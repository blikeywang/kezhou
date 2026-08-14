from __future__ import annotations

import asyncio
import hmac
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode, urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from . import __version__
from .config import Settings
from .ibkr import IbkrProvider as IbkrSocketProvider
from .ibkr_web import IbkrWebProvider
from .providers import BinanceProvider, FUTURE_SPECS, LongbridgeProvider, ProviderError, TimedCache, aggregate_four_hour, aggregate_session_four_hour, is_crypto, normalize_symbol


settings = Settings.from_env()
account_token = settings.account_token()
cache = TimedCache(settings.cache_seconds)
binance = BinanceProvider(cache, settings)
longbridge = LongbridgeProvider(settings, cache)
ibkr_web = IbkrWebProvider(settings)
ibkr_socket = IbkrSocketProvider(settings)

app = FastAPI(
    title="TraderHome Personal Data Hub",
    version=__version__,
    docs_url="/docs",
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Accept", "Authorization", "Content-Type"],
    expose_headers=["X-TraderHome-Provider"],
    max_age=600,
)


@app.on_event("startup")
async def prewarm_personal_sources() -> None:
    async def warm_longbridge() -> None:
        try:
            await longbridge.sdk.ensure()
        except Exception:
            pass

    app.state.longbridge_warmup = asyncio.create_task(warm_longbridge())

    app.state.ibkr_keepalive = ibkr_web.start_keepalive()
    if settings.ibkr_socket_fallback:
        async def warm_ibkr_socket() -> None:
            try:
                await ibkr_socket.connect()
            except Exception:
                pass

        app.state.ibkr_socket_warmup = asyncio.create_task(warm_ibkr_socket())


@app.on_event("shutdown")
async def close_personal_sources() -> None:
    await ibkr_web.close()


@app.middleware("http")
async def private_network_headers(request: Request, call_next):
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def require_token(authorization: str | None = Header(default=None)) -> None:
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not supplied or not hmac.compare_digest(supplied, account_token):
        raise HTTPException(status_code=401, detail="Local account token required")


