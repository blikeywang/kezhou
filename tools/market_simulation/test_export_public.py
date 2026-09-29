import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from export_public import SYMBOLS, NoRedirect, prepare, publish

NOW = 1790656000000


def sample():
    return {
        "serverTime": NOW, "equity": 100011, "unrealized": 0, "risk": 0, "maxDrawdown": 0.01,
        "markets": [{"symbol": s, "source": "public OHLC", "sourceUrl": "https://example.com/price?token=hidden", "executionBars": [], "site_token": "PRIVATE"} for s in SYMBOLS],
        "account": {"initial": 100000, "cash": 100011, "lastRun": NOW, "trades": [
            {"id": "old-trade", "symbol": "BTC", "opened": NOW - 999999999, "closed": NOW - 900000000, "pnl": 11,
             "entrySnapshot": {"summary": "Frozen rationale", "secret": "PRIVATE"}, "events": [{"reason": "Original exit", "authorization": "PRIVATE"}]},
        ], "consumed": ["taken"], "broker_account": "PRIVATE"},
        "reports": [
            {"id": "taken", "symbol": "BTC", "published": NOW - 1, "plan": {"expires": NOW + 10000, "entry": 90}, "secret": "PRIVATE"},
            {"id": "waiting", "symbol": "ETH", "horizon": "1H", "published": NOW - 2, "plan": {"expires": NOW + 10000, "entry": 100}},
            {"id": "expired", "symbol": "CL", "published": NOW - 100, "plan": {"expires": NOW - 1}},
        ],
        "pairs": {"account": {"initial": 100000, "cash": 100000, "trades": [{"id": "pair-open", "pair": "XAU-CL", "legs": [{"symbol": "CL", "entry": 80, "api_key": "PRIVATE"}]}]},
                  "reports": [{"id": "pair-plan", "pair": "XAU-CL", "published": NOW, "history": [{"time": NOW, "ratio": 40}], "structure": {"version": "structure-1.0", "through": NOW, "legs": []}}]},
        "review": {"schedule": {"id": "private-automation-id", "enabled": True, "intervalMinutes": 60},
                   "history": [{"id": "audit", "published": NOW, "checks": [{"id": "pair-open", "book": "pair", "verdict": "suspended", "reason": "Delayed quote", "secret": "PRIVATE"}]}]},
        "cloud": {"lastScheduledSuccess": NOW, "lastError": "PRIVATE backend details"},
        "scheduler_secret": "PRIVATE",
    }


class PublicExportTests(unittest.TestCase):
    def test_all_trades_survive_and_unknown_private_fields_do_not(self):
        public, history = prepare(sample(), NOW)
        body = json.dumps(public)
        self.assertNotIn("PRIVATE", body)
        self.assertNotIn("private-automation-id", body)
        self.assertNotIn("token=hidden", body)
        self.assertEqual(public["account"]["trades"][0]["pnl"], 11)
        self.assertEqual(public["account"]["trades"][0]["entrySnapshot"]["summary"], "Frozen rationale")
        self.assertEqual(len(public["pairs"]["account"]["trades"]), 1)
        self.assertEqual(public["review"]["history"][0]["checks"][0]["verdict"], "suspended")
        self.assertTrue(public["cloud"]["hasError"])
        self.assertEqual(len(history["reports"]), 3)

    def test_latest_pair_chart_survives_history_slimming(self):
        public, history = prepare(sample(), NOW)
        self.assertIn("structure", public["pairs"]["reports"][0])
        self.assertEqual(len(public["pairs"]["reports"][0]["history"]), 1)
        self.assertNotIn("structure", history["pairs"][0])
        self.assertNotIn("history", history["pairs"][0])

    def test_pending_plans_exclude_consumed_and_expired(self):
        public, _ = prepare(sample(), NOW)
        self.assertEqual([r["id"] for r in public["pendingPlans"]], ["waiting"])

    def test_incomplete_or_stale_response_fails_before_publication(self):
        raw = sample()
        raw["markets"].pop()
        with self.assertRaises(ValueError):
            prepare(raw, NOW)
        with self.assertRaises(ValueError):
            prepare(sample(), NOW + 1000000)
        raw = sample()
        raw["account"]["trades"] *= 2
        with self.assertRaises(ValueError):
            prepare(raw, NOW)

    def test_secret_in_allowed_text_blocks_both_files(self):
        public, history = prepare(sample(), NOW)
        token = "private-long-credential"
        history["reports"][0]["summary"] = token
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            (target / "latest.json").write_text("previous")
            with self.assertRaises(ValueError):
                publish(public, history, target, [token])
            self.assertEqual((target / "latest.json").read_text(), "previous")
            self.assertFalse((target / "history.json").exists())

    def test_no_redirect_can_forward_authentication(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, None, {}, "https://other.example/"))

    def test_snapshot_files_are_valid_and_no_nan(self):
        public, history = prepare(sample(), NOW)
        with tempfile.TemporaryDirectory() as directory:
            publish(public, history, Path(directory))
            self.assertTrue(json.loads((Path(directory) / "latest.json").read_text())["paper"])
            self.assertEqual(list(Path(directory).glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
