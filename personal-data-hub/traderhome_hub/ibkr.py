from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from .config import Settings
from .providers import FUTURE_SPECS, ProviderError, TIMEFRAME_SECONDS, _closed, _number, aggregate_four_hour, match_execution_fills, normalize_symbol

try:
    from ib_async import ContFuture, ExecutionFilter, IB, Index, Stock
except ImportError:  # pragma: no cover - service health reports this explicitly
    ContFuture = ExecutionFilter = IB = Index = Stock = None


BAR_REQUESTS = {
    "1m": ("1 min", "2 D"),
    "5m": ("5 mins", "5 D"),
    "15m": ("15 mins", "10 D"),
    "1h": ("1 hour", "2 M"),
    "4h": ("1 hour", "4 M"),
    "1d": ("1 day", "2 Y"),
}


class IbkrProvider:
    name = "IBKR TWS API"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.ib = IB() if IB else None
        self.port: int | None = None
        self.last_error = "ib_async is not installed" if not IB else "IB Gateway/TWS is not connected"
        self.retry_after = 0.0
        self._connect_lock = asyncio.Lock()
        self._contract_lock = asyncio.Lock()
        self._request_limiter = asyncio.Semaphore(3)
        self._contract_cache: dict[str, Any] = {}

    @property
    def connected(self) -> bool:
        return bool(self.ib and self.ib.isConnected())

    async def connect(self) -> None:
        if self.connected:
            return
        if not self.ib:
            raise ProviderError(self.last_error)
        if time.monotonic() < self.retry_after:
            raise ProviderError(self.last_error)
        async with self._connect_lock:
            if self.connected:
                return
            errors = []
            handshake_port: int | None = None
            for port in self.settings.ibkr_ports:
                try:
                    await self.ib.connectAsync(
                        self.settings.ibkr_host,
                        port,
                        clientId=self.settings.ibkr_client_id,
                        timeout=2.5,
                        readonly=True,
                    )
                    self.port = port
                    self.last_error = ""
                    self.retry_after = 0.0
                    return
                except Exception as error:  # ib_async exposes several transport exceptions
                    detail = str(error).strip() or type(error).__name__
                    errors.append(f"{port}: {detail}")
                    if self.ib.isConnected():
                        self.ib.disconnect()
                    if isinstance(error, TimeoutError):
                        # The port accepted TCP but never completed the TWS protocol.
                        # Trying every default port only delays the useful diagnosis.
                        handshake_port = port
                        break
            if handshake_port is not None:
                self.last_error = (
                    f"IB Gateway is listening on {handshake_port}, but the API handshake timed out; "
                    "finish Gateway login and confirm socket API access"
                )
            else:
                self.last_error = "IB Gateway/TWS is not listening on configured API ports"
            self.retry_after = time.monotonic() + 5
            detail = f" ({'; '.join(errors)})" if errors else ""
            raise ProviderError(self.last_error + detail)

    async def status(self) -> dict[str, Any]:
        try:
            await self.connect()
        except ProviderError:
            pass
        return {
            "available": self.connected,
            "source": self.name,
            "port": self.port,
            "readonly": True,
            "message": "connected" if self.connected else self.last_error,
        }

    async def _contract(self, symbol: str) -> Any:
        symbol = normalize_symbol(symbol)
        if symbol in self._contract_cache:
            return self._contract_cache[symbol]
        async with self._contract_lock:
            if symbol in self._contract_cache:
                return self._contract_cache[symbol]
            await self.connect()
            if symbol in FUTURE_SPECS:
                spec = FUTURE_SPECS[symbol]
                root = spec.get("root", symbol)
                contract = ContFuture(root, spec["exchange"], spec["currency"])
            elif symbol == "NDX":
                contract = Index("NDX", "NASDAQ", "USD")
            else:
                contract = Stock(symbol.removesuffix(".US"), "SMART", "USD")
            qualified = await self.ib.qualifyContractsAsync(contract)
            if not qualified:
                raise ProviderError(f"IBKR could not resolve {symbol}")
            self._contract_cache[symbol] = qualified[0]
            return qualified[0]

    async def candles(self, symbol: str, timeframe: str) -> list[list[float]]:
        if timeframe not in BAR_REQUESTS:
            raise ProviderError(f"unsupported timeframe {timeframe}")
        contract = await self._contract(symbol)
        async with self._request_limiter:
            bar_size, duration = BAR_REQUESTS[timeframe]
            try:
                bars = await self.ib.reqHistoricalDataAsync(
                    contract,
                    endDateTime="",
                    durationStr=duration,
                    barSizeSetting=bar_size,
                    whatToShow="TRADES",
                    useRTH=normalize_symbol(symbol) not in FUTURE_SPECS,
                    formatDate=2,
                    keepUpToDate=False,
                    timeout=18,
                )
            except Exception as error:
                self.last_error = str(error)
                raise ProviderError(f"IBKR historical data failed: {error}") from error
        rows = []
        for bar in bars or []:
            date = getattr(bar, "date", None)
            try:
                timestamp = int(date.timestamp()) if hasattr(date, "timestamp") else int(datetime.fromisoformat(str(date)).replace(tzinfo=timezone.utc).timestamp())
                rows.append([timestamp, float(bar.open), float(bar.high), float(bar.low), float(bar.close), float(bar.volume or 0)])
            except (TypeError, ValueError):
                continue
        rows = _closed(rows, "1h" if timeframe == "4h" else timeframe)
        if timeframe == "4h":
            rows = aggregate_four_hour(rows)
        if len(rows) < 70:
            raise ProviderError(f"IBKR returned only {len(rows)} closed candles")
        return rows

    async def quote(self, symbol: str, fallback_candle: list[float] | None = None) -> dict[str, Any]:
        contract = await self._contract(symbol)
        price = fallback_candle[4] if fallback_candle else None
        previous_close = None
        state = "CLOSED_BAR"
        as_of = int((fallback_candle[0] if fallback_candle else time.time()) * 1_000)
        try:
            async with self._request_limiter:
                tickers = await asyncio.wait_for(self.ib.reqTickersAsync(contract), timeout=3.5)
            ticker = tickers[0] if tickers else None
            if ticker is not None:
                live_price = _number(getattr(ticker, "last", None))
                if live_price is None:
                    live_price = _number(ticker.marketPrice())
                if live_price is not None:
                    price = live_price
                previous_close = _number(getattr(ticker, "close", None))
                market_data_type = int(_number(getattr(ticker, "marketDataType", 0), 0) or 0)
                state = {1: "LIVE", 2: "FROZEN", 3: "DELAYED", 4: "DELAYED_FROZEN"}.get(
                    market_data_type,
                    "SNAPSHOT" if live_price is not None else "CLOSED_BAR",
                )
                ticker_time = getattr(ticker, "time", None)
                if isinstance(ticker_time, datetime):
                    as_of = int(ticker_time.timestamp() * 1_000)
        except Exception:
            # Accounts without snapshot permissions still get a clearly labeled
            # latest closed bar instead of a failed chart.
            pass
        return {
            "source": self.name,
            "price": price,
            "previousClose": previous_close,
            "change": price / previous_close - 1 if price and previous_close else None,
            "state": state,
            "exchange": getattr(contract, "exchange", None) or "IBKR",
            "asOf": as_of,
        }

    async def account_summary(self) -> dict[str, Any]:
        await self.connect()
        accounts = self.ib.managedAccounts()
        account = accounts[0] if accounts else ""
        try:
            values = await self.ib.accountSummaryAsync(account)
        except TypeError:
            values = await self.ib.accountSummaryAsync()
        wanted = {
            "NetLiquidation": "net_liquidation",
            "TotalCashValue": "total_cash",
            "AvailableFunds": "available_funds",
            "BuyingPower": "buying_power",
            "GrossPositionValue": "gross_position_value",
            "ExcessLiquidity": "excess_liquidity",
        }
        output: dict[str, Any] = {
            "source": self.name,
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
        }
        currencies: dict[str, dict[str, float]] = {}
        for value in values or []:
            if value.tag not in wanted:
                continue
            number = _number(value.value)
            if number is None:
                continue
            currency = value.currency or "BASE"
            currencies.setdefault(currency, {})[wanted[value.tag]] = number
            if currency in {"BASE", "USD"} and wanted[value.tag] not in output:
                output[wanted[value.tag]] = number
        base_currency = next(
            (currency for currency, fields in currencies.items() if "net_liquidation" in fields),
            next(iter(currencies), "BASE"),
        )
        output["currency"] = base_currency
        for field, number in currencies.get(base_currency, {}).items():
            output.setdefault(field, number)
        output["currencies"] = currencies
        output["provider_status"] = await self.status()
        return output

    async def positions(self) -> dict[str, Any]:
        await self.connect()
        accounts = self.ib.managedAccounts()
        account = accounts[0] if accounts else ""
        try:
            items = await self.ib.reqAccountUpdatesAsync(account)
            portfolio = list(items or self.ib.portfolio(account))
        except (AttributeError, TypeError):
            portfolio = list(self.ib.portfolio(account))
        positions = []
        for item in portfolio:
            contract = item.contract
            positions.append(
                {
                    "symbol": contract.localSymbol or contract.symbol,
                    "asset_class": contract.secType,
                    "currency": contract.currency,
                    "quantity": float(item.position),
                    "market_price": float(item.marketPrice),
                    "market_value": float(item.marketValue),
                    "average_cost": float(item.averageCost),
                    "unrealized_pnl": float(item.unrealizedPNL),
                    "realized_pnl": float(item.realizedPNL),
                }
            )
        return {
            "source": self.name,
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "positions": positions,
        }

    async def review_trades(self, days: int = 30) -> dict[str, Any]:
        await self.connect()
        start = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))
        filter_ = ExecutionFilter(time=start.strftime("%Y%m%d-%H:%M:%S"))
        try:
            fills = await self.ib.reqExecutionsAsync(filter_)
        except Exception as error:
            raise ProviderError(f"IBKR executions failed: {error}") from error
        normalized = []
        for fill in fills or []:
            execution = fill.execution
            contract = fill.contract
            report = fill.commissionReport
            normalized.append(
                {
                    "id": execution.execId,
                    "symbol": contract.localSymbol or contract.symbol,
                    "book_key": str(contract.conId or contract.localSymbol or contract.symbol),
                    "side": execution.side,
                    "time": execution.time if isinstance(execution.time, datetime) else datetime.fromisoformat(str(execution.time)),
                    "quantity": float(execution.shares),
                    "price": float(execution.price),
                    "multiplier": _number(contract.multiplier, 1) or 1,
                    "currency": contract.currency or "USD",
                    "fee": abs(_number(getattr(report, "commission", 0), 0) or 0),
                }
            )
        trades, unmatched = match_execution_fills(normalized)
        return {
            "schema": "traderhome_review_trades_v1",
            "source": self.name,
            "readonly": True,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "window_days": days,
            "trades": trades,
            "quality": {
                "fills_read": len(normalized),
                "complete_round_trips": len(trades),
                "unmatched_open_lots": unmatched,
                "note": "Only FIFO-matched complete round trips are returned; account identifiers are removed.",
            },
        }
