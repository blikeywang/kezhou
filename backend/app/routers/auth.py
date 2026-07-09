from fastapi import APIRouter, Depends, HTTPException, status
from ..schemas import SignupIn, TokenOut, UserOut
from ..config import settings
from .. import store, deps

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=TokenOut)
def signup(body: SignupIn):
    if body.email in store.EMAIL_INDEX:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    uid = store.new_id()
    store.USERS[uid] = {"id": uid, "email": body.email, "pw_hash": deps.hash_pw(body.password), "plan": "free"}
    store.EMAIL_INDEX[body.email] = uid
    store.log_event("signup", user_id=uid)
    return TokenOut(access_token=deps.make_token(uid), plan="free")


@router.post("/login", response_model=TokenOut)
def login(body: SignupIn):
    uid = store.EMAIL_INDEX.get(body.email)
    user = store.USERS.get(uid) if uid else None
    if not user or not deps.verify_pw(body.password, user["pw_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad credentials")
    store.log_event("login", user_id=uid)
    return TokenOut(access_token=deps.make_token(uid), plan=user["plan"])


@router.get("/me", response_model=UserOut)
def me(user: dict = Depends(deps.get_current_user)):
    return UserOut(id=user["id"], email=user["email"], plan=user["plan"],
                   quota_used=store.quota_used(user["id"]),
                   quota_limit=store.user_limit(user["id"]))
