import unittest
from unittest.mock import patch
from datetime import datetime, timezone
import fetch

class ReferenceExpansion(unittest.TestCase):
    def test_all_configured_crypto_have_separate_reference(self):
        now = datetime(2026, 11, 15, tzinfo=timezone.utc).timestamp()
        for symbol in fetch.CRYPTO:
            asset = symbol.lower()
            response = {"data": [{"asset": asset, "time": "2020-01-01T00:00:00Z", "PriceUSD": "2"}]}
            with patch.object(fetch, "_get", return_value=response):
                h = fetch.fetch_coinmetrics(asset, now)
            self.assertEqual(h["ticker"], symbol+" / USD")
            self.assertEqual(h["dataKind"], "close-only")
            self.assertEqual(h["bars"][0][1:4], [None]*3)
            self.assertIsNone(h["bars"][0][5])
    def test_unknown_reference_is_rejected(self):
        with self.assertRaises(ValueError): fetch.fetch_coinmetrics("aapl")

if __name__ == "__main__": unittest.main()
