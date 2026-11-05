"""Coverage, completed-candle and partial-refresh regression tests."""
from __future__ import annotations

import copy
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
import build
import fetch
import run
import universe


def stamp(value):
    return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp())


def yahoo_payload():
    return {"chart": {"error": None, "result": [{
        "meta": {"exchangeTimezoneName": "America/New_York", "currentTradingPeriod": {
            "regular": {"start": stamp("2026-11-04T14:30:00"), "end": stamp("2026-11-04T21:00:00")}}},
        "timestamp": [stamp("2026-11-03T14:30:00"), stamp("2026-11-04T14:30:00")],
        "indicators": {"quote": [{"close": [100, 120], "low": [90, 110]}],
                       "adjclose": [{"adjclose": [50, 60]}]},
    }]}}


class UniverseTests(unittest.TestCase):
    def test_every_catalogue_symbol_has_a_real_mapping(self):
        names = universe.load_names()
        self.assertEqual(len(names), 48)
        self.assertEqual(set(names), set(fetch.CRYPTO) | set(fetch.YAHOO))
        cats = universe.catalogue(names)
        self.assertEqual([len(cats[g]) for g in universe.GROUPS], [10, 18, 8, 6, 6])
        self.assertEqual(fetch.YAHOO["NQ"], "NQ=F")
        self.assertEqual(fetch.YAHOO["ES"], "ES=F")
        self.assertEqual(fetch.YAHOO["NDX"], "^NDX")
        self.assertNotEqual(names["NDX"]["kind"], names["QQQ"]["kind"])
        for group, entries in cats.items():
            self.assertIn(group, build.CFG)
            self.assertIn(group, build._HL)
            for entry in entries:
                self.assertNotIn("tmpl", entry)
                self.assertEqual(entry["grp"], group)


