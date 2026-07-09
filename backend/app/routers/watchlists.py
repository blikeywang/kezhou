from fastapi import APIRouter, Depends, HTTPException, status
from ..schemas import Watchlist, WatchlistIn, WatchlistItemIn
from .. import store, deps

router = APIRouter(prefix="/watchlists", tags=["watchlists"])


def _lists(uid: str) -> dict:
    return store.WATCHLISTS.setdefault(uid, {})


@router.get("", response_model=list[Watchlist])
def list_all(user: dict = Depends(deps.get_current_user)):
    return [Watchlist(id=i, name=v["name"], items=v["items"]) for i, v in _lists(user["id"]).items()]


@router.post("", response_model=Watchlist)
def create(body: WatchlistIn, user: dict = Depends(deps.get_current_user)):
    lid = store.new_id()
    _lists(user["id"])[lid] = {"name": body.name or "My list", "items": []}
    return Watchlist(id=lid, name=body.name, items=[])


@router.patch("/{lid}", response_model=Watchlist)
def rename(lid: str, body: WatchlistIn, user: dict = Depends(deps.get_current_user)):
    lists = _lists(user["id"])
    if lid not in lists:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "list not found")
    lists[lid]["name"] = body.name
    return Watchlist(id=lid, name=body.name, items=lists[lid]["items"])


@router.post("/{lid}/items", response_model=Watchlist)
def add_item(lid: str, item: WatchlistItemIn, user: dict = Depends(deps.get_current_user)):
    lists = _lists(user["id"])
    if lid not in lists:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "list not found")
    items = lists[lid]["items"]
    if not any(i.symbol == item.symbol for i in items):
        items.append(item)
        store.log_event("favorite_add", user_id=user["id"], symbol=item.symbol)
    return Watchlist(id=lid, name=lists[lid]["name"], items=items)


@router.delete("/{lid}/items/{symbol}", response_model=Watchlist)
def remove_item(lid: str, symbol: str, user: dict = Depends(deps.get_current_user)):
    lists = _lists(user["id"])
    if lid not in lists:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "list not found")
    lists[lid]["items"] = [i for i in lists[lid]["items"] if i.symbol != symbol]
    return Watchlist(id=lid, name=lists[lid]["name"], items=lists[lid]["items"])
