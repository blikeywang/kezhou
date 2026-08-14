from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import math
import os
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from .config import Settings
from .longbridge_sdk import LongbridgeSdkSession, OrderSide


TIMEFRAME_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3_600,
    "4h": 14_400,
    "1d": 86_400,
}
CRYPTO_ALIASES = {
    "BTC": "BTCUSDT",
    "BTCUSD": "BTCUSDT",
    "ETH": "ETHUSDT",
    "ETHUSD": "ETHUSDT",
    "SOL": "SOLUSDT",
    "SOLUSD": "SOLUSDT",
}
LONG_BRIDGE_ALIASES = {"NDX": ".NDX.US", "IXIC": ".IXIC.US"}
FUTURE_SPECS = {
    "NQ": {"exchange": "CME", "currency": "USD", "point_value": 20},
    "ES": {"exchange": "CME", "currency": "USD", "point_value": 50},
    "XAUUSD": {"root": "GC", "exchange": "COMEX", "currency": "USD", "point_value": 100},
    "WTI": {"root": "CL", "exchange": "NYMEX", "currency": "USD", "point_value": 1_000},
}


class ProviderError(RuntimeError):
    pass


def normalize_symbol(value: str) -> str:
    symbol = str(value or "").strip().upper().replace("/", "")
    return CRYPTO_ALIASES.get(symbol, symbol)


def is_crypto(symbol: str) -> bool:
    return normalize_symbol(symbol).endswith("USDT")


