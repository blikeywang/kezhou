from __future__ import annotations

import asyncio
import base64
import json
import os
import platform
import re
import secrets
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

try:
    from longbridge.openapi import (
        AdjustType,
        AsyncQuoteContext,
        AsyncTradeContext,
        Config,
        OAuthBuilder,
        OrderSide,
        Period,
        TradeSessions,
    )
except ImportError:  # pragma: no cover - the CLI fallback remains available
    AdjustType = AsyncQuoteContext = AsyncTradeContext = Config = None
    OAuthBuilder = OrderSide = Period = TradeSessions = None


MAGIC = b"LB\x01"
HKDF_INFO = b"longbridge-token-v1"
CLIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,200}$")


class LongbridgeSdkError(RuntimeError):
    pass


def _machine_id() -> str:
    if platform.system() == "Darwin":
        output = subprocess.run(
            ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout
        match = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', output)
        if match:
            return match.group(1)
    for candidate in (Path("/var/lib/dbus/machine-id"), Path("/etc/machine-id")):
        if candidate.exists():
            value = candidate.read_text(encoding="utf-8").strip()
            if value:
                return value
    raise LongbridgeSdkError("could not obtain this machine's stable identifier")


def decrypt_cli_token(path: Path, machine_id: str | None = None) -> dict[str, Any]:
    try:
        data = path.read_bytes()
    except OSError as error:
        raise LongbridgeSdkError("Longbridge CLI login was not found") from error
    try:
        if data.startswith(MAGIC):
            if len(data) <= len(MAGIC) + 12:
                raise LongbridgeSdkError("Longbridge CLI token is truncated")
            key = HKDF(
                algorithm=hashes.SHA256(),
                length=32,
                salt=None,
                info=HKDF_INFO,
            ).derive((machine_id if machine_id is not None else _machine_id()).encode("utf-8"))
            nonce = data[len(MAGIC):len(MAGIC) + 12]
            payload = AESGCM(key).decrypt(nonce, data[len(MAGIC) + 12:], None)
            value = json.loads(payload.decode("utf-8"))
        else:
            value = json.loads(data.decode("utf-8"))
    except LongbridgeSdkError:
        raise
    except Exception as error:
        raise LongbridgeSdkError("Longbridge CLI token could not be decrypted") from error
    if not isinstance(value, dict) or not value.get("access_token"):
        raise LongbridgeSdkError("Longbridge CLI token is invalid")
    return value


def encrypt_cli_token(value: dict[str, Any], path: Path, machine_id: str | None = None) -> None:
    key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=HKDF_INFO,
    ).derive((machine_id if machine_id is not None else _machine_id()).encode("utf-8"))
    nonce = os.urandom(12)
    payload = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    encrypted = MAGIC + nonce + AESGCM(key).encrypt(nonce, payload, None)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encrypted)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _write_private_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=True, separators=(",", ":"))
            stream.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _jwt_account_channel(access_token: str) -> str:
    try:
        encoded = access_token.split(".")[1]
        encoded += "=" * (-len(encoded) % 4)
        claims = json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
        subject = claims.get("sub")
        subject = json.loads(subject) if isinstance(subject, str) else subject
        return str(subject.get("account_channel") or "") if isinstance(subject, dict) else ""
    except Exception:
        return ""


@dataclass(frozen=True)
class SyncedOAuthToken:
    client_id: str
    path: Path
    account_channel: str


def sync_cli_token_to_sdk(home: Path | None = None) -> SyncedOAuthToken:
    home = home or Path.home()
    openapi_dir = home / ".longbridge" / "openapi"
    registration = _read_json(openapi_dir / "cli-registration") or {}
    client_id = str(registration.get("client_id") or "")
    if not CLIENT_ID_PATTERN.fullmatch(client_id):
        raise LongbridgeSdkError("Longbridge OAuth client registration was not found")

    cli_token = decrypt_cli_token(openapi_dir / "cli-auth")
    sdk_path = openapi_dir / "tokens" / client_id
    sdk_token = _read_json(sdk_path)
    candidates = [
        value for value in (cli_token, sdk_token)
        if value and str(value.get("client_id") or client_id) == client_id and value.get("access_token")
    ]
    if not candidates:
        raise LongbridgeSdkError("Longbridge OAuth token was not found")
    selected = max(candidates, key=lambda value: int(value.get("expires_at") or 0))
    normalized = {
        "client_id": client_id,
        "access_token": str(selected["access_token"]),
        "refresh_token": selected.get("refresh_token"),
        "expires_at": int(selected.get("expires_at") or 0),
    }
    if normalized["expires_at"] <= int(time.time()) + 300:
        raise LongbridgeSdkError("Longbridge OAuth token needs renewal; run longbridge auth login")
    if sdk_token != normalized:
        _write_private_json(sdk_path, normalized)
    elif sdk_path.exists():
        sdk_path.chmod(0o600)
    return SyncedOAuthToken(
        client_id=client_id,
        path=sdk_path,
        account_channel=_jwt_account_channel(normalized["access_token"]),
    )


