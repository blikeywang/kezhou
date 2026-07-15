from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from portal.build_site import build


class PortalBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.site = Path(self.tmp.name) / "site"
        self.manifest = build(self.site)

    def tearDown(self):
        self.tmp.cleanup()

    def test_expected_routes_and_shared_shell(self):
        expected = [
            "index.html",
            "history/index.html",
            "decision/index.html",
            "decision/app.html",
            "decision/tos.html",
            "review/index.html",
            "standards/index.html",
        ]
        for rel in expected:
            path = self.site / rel
            self.assertTrue(path.exists(), rel)
            html = path.read_text(encoding="utf-8")
            self.assertIn('data-traderhome-shell="v3"', html, rel)
            self.assertIn('rel="canonical"', html, rel)
            self.assertIn('name="theme-color"', html, rel)
            self.assertIn('rel="icon"', html, rel)

    def test_history_keeps_generated_data(self):
        html = (self.site / "history" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="APPDATA"', html)
        self.assertIn('data-trust-version="2.1"', html)
        self.assertIn('property="og:url" content="https://traderhome-histroy.xyz/history/"', html)
        self.assertIn('content="https://traderhome-histroy.xyz/history/og.png"', html)

    def test_private_review_ledger_is_not_published(self):
        self.assertFalse((self.site / "review" / "data" / "review-data.json").exists())
        manifest = json.loads((self.site / "traderhome-manifest.json").read_text())
        self.assertFalse(manifest["privacy"]["privateTradeLedgerPublished"])
        self.assertEqual(manifest["privacy"]["reviewDemo"], "synthetic")

    def test_professional_product_contracts_and_evidence_standard(self):
        manifest = json.loads((self.site / "traderhome-manifest.json").read_text())
        self.assertEqual(manifest["version"], 3)
        self.assertEqual(set(manifest["productContracts"]), {"history", "decision", "review"})
        self.assertEqual(manifest["evidenceLabels"], ["DATA", "DERIVED", "FORWARD", "METHOD_DEMO"])
        home = (self.site / "index.html").read_text(encoding="utf-8")
        self.assertIn("输出契约", home)
        standards = (self.site / "standards" / "index.html").read_text(encoding="utf-8")
        for level in (">A<", ">B<", ">C<", ">D<"):
            self.assertIn(level, standards)
        review = (self.site / "review" / "index.html").read_text(encoding="utf-8")
        self.assertIn("当前外部授权真实案例数为 0", review)
        self.assertIn("合成样例", review)

    def test_custom_domain_is_preserved(self):
        self.assertEqual((self.site / "CNAME").read_text().strip(), "traderhome-histroy.xyz")

    def test_decision_runtime_is_published_as_a_complete_bundle(self):
        expected = [
            "decision/data/expert-evidence.js",
            "decision/data/coach-training.js",
            "decision/data/intraday-coaches.js",
            "decision/data/plan-gate-model.js",
            "decision/data/market-snapshots/NQ.json",
            "decision/data/market-snapshots/MSFT.json",
            "decision/vendor/lightweight-charts.standalone.production.js",
            "decision/arena-worker/src/engine.js",
        ]
        for rel in expected:
            self.assertTrue((self.site / rel).exists(), rel)

        app = (self.site / "decision" / "app.html").read_text(encoding="utf-8")
        self.assertIn("data/intraday-coaches.js", app)
        self.assertIn("NQ 日内计划席", app)
        self.assertIn("forwardStep(symbol,timeframe,ohlc.data,CARDS)", app)


if __name__ == "__main__":
    unittest.main()