class CompletedCandlesTests(unittest.TestCase):
    def test_yahoo_open_session_excluded_and_adjustment_applied(self):
        ts, close, low = fetch._parse_yahoo(yahoo_payload(), stamp("2026-11-04T18:00:00"))
        self.assertEqual(ts, [stamp("2026-11-03T14:30:00")])
        self.assertEqual(close, [50])
        self.assertEqual(low, [45])

    def test_yahoo_closed_session_and_duplicate(self):
        payload = yahoo_payload()
        result = payload["chart"]["result"][0]
        result["timestamp"].append(stamp("2026-11-04T21:01:00"))
        result["indicators"]["quote"][0]["close"].append(122)
        result["indicators"]["quote"][0]["low"].append(110)
        result["indicators"]["adjclose"][0]["adjclose"].append(61)
        ts, close, low = fetch._parse_yahoo(payload, stamp("2026-11-04T22:00:00"))
        self.assertEqual(len(ts), 2)
        self.assertEqual(ts[-1], stamp("2026-11-04T14:30:00"))
        self.assertEqual(close[-1], 61)
        self.assertEqual(low[-1], 55)

    def test_futures_live_calendar_session_excluded(self):
        payload = yahoo_payload()
        result = payload["chart"]["result"][0]
        result["meta"]["currentTradingPeriod"]["regular"] = {
            "start": stamp("2026-11-04T05:00:00"), "end": stamp("2026-11-05T04:59:00")}
        result["timestamp"] = [stamp("2026-11-03T05:00:00"), stamp("2026-11-04T05:00:00")]
        ts, _, _ = fetch._parse_yahoo(payload, stamp("2026-11-05T03:00:00"))
        self.assertEqual(len(ts), 1)

    def test_missing_calendar_excludes_current_exchange_day(self):
        payload = yahoo_payload()
        del payload["chart"]["result"][0]["meta"]["currentTradingPeriod"]
        ts, _, _ = fetch._parse_yahoo(payload, stamp("2026-11-04T23:00:00"))
        self.assertEqual(len(ts), 1)

    def test_invalid_prices_fail_instead_of_polluting_log_returns(self):
        for bad in (0, -1, float("nan"), float("inf")):
            payload = yahoo_payload()
            payload["chart"]["result"][0]["indicators"]["quote"][0]["close"][0] = bad
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                fetch._parse_yahoo(payload, stamp("2026-11-04T23:00:00"))

    def test_futures_separate_close_is_preserved_and_counted(self):
        payload = yahoo_payload()
        result = payload["chart"]["result"][0]
        result["meta"]["instrumentType"] = "FUTURE"
        result["indicators"]["quote"][0]["low"][0] = 101
        quality = {}
        _, close, low = fetch._parse_yahoo(payload, stamp("2026-11-04T23:00:00"), quality)
        self.assertEqual(close[0], 50)
        self.assertEqual(low[0], 50.5)
        self.assertEqual(quality["separateCloseRows"], 1)
        result["meta"]["instrumentType"] = "EQUITY"
        with self.assertRaises(ValueError):
            fetch._parse_yahoo(payload, stamp("2026-11-04T23:00:00"))

    def test_binance_uses_close_time(self):
        rows = [[1000, "9", "12", "9", "10", "1", 1999],
                [2000, "10", "12", "10", "11", "1", 2999]]
        with patch.object(fetch, "_get", return_value=rows), patch.object(fetch.time, "time", return_value=2.5):
            ts, close, _ = fetch._fetch_binance_from("https://example.test", "BTCUSDT", "4h", 10)
        self.assertEqual(ts, [1])
        self.assertEqual(close, [10])

    def test_yahoo_url_encoding_and_fallback(self):
        calls = []
        def get(url):
            calls.append(url)
            if "query1" in url:
                raise RuntimeError("upstream down")
            return yahoo_payload()
        with patch.object(fetch, "_get", side_effect=get):
            fetch.fetch_yahoo("^NDX")
        self.assertIn("/%5ENDX?", calls[0])
        self.assertIn("query2", calls[1])

    def test_default_daily_request_uses_fixed_1998_start_not_a_rolling_range(self):
        now = stamp("2026-11-05T08:00:00")
        with patch.object(fetch, "_get", return_value=yahoo_payload()) as get, \
             patch.object(fetch.time, "time", return_value=now):
            fetch.fetch_yahoo("^NDX")
        query = parse_qs(urlparse(get.call_args.args[0]).query)
        self.assertEqual(query["period1"], [str(stamp("1998-01-01T00:00:00"))])
        self.assertEqual(query["period2"], [str(now)])
        self.assertEqual(query["interval"], ["1d"])
        self.assertNotIn("range", query)
        self.assertEqual(fetch.LAST_HISTORY["^NDX"]["requestedStart"], "1998-01-01")

    def test_explicit_range_remains_available_without_claiming_1998(self):
        with patch.object(fetch, "_get", return_value=yahoo_payload()) as get:
            fetch.fetch_yahoo("AAPL", rng="1y")
        query = parse_qs(urlparse(get.call_args.args[0]).query)
        self.assertEqual(query["range"], ["1y"])
        self.assertNotIn("period1", query)
        self.assertIsNone(fetch.LAST_HISTORY["AAPL"]["requestedStart"])

    def test_upstream_monthly_aggregation_cannot_pass_as_daily_candles(self):
        payload = yahoo_payload()
        payload["chart"]["result"][0]["meta"]["dataGranularity"] = "1mo"
        with patch.object(fetch, "_get", return_value=payload):
            with self.assertRaisesRegex(RuntimeError, "received 1mo"):
                fetch.fetch_yahoo("^NDX")


