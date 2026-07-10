"""V2.1 可信度与数据健康的标准库回归测试。"""
from __future__ import annotations
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build  # noqa: E402
import fetch  # noqa: E402


class TrustMetricsTest(unittest.TestCase):
    def _prim(self):
        return {
            "condC": [[0, .55, 0, 0, 0], [0, .60, 0, 0, 0], [0, .70, 0, 0, 0]],
            "condD": [[0, .54, 0, 0, 0], [0, .58, 0, 0, 0], [0, .66, 0, 0, 0]],
            "bas": [[0, .52, 0], [0, .53, 0], [0, .54, 0]],
            "corrRange": [-.8, .93], "nCorr": 50, "nDtw": 50, "robust": 83,
        }

    def test_trust_fields(self):
        t = build._trust(self._prim(), "crypto")
        self.assertEqual(t["p"], 68)
        self.assertEqual(t["edge"], 14)
        self.assertEqual(t["gap"], 4)
        self.assertTrue(t["agree"])
        self.assertEqual(t["neff"], 25)
        self.assertLess(t["ci"][0], t["p"])
        self.assertGreater(t["ci"][1], t["p"])
        self.assertIn(t["grade"], {"strong", "moderate", "weak"})

    def test_small_edge_cannot_be_strong(self):
        p = self._prim()
        p["condC"][2][1] = .58
        p["condD"][2][1] = .56
        p["bas"][2][1] = .54
        t = build._trust(p, "crypto")
        self.assertEqual(t["edge"], 3)
        self.assertNotEqual(t["grade"], "strong")

    def test_previous_delta(self):
        new = {"trust": {"p": 68, "edge": 14}, "corr": [-.8, .93], "vk": "bull"}
        old = {"cond": [[], [], [60, 0, "", 64, 0, "", 54]],
               "corr": [-.8, .90], "vk": "neutral", "refRange": ["x", "2026-07-09"]}
        build.attach_previous(new, old)
        self.assertTrue(new["change"]["available"])
        self.assertEqual(new["change"]["p"], 6)
        self.assertEqual(new["change"]["edge"], 6)
        self.assertEqual(new["change"]["sim"], 3)
        self.assertTrue(new["change"]["verdict"])


class FetchFailoverTest(unittest.TestCase):
    def test_binance_failover_and_endpoint(self):
        original_get = fetch._get
        rows = [[1000, "0", "0", "9", "10"], [2000, "0", "0", "10", "11"]]
        calls = []

        def fake_get(url, timeout=25, retries=3):
            calls.append(url)
            if "data-api.binance.vision" in url:
                raise RuntimeError("simulated")
            return rows

        try:
            fetch._get = fake_get
            ts, close, low = fetch.fetch_symbol("BTC")
        finally:
            fetch._get = original_get
        self.assertEqual(ts, [1, 2])
        self.assertEqual(close, [10.0, 11.0])
        self.assertEqual(low, [9.0, 10.0])
        self.assertIn("data-api.binance.vision", calls[0])
        self.assertEqual(fetch.LAST_ENDPOINT["BTC"], "https://api-gcp.binance.com")


if __name__ == "__main__":
    unittest.main()
