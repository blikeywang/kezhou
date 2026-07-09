from fastapi import APIRouter
from ..schemas import ResolveIn, ResolveOut, SymbolHit
from .. import store

router = APIRouter(prefix="/symbols", tags=["symbols"])


@router.get("/search", response_model=list[SymbolHit])
def search(q: str, market: str | None = None):
    hits = store.search_symbols(q)
    if market:
        hits = [h for h in hits if h["market"] == market]
    return hits


@router.post("/resolve", response_model=ResolveOut)
def resolve(body: ResolveIn):
    """存在性校验 + 消歧,供前端"确认这个标的是不是…"用。"""
    r = store.resolve_symbol(body.query)
    store.log_event("resolve", query=body.query, found=r["exists"])
    return r