def _allowed_return(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    is_local = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    return origin in settings.allowed_origins or is_local


async def _provider_statuses(probe_ibkr: bool = False) -> dict[str, Any]:
    web_status = await ibkr_web.status(force=True) if probe_ibkr else ibkr_web.status_snapshot()
    socket_status = None
    if settings.ibkr_socket_fallback:
        socket_status = await ibkr_socket.status() if probe_ibkr else {
            "available": ibkr_socket.connected,
            "source": ibkr_socket.name,
            "port": ibkr_socket.port,
            "readonly": True,
            "message": "connected" if ibkr_socket.connected else ibkr_socket.last_error,
        }
    ibkr_available = bool(web_status["available"] or (socket_status and socket_status["available"]))
    active_source = web_status["source"] if web_status["available"] else socket_status["source"] if socket_status and socket_status["available"] else "IBKR"
    ibkr_status = {
        "available": ibkr_available,
        "connected": ibkr_available,
        "source": active_source,
        "readonly": True,
        "mode": "client_portal_web_api" if web_status["available"] else "socket_fallback" if socket_status and socket_status["available"] else "client_portal_web_api",
        "gateway_available": web_status["gateway_available"],
        "authentication_required": web_status["authentication_required"],
        "login_url": f"http://{settings.host}:{settings.port}/api/v1/ibkr/login",
        "message": "connected" if ibkr_available else web_status["message"],
        "web_api": web_status,
        "socket_fallback_enabled": settings.ibkr_socket_fallback,
    }
    return {
        "longbridge": {
            "available": longbridge.available,
            "connected": longbridge.connected,
            "source": longbridge.name,
            "message": "persistent SDK connected" if longbridge.connected else (
                "SDK ready; existing OAuth login is checked on first request" if longbridge.available else "SDK and CLI not installed"
            ),
        },
        "ibkr": ibkr_status,
        "binance": {
            "available": True,
            "account_available": binance.account_available,
            "source": binance.name,
            "message": "public market data and private read-only account API ready" if binance.account_available else "public read-only REST ready; account API key is optional",
        },
    }


def _ibkr_candidates() -> list[Any]:
    candidates: list[Any] = [ibkr_web]
    if settings.ibkr_socket_fallback:
        candidates.append(ibkr_socket)
    return candidates


async def _ibkr_call(method: str, *args: Any) -> Any:
    errors = []
    for provider in _ibkr_candidates():
        try:
            return await getattr(provider, method)(*args)
        except ProviderError as error:
            errors.append(f"{provider.name}: {error}")
    raise ProviderError("; ".join(errors) or "IBKR is unavailable")


@app.get("/health")
async def health(probe: bool = Query(default=False)) -> dict[str, Any]:
    return {
        "ok": True,
        "service": "traderhome-personal-data-hub",
        "version": __version__,
        "readonly": True,
        "bind": f"{settings.host}:{settings.port}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "providers": await _provider_statuses(probe_ibkr=probe),
    }


@app.get("/api/v1/providers")
async def providers(probe: bool = Query(default=True)) -> dict[str, Any]:
    return {"readonly": True, "providers": await _provider_statuses(probe_ibkr=probe)}


@app.get("/api/v1/ibkr/login")
async def ibkr_login():
    return RedirectResponse(settings.ibkr_web_login_url, status_code=307)


@app.get("/api/v1/ibkr/status")
async def ibkr_status() -> dict[str, Any]:
    return {"readonly": True, "ibkr": (await _provider_statuses(probe_ibkr=True))["ibkr"]}


@app.get("/connect")
async def connect(return_url: str = Query(alias="return")):
    if not _allowed_return(return_url):
        raise HTTPException(status_code=400, detail="Return URL is not allowed")
    separator = "&" if "#" in return_url else "#"
    fragment = urlencode(
        {
            "hub_url": f"http://{settings.host}:{settings.port}",
            "hub_token": account_token,
        }
    )
    return RedirectResponse(return_url + separator + fragment, status_code=302)


async def _market_bundle(symbol: str, timeframes: list[str]) -> dict[str, Any]:
    symbol = normalize_symbol(symbol)
    attempts: list[dict[str, str]] = []
    if is_crypto(symbol):
        candidates = [binance]
    elif symbol in FUTURE_SPECS:
        candidates = _ibkr_candidates()
    else:
        candidates = [longbridge, *_ibkr_candidates()]
    for provider in candidates:
        try:
            fetched_timeframes = [timeframe for timeframe in timeframes if timeframe != "4h" or "1h" not in timeframes]
            values = await asyncio.gather(*(provider.candles(symbol, timeframe) for timeframe in fetched_timeframes))
            fetched = dict(zip(fetched_timeframes, values))
            if "4h" in timeframes and "4h" not in fetched:
                fetched["4h"] = (
                    aggregate_session_four_hour(fetched["1h"])
                    if provider is longbridge
                    else aggregate_four_hour(fetched["1h"])
                )
            data = {
                timeframe: {"candles": fetched[timeframe], "source": provider.name, "closed_only": True}
                for timeframe in timeframes
            }
            quote = await (
                provider.quote(symbol, fetched[timeframes[0]][-1])
                if provider in {ibkr_web, ibkr_socket}
                else provider.quote(symbol)
            )
            derivatives = await binance.derivatives(symbol) if provider is binance else {"available": False}
            return {
                "schema": "traderhome_market_bundle_v1",
                "symbol": symbol,
                "generated_at": int(time.time() * 1_000),
                "readonly": True,
                "provider": provider.name,
                "provider_attempts": attempts,
                "data": data,
                "market": quote,
                "derivatives": derivatives,
                "macro": {"available": False},
            }
        except Exception as error:
            attempts.append({"provider": provider.name, "error": str(error)[:280]})
    raise ProviderError("; ".join(f"{item['provider']}: {item['error']}" for item in attempts))


@app.get("/api/v1/market/bundle")
async def market_bundle(
    symbol: str = Query(min_length=1, max_length=24),
    timeframes: str = Query(default="1m,5m,15m,1h,4h,1d"),
) -> dict[str, Any]:
    requested = list(dict.fromkeys(item.strip() for item in timeframes.split(",") if item.strip()))
    allowed = {"1m", "5m", "15m", "1h", "4h", "1d"}
    if not requested or any(item not in allowed for item in requested):
        raise HTTPException(status_code=422, detail="Unsupported timeframe")
    try:
        return await cache.get(
            f"bundle:{normalize_symbol(symbol)}:{','.join(requested)}",
            lambda: _market_bundle(symbol, requested),
        )
    except ProviderError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/v1/market/quote")
async def market_quote(symbol: str = Query(min_length=1, max_length=24)) -> dict[str, Any]:
    try:
        bundle = await cache.get(
            f"quote-bundle:{normalize_symbol(symbol)}",
            lambda: _market_bundle(symbol, ["1m"]),
            seconds=5,
        )
        return {
            "schema": "traderhome_market_quote_v1",
            "symbol": bundle["symbol"],
            "provider": bundle["provider"],
            "generated_at": bundle["generated_at"],
            "readonly": True,
            "market": bundle["market"],
        }
    except ProviderError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/v1/account/summary", dependencies=[Depends(require_token)])
async def account_summary(provider: str = Query(default="ibkr", pattern="^(ibkr|longbridge|binance)$")) -> dict[str, Any]:
    try:
        if provider == "ibkr":
            return await _ibkr_call("account_summary")
        return await (longbridge.account_summary() if provider == "longbridge" else binance.account_summary())
    except ProviderError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/v1/account/positions", dependencies=[Depends(require_token)])
async def positions(provider: str = Query(default="ibkr", pattern="^(ibkr|longbridge|binance)$")) -> dict[str, Any]:
    try:
        if provider == "ibkr":
            return await _ibkr_call("positions")
        return await (longbridge.positions() if provider == "longbridge" else binance.positions())
    except ProviderError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/v1/review/trades", dependencies=[Depends(require_token)])
async def review_trades(
    days: int = Query(default=30, ge=1, le=365),
    provider: str = Query(default="ibkr", pattern="^(ibkr|longbridge|binance)$"),
    symbols: str = Query(default="", max_length=240),
) -> dict[str, Any]:
    try:
        if provider == "ibkr":
            return await _ibkr_call("review_trades", days)
        if provider == "longbridge":
            return await longbridge.review_trades(days)
        requested = [item.strip() for item in symbols.split(",") if item.strip()]
        return await binance.review_trades(days, requested)
    except ProviderError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