def sync_sdk_token_to_cli(home: Path | None = None) -> bool:
    home = home or Path.home()
    openapi_dir = home / ".longbridge" / "openapi"
    registration = _read_json(openapi_dir / "cli-registration") or {}
    client_id = str(registration.get("client_id") or "")
    if not CLIENT_ID_PATTERN.fullmatch(client_id):
        return False
    sdk_token = _read_json(openapi_dir / "tokens" / client_id)
    if not sdk_token or str(sdk_token.get("client_id") or "") != client_id:
        return False
    cli_path = openapi_dir / "cli-auth"
    cli_token = decrypt_cli_token(cli_path)
    if int(sdk_token.get("expires_at") or 0) <= int(cli_token.get("expires_at") or 0):
        return False
    mirrored = {
        "client_id": client_id,
        "access_token": str(sdk_token["access_token"]),
        "refresh_token": sdk_token.get("refresh_token"),
        "expires_at": int(sdk_token.get("expires_at") or 0),
        "logged_in_at": cli_token.get("logged_in_at"),
    }
    encrypt_cli_token(mirrored, cli_path)
    return True


class LongbridgeSdkSession:
    periods = {
        "1m": "Min_1",
        "5m": "Min_5",
        "15m": "Min_15",
        "1h": "Min_60",
        "1d": "Day",
    }

    def __init__(self, home: Path | None = None, cli_bin: str = "/opt/homebrew/bin/longbridge"):
        self.home = home
        self.cli_bin = cli_bin
        self.quote_context: Any = None
        self.trade_context: Any = None
        self._lock = asyncio.Lock()
        self._token_lock = asyncio.Lock()
        self.last_error = "not connected"
        self.connected_at: datetime | None = None

    @property
    def installed(self) -> bool:
        return AsyncQuoteContext is not None

    @property
    def connected(self) -> bool:
        return self.quote_context is not None and self.trade_context is not None

    async def ensure(self) -> None:
        if self.connected:
            return
        if not self.installed:
            raise LongbridgeSdkError("Longbridge Python SDK is not installed")
        async with self._lock:
            if self.connected:
                return
            try:
                try:
                    synced = await asyncio.to_thread(sync_cli_token_to_sdk, self.home)
                except LongbridgeSdkError as error:
                    if "needs renewal" not in str(error) or not Path(self.cli_bin).exists():
                        raise
                    await asyncio.to_thread(
                        subprocess.run,
                        [self.cli_bin, "auth", "status", "--format", "json"],
                        check=True,
                        capture_output=True,
                        timeout=18,
                        cwd="/tmp",
                    )
                    synced = await asyncio.to_thread(sync_cli_token_to_sdk, self.home)
                oauth = await OAuthBuilder(synced.client_id).build_async(
                    lambda _url: (_ for _ in ()).throw(
                        LongbridgeSdkError("Longbridge OAuth requires a fresh login")
                    )
                )
                config = Config.from_oauth(
                    oauth,
                    enable_overnight=True,
                    enable_print_quote_packages=False,
                    enable_papertrading=synced.account_channel == "lb_papertrading",
                )
                loop = asyncio.get_running_loop()
                self.quote_context = AsyncQuoteContext.create(config, loop)
                self.trade_context = AsyncTradeContext.create(config, loop)
                self.connected_at = datetime.now(timezone.utc)
                self.last_error = "connected"
            except Exception as error:
                self.quote_context = None
                self.trade_context = None
                self.last_error = str(error)
                raise LongbridgeSdkError(str(error)) from error

    async def _mirror_token(self) -> None:
        async with self._token_lock:
            try:
                await asyncio.to_thread(sync_sdk_token_to_cli, self.home)
            except Exception:
                pass

    async def candlesticks(self, symbol: str, timeframe: str, count: int = 500) -> list[Any]:
        await self.ensure()
        period_name = self.periods.get(timeframe)
        if not period_name:
            raise LongbridgeSdkError(f"unsupported Longbridge timeframe {timeframe}")
        rows = await self.quote_context.candlesticks(
            symbol,
            getattr(Period, period_name),
            count,
            AdjustType.NoAdjust,
            TradeSessions.Intraday,
        )
        await self._mirror_token()
        return rows

    async def quote(self, symbol: str) -> Any:
        await self.ensure()
        rows = await self.quote_context.quote([symbol])
        await self._mirror_token()
        if not rows:
            raise LongbridgeSdkError("Longbridge quote is empty")
        return rows[0]

    async def account_balances(self) -> list[Any]:
        await self.ensure()
        rows = await self.trade_context.account_balance()
        await self._mirror_token()
        return rows

    async def stock_positions(self) -> Any:
        await self.ensure()
        rows = await self.trade_context.stock_positions()
        await self._mirror_token()
        return rows

    async def executions(self, days: int) -> tuple[list[Any], dict[str, Any]]:
        await self.ensure()
        end_at = datetime.now(timezone.utc)
        start_at = end_at - timedelta(days=days)
        executions, orders = await asyncio.gather(
            self.trade_context.history_executions(start_at=start_at, end_at=end_at),
            self.trade_context.history_orders(start_at=start_at, end_at=end_at),
        )
        await self._mirror_token()
        return executions, {str(order.order_id): order for order in orders}
