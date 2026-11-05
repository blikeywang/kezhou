"""Lifecycle, provider scope and calendar-screen regression tests."""
import copy
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch
import history_coverage as coverage


def stamp(day):
    return int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())


def history(days):
    return {"bars": [[stamp(d), 10, 12, 9, 11, 100] for d in days], "timeZone": "UTC",
            "priceBasis": "adjusted", "source": "Yahoo Finance", "ticker": "AAPL", "dataKind": "ohlcv"}


class CoverageTests(unittest.TestCase):
    meta = {"grp": "stock", "provider": "yahoo", "kind": "stock", "ticker": "AAPL"}

    def test_listing_start_and_zero_gaps_do_not_certify_full_history(self):
        result = coverage.audit("AAPL", self.meta, history(["1980-12-12", "1980-12-15"]), "1d", stamp("2026-11-05"))
        self.assertEqual(result["startStatus"], "start-reached")
        self.assertEqual(result["continuity"]["missingCount"], 0)
        self.assertFalse(result["fullHistoryVerified"])

    def test_source_start_does_not_replace_independent_ipo_evidence(self):
        h = history(["2026-11-02", "2026-11-03"])
        h["providerFirstDate"] = "2026-11-02"
        result = coverage.audit("UNKNOWN", self.meta, h, "1d", stamp("2026-11-05"))
        self.assertEqual(result["startStatus"], "unverified")
        self.assertIsNone(result["lifecycle"])
        self.assertEqual(result["providerFirstDate"], "2026-11-02")

    def test_early_gap_and_spac_predecessor_are_distinct(self):
        missing = coverage.audit("AMD", self.meta, history(["1979-10-15"]), "1d", stamp("2026-11-05"))
        earlier = coverage.audit("SOFI", self.meta, history(["2021-01-04"]), "1d", stamp("2026-11-05"))
        self.assertEqual(missing["startStatus"], "missing-early")
        self.assertEqual(earlier["startStatus"], "before-reference")
        self.assertEqual(earlier["lifecycle"]["note"], "spac-predecessor")

    def test_known_market_closures_not_reported_as_gaps_but_missing_session_is(self):
        h = history(["2001-09-10", "2001-09-17", "2001-09-19"])
        result = coverage.audit("AAPL", self.meta, h, "1d", stamp("2026-11-05"))
        self.assertEqual(result["continuity"]["missingExamples"], ["2001-09-18"])
        self.assertEqual(result["continuity"]["missingCount"], 1)
        h = history(["2025-01-08", "2025-01-10"])
        self.assertEqual(coverage.audit("AAPL", self.meta, h, "1d", stamp("2026-11-05"))["continuity"]["missingCount"], 0)

    def test_cash_calendar_not_applied_to_futures_or_pre_1970(self):
        h = history(["1969-12-31", "1970-01-02"])
        result = coverage.audit("AAPL", self.meta, h, "1d", stamp("2026-11-05"))
        self.assertEqual(result["continuity"]["uncheckedEarlierBars"], 1)
        result = coverage.audit("NQ", dict(self.meta, kind="future"), h, "1d", stamp("2026-11-05"))
        self.assertIsNone(result["continuity"]["missingCount"])
        self.assertEqual(result["continuity"]["status"], "not-audited")

    def test_crypto_gaps_are_counted_without_filling_prices(self):
        h = history(["2010-07-18", "2010-07-20"])
        original = copy.deepcopy(h)
        result = coverage.audit("BTC", dict(self.meta, grp="crypto"), h, "1d", stamp("2026-11-05"))
        self.assertEqual(result["startStatus"], "network-not-price")
        self.assertEqual(result["continuity"]["missingCount"], 1)
        self.assertEqual(h, original)

    def test_reference_dates_are_primary_urls_and_not_invented_for_unknown_symbols(self):
        for item in coverage.LIFECYCLES.values():
            datetime.fromisoformat(item["date"])
            self.assertTrue(item["sourceUrl"].startswith("https://"))
        self.assertNotIn("UNKNOWN", coverage.LIFECYCLES)

    def test_report_keeps_cached_audit_date(self):
        audit = coverage.audit("AAPL", self.meta, history(["1980-12-12"]), "1d", stamp("2026-11-04"))
        audit["refreshStatus"] = "cached"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.md"
            coverage.write_report({"AAPL": {"coverage": audit}}, "2026-11-05", path)
            text = path.read_text()
        self.assertIn("cached audit from 2026-11-04", text)
        self.assertIn("No series is certified", text)


class ReferencePriceTests(unittest.TestCase):
    def response(self, days=("2010-07-18", "2010-07-19")):
        return {"data": [{"asset": "btc", "time": d+"T00:00:00.000000000Z", "PriceUSD": "0.08584"} for d in days]}

    def test_reference_preserves_close_only_and_excludes_open_daily_interval(self):
        with patch.object(fetch, "_get", return_value=self.response()):
            h = fetch.fetch_coinmetrics("btc", now=stamp("2010-07-19T12:00:00"))
        self.assertEqual(h["bars"], [[stamp("2010-07-18"), None, None, None, .08584, None]])
        self.assertEqual(h["source"], "Coin Metrics")
        self.assertEqual(h["priceBasis"], "usd-reference-close")
        self.assertEqual(h["ticker"], "BTC / USD")

    def test_null_is_not_zero_and_bad_values_fail(self):
        response = self.response()
        response["data"][0]["PriceUSD"] = None
        with patch.object(fetch, "_get", return_value=response):
            h = fetch.fetch_coinmetrics("btc", now=stamp("2026-11-05"))
        self.assertEqual(len(h["bars"]), 1)
        self.assertEqual(h["ingestQuality"]["missingPriceRows"], 1)
        for bad in ("0", "-1", "NaN", "inf"):
            response["data"][0]["PriceUSD"] = bad
            with patch.object(fetch, "_get", return_value=response), self.assertRaises(ValueError):
                fetch.fetch_coinmetrics("btc", now=stamp("2026-11-05"))

    def test_pagination_checks_host_asset_and_monotonicity(self):
        for next_url in ("https://example.test/private", fetch.COINMETRICS_ENDPOINT+"?assets=eth"):
            response = dict(self.response(), next_page_url=next_url)
            with patch.object(fetch, "_get", return_value=response) as get, patch.object(fetch.time, "sleep"), self.assertRaises(ValueError):
                fetch.fetch_coinmetrics("btc", now=stamp("2026-11-05"))
            self.assertEqual(get.call_count, 1)
        response = self.response()
        response["data"].append(response["data"][0])
        with patch.object(fetch, "_get", return_value=response), self.assertRaises(ValueError):
            fetch.fetch_coinmetrics("btc", now=stamp("2026-11-05"))

    def test_correct_pagination_and_identity(self):
        first = self.response(("2010-07-18",))
        first["next_page_url"] = fetch.COINMETRICS_ENDPOINT+"?assets=btc&metrics=PriceUSD&frequency=1d&start_time=2009-01-03&page_token=x"
        with patch.object(fetch, "_get", side_effect=[first,self.response(("2010-07-19",))]), patch.object(fetch.time, "sleep"):
            self.assertEqual(len(fetch.fetch_coinmetrics("btc", now=stamp("2026-11-05"))["bars"]), 2)
        first["data"][0]["asset"] = "eth"
        with patch.object(fetch, "_get", return_value=first), self.assertRaises(ValueError):
            fetch.fetch_coinmetrics("btc", now=stamp("2026-11-05"))


if __name__ == "__main__":
    unittest.main()
