"""订阅与支付:闲鱼(卡密)/ Stripe / 加密(tx-hash 核验)。

三渠道统一收敛到 store.grant_entitlement —— **权限只认权益,不认渠道**。
真实实现见 docs/PAYMENTS.md 与 docs/BUILD_SPEC.md §5。
"""
import time
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from ..config import settings
from ..schemas import (EntitlementOut, XianyuSku, RedeemIn, CryptoQuoteIn,
                       CryptoQuoteOut, CryptoSubmitIn, CryptoSubmitOut, CryptoNetworkOut)
from .. import store, deps
from ..crypto_verify import verify_payment, PendingVerification

router = APIRouter(prefix="/billing", tags=["billing"])
_QUOTES: dict[str, dict] = {}  # order_id -> {tier, amount, expires} (TODO: 入库)


def _ensure_paid_enabled():
    """全站免费期:所有"付费开通"入口一律待上线(返回 503)。
    加密钱包仍开放,但只作打赏(见 /billing/tip/wallets),不绑权益。"""
    if settings.FREE_MODE:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "付费待上线(当前全站免费)")


# ============ 0. 打赏(全站免费期;不绑权益、不做核验) ============
@router.get("/tip/wallets", response_model=list[CryptoNetworkOut])
def tip_wallets():
    """自愿打赏用的收款钱包(USDC)。纯捐赠:不解锁任何功能、不返回权益。"""
    return [{"key": k, "label": v["label"], "family": v["family"], "address": v["address"]}
            for k, v in settings.CRYPTO_NETWORKS.items()]


@router.get("/subscription", response_model=EntitlementOut)
def subscription(user: dict = Depends(deps.get_current_user)):
    ent = store.ENTITLEMENTS.get(user["id"])
    if ent and ent["valid_until"] > time.time():
        return EntitlementOut(**ent)
    return EntitlementOut(tier="free", daily_limit=settings.TIERS["free"])


# ============ 1. 闲鱼:卡密兑换 ============
@router.get("/xianyu/skus", response_model=list[XianyuSku])
def xianyu_skus():
    return settings.XIANYU_SKUS


@router.post("/redeem", response_model=EntitlementOut)
def redeem(body: RedeemIn, user: dict = Depends(deps.get_current_user)):
    """闲鱼付款后凭卡密激活。卡密一次性、绑定档位与有效期。"""
    _ensure_paid_enabled()
    try:
        ent = store.redeem_code(user["id"], body.code)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return EntitlementOut(**ent)


# ============ 2. Stripe(Billing 订阅,Checkout 托管跳转) ============
def _stripe():
    """惰性加载 stripe SDK(未安装/未配置时其余骨架仍可运行)。密钥只从环境读。"""
    if not settings.STRIPE_ENABLED:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Stripe 即将支持(尚未开放)")
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Stripe 未配置(设置 STRIPE_SECRET_KEY / STRIPE_PRICE_PRO / STRIPE_WEBHOOK_SECRET)")
    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY
    stripe.api_version = settings.STRIPE_API_VERSION
    return stripe


def _ensure_customer(stripe, user: dict) -> str:
    cid = user.get("stripe_customer_id")
    if cid:
        return cid
    cust = stripe.Customer.create(email=user["email"], metadata={"user_id": user["id"]})
    store.set_stripe_customer(user["id"], cust.id)
    return cust.id


@router.post("/stripe/checkout")
def stripe_checkout(user: dict = Depends(deps.get_current_user)):
    """建订阅 Checkout Session,返回托管收银页 URL(前端跳转)。"""
    stripe = _stripe()
    cid = _ensure_customer(stripe, user)
    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=cid,
        line_items=[{"price": settings.STRIPE_PRICE_PRO, "quantity": 1}],
        client_reference_id=user["id"],
        allow_promotion_codes=True,
        success_url=f"{settings.PUBLIC_DOMAIN}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{settings.PUBLIC_DOMAIN}/billing/cancel",
    )
    return {"url": session.url}


@router.post("/stripe/portal")
def stripe_portal(user: dict = Depends(deps.get_current_user)):
    """Customer Portal:用户自助改套餐/取消/更新卡。"""
    stripe = _stripe()
    cid = user.get("stripe_customer_id")
    if not cid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no stripe customer for this user")
    session = stripe.billing_portal.Session.create(
        customer=cid, return_url=f"{settings.PUBLIC_DOMAIN}/account")
    return {"url": session.url}


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """**以 Webhook 为准**同步订阅状态。验签 + 幂等(按 event.id 去重)。"""
    stripe = _stripe()
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid signature")
    if event["id"] in store.PROCESSED_EVENTS:
        return {"received": True, "duplicate": True}
    store.PROCESSED_EVENTS.add(event["id"])
    _handle_stripe_event(stripe, event)
    return {"received": True}


def _sync_subscription(sub) -> None:
    uid = store.user_by_customer(sub.get("customer"))
    if not uid:
        return
    st = sub.get("status")
    if st in ("active", "trialing"):
        cpe = sub.get("current_period_end")
        store.grant_entitlement(uid, "pro50", "stripe", until=float(cpe) if cpe else None)
    elif st in ("canceled", "unpaid", "incomplete_expired"):
        store.revoke_entitlement(uid)
    # past_due: 保留宽限期,交由重试/催缴流程处理


