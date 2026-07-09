from fastapi import APIRouter, Depends, HTTPException, status
from ..config import settings
from ..schemas import AnalysisOut
from .. import store, deps, data

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.get("/{symbol}", response_model=AnalysisOut)
def get_analysis(symbol: str, user: dict = Depends(deps.get_current_user)):
    """核心接口。

    - FREE_MODE(默认):全站免费——不计额度、不设付费墙、全字段下发。
    - 收费模式(FREE_MODE=0):双闸 = 每日额度(超额 402)+ 内容分层(免费裁剪锁定字段)。
    """
    sym = symbol.upper()
    if not data.get_symbol(sym):
        # TODO: 冷门标的 -> 存在性校验通过后按需 fetch + engine.analyze(),此处占位
        raise HTTPException(status.HTTP_404_NOT_FOUND, "symbol not available yet")

    if settings.FREE_MODE:
        store.log_event("open_symbol", user_id=user["id"], symbol=sym, plan="free_mode")
        return data.build_analysis(sym, "pro")   # 全站免费:等同 Pro,全字段下发

    if not store.quota_consume(user["id"], sym):
        store.log_event("quota_hit", user_id=user["id"], symbol=sym)
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "daily quota reached — upgrade to Pro")

    store.log_event("open_symbol", user_id=user["id"], symbol=sym, plan=user["plan"])
    resp = data.build_analysis(sym, user["plan"])
    if user["plan"] == "free":
        store.log_event("paywall_view", user_id=user["id"], symbol=sym)
    return resp
