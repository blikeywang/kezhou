from __future__ import annotations

import unittest
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from traderhome_hub.longbridge_sdk import HKDF_INFO, MAGIC, decrypt_cli_token, encrypt_cli_token, sync_cli_token_to_sdk, sync_sdk_token_to_cli
from traderhome_hub.config import Settings
from traderhome_hub.providers import BinanceProvider, LongbridgeProvider, ProviderError, TimedCache, aggregate_four_hour, aggregate_session_four_hour, match_execution_fills, normalize_symbol


class ProviderTests(unittest.TestCase):
    def test_symbol_aliases(self):
        self.assertEqual(normalize_symbol("btc/usd"), "BTCUSDT")
        self.assertEqual(normalize_symbol("aapl"), "AAPL")
        provider = LongbridgeProvider(Settings(), TimedCache(1))
        self.assertEqual(provider.symbol("700.HK"), "700.HK")
        self.assertEqual(provider.symbol("600519.SH"), "600519.SH")

    def test_four_hour_aggregation(self):
        rows = [
            [0, 100, 103, 99, 102, 10],
            [3600, 102, 106, 101, 105, 20],
            [7200, 105, 107, 104, 106, 30],
            [10800, 106, 108, 103, 104, 40],
        ]
        # Historical epochs are filtered as closed; patch them into a current bucket.
        import time
        base = int(time.time() // 14400 * 14400) - 28800
        shifted = [[base + row[0], *row[1:]] for row in rows]
        output = aggregate_four_hour(shifted)
        self.assertEqual(output[-1][1:], [100.0, 108.0, 99.0, 104.0, 100.0])

    def test_fifo_execution_matching(self):
        t0 = datetime(2026, 1, 1, 14, 30, tzinfo=timezone.utc)
        fills = [
            {"id": "1", "symbol": "NQ", "side": "BOT", "time": t0, "quantity": 2, "price": 20000, "multiplier": 20, "currency": "USD", "fee": 4},
            {"id": "2", "symbol": "NQ", "side": "SLD", "time": t0.replace(minute=35), "quantity": 1, "price": 20010, "multiplier": 20, "currency": "USD", "fee": 2},
            {"id": "3", "symbol": "NQ", "side": "SLD", "time": t0.replace(minute=40), "quantity": 1, "price": 19995, "multiplier": 20, "currency": "USD", "fee": 2},
        ]
        trades, unmatched = match_execution_fills(fills)
        self.assertEqual(unmatched, 0)
        self.assertEqual(len(trades), 2)
        self.assertEqual(trades[0]["side"], "long")
        self.assertAlmostEqual(trades[0]["net_pnl"], 196)
        self.assertAlmostEqual(trades[1]["net_pnl"], -104)

    def test_execution_matching_keeps_hedge_mode_books_separate(self):
        t0 = datetime(2026, 1, 1, 14, 30, tzinfo=timezone.utc)
        fills = [
            {"id": "1", "symbol": "BTCUSDT", "book_key": "BTCUSDT:LONG", "side": "BUY", "time": t0, "quantity": 1, "price": 100, "currency": "USDT"},
            {"id": "2", "symbol": "BTCUSDT", "book_key": "BTCUSDT:SHORT", "side": "SELL", "time": t0 + timedelta(minutes=1), "quantity": 1, "price": 110, "currency": "USDT"},
            {"id": "3", "symbol": "BTCUSDT", "book_key": "BTCUSDT:LONG", "side": "SELL", "time": t0 + timedelta(minutes=2), "quantity": 1, "price": 105, "currency": "USDT"},
            {"id": "4", "symbol": "BTCUSDT", "book_key": "BTCUSDT:SHORT", "side": "BUY", "time": t0 + timedelta(minutes=3), "quantity": 1, "price": 103, "currency": "USDT"},
        ]
        trades, unmatched = match_execution_fills(fills)
        self.assertEqual(unmatched, 0)
        self.assertEqual([trade["side"] for trade in trades], ["long", "short"])
        self.assertEqual([trade["net_pnl"] for trade in trades], [5, 7])

    def test_reversal_fill_allocates_fee_once(self):
        t0 = datetime(2026, 1, 1, 14, 30, tzinfo=timezone.utc)
        fills = [
            {"id": "1", "symbol": "ES", "side": "BUY", "time": t0, "quantity": 1, "price": 100, "fee": 1},
            {"id": "2", "symbol": "ES", "side": "SELL", "time": t0 + timedelta(minutes=1), "quantity": 2, "price": 110, "fee": 2},
            {"id": "3", "symbol": "ES", "side": "BUY", "time": t0 + timedelta(minutes=2), "quantity": 1, "price": 105, "fee": 1},
        ]
        trades, unmatched = match_execution_fills(fills)
        self.assertEqual(unmatched, 0)
        self.assertEqual([trade["side"] for trade in trades], ["long", "short"])
        self.assertEqual([trade["fees"] for trade in trades], [2, 2])
        self.assertEqual(sum(trade["fees"] for trade in trades), 4)

    def test_us_session_four_hour_bars_start_with_the_session(self):
        import time
        base = int(time.time() // 86400 * 86400) - 172800 + 13 * 3600
        rows = [[base + index * 3600, 100 + index, 102 + index, 99 + index, 101 + index, 10] for index in range(7)]
        output = aggregate_session_four_hour(rows)
        self.assertEqual(len(output), 2)
        self.assertEqual(output[0][0], base)
        self.assertEqual(output[0][4], 104)
        self.assertEqual(output[1][1], 104)

    def test_longbridge_cli_token_is_decrypted_and_synced_privately(self):
        with TemporaryDirectory() as directory:
            home = Path(directory)
            source = home / ".longbridge" / "openapi"
            source.mkdir(parents=True)
            client_id = "test-client"
            (source / "cli-registration").write_text(json.dumps({"client_id": client_id}), encoding="utf-8")
            token = {
                "client_id": client_id,
                "access_token": "header.payload.signature",
                "refresh_token": "refresh",
                "expires_at": 4_102_444_800,
            }
            machine_id = "TEST-MACHINE-ID"
            key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=HKDF_INFO).derive(machine_id.encode())
            nonce = b"0123456789ab"
            ciphertext = AESGCM(key).encrypt(nonce, json.dumps(token).encode(), None)
            (source / "cli-auth").write_bytes(MAGIC + nonce + ciphertext)

            self.assertEqual(decrypt_cli_token(source / "cli-auth", machine_id)["client_id"], client_id)
            # The sync path uses the machine function, so place a legacy JSON token for this isolated fixture.
            (source / "cli-auth").write_text(json.dumps(token), encoding="utf-8")
            synced = sync_cli_token_to_sdk(home)
            self.assertEqual(synced.client_id, client_id)
            self.assertEqual(synced.path.stat().st_mode & 0o777, 0o600)
            stored = json.loads(synced.path.read_text(encoding="utf-8"))
            self.assertEqual(stored["access_token"], token["access_token"])

    def test_longbridge_sdk_refresh_is_mirrored_to_encrypted_cli_cache(self):
        with TemporaryDirectory() as directory:
            home = Path(directory)
            source = home / ".longbridge" / "openapi"
            source.mkdir(parents=True)
            client_id = "refresh-client"
            machine_id = "REFRESH-MACHINE"
            (source / "cli-registration").write_text(json.dumps({"client_id": client_id}), encoding="utf-8")
            cli = {"client_id": client_id, "access_token": "old", "refresh_token": "old-r", "expires_at": 100, "logged_in_at": 50}
            encrypt_cli_token(cli, source / "cli-auth", machine_id)
            sdk_path = source / "tokens" / client_id
            sdk_path.parent.mkdir()
            sdk_path.write_text(json.dumps({"client_id": client_id, "access_token": "new", "refresh_token": "new-r", "expires_at": 200}), encoding="utf-8")
            # Patch the platform identifier only for this isolated encrypted fixture.
            from unittest.mock import patch
            with patch("traderhome_hub.longbridge_sdk._machine_id", return_value=machine_id):
                self.assertTrue(sync_sdk_token_to_cli(home))
            mirrored = decrypt_cli_token(source / "cli-auth", machine_id)
            self.assertEqual(mirrored["access_token"], "new")
            self.assertEqual(mirrored["logged_in_at"], 50)


class AsyncProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_binance_spot_assets_contribute_to_account_equity(self):
        settings = Settings(binance_api_key="read-only-key", binance_api_secret="secret")
        provider = BinanceProvider(TimedCache(1), settings)

        async def signed(_base_url, path, _params=None):
            if path == "/api/v3/account":
                return {"balances": [
                    {"asset": "BTC", "free": "0.1", "locked": "0"},
                    {"asset": "USDT", "free": "100", "locked": "0"},
                ]}
            raise ProviderError("futures account is unavailable")

        provider._signed_request = AsyncMock(side_effect=signed)
        with patch(
            "traderhome_hub.providers._json_request",
            new=AsyncMock(return_value=[{"symbol": "BTCUSDT", "price": "50000"}]),
        ):
            summary = await provider.account_summary()
        self.assertEqual(summary["net_liquidation"], 5_100)
        self.assertEqual(summary["total_cash"], 100)
        self.assertEqual(summary["spot_equity_usdt"], 5_100)
        self.assertTrue(summary["coverage"]["spot"])
        self.assertFalse(summary["coverage"]["usdt_futures"])

    async def test_binance_trade_history_is_split_into_seven_day_windows(self):
        settings = Settings(binance_api_key="read-only-key", binance_api_secret="secret")
        provider = BinanceProvider(TimedCache(1), settings)
        requests = []

        async def signed(_base_url, path, params=None):
            self.assertEqual(path, "/fapi/v1/userTrades")
            requests.append(dict(params or {}))
            start = params["startTime"]
            end = params["endTime"]
            midpoint = (start + end) // 2
            prefix = str(start)
            return [
                {"id": prefix + "1", "time": midpoint, "side": "BUY", "positionSide": "LONG", "qty": "1", "price": "100", "commission": "0.1", "commissionAsset": "USDT", "marginAsset": "USDT"},
                {"id": prefix + "2", "time": midpoint + 1, "side": "SELL", "positionSide": "LONG", "qty": "1", "price": "105", "commission": "0.1", "commissionAsset": "USDT", "marginAsset": "USDT"},
            ]

        provider._signed_request = AsyncMock(side_effect=signed)
        payload = await provider.review_trades(8, ["BTCUSDT"])
        self.assertEqual(len(requests), 2)
        self.assertTrue(all(item["endTime"] - item["startTime"] < 7 * 86_400_000 for item in requests))
        self.assertEqual(payload["quality"]["request_windows"], 2)
        self.assertEqual(payload["quality"]["complete_round_trips"], 2)
        self.assertEqual(payload["trades"][0]["currency"], "USDT")


if __name__ == "__main__":
    unittest.main()