def _handle_stripe_event(stripe, event) -> None:
    typ = event["type"]
    obj = event["data"]["object"]
    if typ in ("customer.subscription.created", "customer.subscription.updated"):
        _sync_subscription(obj)
    elif typ == "customer.subscription.deleted":
        uid = store.user_by_customer(obj.get("customer"))
        if uid:
            store.revoke_entitlement(uid)
    elif typ == "invoice.paid":
        sub_id = obj.get("subscription")
        if sub_id:
            _sync_subscription(stripe.Subscription.retrieve(sub_id))
    elif typ == "invoice.payment_failed":
        pass  # 进入 past_due:通知用户更新卡(邮件/站内),保留宽限


# ============ 3. 加密:多链 USDC + tx-hash 链上核验 ============
@router.get("/crypto/networks", response_model=list[CryptoNetworkOut])
def crypto_networks():
    return [{"key": k, "label": v["label"], "family": v["family"], "address": v["address"]}
            for k, v in settings.CRYPTO_NETWORKS.items()]


@router.post("/crypto/quote", response_model=CryptoQuoteOut)
def crypto_quote(body: CryptoQuoteIn, user: dict = Depends(deps.get_current_user)):
    _ensure_paid_enabled()   # 全站免费期:加密仅打赏(/billing/tip/wallets),不走开通
    net = settings.CRYPTO_NETWORKS.get(body.network)
    price = settings.CRYPTO_PRICE_USDC.get(body.tier)
    if not net:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown network")
    if price is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown tier")
    order_id = store.new_id()
    amount = f"{price:.2f}"  # USDC 稳定币,应付=定价
    exp = time.time() + settings.CRYPTO_QUOTE_TTL_MIN * 60
    _QUOTES[order_id] = {"tier": body.tier, "network": body.network, "price": price,
                         "expires": exp, "user": user["id"]}
    return CryptoQuoteOut(order_id=order_id, tier=body.tier, network=body.network,
                          label=net["label"], address=net["address"], amount=amount, expires_at=exp)


@router.post("/crypto/submit", response_model=CryptoSubmitOut)
def crypto_submit(body: CryptoSubmitIn, user: dict = Depends(deps.get_current_user)):
    """提交 tx_hash → 链上核验。三态:
    - **confirmed**:核验通过,已开通权益;
    - **pending**:交易还没上链/确认数不够 —— 前端在 20 分钟窗口内每 ~15s 轮询本接口;
    - **failed**:确定失败(收款方不符 / 金额不足 / 交易失败)。
    订单(order_id)绑定用户 + 应付金额 + 过期(20 分钟)。tx_hash 去重防重放。"""
    _ensure_paid_enabled()   # 全站免费期:此路关闭(加密仅打赏)
    net = settings.CRYPTO_NETWORKS.get(body.network)
    price = settings.CRYPTO_PRICE_USDC.get(body.tier)
    if not net or price is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown network/tier")
    if body.tx_hash in store.USED_TX:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "tx already used")

    order = _QUOTES.get(body.order_id) if body.order_id else None
    if body.order_id and not order:
        raise HTTPException(status.HTTP_410_GONE, "quote expired or unknown — request a new quote")
    if order:
        if order["user"] != user["id"] or order["network"] != body.network:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "order mismatch")
        if order["expires"] < time.time():
            _QUOTES.pop(body.order_id, None)
            raise HTTPException(status.HTTP_410_GONE, "quote expired — request a new quote")
        price = order["price"]

    if settings.PAYMENTS_DEMO:
        if not body.tx_hash or len(body.tx_hash) < 10:
            return CryptoSubmitOut(status="failed", message="bad tx hash")
    else:
        try:
            verify_payment(net, body.tx_hash, price)   # 真实链上核验:收款地址/USDC/金额/确认数
        except PendingVerification as e:
            return CryptoSubmitOut(status="pending", message=str(e))   # 20 分钟内轮询
        except ValueError as e:
            return CryptoSubmitOut(status="failed", message=str(e))

    store.USED_TX.add(body.tx_hash)
    if body.order_id:
        _QUOTES.pop(body.order_id, None)
    ent = store.grant_entitlement(user["id"], body.tier, "crypto")
    return CryptoSubmitOut(status="confirmed", entitlement=EntitlementOut(**ent))


# 演示端点(仅联调):仅当 PAYMENTS_DEMO=1 且 ENV != prod 时可用;
# 生产环境(默认 PAYMENTS_DEMO=0)直接 404 —— 不依赖"记得删代码"。
@router.post("/_demo/upgrade", response_model=EntitlementOut)
def demo_upgrade(tier: str = "pro50", user: dict = Depends(deps.get_current_user)):
    if not settings.PAYMENTS_DEMO or settings.ENV == "prod":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    ent = store.grant_entitlement(user["id"], tier, "demo")
    return EntitlementOut(**ent)
