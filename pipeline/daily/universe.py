"""Canonical research universe shared by ingestion and the published catalogue."""
from __future__ import annotations

import json
import re
from pathlib import Path

META = Path(__file__).with_name("meta.json")
GROUPS = ("crypto", "stock", "index", "futures", "commodity")


def load_names() -> dict:
    names = json.loads(META.read_text(encoding="utf-8"))["names"]
    for symbol, meta in names.items():
        if not re.fullmatch(r"[A-Z0-9]+", symbol):
            raise ValueError(f"Invalid public symbol: {symbol}")
        if meta["grp"] not in GROUPS or meta["provider"] not in {"binance", "yahoo"}:
            raise ValueError(f"Invalid source/group: {symbol}")
        for key in ("nz", "ne", "ticker", "kind"):
            if not meta.get(key):
                raise ValueError(f"Missing {key}: {symbol}")
        reference = meta.get("historyReference")
        if reference and (reference not in names or names[reference]["kind"] != "index"):
            raise ValueError(f"History reference must be a separate index: {symbol}")
    return names


def catalogue(names: dict) -> dict:
    cats = {group: [] for group in GROUPS}
    for symbol, meta in names.items():
        cats[meta["grp"]].append(dict(meta, k=symbol))
    return cats
