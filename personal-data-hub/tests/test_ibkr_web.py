from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from traderhome_hub.config import Settings
from traderhome_hub.ibkr_web import IbkrWebProvider


class IbkrWebProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_status_exposes_login_without_account_identifiers(self):
        provider = IbkrWebProvider(Settings())
        provider._request = AsyncMock(
            return_value={"authenticated": False, "connected": True, "competing": False}
        )

        status = await provider.status()

        self.assertFalse(status["available"])
        self.assertTrue(status["gateway_available"])
        self.assertTrue(status["authentication_required"])
        self.assertEqual(status["login_url"], "http://127.0.0.1:5001")
        self.assertNotIn("account", str(status).lower())

    async def test_front_future_is_resolved_from_contract_months(self):
        provider = IbkrWebProvider(Settings())
        provider.authenticated = True
        provider.gateway_reachable = True
        future_date = datetime.now(timezone.utc) + timedelta(days=45)
        future_month = future_date.strftime("%b%y").upper()
        future_expiration = int(future_date.strftime("%Y%m%d"))

        async def request(path, **_kwargs):
            if path.endswith("search"):
                return [{
                    "conid": 11004968,
                    "symbol": "ES",
                    "sections": [{"secType": "FUT", "months": future_month}],
                }]
            return [{
                "conid": 123456,
                "symbol": "ES",
                "localSymbol": "ES-TEST",
                "maturityDate": future_expiration,
                "currency": "USD",
                "listingExchange": "CME",
            }]

        provider._request = AsyncMock(side_effect=request)
        contract = await provider._contract("ES")

        self.assertEqual(contract["conid"], 123456)
        self.assertEqual(contract["sec_type"], "FUT")

    async def test_direct_review_is_honest_about_seven_day_limit(self):
        provider = IbkrWebProvider(Settings())
        provider.authenticated = True
        provider.gateway_reachable = True
        provider.last_status_at = 10**12
        now = int(datetime.now(timezone.utc).timestamp() * 1_000)
        provider._request = AsyncMock(return_value=[
            {"execution_id": "1", "symbol": "ESU6", "side": "B", "trade_time_r": now, "size": 1, "price": 6500, "commission": 2.5, "currency": "USD"},
            {"execution_id": "2", "symbol": "ESU6", "side": "S", "trade_time_r": now + 60_000, "size": 1, "price": 6502, "commission": 2.5, "currency": "USD"},
        ])

        with patch("traderhome_hub.ibkr_web.time.monotonic", return_value=1):
            payload = await provider.review_trades(90)

        self.assertEqual(payload["window_days"], 7)
        self.assertEqual(payload["requested_window_days"], 90)
        self.assertFalse(payload["quality"]["history_complete"])
        self.assertEqual(len(payload["trades"]), 1)
        self.assertEqual(payload["trades"][0]["net_pnl"], 95)


if __name__ == "__main__":
    unittest.main()
