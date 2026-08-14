from __future__ import annotations

import os
import secrets
import subprocess
from dataclasses import dataclass
from pathlib import Path


DEFAULT_ORIGINS = (
    "https://traderhome-histroy.xyz",
    "https://www.traderhome-histroy.xyz",
)


def _keychain_secret(service: str) -> str:
    if not Path("/usr/bin/security").exists():
        return ""
    try:
        result = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-a", os.getenv("USER", ""), "-s", service, "-w"],
            check=True,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip()


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    data_dir: Path = Path.home() / ".traderhome"
    longbridge_bin: str = "/opt/homebrew/bin/longbridge"
    ibkr_host: str = "127.0.0.1"
    ibkr_ports: tuple[int, ...] = (4001, 4002, 7497, 7496)
    ibkr_client_id: int = 73
    ibkr_web_port: int = 5001
    ibkr_socket_fallback: bool = False
    cache_seconds: int = 12
    binance_api_key: str = ""
    binance_api_secret: str = ""
    allowed_origins: tuple[str, ...] = DEFAULT_ORIGINS

    @classmethod
    def from_env(cls) -> "Settings":
        port_text = os.getenv("TRADERHOME_IBKR_PORT", "").strip()
        ports = tuple(
            dict.fromkeys(
                [int(port_text)] if port_text else [4001, 4002, 7497, 7496]
            )
        )
        origins = tuple(
            item.strip().rstrip("/")
            for item in os.getenv(
                "TRADERHOME_ALLOWED_ORIGINS", ",".join(DEFAULT_ORIGINS)
            ).split(",")
            if item.strip()
        )
        return cls(
            host=os.getenv("TRADERHOME_HUB_HOST", "127.0.0.1"),
            port=int(os.getenv("TRADERHOME_HUB_PORT", "8765")),
            data_dir=Path(
                os.getenv("TRADERHOME_HUB_DATA_DIR", str(Path.home() / ".traderhome"))
            ).expanduser(),
            longbridge_bin=os.getenv(
                "TRADERHOME_LONGBRIDGE_BIN", "/opt/homebrew/bin/longbridge"
            ),
            ibkr_host=os.getenv("TRADERHOME_IBKR_HOST", "127.0.0.1"),
            ibkr_ports=ports,
            ibkr_client_id=int(os.getenv("TRADERHOME_IBKR_CLIENT_ID", "73")),
            ibkr_web_port=int(os.getenv("TRADERHOME_IBKR_WEB_PORT", "5001")),
            ibkr_socket_fallback=os.getenv("TRADERHOME_IBKR_SOCKET_FALLBACK", "0").strip().lower() in {"1", "true", "yes"},
            cache_seconds=int(os.getenv("TRADERHOME_CACHE_SECONDS", "12")),
            binance_api_key=(os.getenv("TRADERHOME_BINANCE_API_KEY", "").strip() or _keychain_secret("com.traderhome.binance-api-key")),
            binance_api_secret=(os.getenv("TRADERHOME_BINANCE_API_SECRET", "").strip() or _keychain_secret("com.traderhome.binance-api-secret")),
            allowed_origins=origins or DEFAULT_ORIGINS,
        )

    @property
    def token_path(self) -> Path:
        return self.data_dir / "data-hub-token"

    @property
    def ibkr_web_api_url(self) -> str:
        return f"http://127.0.0.1:{self.ibkr_web_port}/v1/api"

    @property
    def ibkr_web_login_url(self) -> str:
        return f"http://127.0.0.1:{self.ibkr_web_port}"

    def account_token(self) -> str:
        self.data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.data_dir.chmod(0o700)
        if self.token_path.exists():
            token = self.token_path.read_text(encoding="utf-8").strip()
            if len(token) >= 32:
                return token
        token = secrets.token_urlsafe(36)
        self.token_path.write_text(token + "\n", encoding="utf-8")
        self.token_path.chmod(0o600)
        return token