class EvidenceTests(unittest.TestCase):
    def test_extended_history_is_not_reported_as_a_market_probability_change(self):
        old = {"health":{"historyStart":"2011-11-01"},"trust":{"p":50,"edge":0}}
        new = {"health":{"historyStart":"1998-01-02"},"trust":{"p":60,"edge":10}}
        build.attach_previous(new, old)
        self.assertFalse(new["change"]["available"])
        self.assertTrue(new["change"]["historyExpanded"])
        self.assertNotIn("p", new["change"])

    def test_low_sample_never_inflates_effective_count_or_grade(self):
        prim = {"condC": [[1, .9, 0, 0, 0]] * 5, "condD": [[1, .9, 0, 0, 0]] * 5,
                "bas": [[1, .5, 0]] * 5, "nCorr": 2, "nDtw": 3, "robust": 100,
                "corrRange": [-.9, .99]}
        trust = build._trust(prim, "futures")
        self.assertLessEqual(trust["neff"], trust["n"])
        self.assertEqual(trust["grade"], "weak")

    def test_asset_stars_use_actual_counts_and_missing_seasons_stay_null(self):
        prim = {"condC": [[1, .9, 0, 0, 0]] * 5, "condD": [[1, .9, 0, 0, 0]] * 5,
                "bas": [[1, .5, 0]] * 5, "nCorr": 2, "nDtw": 3, "robust": 100,
                "corrRange": [-.9, .99], "mC": [], "nc": [100] * 40,
                "refRange": ["2026-01-01", "2026-03-01"]}
        season = {"sum": {key: [0, 0, 0] for key in ("5", "21", "63")}, "py": [[2025, .1, None, None]]}
        with patch.object(build, "_sig", return_value="") as sig:
            asset = build.build_asset("NQ", "NQ", "NQ", "futures", prim, season)
        self.assertEqual([call.args[1] for call in sig.call_args_list], [2, 3] * 5)
        self.assertEqual(asset["seasyears"], [[2025, 10, None, None]])

    def test_health_ages_crypto_and_daily_differently(self):
        self.assertEqual(run.data_status(100, "crypto", now=100 + 19 * 3600), "stale")
        self.assertEqual(run.data_status(100, "futures", now=100 + 3 * 86400), "fresh")
        self.assertEqual(run.data_status(100, "stock", now=100 + 6 * 86400), "stale")


class PartialRefreshTests(unittest.TestCase):
    def test_new_symbol_failure_is_not_reported_healthy(self):
        names = {k: universe.load_names()[k] for k in ("NQ", "ES")}
        old = {"NQ": {"last": None, "refRange": ["2026-01-01", "2026-02-01"],
                      "health": {"asof": "2026-02-01", "source": "Yahoo Finance"}}}
        original = copy.deepcopy(old)
        with patch.object(run.inject, "load_meta_names", return_value=names), \
             patch.object(run, "_load_existing", return_value=(old, {"dark": {}, "light": {}})), \
             patch.object(run, "get_ohlc", side_effect=RuntimeError("upstream unavailable")), \
             patch.object(run.inject, "inject") as publish, \
             patch.object(run, "_ensure_ui_explanations"), patch.object(run, "_ensure_ui_v21"), \
             redirect_stdout(io.StringIO()):
            run.main()
        data = publish.call_args.args[0]
        self.assertEqual(data["run"]["status"], "partial")
        self.assertEqual(data["run"]["unavailable"], ["ES"])
        self.assertEqual(data["run"]["failed"], ["NQ", "ES"])
        self.assertEqual(data["run"]["fresh"], 0)
        self.assertEqual(data["run"]["cached"], 1)
        self.assertNotIn("ES", data["assets"])
        self.assertEqual(old, original)

    def test_total_failure_without_cache_leaves_page_unchanged(self):
        with patch.object(run.inject, "load_meta_names", return_value={"NQ": universe.load_names()["NQ"]}), \
             patch.object(run, "_load_existing", return_value=({}, {})), \
             patch.object(run, "get_ohlc", side_effect=RuntimeError("unavailable")), \
             patch.object(run.inject, "inject") as publish, redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit):
                run.main()
        publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
