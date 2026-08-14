from __future__ import annotations

import asyncio
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any

import httpx

from .config import Settings
from .providers import (
    FUTURE_SPECS,
    ProviderError,
    _closed,
    _epoch,
    _number,
    match_execution_fills,
    normalize_symbol,
)


WEB_BAR_REQUESTS = {
    "1m": ("1d", "1min"),
    "5m": ("5d", "5min"),
    "15m": ("10d", "15min"),
    "1h": ("30d", "1h"),
    "4h": ("100d", "4h"),
    "1d": ("2y", "1d"),
}

FUTURE_MULTIPLIERS = {
    "NQ": 20,
    "MNQ": 2,
    "ES": 50,
    "MES": 5,
    "GC": 100,
    "MGC": 10,
    "CL": 1_000,
    "MCL": 100,
}


class IbkrWebAuthenticationRequired(ProviderError):
    pass


class IbkrWebProvider:
    """Read-only IBKR Client Portal Web API adapter for individual accounts."""

    name = "IBKR Client Portal Web API"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.gateway_reachable = False
        self.authenticated = False
        self.established = False
        self.last_error = "IBKR Web API gateway is not running"
        self.last_status_at = 0.0
        self._status_lock = asyncio.Lock()
        self._request_limiter = asyncio.Semaphore(4)
        self._contract_lock = asyncio.Lock()
        self._account_lock = asyncio.Lock()
        self._contract_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._accounts_cache: tuple[float, list[dict[str, Any]]] = (0.0, [])
        self._keepalive_task: asyncio.Task[None] | None = None
        self._client = httpx.AsyncClient(
            base_url=self.settings.ibkr_web_api_url,
            verify=False,
            trust_env=False,
            timeout=httpx.Timeout(12),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "TraderHome-Personal-Data-Hub/1.1",
            },
        )

    @property
    def connected(self) -> bool:
        return self.gateway_reachable and self.authenticated

    def status_snapshot(self) -> dict[str, Any]:
        return {
            "available": self.connected,
            "gateway_available": self.gateway_reachable,
            "authenticated": self.authenticated,
            "established": self.established,
            "authentication_required": self.gateway_reachable and not self.authenticated,
            "source": self.name,
            "readonly": True,
            "mode": "client_portal_web_api",
            "login_url": self.settings.ibkr_web_login_url,
            "message": "connected" if self.connected else self.last_error,
        }

    async def _request(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        method: str = "GET",
        body: dict[str, Any] | None = None,
        timeout: float = 12,
    ) -> Any:
        async with self._request_limiter:
            try:
                response = await self._client.request(
                    method,
                    path,
                    params={key: value for key, value in (params or {}).items() if value is not None},
                    json=body,
                    timeout=timeout,
                )
            except httpx.RequestError as error:
                raise ProviderError(f"IBKR Web API gateway: {error}") from error
        if response.status_code == 401:
            raise IbkrWebAuthenticationRequired(
                "IBKR Web API requires today's browser login and two-factor authentication"
            )
        if response.is_error:
            try:
                payload = response.json()
                detail = payload.get("error") or payload.get("message") or payload if isinstance(payload, dict) else payload
            except ValueError:
                detail = response.text.strip() or f"HTTP {response.status_code}"
            raise ProviderError(f"IBKR Web API: {detail}")
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as error:
            raise ProviderError("IBKR Web API returned invalid JSON") from error

    async def status(self, force: bool = True) -> dict[str, Any]:
        if not force and time.monotonic() - self.last_status_at < 5:
            return self.status_snapshot()
        async with self._status_lock:
            if not force and time.monotonic() - self.last_status_at < 5:
                return self.status_snapshot()
            try:
                payload = await self._request("/iserver/auth/status", timeout=3.5)
                if not isinstance(payload, dict):
                    raise ProviderError("IBKR Web API returned an invalid authentication status")
                self.gateway_reachable = True
                self.authenticated = bool(payload.get("authenticated")) and not bool(payload.get("competing"))
                self.established = bool(payload.get("established", self.authenticated))
                if self.authenticated:
                    self.last_error = ""
                elif payload.get("competing"):
                    self.last_error = "IBKR username is active in another brokerage session"
                else:
                    self.last_error = "IBKR Web API requires today's browser login and two-factor authentication"
            except IbkrWebAuthenticationRequired as error:
                self.gateway_reachable = True
                self.authenticated = False
                self.established = False
                self.last_error = str(error)
            except ProviderError as error:
                self.gateway_reachable = False
                self.authenticated = False
                self.established = False
                self.last_error = str(error)
            self.last_status_at = time.monotonic()
            return self.status_snapshot()

    async def connect(self) -> None:
        if self.connected:
            return
        status = await self.status(force=time.monotonic() - self.last_status_at >= 5)
        if not status["available"]:
            raise ProviderError(status["message"])

    def start_keepalive(self) -> asyncio.Task[None]:
        if self._keepalive_task and not self._keepalive_task.done():
            return self._keepalive_task
        self._keepalive_task = asyncio.create_task(self._keepalive_loop())
        return self._keepalive_task

    async def close(self) -> None:
        if self._keepalive_task and not self._keepalive_task.done():
            self._keepalive_task.cancel()
        await self._client.aclose()

    async def _keepalive_loop(self) -> None:
        while True:
            try:
                status = await self.status(force=True)
                if status["available"]:
                    await self._request("/tickle", method="POST", body={}, timeout=5)
            except Exception:
                pass
            await asyncio.sleep(60)

    async def _accounts(self) -> list[dict[str, Any]]:
        await self.connect()
        cached_at, cached = self._accounts_cache
        if cached and time.monotonic() - cached_at < 5:
            return cached
        async with self._account_lock:
            cached_at, cached = self._accounts_cache
            if cached and time.monotonic() - cached_at < 5:
                return cached
            payload = await self._request("/portfolio/accounts")
            accounts = [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []
            if not accounts:
                raise ProviderError("IBKR Web API returned no accessible account")
            self._accounts_cache = (time.monotonic(), accounts)
            return accounts

    @staticmethod
    def _month_key(value: str) -> int:
        for pattern in ("%b%y", "%Y%m", "%Y%m%d"):
            try:
                return int(datetime.strptime(value.strip().title(), pattern).strftime("%Y%m%d"))
            except ValueError:
                continue
        return 99_999_999

    @staticmethod
    def _expiration_key(item: dict[str, Any]) -> int:
        for key in ("maturityDate", "lastTradingDay", "lastTradeDate", "contractMonth"):
            value = str(item.get(key) or "").replace("-", "")
            if value[:8].isdigit():
                return int(value[:8])
            if value[:6].isdigit():
                return int(value[:6] + "31")
        return 99_999_999

    async def _future_contract(self, symbol: str) -> dict[str, Any]:
        spec = FUTURE_SPECS[symbol]
        root = spec.get("root", symbol)
        search = await self._request("/iserver/secdef/search", params={"symbol": root})
        candidates = [item for item in search if isinstance(item, dict)] if isinstance(search, list) else []
        underlying = next(
            (
                item
                for item in candidates
                if str(item.get("symbol", "")).upper() == root
                and any(str(section.get("secType", "")).upper() == "FUT" for section in item.get("sections", []) if isinstance(section, dict))
            ),
            None,
        )
        if not underlying:
            raise ProviderError(f"IBKR Web API could not resolve {root} futures")
        section = next(
            section
            for section in underlying.get("sections", [])
            if isinstance(section, dict) and str(section.get("secType", "")).upper() == "FUT"
        )
        months = [item for item in str(section.get("months") or "").split(";") if item]
        today = int(datetime.now(timezone.utc).strftime("%Y%m%d"))
        month_floor = int(datetime.now(timezone.utc).strftime("%Y%m") + "01")
        months = [item for item in sorted(months, key=self._month_key) if self._month_key(item) >= month_floor]
        contracts: list[dict[str, Any]] = []
        for month in months[:6]:
            try:
                payload = await self._request(
                    "/iserver/secdef/info",
                    params={
                        "conid": underlying.get("conid"),
                        "sectype": "FUT",
                        "month": month,
                        "exchange": spec["exchange"],
                    },
                )
            except ProviderError:
                continue
            rows = [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []
            contracts.extend(
                item
                for item in rows
                if str(item.get("currency") or spec["currency"]).upper() == spec["currency"]
                and self._expiration_key(item) >= today
            )
            if contracts:
                break
        if not contracts:
            raise ProviderError(f"IBKR Web API returned no active {root} futures contract")
        contract = min(contracts, key=self._expiration_key)
        conid = int(contract.get("conid") or 0)
        if not conid:
            raise ProviderError(f"IBKR Web API returned an invalid {root} contract")
        return {
            "conid": conid,
            "symbol": contract.get("localSymbol") or contract.get("symbol") or root,
            "root": root,
            "exchange": contract.get("listingExchange") or contract.get("exchange") or spec["exchange"],
            "currency": contract.get("currency") or spec["currency"],
            "sec_type": "FUT",
        }

    async def _contract(self, symbol: str) -> dict[str, Any]:
        symbol = normalize_symbol(symbol)
        cached = self._contract_cache.get(symbol)
        if cached and time.monotonic() - cached[0] < 1_800:
            return cached[1]
        async with self._contract_lock:
            cached = self._contract_cache.get(symbol)
            if cached and time.monotonic() - cached[0] < 1_800:
                return cached[1]
            await self.connect()
            if symbol in FUTURE_SPECS:
                contract = await self._future_contract(symbol)
            else:
                ticker = symbol.removesuffix(".US")
                sec_type = "IND" if ticker in {"NDX", "SPX", "IXIC"} else "STK"
                payload = await self._request(
                    "/iserver/secdef/search",
                    params={"symbol": ticker, "secType": sec_type},
                )
                rows = [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []
                exact = [item for item in rows if str(item.get("symbol", "")).upper() == ticker]
                item = (exact or rows or [None])[0]
                if not item or not int(item.get("conid") or 0):
                    raise ProviderError(f"IBKR Web API could not resolve {symbol}")
                contract = {
                    "conid": int(item["conid"]),
                    "symbol": item.get("symbol") or ticker,
                    "root": ticker,
                    "exchange": item.get("listingExchange") or item.get("exchange") or ("NASDAQ" if sec_type == "IND" else "SMART"),
                    "currency": item.get("currency") or "USD",
                    "sec_type": sec_type,
                }
            self._contract_cache[symbol] = (time.monotonic(), contract)
            return contract

    async def candles(self, symbol: str, timeframe: str) -> list[list[float]]:
        if timeframe not in WEB_BAR_REQUESTS:
            raise ProviderError(f"unsupported timeframe {timeframe}")
        symbol = normalize_symbol(symbol)
        contract = await self._contract(symbol)
        period, bar = WEB_BAR_REQUESTS[timeframe]
        payload = await self._request(
            "/iserver/marketdata/history",
            params={
                "conid": contract["conid"],
                "exchange": contract["exchange"],
                "period": period,
                "bar": bar,
                "outsideRth": str(symbol in FUTURE_SPECS).lower(),
                "source": "Trades",
            },
            timeout=20,
        )
        values = payload.get("data", []) if isinstance(payload, dict) else []
        rows = []
        for item in values:
            if not isinstance(item, dict):
                continue
            timestamp = _number(item.get("t"))
            if timestamp is None:
                continue
            rows.append(
                [
                    int(timestamp / 1_000 if timestamp > 10_000_000_000 else timestamp),
                    _number(item.get("o")),
                    _number(item.get("h")),
                    _number(item.get("l")),
                    _number(item.get("c")),
                    _number(item.get("v"), 0),
                ]
            )
        rows = _closed(rows, timeframe)
        if len(rows) < 70:
            raise ProviderError(f"IBKR Web API returned only {len(rows)} closed candles")
        return rows

    async def quote(self, symbol: str, fallback_candle: list[float] | None = None) -> dict[str, Any]:
        contract = await self._contract(symbol)
        params = {"conids": contract["conid"], "fields": "31,55,70,71,84,86,6509"}
        payload: Any = []
        try:
            await self._request("/iserver/marketdata/snapshot", params=params, timeout=5)
            await asyncio.sleep(0.55)
            payload = await self._request("/iserver/marketdata/snapshot", params=params, timeout=5)
        except ProviderError:
            pass
        item = payload[0] if isinstance(payload, list) and payload else {}
        price = _number(item.get("31")) if isinstance(item, dict) else None
        if price is None and fallback_candle:
            price = _number(fallback_candle[4])
        availability = str(item.get("6509") or "") if isinstance(item, dict) else ""
        state = {
            "R": "LIVE",
            "D": "DELAYED",
            "Z": "FROZEN",
            "Y": "DELAYED_FROZEN",
            "N": "NOT_SUBSCRIBED",
            "O": "AGREEMENT_REQUIRED",
        }.get(availability[:1], "CLOSED_BAR" if fallback_candle else "SNAPSHOT")
        return {
            "source": self.name,
            "price": price,
            "previousClose": None,
            "change": None,
            "bid": _number(item.get("84")) if isinstance(item, dict) else None,
            "ask": _number(item.get("86")) if isinstance(item, dict) else None,
            "state": state,
            "exchange": contract["exchange"],
            "contract": contract["symbol"],
            "asOf": int(_number(item.get("_updated"), time.time() * 1_000) or time.time() * 1_000),
        }

    @staticmethod
    def _summary_number(payload: dict[str, Any], *keys: str) -> tuple[float | None, str | None]:
        for key in keys:
            item = payload.get(key)
            if isinstance(item, dict):
                number = _number(item.get("amount"), _number(item.get("value")))
                if number is not None:
                    return number, item.get("currency")
            number = _number(item)
            if number is not None:
                return number, None
        return None, None

    async def account_summary(self) -> dict[str, Any]:
        account = (await self._accounts())[0]
        account_id = account.get("accountId") or account.get("id")
        payload = await self._request(f"/portfolio/{urllib.parse.quote(str(account_id))}/summary")
        if not isinstance(payload, dict):
            raise ProviderError("IBKR Web API returned an invalid account summary")
        fields = {
            "net_liquidation": ("netliquidation", "netLiquidation"),
            "total_cash": ("cashbalance", "totalcashvalue", "totalCashValue"),
            "available_funds": ("availablefunds", "availableFunds"),
            "buying_power": ("buyingpower", "buyingPower"),
            "gross_position_value": ("grosspositionvalue", "grossPositionValue"),
            "excess_liquidity": ("excessliquidity", "excessLiquidity"),
        }
        output: dict[str, Any] = {
            "source": self.name,
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
        }
        currency = account.get("currency") or "BASE"
        for target, keys in fields.items():
            number, item_currency = self._summary_number(payload, *keys)
            if number is not None:
                output[target] = number
            if item_currency:
                currency = item_currency
        output["currency"] = currency
        output["currencies"] = {
            currency: {key: value for key, value in output.items() if key in fields and isinstance(value, (int, float))}
        }
        output["provider_status"] = self.status_snapshot()
        return output

    async def positions(self) -> dict[str, Any]:
        account = (await self._accounts())[0]
        account_id = urllib.parse.quote(str(account.get("accountId") or account.get("id")))
        rows: list[dict[str, Any]] = []
        for page in range(20):
            payload = await self._request(f"/portfolio/{account_id}/positions/{page}")
            page_rows = [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []
            rows.extend(page_rows)
            if len(page_rows) < 100:
                break
        positions = [
            {
                "symbol": item.get("contractDesc") or item.get("ticker") or item.get("symbol") or str(item.get("conid") or ""),
                "asset_class": item.get("assetClass") or item.get("secType") or "",
                "currency": item.get("currency") or account.get("currency") or "USD",
                "quantity": _number(item.get("position"), 0) or 0,
                "market_price": _number(item.get("mktPrice"), 0) or 0,
                "market_value": _number(item.get("mktValue"), 0) or 0,
                "average_cost": _number(item.get("avgCost"), _number(item.get("avgPrice"), 0)) or 0,
                "unrealized_pnl": _number(item.get("unrealizedPnl"), 0) or 0,
                "realized_pnl": _number(item.get("realizedPnl"), 0) or 0,
            }
            for item in rows
        ]
        return {
            "source": self.name,
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "positions": positions,
        }

    @staticmethod
    def _trade_multiplier(item: dict[str, Any]) -> float:
        explicit = _number(item.get("multiplier"))
        if explicit:
            return explicit
        symbol = str(item.get("symbol") or item.get("contract_description_1") or "").upper()
        root = "".join(character for character in symbol if character.isalpha())
        for candidate, multiplier in FUTURE_MULTIPLIERS.items():
            if root.startswith(candidate):
                return multiplier
        return 1

    async def review_trades(self, days: int = 30) -> dict[str, Any]:
        await self.connect()
        window = max(1, min(days, 7))
        payload = await self._request("/iserver/account/trades", params={"days": window})
        rows = payload if isinstance(payload, list) else payload.get("trades", []) if isinstance(payload, dict) else []
        normalized = []
        for index, item in enumerate(rows):
            if not isinstance(item, dict):
                continue
            side_value = str(item.get("side") or item.get("type") or "").upper()
            side = "BUY" if side_value in {"B", "BOT", "BUY"} else "SELL" if side_value in {"S", "SLD", "SELL"} else ""
            timestamp = item.get("trade_time_r") or item.get("tradeTimeR") or item.get("trade_time") or item.get("tradeTime")
            quantity = abs(_number(item.get("size"), _number(item.get("quantity"), _number(item.get("qty"), 0))) or 0)
            price = _number(item.get("price"))
            if not side or not timestamp or not quantity or price is None:
                continue
            try:
                executed_at = datetime.fromtimestamp(_epoch(timestamp), timezone.utc)
            except (TypeError, ValueError, OSError):
                continue
            normalized.append(
                {
                    "id": str(item.get("execution_id") or item.get("executionId") or item.get("trade_id") or index),
                    "symbol": item.get("symbol") or item.get("contract_description_1") or item.get("company_name") or "UNKNOWN",
                    "book_key": str(item.get("conid") or item.get("conidex") or item.get("symbol") or item.get("contract_description_1") or "UNKNOWN"),
                    "side": side,
                    "time": executed_at,
                    "quantity": quantity,
                    "price": price,
                    "multiplier": self._trade_multiplier(item),
                    "currency": item.get("currency") or "USD",
                    "fee": abs(_number(item.get("commission"), 0) or 0),
                }
            )
        trades, unmatched = match_execution_fills(normalized)
        note = "IBKR Client Portal direct executions cover at most the current day plus six prior days."
        if days > 7:
            note += " Longer history requires an IBKR Flex Query or an imported trade file."
        return {
            "schema": "traderhome_review_trades_v1",
            "source": self.name,
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "window_days": window,
            "requested_window_days": days,
            "trades": trades,
            "quality": {
                "fills_read": len(normalized),
                "complete_round_trips": len(trades),
                "unmatched_open_lots": unmatched,
                "direct_api_window_days": window,
                "history_complete": days <= 7,
                "note": note,
            },
        }
