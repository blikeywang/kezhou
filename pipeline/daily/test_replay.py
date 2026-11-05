"""A replay must expose exactly the bars used by matching, without fabricated OHLC."""
import copy
import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import fetch
import replay
import run
import universe
from test_universe import yahoo_payload, stamp


class ReplayFetchTests(unittest.TestCase):
    def test_adjusts_all_ohlc_and_preserves_missing_fields(self):
        payload = yahoo_payload()
        quote = payload["chart"]["result"][0]["indicators"]["quote"][0]
        quote.update(open=[96, None], high=[104, None], volume=[1000, None])
        history = {}
        ts, close, low = fetch._parse_yahoo(payload, stamp("2026-11-04T22:00:00"), history=history)
        self.assertEqual(history["bars"][0], [ts[0], 48, 52, 45, 50, 1000])
        self.assertEqual(history["bars"][1], [ts[1], None, None, low[1], close[1], None])
        self.assertEqual(history["timeZone"], "America/New_York")
        self.assertEqual(history["priceBasis"], "adjusted")

    def test_duplicate_session_ohlc_is_replaced_together(self):
        payload = yahoo_payload()
        result = payload["chart"]["result"][0]
        result["timestamp"].append(stamp("2026-11-04T21:01:00"))
        result["indicators"]["quote"][0].update(
            open=[96, 115, 116], high=[104, 123, 125], low=[90, 110, 111],
            close=[100, 120, 122], volume=[1000, 2000, 2100])
        result["indicators"]["adjclose"][0]["adjclose"] = [50, 60, 61]
        history = {}
        ts, _, _ = fetch._parse_yahoo(payload, stamp("2026-11-04T22:00:00"), history=history)
        self.assertEqual(history["bars"][-1], [ts[-1], 58, 62.5, 55.5, 61, 2100])

    def test_binance_ohlc_is_from_same_completed_bar(self):
        rows = [[1000, "9.5", "12", "9", "10", "7", 1999],
                [2000, "10", "12", "10", "11", "8", 2999]]
        with patch.object(fetch, "_get", return_value=rows), patch.object(fetch.time, "time", return_value=2.5):
            fetch._fetch_binance_from("https://example.test", "TESTUSDT", "4h", 10)
        self.assertEqual(fetch.LAST_HISTORY["TESTUSDT"]["bars"], [[1, 9.5, 12, 9, 10, 7]])


class ReplaySnapshotTests(unittest.TestCase):
    def setUp(self):
        self.ts = [1700000000 + i * 14400 for i in range(700)]
        self.close = [100 + i for i in range(700)]
        self.history = {"timeZone": "UTC", "priceBasis": "spot", "bars": [
            [t, c - 1, c + 2, c - 2, c, 10] for t, c in zip(self.ts, self.close)]}
        self.prim = {"matchEnds": {"corr": [[200, .93], [230, .91]], "dtw": [[215, 4.1]]}}

    def build(self):
        return replay.build_replay("BTC", "crypto", self.prim, self.ts, self.close,
                                   self.history, "Binance", "BTCUSDT")

    def test_exact_indices_and_bounded_context(self):
        data = self.build()
        case = data["cases"]["corr"][0]
        self.assertEqual(case["endTime"], self.ts[200])
        self.assertEqual(case["startTime"], self.ts[141])
        self.assertEqual(case["end"] - case["start"] + 1, 60)
        self.assertEqual(case["bars"][case["end"]][4], self.close[200])
        self.assertEqual(len(case["bars"]), 120 + 60 + 360)
        self.assertEqual(data["cases"]["dtw"][0]["endTime"], self.ts[215])
        current = data["current"]
        self.assertEqual(current["end"], len(current["bars"]) - 1)
        self.assertEqual(current["bars"][-1][0], self.ts[-1])

    def test_early_case_context_is_clipped(self):
        self.prim["matchEnds"]["corr"] = [[59, .9]]
        self.assertEqual(self.build()["cases"]["corr"][0]["start"], 0)

    def test_mismatched_close_or_timestamp_rejected(self):
        for column in (0, 4):
            original = copy.deepcopy(self.history)
            self.history["bars"][2][column] += 1
            with self.assertRaises(ValueError):
                self.build()
            self.history = original

    def test_future_overlap_rejected(self):
        self.prim["matchEnds"]["corr"] = [[650, .9]]
        with self.assertRaises(ValueError):
            self.build()

    def test_inconsistent_candle_is_preserved_not_repaired(self):
        self.history["bars"][200][3] = self.close[200] + 1
        case = self.build()["cases"]["corr"][0]
        self.assertEqual(case["invalidCandles"], 1)
        self.assertEqual(case["bars"][case["end"]][3], self.close[200] + 1)
        self.assertFalse(replay.candle_valid(case["bars"][case["end"]]))

    def test_no_history_never_invents_candles(self):
        self.history = None
        self.assertIsNone(self.build())

    def test_failed_replay_does_not_publish_a_partially_built_new_asset(self):
        with patch.object(run.inject, "load_meta_names", return_value={"NQ":universe.load_names()["NQ"]}), \
             patch.object(run, "_load_existing", return_value=({}, {})), \
             patch.object(run, "get_ohlc", return_value=([1], [100], [99], {"source":"Test","endpoint":"test"})), \
             patch.object(run.build, "build_prim", return_value={}), \
             patch.object(run.build, "build_season", return_value={}), \
             patch.object(run.build, "build_asset", return_value={"last":None}), \
             patch.object(run.replay, "build_replay", side_effect=ValueError("mismatched bars")), \
             patch.object(run.inject, "inject") as publish, redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit):
                run.main()
        publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
