"""鉴权与依赖。骨架用 HMAC 签名令牌 + PBKDF2 口令哈希;
生产请换 argon2/bcrypt + 标准 JWT(python-jose)+ 刷新令牌。"""
from __future__ import annotations
import base64, hashlib, hmac, json, os, time
from fastapi import Depends, Header, HTTPException, status
from .config import settings
from . import store


def hash_pw(pw: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 100_000)
    return salt.hex() + ":" + dk.hex()


def verify_pw(pw: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split(":")
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt_hex), 100_000)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def make_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": int(time.time()) + settings.JWT_TTL_MIN * 60}
    body = _b64(json.dumps(payload).encode())
    sig = _b64(hmac.new(settings.JWT_SECRET.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def parse_token(token: str) -> dict:
    try:
        body, sig = token.split(".")
        expect = _b64(hmac.new(settings.JWT_SECRET.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expect):
            raise ValueError("bad sig")
        pad = "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(body + pad))
        if payload["exp"] < time.time():
            raise ValueError("expired")
        return payload
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    payload = parse_token(authorization.split(" ", 1)[1])
    user = store.USERS.get(payload["sub"])
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    return user


def optional_user(authorization: str | None = Header(default=None)) -> dict | None:
    if not authorization:
        return None
    try:
        return get_current_user(authorization)
    except HTTPException:
        return None
