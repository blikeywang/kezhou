from fastapi import APIRouter
from ..schemas import CollectIn
from .. import store

router = APIRouter(tags=["analytics"])


@router.post("/collect")
def collect(body: CollectIn):
    """埋点批量上报。前端用 sendBeacon 批量发送。
    TODO: 落 ClickHouse/BigQuery 或转发 PostHog;关键转化以支付 Webhook 二次确认。"""
    for e in body.events:
        store.log_event(e.ev, anon_id=body.anon_id, session_id=body.session_id, **e.props)
    return {"accepted": len(body.events)}
