"""Bounded, source-faithful candle snapshots for the selected historical matches."""
from __future__ import annotations

import math
from build import CFG


def candle_valid(row):
    _, op, hi, lo, close, _ = row
    return (all(isinstance(v, (int, float)) and math.isfinite(v) and v > 0
                for v in (op, hi, lo, close))
            and lo <= min(op, close) <= max(op, close) <= hi)


def build_replay(symbol, group, prim, ts, close, history, source, ticker):
    if not history:
        return None
    rows = history["bars"]
    if len(rows) != len(ts):
        raise ValueError("Replay and matching history lengths differ")
    for i, row in enumerate(rows):
        if len(row) != 6 or row[0] != ts[i] or row[4] != close[i]:
            raise ValueError(f"Replay and matching history differ at bar {i}")
        if not all(v is None or isinstance(v, (int, float)) and math.isfinite(v) for v in row):
            raise ValueError("Non-finite replay value")
    cfg = CFG[group]
    window, horizon = cfg["window"], max(cfg["H"])
    n = len(rows)

    def segment(end, key, score=None):
        start = end - window + 1
        left = max(0, start - 2 * window)
        right = min(n, end + 2 * horizon + 1)
        bars = rows[left:right]
        return {
            "id": key, "score": score, "start": start - left, "end": end - left,
            "startTime": rows[start][0], "endTime": rows[end][0],
            "bars": bars, "invalidCandles": sum(not candle_valid(row) for row in bars),
        }

    cases = {}
    for method in ("corr", "dtw"):
        cases[method] = []
        for end, score in prim["matchEnds"][method]:
            if end >= n - window or end + horizon >= n:
                raise ValueError("Historical match crosses current window or lacks forward history")
            cases[method].append(segment(end, f"{method}-{ts[end]}", float(score)))
    return {
        "version": 1, "symbol": symbol, "interval": "4h" if group == "crypto" else "1d",
        "timeZone": history["timeZone"], "priceBasis": history["priceBasis"],
        "source": source, "ticker": ticker, "asof": ts[-1], "window": window,
        "horizons": cfg["H"], "current": segment(n - 1, "current"), "cases": cases,
    }
