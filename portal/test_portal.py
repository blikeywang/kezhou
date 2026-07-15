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
        self.assertEqual(manifest["privacy"]["reviewRuntime"], "browser_local")
        self.assertEqual(manifest["privacy"]["reviewDemo"], "optional_synthetic")

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
        self.assertIn("原始记录仅在本页内存处理", review)
        self.assertIn("查看完整教学案例", review)
        self.assertIn("连接自托管 API", review)

    def test_review_runtime_is_published_as_a_local_first_bundle(self):
        expected = [
            "review/review-engine.mjs",
            "review/review-app.mjs",
            "review/review.css",
            "review/sample-trades.csv",
            "review/sample-bars.csv",
        ]
        for rel in expected:
            self.assertTrue((self.site / rel).exists(), rel)

        review = (self.site / "review" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="tradeFile"', review)
        self.assertIn('id="barFile"', review)
        self.assertIn('id="tradeDialog"', review)
        self.assertIn('id="betterPlan"', review)
        self.assertIn("看这笔怎样做得更好", review)
        self.assertIn("导出聚合报告", review)
        self.assertNotIn("$420", review)
        app = (self.site / "review" / "review-app.mjs").read_text(encoding="utf-8")
        self.assertIn("normalizeTradeRecords", app)
        self.assertIn("createExportReport", app)
        self.assertIn("credentials: \"omit\"", app)

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
        self.assertIn('id="tourLaunch"', app)
        self.assertIn('id="productTour" hidden', app)
        self.assertIn("EV Desk 使用教程", app)
        self.assertIn("以后不再自动弹出", app)
        self.assertIn("教学示例 · 不是当前交易建议", app)
        self.assertIn("主计划是回踩 98 入场、95 止损、104 目标", app)
        self.assertIn("62分不是 62% 胜率", app)
        self.assertIn("把 NQ 放入等待清单", app)


if __name__ == "__main__":
    unittest.main()
