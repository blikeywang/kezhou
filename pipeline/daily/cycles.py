"""Completed daily/weekly analogues, with identical windows for year comparisons."""
from __future__ import annotations

import calendar
import json
from datetime import date as calendar_date, datetime, time as day_time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

from build import _zwin, _stats
from replay import build_replay

PROFILE_DIR = Path(__file__).resolve().parents[2] / "prototype" / "history-profiles"
TARGET_YEARS = (2018, 2023)


def configurations(group):
    crypto = group == "crypto"
    return {
        "1d-6m": {"interval": "1d", "months": 6, "window": 180 if crypto else 126,
                  "H": [30, 90, 180] if crypto else [21, 63, 126]},
        "1d-1y": {"interval": "1d", "months": 12, "window": 365 if crypto else 252,
                  "H": [30, 90, 180] if crypto else [21, 63, 126]},
        "1w-6m": {"interval": "1w", "months": 6, "window": 26, "H": [4, 13, 26]},
        "1w-1y": {"interval": "1w", "months": 12, "window": 52, "H": [4, 13, 26]},
    }


def weekly_history(history, group, now):
    tz = ZoneInfo(history["timeZone"])
    today = datetime.fromtimestamp(now, tz).date()
    current_week = today - timedelta(days=today.weekday())
    groups = {}
    for row in history["bars"]:
        date = datetime.fromtimestamp(row[0], tz).date()
        week = date - timedelta(days=date.weekday())
        groups.setdefault(week, []).append((date, row))
    bars, session_ends = [], []
    for index, (week, items) in enumerate(sorted(groups.items())):
        if week >= current_week:
            continue
        if group == "crypto":
            if [date for date, _ in items] != [week + timedelta(days=i) for i in range(7)]:
                continue
        elif index == 0:
            # The first source week can start on a listing date or mid-week cutoff.
            continue
        rows = [row for _, row in items]
        def aggregate(column, operation):
            values = [r[column] for r in rows]
            return operation(values) if all(v is not None for v in values) else None
        stamp = int(datetime.combine(week, day_time.min, tz).timestamp())
        bars.append([stamp, rows[0][1], aggregate(2, max), aggregate(3, min),
                     rows[-1][4], aggregate(5, sum)])
        session_ends.append(items[-1][0].isoformat())
    return dict(history, bars=bars, sessionEnds=session_ends, aggregation="completed-calendar-week")


def _metrics(values):
    values = np.asarray(values, float)
    return {"return": float(values[-1] / values[0] - 1),
            "drawdown": float(np.min(values / np.maximum.accumulate(values) - 1))}


