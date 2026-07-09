"""刻舟求剑 匹配引擎 — 产品核心资产。

从原型的 JS `ana()` / pipeline 逐条复刻,保证结果可复现、无未来函数。
纯 numpy 实现:z-标准化 + 相关系数 + 带 Sakoe-Chiba 的 DTW(corr 预筛 → DTW 精排),
条件分布 vs 无条件基准,季节性,形态拆解。
"""
from __future__ import annotations
import math
from datetime import datetime, timezone
from typing import Sequence
import numpy as np


def _zwin(log_close: np.ndarray, s: int, W: int) -> np.ndarray:
    w = log_close[s:s + W]
    m = w.mean()
    sd = w.std()
    return (w - m) / sd if sd > 0 else np.zeros(W)


def _dtw(a: np.ndarray, b: np.ndarray, band: int) -> float:
    """带 Sakoe-Chiba 带的 DTW 距离(a,b 同长)。"""
    n = len(a)
    INF = float("inf")
    prev = np.full(n + 1, INF)
    prev[0] = 0.0
    for i in range(1, n + 1):
        cur = np.full(n + 1, INF)
        jlo, jhi = max(1, i - band), min(n, i + band)
        for j in range(jlo, jhi + 1):
            cost = abs(a[i - 1] - b[j - 1])
            cur[j] = cost + min(prev[j], cur[j - 1], prev[j - 1])
        prev = cur
    return float(prev[n])


def _stats(arr: np.ndarray) -> dict | None:
    if arr.size == 0:
        return None
    s = np.sort(arr)
    def q(p): return float(s[min(len(s) - 1, round(p * (len(s) - 1)))])
    return {
        "n": int(arr.size),
        "p_up": round(float((arr > 0).mean()), 3),
        "mean": round(float(arr.mean()), 4),
        "p10": round(q(.10), 4), "p25": round(q(.25), 4),
        "median": round(q(.50), 4),
        "p75": round(q(.75), 4), "p90": round(q(.90), 4),
    }


def _binom_p(p_up: float, n: int, p0: float) -> float:
    if n <= 0:
        return 1.0
    se = math.sqrt(p0 * (1 - p0) / n)
    if se == 0:
        return 1.0
    z = abs(p_up - p0) / se
    return 2 * (1 - 0.5 * (1 + math.erf(z / math.sqrt(2))))


def analyze(
    close: Sequence[float],
    low: Sequence[float],
    window: int = 60,
    horizons: Sequence[int] = (6, 30, 60, 90, 180),
    top_k: int = 50,
    min_sep: int = 30,
    prefilter: int = 400,
) -> dict:
    """核心:对最近 `window` 根 K 线找历史相似片段,统计其后走势。

    返回 corr 与 dtw 两套条件分布,以及无条件基准。**无未来函数**:候选片段
    结束点严格早于参考窗口,且其前瞻收益全部落在已实现历史内。
    """
    C = np.asarray(close, dtype=float)
    Lo = np.asarray(low, dtype=float)
    n = C.size
    if n < window + max(horizons) + 2:
        raise ValueError("history too short for given window/horizons")
    logC = np.log(C)
    ref_end = n - 1
    ref_start = ref_end - window + 1
    ref_z = _zwin(logC, ref_start, window)
    max_h = max(horizons)

    # candidate windows: end index e strictly before ref window, forward data must exist
    ends = [e for e in range(window - 1, ref_start) if e + max_h <= n - 1]
    corrs = np.empty(len(ends))
    for k, e in enumerate(ends):
        z = _zwin(logC, e - window + 1, window)
        corrs[k] = float(np.dot(ref_z, z) / window)

    order = np.argsort(-corrs)
    band = max(4, window // 6)
    # DTW only on the top `prefilter` by corr
    dtw_by_end: dict[int, float] = {}
    for k in order[:prefilter]:
        e = ends[k]
        z = _zwin(logC, e - window + 1, window)
        dtw_by_end[e] = _dtw(ref_z, z, band)

    def _select(candidate_ends: list[int]) -> list[int]:
        chosen: list[int] = []
        for e in candidate_ends:
            if len(chosen) >= top_k:
                break
            if all(abs(e - ch) >= min_sep for ch in chosen):
                chosen.append(e)
        return chosen

    corr_sorted = [ends[k] for k in order]
    dtw_sorted = sorted(dtw_by_end, key=lambda e: dtw_by_end[e])
    ch_corr = _select(corr_sorted)
    ch_dtw = _select(dtw_sorted)

    def _forward(chosen: list[int]) -> dict:
        fwd = {h: [] for h in horizons}
        matches = []
        for e in chosen:
            base = C[e]
            rec = {"index": int(e)}
            for h in horizons:
                r = C[e + h] / base - 1
                fwd[h].append(r)
                rec[f"ret_{h}"] = round(float(r), 4)
            mn = float(np.min(Lo[e + 1:e + max_h + 1] / base))
            rec["max_dd"] = round(mn - 1, 4)
            matches.append(rec)
        cond = {h: _stats(np.asarray(fwd[h])) for h in horizons}
        return {"cond": cond, "matches": matches}

    # baseline: unconditional forward returns over all valid windows
    baseline = {}
    for h in horizons:
        arr = np.array([C[e + h] / C[e] - 1 for e in range(window - 1, ref_start) if e + h <= n - 1])
        baseline[h] = _stats(arr)

    corr_res = _forward(ch_corr)
    dtw_res = _forward(ch_dtw)

    # significance markers (binomial approx; note: overlapping windows -> smaller effective n)
    sig = {}
    for h in horizons:
        c, b = corr_res["cond"][h], baseline[h]
        if c and b:
            p = _binom_p(c["p_up"], c["n"], b["p_up"])
            sig[h] = "**" if p < 0.05 else ("*" if p < 0.10 else "")

    return {
        "window": window,
        "horizons": list(horizons),
        "n_candles": int(n),
        "corr": {"range": [round(float(corrs[order[-1]]), 3), round(float(corrs[order[0]]), 3)], **corr_res},
        "dtw": {**dtw_res},
        "baseline": baseline,
        "significance": sig,
    }


def seasonality(timestamps: Sequence[int], close: Sequence[float], days: Sequence[int]) -> dict:
    """同期季节性:锚定今天,统计历史每年同一日历日之后 N 天的收益。"""
    ts = list(timestamps)
    C = np.asarray(close, dtype=float)
    n = C.size
    anchor = datetime.fromtimestamp(ts[-1], tz=timezone.utc)
    first_y = datetime.fromtimestamp(ts[0], tz=timezone.utc).year
    per_year = []
    for y in range(first_y, anchor.year):
        target = datetime(y, anchor.month, anchor.day, tzinfo=timezone.utc).timestamp()
        bi = int(np.argmin([abs(t - target) for t in ts]))
        if abs(ts[bi] - target) > 5 * 86400:
            continue
        rec = {"year": y}
        for d in days:
            j = bi + d
            rec[f"ret_{d}"] = round(float(C[j] / C[bi] - 1), 4) if j <= n - 1 else None
        per_year.append(rec)
    return {"anchor": anchor.date().isoformat(), "per_year": per_year}
