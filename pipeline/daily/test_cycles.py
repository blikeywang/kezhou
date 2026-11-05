"""Long-window source fidelity, calendar boundaries and non-overlapping evidence."""
import copy
import math
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cycles
import fetch
import run


def stamp(value, zone="UTC"):
    return int(datetime.fromisoformat(value).replace(tzinfo=ZoneInfo(zone)).timestamp())


def history(start="2017-08-17", end="2026-11-05", zone="UTC", weekdays=False):
    day, stop = datetime.fromisoformat(start), datetime.fromisoformat(end)
    rows = []
    while day < stop:
        if not weekdays or day.weekday() < 5:
            i = len(rows)
            close = 100 * math.exp(.0003*i + .3*math.sin(i/83) + .08*math.cos(i/17))
            rows.append([stamp(day.isoformat(), zone), close*.995, close*1.01, close*.99, close, 1000+i])
        day += timedelta(days=1)
    return {"bars": rows, "timeZone": zone, "priceBasis": "spot" if not weekdays else "adjusted"}


class CalendarTests(unittest.TestCase):
    def test_crypto_requires_seven_days_and_drops_current_week(self):
        h = history("2026-10-19", "2026-11-05")
        result = cycles.weekly_history(h, "crypto", stamp("2026-11-05"))
        self.assertEqual(len(result["bars"]), 2)
        self.assertEqual(result["sessionEnds"], ["2026-10-25", "2026-11-01"])
        first = h["bars"][:7]
        self.assertEqual(result["bars"][0], [first[0][0], first[0][1], max(r[2] for r in first),
                                            min(r[3] for r in first), first[-1][4], sum(r[5] for r in first)])
        del h["bars"][2]
        result = cycles.weekly_history(h, "crypto", stamp("2026-11-05"))
        self.assertEqual(result["sessionEnds"], ["2026-11-01"])

    def test_exchange_weeks_respect_dst_holidays_and_initial_partial_week(self):
        h = history("2026-03-04", "2026-03-18", "America/New_York", weekdays=True)
        h["bars"] = [r for r in h["bars"] if r[0] != stamp("2026-03-11", "America/New_York")]
        result = cycles.weekly_history(h, "stock", stamp("2026-03-18"))
        self.assertEqual(len(result["bars"]), 1)
        self.assertEqual(result["bars"][0][0], stamp("2026-03-09", "America/New_York"))
        self.assertEqual(result["sessionEnds"], ["2026-03-13"])

    def test_missing_ohlc_and_volume_are_not_invented(self):
        h = history("2026-10-19", "2026-10-26")
        h["bars"][0][1] = h["bars"][2][2] = h["bars"][3][5] = None
        row = cycles.weekly_history(h, "crypto", stamp("2026-10-27"))["bars"][0]
        self.assertEqual((row[1], row[2], row[5]), (None, None, None))
        self.assertEqual(row[4], h["bars"][-1][4])


class ProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.history = history()
        cls.meta = {"grp": "crypto", "ticker": "BTCUSDT"}
        cls.now = stamp("2026-11-05T09:00:00")

    def build(self, key="1d-1y", source=None, now=None):
        return cycles.build_profile("BTC", self.meta, source or self.history, key,
                                    cycles.configurations("crypto")[key], now or self.now)

    def test_windows_distinguish_calendar_days_from_trading_sessions(self):
        self.assertEqual([v["window"] for v in cycles.configurations("crypto").values()], [180,365,26,52])
        self.assertEqual([v["window"] for v in cycles.configurations("stock").values()], [126,252,26,52])

    def test_year_means_endpoint_and_discloses_incomplete_2018_coverage(self):
        p = self.build()
        a, b = p["comparison"]
        self.assertEqual(a["eligibleStart"], "2018-08-16")
        self.assertEqual(a["eligibleEnd"], "2018-12-31")
        self.assertLess(a["candidates"], b["candidates"])
        self.assertEqual(b["candidates"], 365)
        self.assertEqual(a["expectedEndpoints"], 365)
        self.assertTrue(p["annualCases"]["2018"][0]["bars"][p["annualCases"]["2018"][0]["start"]][0] < stamp("2018-01-01"))

    def test_source_prices_are_exact_and_all_outcomes_precede_current_window(self):
        original = {row[0]: row for row in self.history["bars"]}
        for key in ("1d-6m", "1d-1y"):
            p = self.build(key)
            self.assertEqual(p["methods"], ["corr"])
            for s in [p["current"], *p["cases"]["corr"], *sum(p["annualCases"].values(), [])]:
                self.assertEqual(s["end"]-s["start"]+1, p["window"])
                for row in s["bars"]:
                    self.assertEqual(row, original[row[0]])
                if s["id"] != "current":
                    self.assertLess(s["bars"][-1][0], p["current"]["startTime"])
                    self.assertEqual(len(s["bars"])-s["end"]-1, max(p["horizons"]))
            ends = sorted(s["endTime"] for s in p["cases"]["corr"])
            self.assertTrue(all(b-a >= p["window"]*86400 for a,b in zip(ends, ends[1:])))

    def test_scores_recompute_from_only_log_close_window(self):
        p = self.build()
        def normalized(segment):
            values = cycles.np.log([r[4] for r in segment["bars"][segment["start"]:segment["end"]+1]])
            return (values-values.mean()) / values.std()
        for s in p["cases"]["corr"]:
            score = float(cycles.np.dot(normalized(p["current"]), normalized(s))/p["window"])
            self.assertAlmostEqual(score, s["score"], places=10)

    def test_weekly_end_date_is_completed_session_not_monday_label(self):
        p = self.build("1w-1y")
        self.assertEqual(p["asofDay"], "2026-11-01")
        self.assertEqual(p["asof"], stamp("2026-10-26"))
        for year, cases in p["annualCases"].items():
            for s in cases:
                self.assertEqual(s["endDate"][:4], year)
                self.assertEqual(datetime.fromisoformat(s["endDate"]).weekday(), 6)

    def test_current_gap_fails_and_historical_gaps_exclude_affected_cases(self):
        h = copy.deepcopy(self.history)
        del h["bars"][-5]
        with self.assertRaisesRegex(ValueError, "Current profile window"):
            self.build(source=h)
        h = copy.deepcopy(self.history)
        missing = stamp("2023-02-01")
        h["bars"] = [r for r in h["bars"] if r[0] != missing]
        p = self.build(source=h)
        for s in [*p["cases"]["corr"], *sum(p["annualCases"].values(), [])]:
            self.assertFalse(s["startTime"] <= missing <= s["bars"][-1][0])

    def test_missing_year_is_unavailable_not_zero_score(self):
        p = self.build(source=history("2020-01-01"))
        self.assertFalse(p["comparison"][0]["available"])
        self.assertNotIn("score", p["comparison"][0])
        self.assertEqual(p["verdict"]["reason"], "unavailable")

    def test_metrics_use_close_drawdown_and_real_sample_counts(self):
        self.assertAlmostEqual(cycles._metrics([100,120,90,99])["return"], -.01)
        self.assertEqual(cycles._metrics([100,120,90,99])["drawdown"], -.25)
        p = self.build()
        self.assertLessEqual(p["summary"][0]["n"], 20)
        self.assertGreater(p["summary"][0]["n"], 0)
        self.assertEqual(len({row["n"] for row in p["summary"]}), 1)

    def test_weak_analogues_do_not_manufacture_a_zero_percent_up_rate(self):
        h = copy.deepcopy(self.history)
        n = len(h["bars"])
        for i, row in enumerate(h["bars"]):
            close = math.exp((i if i < n-365 else n-i)/1000)*100
            row[1:5] = [close,close,close,close]
        p = self.build(source=h)
        self.assertEqual(p["verdict"]["reason"], "weak")
        self.assertTrue(all(row["n"] == 0 and row["upRate"] is None and row["median"] is None for row in p["summary"]))

    def test_refresh_failure_preserves_cached_snapshot_and_original_asof(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profiles = cycles.refresh_profiles("BTC", self.meta, self.history, {}, self.now, root)
            self.assertTrue(all(p["status"] == "fresh" for p in profiles.values()))
            before = {p.name: p.read_bytes() for p in root.glob("*.json")}
            fallback = cycles.refresh_profiles("BTC", self.meta, None, profiles, self.now+86400, root)
            for key, descriptor in fallback.items():
                self.assertEqual(descriptor["status"], "cached")
                self.assertEqual(descriptor["asof"], profiles[key]["asof"])
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.glob("*.json")})

    def test_unavailable_history_never_writes_synthetic_data(self):
        with tempfile.TemporaryDirectory() as directory:
            result = cycles.refresh_profiles("BTC", self.meta, history("2026-10-01"), {}, self.now, Path(directory))
            self.assertTrue(all(p["status"] == "unavailable" and "url" not in p for p in result.values()))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_fetch_captures_base_history_before_daily_request_overwrites_cache(self):
        base = {"bars": [[1,1,1,1,1,1]], "timeZone": "UTC"}
        daily = {"bars": [[2,2,2,2,2,2]], "timeZone": "UTC"}
        def daily_fetch(pair, interval):
            self.assertEqual(interval, "1d")
            fetch.LAST_HISTORY[pair] = fetch.LAST_HISTORY[(pair, interval)] = daily
        with patch.dict(fetch.LAST_HISTORY, {"BTCUSDT": base}), \
             patch.object(fetch, "fetch_symbol", return_value=([1],[1],[1])), \
             patch.object(fetch, "fetch_binance", side_effect=daily_fetch), \
             patch.object(fetch, "fetch_coinmetrics", return_value={"source":"Coin Metrics"}):
            result = run.get_ohlc("BTC", "crypto", False)[3]
            self.assertIs(result["history"], base)
            self.assertIs(result["dailyHistory"], daily)

    def test_early_reference_profiles_are_independent_close_only_series(self):
        h = history("2010-07-18")
        h.update(source="Coin Metrics", ticker="BTC / USD", dataKind="close-only", priceBasis="usd-reference-close")
        for row in h["bars"]:
            row[1] = row[2] = row[3] = row[5] = None
        with tempfile.TemporaryDirectory() as directory:
            profiles = cycles.refresh_profiles("BTC", self.meta, h, {}, self.now, Path(directory), series="usd")
            self.assertEqual(set(profiles), {"usd-"+k for k in cycles.configurations("crypto")})
            self.assertTrue(all(p["source"] == "Coin Metrics" for p in profiles.values()))
        p = cycles.build_profile("BTC", self.meta, h, "usd-1d-1y", cycles.configurations("crypto")["1d-1y"], self.now)
        self.assertEqual(p["comparison"][0]["candidates"], 365)
        self.assertEqual(p["comparison"][0]["eligibleStart"], "2018-01-01")
        self.assertEqual(p["ticker"], "BTC / USD")
        self.assertTrue(all(row[1:4] == [None,None,None] and row[5] is None for row in p["current"]["bars"]))

    def test_usd_profile_rejects_a_binance_substitution(self):
        with tempfile.TemporaryDirectory() as directory:
            result = cycles.refresh_profiles("BTC", self.meta, self.history, {}, self.now, Path(directory), series="usd")
            self.assertTrue(all(p["status"] == "unavailable" for p in result.values()))
            self.assertFalse(list(Path(directory).glob("*.json")))


if __name__ == "__main__":
    unittest.main()
