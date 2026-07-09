"""内存存储 —— 骨架用。生产替换为 Postgres(账户/订阅/收藏)+ Redis(额度)+ 列存(K线)+ 数仓(事件)。

所有 TODO 标记出需要换成真实基础设施的位置。
"""
from __future__ import annotations
import secrets, time, uuid
from datetime import date, datetime, timezone

# ---- 用户 / 订阅(TODO: Postgres) ----
USERS: dict[str, dict] = {}          # id -> {id,email,pw_hash,plan}
EMAIL_INDEX: dict[str, str] = {}     # email -> id

# ---- 收藏(TODO: Postgres) ----
WATCHLISTS: dict[str, dict] = {}     # user_id -> {list_id: {name, items:[...]}}

# ---- 事件(TODO: ClickHouse/BigQuery 或 PostHog) ----
EVENTS: list[dict] = []

# ---- 额度(TODO: Redis 计数 + 每日过期) ----
_QUOTA: dict[str, set[str]] = {}     # f"{user_id}:{YYYY-MM-DD}" -> set(symbol)

# ---- 统一权益(TODO: Postgres subscription 表) ----
ENTITLEMENTS: dict[str, dict] = {}   # user_id -> {tier, daily_limit, valid_until, source}
# ---- 闲鱼兑换码(TODO: Postgres,足够随机 + 失败限速防枚举) ----
REDEMPTION: dict[str, dict] = {}     # code -> {tier, valid_days, used, used_by}
# ---- 加密交易去重(防重放)(TODO: Postgres 唯一索引 tx_hash) ----
USED_TX: set[str] = set()
# ---- Stripe 客户映射 + Webhook 幂等(TODO: Postgres) ----
STRIPE_CUST: dict[str, str] = {}        # stripe_customer_id -> user_id
PROCESSED_EVENTS: set[str] = set()      # stripe event.id 去重(幂等)


def set_stripe_customer(user_id: str, customer_id: str):
    STRIPE_CUST[customer_id] = user_id
    u = USERS.get(user_id)
    if u:
        u["stripe_customer_id"] = customer_id


def user_by_customer(customer_id: str) -> str | None:
    return STRIPE_CUST.get(customer_id)


def revoke_entitlement(user_id: str):
    ENTITLEMENTS.pop(user_id, None)
    u = USERS.get(user_id)
    if u:
        u["plan"] = "free"


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def quota_key(user_id: str) -> str:
    return f"{user_id}:{date.today().isoformat()}"


def quota_used(user_id: str) -> int:
    return len(_QUOTA.get(quota_key(user_id), set()))


def user_limit(user_id: str) -> int:
    """每日额度 = 有效权益的 daily_limit,过期/无则回落免费。"""
    from .config import settings
    ent = ENTITLEMENTS.get(user_id)
    if ent and ent["valid_until"] > time.time():
        return ent["daily_limit"]
    return settings.TIERS["free"]


def quota_consume(user_id: str, symbol: str) -> bool:
    """返回 True 表示可继续(已存在=不重复计费;或成功新计一次)。"""
    used = _QUOTA.setdefault(quota_key(user_id), set())
    if symbol in used:
        return True
    if len(used) >= user_limit(user_id):
        return False
    used.add(symbol)
    return True


def grant_entitlement(user_id: str, tier: str, source: str, days: int | None = None,
                      until: float | None = None) -> dict:
    """三种支付方式成功后都调用它 —— 权限只认这里,不认渠道。
    Stripe 订阅传 until=current_period_end(随续费 Webhook 滚动);一次性购买传 days。"""
    from .config import settings
    if until is None:
        if days is None:
            days = settings.TIER_VALID_DAYS.get(tier, 30)
        until = time.time() + days * 86400
    ent = {
        "tier": tier,
        "daily_limit": settings.TIERS.get(tier, 5),
        "valid_until": until,
        "source": source,
    }
    ENTITLEMENTS[user_id] = ent
    u = USERS.get(user_id)
    if u:
        u["plan"] = tier
    log_event("upgrade_success", user_id=user_id, tier=tier, source=source)
    return ent


# ---- 兑换码 ----
def gen_codes(tier: str, count: int, valid_days: int) -> list[str]:
    out = []
    for _ in range(count):
        code = "KZ-" + secrets.token_hex(5).upper()
        REDEMPTION[code] = {"tier": tier, "valid_days": valid_days, "used": False, "used_by": None}
        out.append(code)
    return out


def redeem_code(user_id: str, code: str) -> dict:
    rec = REDEMPTION.get(code.strip().upper())
    if not rec or rec["used"]:
        raise ValueError("invalid or used code")
    rec["used"] = True
    rec["used_by"] = user_id
    return grant_entitlement(user_id, rec["tier"], "xianyu", rec["valid_days"])


def log_event(ev: str, **props):
    EVENTS.append({"ts": int(datetime.now(timezone.utc).timestamp() * 1000), "ev": ev, **props})


# ---- 标的字典(TODO: 由数据商目录同步) ----
SYMBOLS: list[dict] = [
    {"ticker": "BTC", "name": "Bitcoin", "exchange": "Crypto", "market": "crypto"},
    {"ticker": "ETH", "name": "Ethereum", "exchange": "Crypto", "market": "crypto"},
    {"ticker": "SOL", "name": "Solana", "exchange": "Crypto", "market": "crypto"},
    {"ticker": "LINK", "name": "Chainlink", "exchange": "Crypto", "market": "crypto"},
    {"ticker": "AAPL", "name": "Apple", "exchange": "NASDAQ", "market": "stock"},
    {"ticker": "NVDA", "name": "NVIDIA", "exchange": "NASDAQ", "market": "stock"},
    {"ticker": "PLTR", "name": "Palantir", "exchange": "NYSE", "market": "stock"},
    {"ticker": "TSM", "name": "TSMC", "exchange": "NYSE", "market": "stock"},
    {"ticker": "GLD", "name": "Gold", "exchange": "NYSE", "market": "commodity"},
    {"ticker": "USO", "name": "Oil", "exchange": "NYSE", "market": "commodity"},
    {"ticker": "SLV", "name": "Silver", "exchange": "NYSE", "market": "commodity"},
]


def search_symbols(q: str, limit: int = 8) -> list[dict]:
    ql = q.lower().strip()
    if not ql:
        return []
    hits = [s for s in SYMBOLS if ql == s["ticker"].lower()]
    hits += [s for s in SYMBOLS if ql in s["ticker"].lower() or ql in s["name"].lower() and s not in hits]
    seen, out = set(), []
    for s in hits:
        if s["ticker"] not in seen:
            seen.add(s["ticker"]); out.append(s)
    return out[:limit]


def resolve_symbol(q: str) -> dict:
    """存在性校验 + 消歧。TODO: 命中字典即确认;否则向数据商做轻量 meta 探测。"""
    hits = search_symbols(q, 5)
    exact = [h for h in hits if h["ticker"].lower() == q.lower().strip()]
    if exact:
        return {"exists": True, "canonical": exact[0], "ambiguous": []}
    if len(hits) == 1:
        return {"exists": True, "canonical": hits[0], "ambiguous": []}
    if hits:
        return {"exists": True, "canonical": None, "ambiguous": hits}
    return {"exists": False, "canonical": None, "ambiguous": []}
