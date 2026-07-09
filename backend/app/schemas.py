"""Pydantic 模型 — 同时定义 OpenAPI 契约。"""
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, EmailStr, Field


# ---- auth ----
class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    plan: str = "free"


class UserOut(BaseModel):
    id: str
    email: EmailStr
    plan: str
    quota_used: int
    quota_limit: int


# ---- symbols ----
class SymbolHit(BaseModel):
    ticker: str
    name: str
    exchange: str
    market: str  # crypto | stock | commodity


class ResolveIn(BaseModel):
    query: str


class ResolveOut(BaseModel):
    exists: bool
    canonical: Optional[SymbolHit] = None
    ambiguous: list[SymbolHit] = []


# ---- analysis ----
class ForwardStat(BaseModel):
    n: int
    p_up: float
    mean: float
    median: float
    p25: float
    p75: float


class Match(BaseModel):
    date: str
    corr: float
    max_dd: float
    returns: dict[str, float]


class AnalysisOut(BaseModel):
    symbol: str
    market: str
    timeframe: str
    window: int
    as_of: str
    verdict: str            # bull | bullweak | below | neutral (free)
    kpi: dict               # mid_p_up / baseline / peak_similarity / last_close (free)
    morphology: str         # free
    chart_url: Optional[str] = None
    # Pro-only (免费用户下这些为 None,服务端不下发)
    prob_table: Optional[list[dict]] = None
    seasonality_years: Optional[list[dict]] = None
    matches: Optional[list[Match]] = None
    locked: list[str] = []  # 免费用户下被锁定的字段名


# ---- watchlists ----
class WatchlistIn(BaseModel):
    name: str


class WatchlistItemIn(BaseModel):
    symbol: str
    market: str


class Watchlist(BaseModel):
    id: str
    name: str
    items: list[WatchlistItemIn] = []


# ---- events ----
class Event(BaseModel):
    ev: str
    ts: Optional[int] = None
    props: dict = {}


class CollectIn(BaseModel):
    anon_id: Optional[str] = None
    session_id: Optional[str] = None
    events: list[Event]


# ---- billing ----
class EntitlementOut(BaseModel):
    tier: str
    daily_limit: int
    valid_until: Optional[float] = None
    source: Optional[str] = None


class XianyuSku(BaseModel):
    tier: str
    price_cny: int
    url: str


class RedeemIn(BaseModel):
    code: str


class CryptoNetworkOut(BaseModel):
    key: str            # bnb | arbitrum | solana
    label: str
    family: str         # evm | solana
    address: str


class CryptoQuoteIn(BaseModel):
    tier: str
    network: str


class CryptoQuoteOut(BaseModel):
    order_id: str
    tier: str
    network: str
    label: str
    address: str
    token: str = "USDC"
    amount: str           # 应付 USDC(稳定币,=定价)
    expires_at: float


class CryptoSubmitIn(BaseModel):
    tier: str
    network: str
    tx_hash: str
    order_id: Optional[str] = None


class CryptoSubmitOut(BaseModel):
    status: str                       # confirmed | pending | failed
    message: str = ""
    entitlement: Optional[EntitlementOut] = None


class CodeGenIn(BaseModel):
    tier: str
    count: int = 10
    valid_days: int = 30
