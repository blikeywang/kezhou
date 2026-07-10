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
        ]
        for rel in expected:
            path = self.site / rel
            self.assertTrue(path.exists(), rel)
            html = path.read_text(encoding="utf-8")
            self.assertIn('data-traderhome-shell="v1"', html, rel)

    def test_history_keeps_generated_data(self):
        html = (self.site / "history" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="APPDATA"', html)
        self.assertIn('data-trust-version="2.1"', html)

    def test_private_review_ledger_is_not_published(self):
        self.assertFalse((self.site / "review" / "data" / "review-data.json").exists())
        manifest = json.loads((self.site / "traderhome-manifest.json").read_text())
        self.assertFalse(manifest["privacy"]["privateTradeLedgerPublished"])

    def test_custom_domain_is_preserved(self):
        self.assertEqual((self.site / "CNAME").read_text().strip(), "traderhome-histroy.xyz")


if __name__ == "__main__":
    unittest.main()
