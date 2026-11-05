"""Bounded, source-faithful candle snapshots for the selected historical matches."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from build import CFG


def candle_valid(row):
    _, op, hi, lo, close, _ = row
    return (all(isinstance(v, (int, float)) and math.isfinite(v) and v > 0
                for v in (op, hi, lo, close))
            and lo <= min(op, close) <= max(op, close) <= hi)


def build_replay(symbol, group, prim, ts, close, history, source, ticker, config=None,
                 interval=None, annual_year_basis="window"):
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
    cfg = config or CFG[group]
    window, horizon = cfg["window"], max(cfg["H"])
    n = len(rows)

    def segment(end, key, score=None):
        start = end - window + 1
        left = max(0, start - cfg.get("contextBefore", 2) * window)
        right = min(n, end + cfg.get("contextAfter", 2) * horizon + 1)
        bars = rows[left:right]
        return {
            "id": key, "score": score, "start": start - left, "end": end - left,
            "startTime": rows[start][0], "endTime": rows[end][0],
            "endDate": (history["sessionEnds"][end] if history.get("sessionEnds") else
                        datetime.fromtimestamp(rows[end][0], ZoneInfo(history["timeZone"])).date().isoformat()),
            "bars": bars, "invalidCandles": sum(not candle_valid(row) for row in bars),
        }

    cases = {}
    def historical(end, key, score):
        if end < window - 1 or end >= n - window or end + horizon >= n:
            raise ValueError("Historical match crosses current window or lacks forward history")
        return segment(end, key, float(score))

    for method in prim["matchEnds"]:
        cases[method] = []
        for end, score in prim["matchEnds"][method]:
            cases[method].append(historical(end, f"{method}-{ts[end]}", score))
    annual_cases = {}
    for year, matches in prim.get("annualMatchEnds", {}).items():
        if not 1 <= len(matches) <= 3:
            raise ValueError("Invalid annual case count")
        annual_cases[year] = []
        for end, score in matches:
            case = historical(end, f"year-{year}-{ts[end]}", score)
            years = ([case["endDate"][:4]] if annual_year_basis == "end" else
                     [str(datetime.fromtimestamp(case[key], timezone.utc).year) for key in ("startTime", "endTime")])
            if any(value != year for value in years):
                raise ValueError("Annual case crosses the selected year")
            annual_cases[year].append(case)
    return {
        "version": 1, "symbol": symbol, "interval": interval or ("4h" if group == "crypto" else "1d"),
        "timeZone": history["timeZone"], "priceBasis": history["priceBasis"],
        "source": source, "ticker": ticker, "asof": ts[-1], "window": window,
        "horizons": cfg["H"], "current": segment(n - 1, "current"), "cases": cases,
        "annualCases": annual_cases,
        "methods": list(cases), "annualYearBasis": annual_year_basis,
    }
