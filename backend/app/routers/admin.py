from collections import Counter
from fastapi import APIRouter, Depends, HTTPException, status
from ..schemas import CodeGenIn
from .. import store, deps

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(user: dict = Depends(deps.get_current_user)) -> dict:
    # TODO: 真实基于角色/组织判定;骨架用 plan==team 代替
    if user.get("plan") != "team":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin only")
    return user


@router.get("/stats")
def stats(_: dict = Depends(_require_admin)):
    """后台统计:漏斗、转化、付费触发归因、热门标的。生产从数仓查询。"""
    ev = store.EVENTS
    by_ev = Counter(e["ev"] for e in ev)
    top_symbols = Counter(e.get("symbol") for e in ev if e["ev"] == "open_symbol" and e.get("symbol"))
    triggers = Counter(e.get("context") for e in ev if e["ev"] == "upgrade_success")
    funnel = {
        "visitors": by_ev.get("page_view", 0),
        "signups": by_ev.get("signup", 0),
        "activated": len({e.get("user_id") for e in ev if e["ev"] == "open_symbol"}),
        "paywall": by_ev.get("paywall_view", 0),
        "quota_hit": by_ev.get("quota_hit", 0),
        "upgrades": by_ev.get("upgrade_success", 0),
    }
    return {
        "funnel": funnel,
        "conversion_by_trigger": dict(triggers),
        "top_symbols": top_symbols.most_common(10),
        "event_counts": dict(by_ev),
        "total_events": len(ev),
    }


@router.post("/codes")
def generate_codes(body: CodeGenIn, _: dict = Depends(_require_admin)):
    """批量生成闲鱼兑换码(卡密)。用于闲鱼自动发货/人工发码。"""
    codes = store.gen_codes(body.tier, body.count, body.valid_days)
    return {"tier": body.tier, "valid_days": body.valid_days, "count": len(codes), "codes": codes}