def _number(value: Any, default: float | None = None) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _epoch(value: Any) -> int:
    if isinstance(value, datetime):
        return int(value.timestamp())
    number = _number(value)
    if number is not None:
        return int(number / 1_000 if number > 10_000_000_000 else number)
    text = str(value or "").strip().replace("Z", "+00:00")
    if not text:
        raise ValueError("missing timestamp")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def _extract_rows(payload: Any, keys: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in (*keys, "data", "result", "items", "candlesticks", "quotes"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = _extract_rows(value, keys)
            if nested:
                return nested
    return [payload] if payload else []


def _closed(rows: list[list[float]], timeframe: str) -> list[list[float]]:
    now = int(time.time())
    seconds = TIMEFRAME_SECONDS[timeframe]
    clean: dict[int, list[float]] = {}
    for row in rows:
        if len(row) < 6:
            continue
        values = [_number(value) for value in row[:6]]
        if any(value is None for value in values):
            continue
        ts = int(values[0])
        if ts + seconds <= now + 2:
            clean[ts] = [ts, *[float(value) for value in values[1:]]]
    return [clean[key] for key in sorted(clean)][-500:]


def aggregate_four_hour(rows: list[list[float]]) -> list[list[float]]:
    groups: dict[int, list[list[float]]] = defaultdict(list)
    for row in rows:
        # Stable UTC buckets work for continuous futures. Longbridge regular-session
        # bars arrive in chronological one-hour groups and use the same rule.
        groups[int(row[0]) // 14_400].append(row)
    output: list[list[float]] = []
    for key in sorted(groups):
        values = groups[key]
        if not values:
            continue
        output.append(
            [
                values[0][0],
                values[0][1],
                max(item[2] for item in values),
                min(item[3] for item in values),
                values[-1][4],
                sum(item[5] for item in values),
            ]
        )
    return _closed(output, "4h")


def aggregate_session_four_hour(rows: list[list[float]]) -> list[list[float]]:
    """Build two stable RTH bars per US session from Longbridge one-hour bars."""
    sessions: dict[str, list[list[float]]] = defaultdict(list)
    for row in rows:
        day = datetime.fromtimestamp(row[0], timezone.utc).date().isoformat()
        sessions[day].append(row)
    output: list[list[float]] = []
    for day in sorted(sessions):
        ordered = sorted(sessions[day], key=lambda item: item[0])
        for index in range(0, len(ordered), 4):
            values = ordered[index:index + 4]
            if not values:
                continue
            output.append([
                values[0][0], values[0][1], max(item[2] for item in values),
                min(item[3] for item in values), values[-1][4], sum(item[5] for item in values),
            ])
    return _closed(output, "4h")


class TimedCache:
    def __init__(self, seconds: int):
        self.seconds = seconds
        self.values: dict[str, tuple[float, Any]] = {}
        self.locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def get(self, key: str, loader: Callable[[], Awaitable[Any]], seconds: int | None = None) -> Any:
        ttl = self.seconds if seconds is None else seconds
        cached = self.values.get(key)
        if cached and time.monotonic() - cached[0] < ttl:
            return cached[1]
        async with self.locks[key]:
            cached = self.values.get(key)
            if cached and time.monotonic() - cached[0] < ttl:
                return cached[1]
            value = await loader()
            self.values[key] = (time.monotonic(), value)
            return value


async def _json_request(url: str, timeout: float = 10) -> Any:
    def run() -> Any:
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": "TraderHome-Personal-Data-Hub/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ProviderError(str(error)) from error

    return await asyncio.to_thread(run)


class BinanceProvider:
    name = "Binance"

    def __init__(self, cache: TimedCache, settings: Settings | None = None):
        self.cache = cache
        self.settings = settings or Settings()

    @property
    def account_available(self) -> bool:
        return bool(self.settings.binance_api_key and self.settings.binance_api_secret)

    async def _signed_request(self, base_url: str, path: str, params: dict[str, Any] | None = None) -> Any:
        if not self.account_available:
            raise ProviderError("Binance read-only API key is not configured")
        values = dict(params or {})
        values["recvWindow"] = 5_000
        values["timestamp"] = int(time.time() * 1_000)
        query = urllib.parse.urlencode(values)
        signature = hmac.new(
            self.settings.binance_api_secret.encode("utf-8"),
            query.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        url = f"{base_url}{path}?{query}&signature={signature}"

        def run() -> Any:
            request = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "TraderHome-Personal-Data-Hub/1.0",
                    "X-MBX-APIKEY": self.settings.binance_api_key,
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                try:
                    payload = json.loads(error.read().decode("utf-8"))
                    detail = payload.get("msg") or f"HTTP {error.code}"
                except Exception:
                    detail = f"HTTP {error.code}"
                raise ProviderError(f"Binance account API: {detail}") from error
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                raise ProviderError(f"Binance account API: {error}") from error

        return await asyncio.to_thread(run)

    async def candles(self, symbol: str, timeframe: str) -> list[list[float]]:
        symbol = normalize_symbol(symbol)
        if not is_crypto(symbol):
            raise ProviderError("Binance only handles crypto symbols")
        if timeframe not in TIMEFRAME_SECONDS:
            raise ProviderError(f"unsupported timeframe {timeframe}")
        url = "https://api.binance.com/api/v3/klines?" + urllib.parse.urlencode(
            {"symbol": symbol, "interval": timeframe, "limit": 500}
        )

        async def load() -> list[list[float]]:
            payload = await _json_request(url)
            if not isinstance(payload, list):
                raise ProviderError("Binance returned an unexpected payload")
            rows = [
                [int(item[0]) // 1_000, float(item[1]), float(item[2]), float(item[3]), float(item[4]), float(item[5])]
                for item in payload
                if isinstance(item, list) and len(item) >= 7 and int(item[6]) < int(time.time() * 1_000)
            ]
            if len(rows) < 70:
                raise ProviderError(f"Binance returned only {len(rows)} closed candles")
            return rows

        return await self.cache.get(f"binance:candles:{symbol}:{timeframe}", load)

    async def quote(self, symbol: str) -> dict[str, Any]:
        symbol = normalize_symbol(symbol)

        async def load() -> dict[str, Any]:
            payload = await _json_request(
                "https://api.binance.com/api/v3/ticker/24hr?" + urllib.parse.urlencode({"symbol": symbol})
            )
            return {
                "source": self.name,
                "price": _number(payload.get("lastPrice")),
                "previousClose": _number(payload.get("prevClosePrice")),
                "change": (_number(payload.get("priceChangePercent"), 0) or 0) / 100,
                "volume": _number(payload.get("volume")),
                "quoteVolume": _number(payload.get("quoteVolume")),
                "state": "24x7",
                "asOf": int(time.time() * 1_000),
            }

        return await self.cache.get(f"binance:quote:{symbol}", load, 5)

    async def derivatives(self, symbol: str) -> dict[str, Any]:
        symbol = normalize_symbol(symbol)

        async def load() -> dict[str, Any]:
            premium_url = "https://fapi.binance.com/fapi/v1/premiumIndex?" + urllib.parse.urlencode({"symbol": symbol})
            oi_url = "https://fapi.binance.com/fapi/v1/openInterest?" + urllib.parse.urlencode({"symbol": symbol})
            premium, open_interest = await asyncio.gather(
                _json_request(premium_url), _json_request(oi_url)
            )
            mark = _number(premium.get("markPrice"))
            contracts = _number(open_interest.get("openInterest"))
            return {
                "available": True,
                "source": "Binance Futures",
                "fundingRate": _number(premium.get("lastFundingRate")),
                "markPrice": mark,
                "openInterestUsd": mark * contracts if mark is not None and contracts is not None else None,
            }

        try:
            return await self.cache.get(f"binance:derivatives:{symbol}", load, 10)
        except ProviderError as error:
            return {"available": False, "source": "Binance Futures", "error": str(error)}

    async def account_summary(self) -> dict[str, Any]:
        spot, futures = await asyncio.gather(
            self._signed_request("https://api.binance.com", "/api/v3/account", {"omitZeroBalances": "true"}),
            self._signed_request("https://fapi.binance.com", "/fapi/v3/account"),
            return_exceptions=True,
        )
        if isinstance(spot, Exception) and isinstance(futures, Exception):
            raise ProviderError(f"{spot}; {futures}")
        spot_balances = [] if isinstance(spot, Exception) else [
            {
                "asset": item.get("asset"),
                "free": _number(item.get("free"), 0),
                "locked": _number(item.get("locked"), 0),
            }
            for item in spot.get("balances", [])
            if (_number(item.get("free"), 0) or 0) or (_number(item.get("locked"), 0) or 0)
        ]
        stable_assets = {"USDT", "USDC", "FDUSD", "TUSD", "DAI", "BUSD"}
        prices: dict[str, float] = {}
        try:
            tickers = await _json_request("https://api.binance.com/api/v3/ticker/price")
            prices = {
                str(item.get("symbol")): value
                for item in tickers if isinstance(item, dict)
                if (value := _number(item.get("price"))) is not None
            }
        except ProviderError:
            pass
        spot_equity = 0.0
        spot_available = 0.0
        spot_cash = 0.0
        unpriced_assets: list[str] = []
        for item in spot_balances:
            asset = str(item["asset"] or "")
            total = (item["free"] or 0) + (item["locked"] or 0)
            conversion = 1.0 if asset in stable_assets else prices.get(f"{asset}USDT")
            if conversion is None:
                inverse = prices.get(f"USDT{asset}")
                conversion = 1 / inverse if inverse else None
            if conversion is None:
                unpriced_assets.append(asset)
                continue
            spot_equity += total * conversion
            spot_available += (item["free"] or 0) * conversion
            if asset in stable_assets:
                spot_cash += total
        futures_margin = None if isinstance(futures, Exception) else _number(futures.get("totalMarginBalance"))
        futures_wallet = None if isinstance(futures, Exception) else _number(futures.get("totalWalletBalance"))
        futures_available = None if isinstance(futures, Exception) else _number(futures.get("availableBalance"))
        net_liquidation = spot_equity + (futures_margin or 0) if spot_balances or futures_margin is not None else None
        return {
            "source": "Binance Account API",
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "currency": "USDT",
            "net_liquidation": net_liquidation,
            "total_cash": spot_cash + (futures_wallet or 0) if spot_balances or futures_wallet is not None else None,
            "available_funds": spot_available + (futures_available or 0) if spot_balances or futures_available is not None else None,
            "unrealized_pnl": None if isinstance(futures, Exception) else _number(futures.get("totalUnrealizedProfit")),
            "spot_equity_usdt": spot_equity,
            "spot_balances": spot_balances,
            "unpriced_spot_assets": unpriced_assets,
            "coverage": {
                "spot": not isinstance(spot, Exception),
                "usdt_futures": not isinstance(futures, Exception),
            },
        }

    async def positions(self) -> dict[str, Any]:
        summary = await self.account_summary()
        futures = await self._signed_request("https://fapi.binance.com", "/fapi/v3/account")
        output = [
            {
                "symbol": item["asset"],
                "asset_class": "CRYPTO_SPOT",
                "currency": item["asset"],
                "quantity": (item["free"] or 0) + (item["locked"] or 0),
                "available_quantity": item["free"],
            }
            for item in summary["spot_balances"]
        ]
        output.extend(
            {
                "symbol": item.get("symbol"),
                "asset_class": "CRYPTO_FUTURE",
                "currency": "USDT",
                "quantity": _number(item.get("positionAmt"), 0),
                "average_cost": _number(item.get("entryPrice")),
                "unrealized_pnl": _number(item.get("unrealizedProfit")),
                "leverage": _number(item.get("leverage")),
            }
            for item in futures.get("positions", [])
            if abs(_number(item.get("positionAmt"), 0) or 0) > 1e-12
        )
        return {
            "source": "Binance Account API",
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "positions": output,
        }

    async def review_trades(self, days: int, symbols: list[str]) -> dict[str, Any]:
        window_days = max(1, min(days, 180))
        end_time = int(time.time() * 1_000)
        start_time = end_time - window_days * 86_400_000
        normalized: list[dict[str, Any]] = []
        errors: list[str] = []
        requested = list(dict.fromkeys(normalize_symbol(value) for value in symbols if value))[:20]
        discovered: list[str] = []
        if not requested:
            try:
                for page in range(1, 6):
                    rows = await self._signed_request(
                        "https://fapi.binance.com",
                        "/fapi/v1/income",
                        {
                            "incomeType": "REALIZED_PNL",
                            "startTime": start_time,
                            "endTime": end_time,
                            "page": page,
                            "limit": 1_000,
                        },
                    )
                    discovered.extend(
                        normalize_symbol(item.get("symbol"))
                        for item in rows if isinstance(item, dict) and item.get("symbol")
                    )
                    if not isinstance(rows, list) or len(rows) < 1_000:
                        break
            except ProviderError as error:
                errors.append(f"symbol discovery: {error}")
        selected_symbols = list(dict.fromkeys(requested or discovered))[:20]
        if not selected_symbols:
            selected_symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]

        slices: list[tuple[str, int, int]] = []
        for symbol in selected_symbols:
            cursor = start_time
            while cursor <= end_time:
                slice_end = min(end_time, cursor + 7 * 86_400_000 - 1)
                slices.append((symbol, cursor, slice_end))
                cursor = slice_end + 1

        limiter = asyncio.Semaphore(4)

        async def fetch_slice(
            symbol: str,
            slice_start: int,
            slice_end: int,
        ) -> tuple[str, list[dict[str, Any]], str | None]:
            try:
                async with limiter:
                    payload = await self._signed_request(
                        "https://fapi.binance.com",
                        "/fapi/v1/userTrades",
                        {
                            "symbol": symbol,
                            "startTime": slice_start,
                            "endTime": slice_end,
                            "limit": 1_000,
                        },
                    )
            except ProviderError as error:
                return symbol, [], str(error)
            rows = list(payload) if isinstance(payload, list) else []
            output = list(rows)
            # Very active accounts can exceed 1,000 fills in one seven-day
            # slice. Continue by trade id and retain only this slice.
            while len(rows) >= 1_000:
                try:
                    cursor_id = max(int(item.get("id")) for item in rows if item.get("id") is not None) + 1
                    async with limiter:
                        payload = await self._signed_request(
                            "https://fapi.binance.com",
                            "/fapi/v1/userTrades",
                            {"symbol": symbol, "fromId": cursor_id, "limit": 1_000},
                        )
                except (ProviderError, TypeError, ValueError) as error:
                    return symbol, output, f"pagination: {error}"
                rows = list(payload) if isinstance(payload, list) else []
                if not rows:
                    break
                output.extend(
                    item for item in rows
                    if slice_start <= int(item.get("time") or 0) <= slice_end
                )
                if len(rows) < 1_000 or any(int(item.get("time") or 0) > slice_end for item in rows):
                    break
            return symbol, output, None

        results = await asyncio.gather(*(fetch_slice(*item) for item in slices))
        unconverted_fee_assets: set[str] = set()
        seen_fills: set[tuple[str, str]] = set()
        for symbol, rows, error in results:
            if error:
                errors.append(f"{symbol}: {error}")
            for item in rows:
                fill_id = str(item.get("id"))
                if (symbol, fill_id) in seen_fills:
                    continue
                seen_fills.add((symbol, fill_id))
                margin_asset = str(item.get("marginAsset") or ("USDC" if symbol.endswith("USDC") else "USDT"))
                commission_asset = str(item.get("commissionAsset") or margin_asset)
                fee = abs(_number(item.get("commission"), 0) or 0) if commission_asset == margin_asset else 0
                if commission_asset != margin_asset and abs(_number(item.get("commission"), 0) or 0) > 0:
                    unconverted_fee_assets.add(commission_asset)
                quantity = _number(item.get("qty"), 0) or 0
                price = _number(item.get("price"), 0) or 0
                timestamp = int(item.get("time") or 0)
                if quantity <= 0 or price <= 0 or timestamp <= 0:
                    continue
                normalized.append({
                    "id": fill_id,
                    "symbol": symbol,
                    "book_key": f"{symbol}:{item.get('positionSide') or 'BOTH'}",
                    "side": str(item.get("side") or ""),
                    "time": datetime.fromtimestamp(timestamp / 1_000, timezone.utc),
                    "quantity": quantity,
                    "price": price,
                    "multiplier": 1,
                    "currency": margin_asset,
                    "fee": fee,
                })
        trades, unmatched = match_execution_fills(
            normalized,
            trade_id_prefix="BINANCE",
            strategy="Binance Futures matched executions",
        )
        return {
            "schema": "traderhome_review_trades_v1",
            "source": "Binance Account API",
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "window_days": window_days,
            "trades": trades,
            "quality": {
                "fills_read": len(normalized),
                "complete_round_trips": len(trades),
                "unmatched_open_lots": unmatched,
                "symbols_queried": selected_symbols,
                "symbols_auto_discovered": not bool(requested),
                "request_windows": len(slices),
                "unconverted_fee_assets": sorted(unconverted_fee_assets),
                "errors": errors,
                "note": "USD-M futures only; requests are split into Binance's required seven-day windows.",
            },
        }


class LongbridgeProvider:
    name = "Longbridge OpenAPI"
    periods = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "1h", "1d": "day"}

    def __init__(self, settings: Settings, cache: TimedCache):
        self.settings = settings
        self.cache = cache
        self.sdk = LongbridgeSdkSession(cli_bin=settings.longbridge_bin)
        self._cli_lock = asyncio.Lock()

    @property
    def available(self) -> bool:
        cli_available = bool(shutil.which(self.settings.longbridge_bin) or os.path.exists(self.settings.longbridge_bin))
        return self.sdk.installed or cli_available

    @property
    def connected(self) -> bool:
        return self.sdk.connected

    def symbol(self, symbol: str) -> str:
        symbol = normalize_symbol(symbol)
        if symbol in LONG_BRIDGE_ALIASES:
            return LONG_BRIDGE_ALIASES[symbol]
        if re.search(r"\.(US|HK|SH|SZ|SG|HAS)$", symbol):
            return symbol
        if symbol in FUTURE_SPECS or is_crypto(symbol):
            raise ProviderError(f"{symbol} is not a Longbridge equity/index symbol")
        return f"{symbol}.US"

    async def _run(self, *args: str, timeout: float = 18) -> Any:
        if not self.available:
            raise ProviderError("longbridge CLI is not installed")
        env = os.environ.copy()
        log_workdir = "/tmp/traderhome-longbridge"
        os.makedirs(log_workdir, mode=0o700, exist_ok=True)
        async with self._cli_lock:
            process = await asyncio.create_subprocess_exec(
                self.settings.longbridge_bin,
                *args,
                "--format",
                "json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=log_workdir,
            )
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
            except asyncio.TimeoutError as error:
                process.kill()
                await process.communicate()
                raise ProviderError("Longbridge timed out") from error
        if process.returncode:
            detail = stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or ["unknown error"]
            raise ProviderError(f"Longbridge: {detail[0]}")
        try:
            return json.loads(stdout.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ProviderError("Longbridge returned invalid JSON") from error

    async def candles(self, symbol: str, timeframe: str) -> list[list[float]]:
        lb_symbol = self.symbol(symbol)
        period = self.periods.get(timeframe)
        if period is None:
            raise ProviderError(f"unsupported timeframe {timeframe}")

        async def load() -> list[list[float]]:
            rows = []
            sdk_timeframe = "1h" if timeframe == "4h" else timeframe
            try:
                payload = await self.sdk.candlesticks(lb_symbol, sdk_timeframe)
                rows = [
                    [
                        _epoch(item.timestamp), float(item.open), float(item.high),
                        float(item.low), float(item.close), float(item.volume or 0),
                    ]
                    for item in payload
                ]
            except Exception:
                payload = await self._run("kline", lb_symbol, "--period", period, "--count", "500")
                for item in _extract_rows(payload, ("candles", "klines")):
                    try:
                        rows.append(
                            [
                                _epoch(item.get("timestamp", item.get("time"))),
                                float(item.get("open")),
                                float(item.get("high")),
                                float(item.get("low")),
                                float(item.get("close")),
                                float(item.get("volume") or 0),
                            ]
                        )
                    except (TypeError, ValueError):
                        continue
            rows = _closed(rows, "1h" if timeframe == "4h" else timeframe)
            if timeframe == "4h":
                rows = aggregate_session_four_hour(rows)
            if len(rows) < 70:
                raise ProviderError(f"Longbridge returned only {len(rows)} closed candles")
            return rows

        return await self.cache.get(f"longbridge:candles:{lb_symbol}:{timeframe}", load)

    async def quote(self, symbol: str) -> dict[str, Any]:
        lb_symbol = self.symbol(symbol)

        async def load() -> dict[str, Any]:
            try:
                quote = await self.sdk.quote(lb_symbol)
                price = _number(quote.last_done)
                previous = _number(quote.prev_close)
                timestamp = quote.timestamp
                volume = _number(quote.volume)
                turnover = _number(quote.turnover)
                state = str(quote.trade_status)
            except Exception:
                payload = await self._run("quote", lb_symbol)
                rows = _extract_rows(payload, ("quotes",))
                if not rows:
                    raise ProviderError("Longbridge quote is empty")
                quote = rows[0]
                price = _number(quote.get("last", quote.get("last_done", quote.get("lastDone"))))
                previous = _number(quote.get("prev_close", quote.get("prevClose")))
                active_session = quote.get("overnight") or quote.get("pre_market") or quote.get("post_market") or {}
                timestamp = quote.get("timestamp", quote.get("time", active_session.get("timestamp")))
                volume = _number(quote.get("volume"))
                turnover = _number(quote.get("turnover"))
                state = str(quote.get("status", quote.get("trade_status", quote.get("tradeStatus", ""))))
            return {
                "source": self.name,
                "price": price,
                "previousClose": previous,
                "change": price / previous - 1 if price and previous else None,
                "volume": volume,
                "turnover": turnover,
                "state": state,
                "exchange": "Longbridge",
                "asOf": _epoch(timestamp) * 1_000 if timestamp else int(time.time() * 1_000),
            }

        return await self.cache.get(f"longbridge:quote:{lb_symbol}", load, 5)

    async def account_summary(self) -> dict[str, Any]:
        try:
            balances = await self.sdk.account_balances()
            if not balances:
                raise ProviderError("Longbridge account assets are empty")
            balance = balances[0]
            asset = {
                "currency": balance.currency,
                "net_assets": balance.net_assets,
                "total_cash": balance.total_cash,
                "buy_power": balance.buy_power,
                "init_margin": balance.init_margin,
                "maintenance_margin": balance.maintenance_margin,
                "risk_level": balance.risk_level,
                "cash_infos": [
                    {
                        "currency": item.currency,
                        "available_cash": item.available_cash,
                        "frozen_cash": item.frozen_cash,
                        "settling_cash": item.settling_cash,
                        "withdraw_cash": item.withdraw_cash,
                    }
                    for item in balance.cash_infos
                ],
            }
        except Exception:
            payload = await self._run("assets")
            rows = _extract_rows(payload, ("assets",))
            if not rows:
                raise ProviderError("Longbridge account assets are empty")
            asset = rows[0]
        currencies = {
            str(item.get("currency") or "BASE"): {
                "available_cash": _number(item.get("available_cash")),
                "frozen_cash": _number(item.get("frozen_cash")),
                "settling_cash": _number(item.get("settling_cash")),
                "withdraw_cash": _number(item.get("withdraw_cash")),
            }
            for item in asset.get("cash_infos", [])
            if isinstance(item, dict)
        }
        return {
            "source": self.name,
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "currency": asset.get("currency") or "USD",
            "net_liquidation": _number(asset.get("net_assets")),
            "total_cash": _number(asset.get("total_cash")),
            "buying_power": _number(asset.get("buy_power")),
            "initial_margin": _number(asset.get("init_margin")),
            "maintenance_margin": _number(asset.get("maintenance_margin")),
            "risk_level": asset.get("risk_level"),
            "currencies": currencies,
        }

    async def positions(self) -> dict[str, Any]:
        try:
            payload = await self.sdk.stock_positions()
            raw = [
                {
                    "symbol": item.symbol,
                    "name": item.symbol_name,
                    "asset_class": "STK",
                    "currency": item.currency,
                    "market": str(item.market),
                    "quantity": item.quantity,
                    "available_quantity": item.available_quantity,
                    "cost_price": item.cost_price,
                }
                for channel in payload.channels
                for item in channel.positions
            ]
        except Exception:
            payload = await self._run("positions")
            if isinstance(payload, list):
                raw = payload
            elif isinstance(payload, dict):
                raw = []
                for key, asset_class in (("stock_list", "STK"), ("option_list", "OPT"), ("crypto_list", "CRYPTO")):
                    raw.extend({**item, "asset_class": asset_class} for item in payload.get(key, []) if isinstance(item, dict))
            else:
                raw = []
        positions = []
        for item in raw:
            quantity = _number(item.get("quantity"), 0) or 0
            if abs(quantity) < 1e-12:
                continue
            positions.append({
                "symbol": item.get("symbol"),
                "name": item.get("name"),
                "asset_class": item.get("asset_class", "STK"),
                "currency": item.get("currency"),
                "market": item.get("market"),
                "quantity": quantity,
                "available_quantity": _number(item.get("available_quantity", item.get("available"))),
                "average_cost": _number(item.get("cost_price", item.get("average_cost"))),
            })
        return {
            "source": self.name,
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "positions": positions,
        }

    async def review_trades(self, days: int) -> dict[str, Any]:
        try:
            executions, orders = await self.sdk.executions(days)
        except Exception as error:
            raise ProviderError(str(error)) from error
        fills = []
        for execution in executions:
            order = orders.get(str(execution.order_id))
            if order is None:
                continue
            side = "BUY" if str(order.side) == str(getattr(type(order.side), "Buy", "Buy")) else "SELL"
            if OrderSide is not None:
                try:
                    side = "BUY" if order.side == OrderSide.Buy else "SELL"
                except Exception:
                    pass
            fills.append({
                "id": execution.trade_id,
                "symbol": execution.symbol,
                "side": side,
                "time": execution.trade_done_at,
                "quantity": float(execution.quantity),
                "price": float(execution.price),
                "multiplier": 1,
                "currency": (
                    "HKD" if str(execution.symbol).endswith(".HK") else
                    "CNY" if str(execution.symbol).endswith((".SH", ".SZ")) else
                    "SGD" if str(execution.symbol).endswith(".SG") else "USD"
                ),
                "fee": 0,
            })
        trades, unmatched = match_execution_fills(
            fills,
            trade_id_prefix="LONGBRIDGE",
            strategy="Longbridge matched executions",
        )
        return {
            "schema": "traderhome_review_trades_v1",
            "source": self.name,
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "window_days": days,
            "trades": trades,
            "quality": {
                "fills_read": len(fills),
                "complete_round_trips": len(trades),
                "unmatched_open_lots": unmatched,
                "fee_coverage": False,
                "note": "Only FIFO-matched complete round trips are returned; Longbridge execution fees are not included.",
            },
        }


@dataclass
class MatchedLot:
    symbol: str
    side: str
    entry_time: datetime
    exit_time: datetime
    entry_price: float
    exit_price: float
    quantity: float
    point_value: float
    currency: str
    fees: float
    net_pnl: float
    trade_id: str
    strategy: str

    def as_trade(self) -> dict[str, Any]:
        return {
            "trade_id": self.trade_id,
            "symbol": self.symbol,
            "side": self.side,
            "entry_time": self.entry_time.isoformat(),
            "exit_time": self.exit_time.isoformat(),
            "entry_price": self.entry_price,
            "exit_price": self.exit_price,
            "quantity": self.quantity,
            "point_value": self.point_value,
            "currency": self.currency,
            "fees": self.fees,
            "net_pnl": self.net_pnl,
            "strategy": self.strategy,
        }


def match_execution_fills(
    fills: list[dict[str, Any]],
    trade_id_prefix: str = "IBKR",
    strategy: str = "IBKR matched executions",
) -> tuple[list[dict[str, Any]], int]:
    """FIFO-match normalized fills into complete long/short round trips."""
    books: defaultdict[str, dict[str, deque[dict[str, Any]]]] = defaultdict(
        lambda: {"buy": deque(), "sell": deque()}
    )
    trades: list[MatchedLot] = []
    unmatched = 0
    for fill in sorted(fills, key=lambda item: item["time"]):
        side = str(fill.get("side", "")).upper()
        action = "buy" if side in {"BOT", "BUY"} else "sell" if side in {"SLD", "SELL"} else ""
        if not action:
            continue
        opposite = "sell" if action == "buy" else "buy"
        symbol = str(fill.get("symbol") or "").upper()
        remaining = abs(float(fill.get("quantity") or 0))
        original_quantity = remaining
        if not symbol or remaining <= 0:
            continue
        book = books[str(fill.get("book_key") or symbol)]
        while remaining > 1e-9 and book[opposite]:
            opening = book[opposite][0]
            matched = min(remaining, opening["remaining"])
            direction = "short" if opposite == "sell" else "long"
            entry = float(opening["price"])
            exit_price = float(fill["price"])
            multiplier = float(fill.get("multiplier") or opening.get("multiplier") or 1)
            gross = (exit_price - entry) * matched * multiplier * (1 if direction == "long" else -1)
            open_fee = float(opening.get("fee") or 0) * matched / float(opening["quantity"])
            close_fee = float(fill.get("fee") or 0) * matched / float(fill["quantity"])
            fee = open_fee + close_fee
            trades.append(
                MatchedLot(
                    symbol=symbol,
                    side=direction,
                    entry_time=opening["time"],
                    exit_time=fill["time"],
                    entry_price=entry,
                    exit_price=exit_price,
                    quantity=matched,
                    point_value=multiplier,
                    currency=str(fill.get("currency") or "USD"),
                    fees=fee,
                    net_pnl=gross - fee,
                    trade_id=f"{trade_id_prefix}-{opening.get('id', 'OPEN')}-{fill.get('id', 'CLOSE')}-{len(trades) + 1}",
                    strategy=strategy,
                )
            )
            remaining -= matched
            opening["remaining"] -= matched
            if opening["remaining"] <= 1e-9:
                book[opposite].popleft()
        if remaining > 1e-9:
            item = dict(fill)
            item["quantity"] = remaining
            item["remaining"] = remaining
            item["fee"] = float(fill.get("fee") or 0) * remaining / original_quantity
            book[action].append(item)
    unmatched = sum(len(side) for book in books.values() for side in book.values())
    return [trade.as_trade() for trade in trades], unmatched
