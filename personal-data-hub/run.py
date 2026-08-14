#!/usr/bin/env python3
from __future__ import annotations

import uvicorn

from traderhome_hub.config import Settings


if __name__ == "__main__":
    settings = Settings.from_env()
    uvicorn.run(
        "traderhome_hub.service:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
        access_log=False,
    )