def build_profile(symbol, meta, history, key, config, now):
    if not history or not history.get("bars"):
        raise ValueError("Daily source history unavailable")
    interval, window, horizons = config["interval"], config["window"], config["H"]
    source_history = weekly_history(history, meta["grp"], now) if interval == "1w" else history
    rows = source_history["bars"]
    n, max_h = len(rows), max(horizons)
    if n < 2 * window + max_h:
        raise ValueError("Insufficient history for separate current, matching and forward windows")
    ts = [r[0] for r in rows]
    close = np.asarray([r[4] for r in rows], float)
    if (any(ts[i] >= ts[i+1] for i in range(n-1)) or not np.all(np.isfinite(close))
            or np.any(close <= 0) or any(t > now for t in ts)):
        raise ValueError("Invalid completed profile history")
    tz = ZoneInfo(source_history["timeZone"])
    dates = [datetime.fromtimestamp(t, tz).date() for t in ts]
    endpoint_dates = ([calendar_date.fromisoformat(d) for d in source_history["sessionEnds"]]
                      if interval == "1w" else dates)
    # Use local calendar dates across DST; daily exchange sessions include holidays.
    expected_days = 7 if interval == "1w" else (1 if meta["grp"] == "crypto" else None)
    gap = np.r_[0, np.cumsum([(b-a).days != expected_days for a,b in zip(dates, dates[1:])])] if expected_days else np.zeros(n, int)
    ref_start = n - window
    if gap[-1] != gap[ref_start]:
        raise ValueError("Current profile window crosses missing candles")
    ends = [e for e in range(window-1, ref_start-max_h)
            if gap[e+max_h] == gap[e-window+1]]
    if not ends:
        raise ValueError("No complete non-overlapping historical and forward windows")
    log_close = np.log(close)
    ref = _zwin(log_close, ref_start, window)
    scores = {e: float(np.clip(np.dot(ref, _zwin(log_close, e-window+1, window))/window, -1, 1)) for e in ends}
    ranked = sorted(ends, key=lambda e: (-scores[e], e))

    def choose(candidates, limit):
        chosen = []
        for e in candidates:
            if all(abs(e-other) >= window for other in chosen):
                chosen.append(e)
                if len(chosen) == limit:
                    break
        return chosen

    selected = choose(ranked, 20)
    annual, comparison = {}, []
    for year in TARGET_YEARS:
        candidates = [e for e in ranked if endpoint_dates[e].year == year]
        chosen = choose(candidates, 3)
        year_rows = [date for date in endpoint_dates if date.year == year]
        expected = (366 if calendar.isleap(year) else 365) if interval == "1d" and meta["grp"] == "crypto" else len(year_rows)
        record = {"year": year, "candidates": len(candidates), "sourceBars": len(year_rows),
                  "expectedEndpoints": expected, "selected": len(chosen), "available": bool(chosen)}
        if chosen:
            annual[str(year)] = [[e, scores[e]] for e in chosen]
            e = chosen[0]
            record.update(score=scores[e], start=dates[e-window+1].isoformat(), end=endpoint_dates[e].isoformat(),
                          eligibleStart=min(endpoint_dates[j] for j in candidates).isoformat(),
                          eligibleEnd=max(endpoint_dates[j] for j in candidates).isoformat(),
                          **_metrics(close[e-window+1:e+1]))
        comparison.append(record)
    prim = {"matchEnds": {"corr": [[e, scores[e]] for e in selected[:6]]}, "annualMatchEnds": annual}
    cfg = dict(config, contextBefore=1, contextAfter=1)
    snapshot = build_replay(symbol, meta["grp"], prim, ts, close.tolist(), source_history,
                            "Binance" if meta["grp"] == "crypto" else "Yahoo Finance", meta["ticker"],
                            config=cfg, interval=interval, annual_year_basis="end")
    # A distant top-ranked window is not automatically a useful analogue.
    stats_ends = choose([e for e in ranked if scores[e] >= .5], 20)
    summary = []
    for h in horizons:
        matches = _stats(np.asarray([close[e+h]/close[e]-1 for e in stats_ends]))
        baseline = _stats(np.asarray([close[e+h]/close[e]-1 for e in ends]))
        summary.append({"bars": h, "n": matches["n"] if matches else 0, "upRate": matches["p_up"] if matches else None,
                        "median": matches["median"] if matches else None, "p25": matches["p25"] if matches else None, "p75": matches["p75"] if matches else None,
                        "baseUpRate": baseline["p_up"]})
    verdict = {"leader": None, "reason": "unavailable", "margin": None}
    if all(item["available"] for item in comparison):
        a, b = comparison
        margin = abs(a["score"]-b["score"])
        reason = "weak" if max(a["score"], b["score"]) < .5 else "close" if margin < .05 else "higher"
        verdict = {"leader": max(comparison, key=lambda r: r["score"])["year"] if reason == "higher" else None,
                   "reason": reason, "margin": margin}
    asof_day = source_history["sessionEnds"][-1] if interval == "1w" else dates[-1].isoformat()
    stale_after = 15*86400 if interval == "1w" else (3 if meta["grp"] == "crypto" else 5)*86400
    snapshot.update(profileKey=key, months=config["months"], group=meta["grp"],
                    asofDay=asof_day, historyStart=dates[0].isoformat(), sourceBars=n,
                    generatedAt=datetime.fromtimestamp(now, timezone.utc).isoformat(),
                    status="stale" if now-ts[-1] > stale_after else "fresh",
                    summary=summary, comparison=comparison, verdict=verdict,
                    currentMetrics=_metrics(close[ref_start:]), eligibleCandidates=len(ends),
                    statsScope="full-history-non-overlapping", statsMinCorrelation=.5, futureBeforeCurrent=True)
    return snapshot


def refresh_profiles(symbol, meta, history, previous, now, output_dir=PROFILE_DIR):
    profiles = {}
    for key, config in configurations(meta["grp"]).items():
        descriptor = dict(config, profileKey=key, symbol=symbol, group=meta["grp"])
        try:
            snapshot = build_profile(symbol, meta, history, key, config, now)
            output_dir.mkdir(parents=True, exist_ok=True)
            name = f"{symbol}-{key}.json"
            path = output_dir / name
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
            temporary.replace(path)
            descriptor.update(url="./history-profiles/"+name, asof=snapshot["asof"],
                              asofDay=snapshot["asofDay"], generatedAt=snapshot["generatedAt"],
                              status=snapshot["status"], historyStart=snapshot["historyStart"])
        except Exception as error:
            old = (previous or {}).get(key)
            if old and old.get("url") and (output_dir / Path(old["url"]).name).is_file():
                descriptor = dict(old, status="cached", error=str(error)[:160])
            else:
                descriptor.update(status="unavailable", error=str(error)[:160])
        profiles[key] = descriptor
    return profiles
