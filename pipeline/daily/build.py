# -*- coding: utf-8 -*-
"""从原始 OHLC 计算「刻舟求剑」分析,产出与前端 app.html 完全一致的资产结构。

关键:前端(prototype/app.html)的 APPDATA 资产 schema 是唯一真源。本模块复刻它,
不依赖已过时的 pipeline/app.py、pipeline/appdata.py。全部为衍生统计,不下发原始价。

复用后端匹配引擎的原语(_zwin/_dtw/_stats)保证「同一套算法、无未来函数」。
"""
from __future__ import annotations
import io, base64, math, os, sys
from datetime import datetime, timezone
import numpy as np

# 复用后端引擎原语(单一算法真源)
_BACKEND = os.path.join(os.path.dirname(__file__), "..", "..", "backend")
sys.path.insert(0, os.path.abspath(_BACKEND))
from app.engine.matcher import _zwin, _dtw, _stats  # noqa: E402

# 各战场配置:窗口 / 前瞻横轴(bar) / 匹配表取哪几个横轴 / 季节性天数 / 取样上限 / 最小间隔
CFG = {
    "crypto":    dict(window=60, H=[6, 30, 60, 90, 180], match_idx=[0, 2, 4],
                      sea_days=[7, 30, 90], sea_bars=[42, 180, 540],
                      top_k=50, min_sep=30, prefilter=400),
    "stock":     dict(window=40, H=[5, 10, 21, 42, 63], match_idx=[2, 4],
                      sea_days=[5, 21, 63], sea_bars=[5, 21, 63],
                      top_k=40, min_sep=20, prefilter=400),
    "commodity": dict(window=40, H=[5, 10, 21, 42, 63], match_idx=[2, 4],
                      sea_days=[5, 21, 63], sea_bars=[5, 21, 63],
                      top_k=40, min_sep=20, prefilter=400),
}


def _date(ts_sec: float) -> str:
    return datetime.fromtimestamp(ts_sec, tz=timezone.utc).date().isoformat()


# ---------------- PRIM(原始分析结果,内部格式)----------------
def build_prim(ts, close, low, grp):
    cfg = CFG[grp]
    W, H = cfg["window"], cfg["H"]
    C = np.asarray(close, float); Lo = np.asarray(low, float); n = C.size
    max_h = max(H)
    if n < W + max_h + 2:
        raise ValueError(f"history too short: n={n}, need>{W+max_h+2}")
    logC = np.log(C)
    ref_end = n - 1; ref_start = ref_end - W + 1
    ref_z = _zwin(logC, ref_start, W)

    ends = [e for e in range(W - 1, ref_start) if e + max_h <= n - 1]
    corrs = np.array([float(np.dot(ref_z, _zwin(logC, e - W + 1, W)) / W) for e in ends])
    order = np.argsort(-corrs)
    corr_by_end = {ends[k]: float(corrs[k]) for k in range(len(ends))}
    band = max(4, W // 6)
    dtw_by_end = {}
    for k in order[:cfg["prefilter"]]:
        e = ends[k]
        dtw_by_end[e] = _dtw(ref_z, _zwin(logC, e - W + 1, W), band)

    def select(cand):
        ch = []
        for e in cand:
            if len(ch) >= cfg["top_k"]:
                break
            if all(abs(e - c) >= cfg["min_sep"] for c in ch):
                ch.append(e)
        return ch

    ch_corr = select([ends[k] for k in order])
    ch_dtw = select(sorted(dtw_by_end, key=lambda e: dtw_by_end[e]))

    def cond_matches(chosen, score_of, score_round):
        fwd = {h: [] for h in H}; paths = []; rows = []
        for e in chosen:
            base = C[e]
            for h in H:
                fwd[h].append(C[e + h] / base - 1)
            paths.append(C[e:e + max_h + 1] / base * 100.0)
            mdd = round(float(np.min(Lo[e + 1:e + max_h + 1] / base)) - 1, 4)
            rets = [round(float(C[e + H[i]] / base - 1), 4) for i in cfg["match_idx"]]
            rows.append([_date(ts[e]), round(score_of(e), score_round)] + rets + [mdd])
        cond = []
        for h in H:
            st = _stats(np.asarray(fwd[h]))
            cond.append([h, st["p_up"], st["median"], st["p25"], st["p75"]])
        P = np.vstack(paths)
        mp = [round(float(np.median(P[:, j])), 2) for j in range(P.shape[1])]
        return cond, rows, mp

    condC, mC, mpC = cond_matches(ch_corr, lambda e: corr_by_end[e], 3)
    condD, mD, mpD = cond_matches(ch_dtw, lambda e: dtw_by_end[e], 1)

    bas = []
    for h in H:
        arr = np.array([C[e + h] / C[e] - 1 for e in range(W - 1, ref_start) if e + h <= n - 1])
        st = _stats(arr); bas.append([h, st["p_up"], st["median"]])

    # Top-K 敏感性:观察 corr / DTW 在 20、30、全量案例下相对基准的方向是否稳定。
    mid_h = H[2]; p0 = bas[2][1]
    consensus_edge = (condC[2][1] + condD[2][1]) / 2 - p0
    target_sign = 1 if consensus_edge > 0.01 else (-1 if consensus_edge < -0.01 else 0)
    sensitivity = []
    for chosen in (ch_corr, ch_dtw):
        cuts = sorted(set(min(x, len(chosen)) for x in (20, 30, len(chosen)) if min(x, len(chosen)) > 0))
        for cut in cuts:
            vals = [C[e + mid_h] / C[e] - 1 for e in chosen[:cut]]
            edge = float(np.mean(np.asarray(vals) > 0)) - p0
            sign = 1 if edge > 0.01 else (-1 if edge < -0.01 else 0)
            sensitivity.append(sign == target_sign)
    robust = round(100 * sum(sensitivity) / len(sensitivity)) if sensitivity else 0

    nc = [round(float(C[i] / C[ref_start] * 100.0), 2) for i in range(ref_start, ref_end + 1)]
    dvals = sorted(dtw_by_end.values())
    return {
        "refRange": [_date(ts[ref_start]), _date(ts[ref_end])],
        "lastClose": round(float(C[-1]), 2),                      # 仅内部用于计算,不下发
        "corrRange": [round(float(corrs[order[-1]]), 3), round(float(corrs[order[0]]), 3)],
        "dtwRange": [round(dvals[0], 2), round(dvals[min(len(dvals) - 1, cfg["top_k"])], 2)],
        "condC": condC, "condD": condD, "bas": bas,
        "nCorr": len(ch_corr), "nDtw": len(ch_dtw), "robust": robust,
        "nc": nc, "mpC": mpC, "mpD": mpD, "mC": mC[:6], "mD": mD[:6],
    }


# ---------------- 季节性(同期,逐年)----------------
def build_season(ts, close, grp):
    cfg = CFG[grp]; days = cfg["sea_days"]; bars = cfg["sea_bars"]
    C = np.asarray(close, float); n = C.size
    anchor = datetime.fromtimestamp(ts[-1], tz=timezone.utc)
    first_y = datetime.fromtimestamp(ts[0], tz=timezone.utc).year
    py = []; buckets = {d: [] for d in days}
    for y in range(first_y, anchor.year):
        try:
            target = datetime(y, anchor.month, anchor.day, tzinfo=timezone.utc).timestamp()
        except ValueError:
            continue
        bi = int(np.argmin([abs(t - target) for t in ts]))
        if abs(ts[bi] - target) > 5 * 86400:
            continue
        row = [y]
        for d, step in zip(days, bars):
            j = bi + step
            r = float(C[j] / C[bi] - 1) if j <= n - 1 else None
            row.append(round(r, 4) if r is not None else None)
            if r is not None:
                buckets[d].append(r)
        py.append(row)
    summ = {}
    for d in days:
        arr = buckets[d]
        if arr:
            up = sum(1 for x in arr if x > 0) / len(arr)
            med = float(np.median(arr))
            summ[str(d)] = [round(up, 3), round(med, 4), len(arr)]
        else:
            summ[str(d)] = [0.0, 0.0, 0]
    return {"sum": summ, "py": py}


# ---------------- 格式化为前端资产(与 app.html schema 完全一致)----------------
def _binom_p(pup, n, p0):
    if n <= 0:
        return 1.0
    se = math.sqrt(p0 * (1 - p0) / n)
    return 1.0 if se == 0 else 2 * (1 - 0.5 * (1 + math.erf(abs(pup - p0) / se / math.sqrt(2))))


def _sig(pup, n, p0):
    p = _binom_p(pup, n, p0)
    return "★★" if p < 0.05 else ("★" if p < 0.10 else "")


def _wilson(p, n, z=1.96):
    """Wilson score interval; n 为保守估计的有效样本量。"""
    if n <= 0:
        return 0.0, 1.0
    den = 1 + z * z / n
    center = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return max(0.0, center - half), min(1.0, center + half)


def _trust(P, grp):
    cfg = CFG[grp]; i = 2
    pc, pd, p0 = P["condC"][i][1], P["condD"][i][1], P["bas"][i][1]
    consensus = (pc + pd) / 2
    edge = consensus - p0
    gap = abs(pc - pd)
    agree = (pc - p0) * (pd - p0) > 0 or (abs(pc - p0) <= .01 and abs(pd - p0) <= .01)
    n = min(P.get("nCorr", cfg["top_k"]), P.get("nDtw", cfg["top_k"]))
    # 最小间隔为半窗口;用该比例给出保守“约有效样本量”,不宣称样本完全独立。
    neff = max(5, round(n * min(1.0, cfg["min_sep"] / cfg["window"])))
    lo, hi = _wilson(consensus, neff)
    robust = int(P.get("robust", 0))
    sim = P["corrRange"][1]
    score = 0
    ae = abs(edge)
    score += 30 if ae >= .10 else (20 if ae >= .05 else (8 if ae >= .02 else 0))
    score += 20 if gap <= .05 else (12 if gap <= .10 else (4 if gap <= .15 else 0))
    score += 20 if robust >= 80 else (12 if robust >= 60 else (5 if robust >= 40 else 0))
    score += 15 if agree else 0
    sim_hi = .90 if grp == "crypto" else .80
    sim_mid = .75 if grp == "crypto" else .65
    score += 10 if sim >= sim_hi else (6 if sim >= sim_mid else 2)
    score += 5 if neff >= 20 else (3 if neff >= 12 else 1)
    # 等级同时要求“证据完整”与最小效应,避免稳定但仅 1–3pp 的 Edge 被称为强方向优势。
    grade = "strong" if score >= 75 and agree and ae >= .05 else (
        "moderate" if score >= 50 and ae >= .02 else "weak")
    direction = "above" if edge > .02 else ("below" if edge < -.02 else "flat")
    return dict(
        p=round(consensus * 100), pc=round(pc * 100), pd=round(pd * 100),
        base=round(p0 * 100), edge=round(edge * 100), gap=round(gap * 100),
        ci=[round(lo * 100), round(hi * 100)], n=n, neff=neff,
        robust=robust, agree=agree, score=score, grade=grade, direction=direction,
    )


def _morph(nc):
    n = len(nc); tot = nc[-1] / nc[0] - 1; hi = max(nc); lo = min(nc)
    pos = (nc[-1] - lo) / (hi - lo) if hi > lo else .5
    recent = nc[-1] / nc[-max(5, n // 6)] - 1
    peak = nc[0]; dd = 0.0
    for value in nc:
        peak = max(peak, value)
        dd = min(dd, value / peak - 1)
    tr_z = "上行趋势" if tot > 0.02 else ("下行趋势" if tot < -0.02 else "横盘震荡")
    tr_e = "Uptrend" if tot > 0.02 else ("Downtrend" if tot < -0.02 else "Range-bound")
    pp_z = "接近区间高点" if pos > 0.7 else ("接近区间低点" if pos < 0.3 else "居区间中部")
    pp_e = "near range high" if pos > 0.7 else ("near range low" if pos < 0.3 else "mid-range")
    rr_z = "近端走强" if recent > 0.01 else ("近端回落" if recent < -0.01 else "近端走平")
    rr_e = "strengthening lately" if recent > 0.01 else ("pulling back lately" if recent < -0.01 else "flat lately")
    z = f"{tr_z},窗口累计 {tot*100:+.1f}%;当前价{pp_z}(分位 {pos*100:.0f}%),{rr_z}。期间最大回撤 {dd*100:.1f}%。"
    e = f"{tr_e}; window return {tot*100:+.1f}%. Price {pp_e} (percentile {pos*100:.0f}%), {rr_e}. Max drawdown {dd*100:.1f}%."
    return z, e


def _verdict(condC, condD, bas, corrRange, grp):
    edge = (condC[2][1] + condD[2][1]) / 2 - bas[2][1]; q = corrRange[1]
    qk = "high" if q > (0.9 if grp == "crypto" else 0.8) else ("mid" if q > (0.75 if grp == "crypto" else 0.65) else "low")
    if edge > 0.05:
        vk, c = ("bull", "up") if q > (0.9 if grp == "crypto" else 0.7) else ("bullweak", "up")
    elif edge < -0.05:
        vk, c = "below", "dn"
    else:
        vk, c = "neutral", "mut"
    return vk, c, qk


def build_asset(k, nz, ne, grp, P, S):
    cfg = CFG[grp]; H = cfg["H"]; n = cfg["top_k"]
    condC, condD, bas = P["condC"], P["condD"], P["bas"]
    cond = []
    for i, h in enumerate(H):
        c, d, b = condC[i], condD[i], bas[i]
        cond.append([round(c[1] * 100), round(c[2] * 1000) / 10, _sig(c[1], n, b[1]),
                     round(d[1] * 100), round(d[2] * 1000) / 10, _sig(d[1], n, b[1]),
                     round(b[1] * 100), round(b[2] * 1000) / 10,
                     round(c[3] * 1000) / 10, round(c[4] * 1000) / 10])
    sea_keys = [str(x) for x in cfg["sea_days"]]
    season = [[round(S["sum"][key][0] * 100), round(S["sum"][key][1] * 1000) / 10, S["sum"][key][2]] for key in sea_keys]
    seasyears = [[r[0]] + [(round(x * 1000) / 10 if x is not None else 0) for x in r[1:]] for r in S["py"]]
    matches = [[m[0], m[1]] + [round(x * 1000) / 10 for x in m[2:]] for m in P["mC"][:6]]
    vk, vc, qk = _verdict(condC, condD, bas, P["corrRange"], grp)
    mz, me = _morph(P["nc"])
    trust = _trust(P, grp)
    return dict(
        k=k, nz=nz, ne=ne, grp=grp, refRange=P["refRange"], last=None,
        corr=[P["corrRange"][0], P["corrRange"][1]], vk=vk, vc=vc, qk=qk,
        midp=round(condC[2][1] * 100), basmid=round(bas[2][1] * 100),
        trust=trust,
        mz=mz, me=me, cond=cond, season=season, seasyears=seasyears,
        matches=matches, nc=[round(x * 10) / 10 for x in P["nc"]], chart=k,
    )


def attach_previous(asset, old_asset):
    """把上一版 APPDATA 的核心指标附到新资产,用于“相比昨天”。"""
    if not old_asset:
        asset["change"] = {"available": False}
        return asset
    old_t = old_asset.get("trust")
    if not old_t:
        try:
            r = old_asset["cond"][2]
            p = round((r[0] + r[3]) / 2)
            base = round(r[6])
            old_t = {"p": p, "edge": p - base}
        except (KeyError, IndexError, TypeError):
            asset["change"] = {"available": False}
            return asset
    nt = asset["trust"]
    asset["change"] = {
        "available": True,
        "date": (old_asset.get("health") or {}).get("asof") or old_asset.get("refRange", [None, None])[-1],
        "p": nt["p"] - int(old_t.get("p", nt["p"])),
        "edge": nt["edge"] - int(old_t.get("edge", nt["edge"])),
        "sim": round((asset["corr"][1] - old_asset.get("corr", asset["corr"])[1]) * 100),
        "verdict": old_asset.get("vk") != asset.get("vk"),
    }
    return asset


# ---------------- 图表(归一化曲线,深/浅两套 base64 PNG)----------------
_TH = {
    "dark": dict(bg="#141b26", fg="#dbe2ee", mut="#8695ab", grid="#293546", cur="#e2e8f2",
                 corr="#5b9bd5", dtw="#9aa8c9", base="#48566b", up="#54b98a", dn="#e07a7a", cmap="RdYlGn"),
    "light": dict(bg="#f3f5f9", fg="#28303e", mut="#7c8798", grid="#d7dde7", cur="#28303e",
                  corr="#3b6fb0", dtw="#7885a6", base="#aeb8c8", up="#2f9e74", dn="#cf6060", cmap="RdYlGn"),
}
_HL = {"crypto": {6: "1d", 30: "5d", 60: "10d", 90: "15d", 180: "30d"},
       "stock": {5: "1w", 10: "2w", 21: "1m", 42: "2m", 63: "3m"}}
_HL["commodity"] = _HL["stock"]


def _b64(fig, th, plt):
    bio = io.BytesIO()
    fig.savefig(bio, format="png", dpi=118, bbox_inches="tight", facecolor=th["bg"])
    plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(bio.getvalue()).decode()


def _asset_fig(name, P, S, grp, th, plt, np_):
    H = CFG[grp]["H"]; HL = _HL[grp]
    plt.rcParams.update({"font.size": 8.5, "text.color": th["fg"], "axes.labelcolor": th["fg"],
        "xtick.color": th["mut"], "ytick.color": th["mut"], "axes.edgecolor": th["grid"],
        "axes.facecolor": th["bg"], "figure.facecolor": th["bg"], "axes.grid": True,
        "grid.color": th["grid"], "grid.alpha": 0.55, "axes.titlecolor": th["fg"]})
    fig, axs = plt.subplots(1, 3, figsize=(13.4, 3.25))
    nc = P["nc"]; Wl = len(nc)
    ax = axs[0]; ax.plot(range(Wl), nc, color=th["cur"], lw=1.7, label="current", zorder=5)
    for mp, cl, lb in [(P["mpC"], th["corr"], "corr proj"), (P["mpD"], th["dtw"], "DTW proj")]:
        base = nc[-1]; proj = [base * m / 100 for m in mp]; xp = list(range(Wl - 1, Wl - 1 + len(proj)))
        ax.plot(xp, proj, color=cl, lw=1.6, label=lb)
    ax.axvline(Wl - 1, color=th["mut"], ls=":", lw=.8)
    ax.set_title(f"① {name} · current pattern + historical projection", fontsize=9, loc="left")
    ax.legend(fontsize=6.5, frameon=False, loc="upper left"); ax.set_xlabel("bars (indexed = 100)")
    ax = axs[1]; xs = np_.arange(len(H)); w = 0.26
    cc = [P["condC"][i][1] for i in range(len(H))]; cd = [P["condD"][i][1] for i in range(len(H))]
    bb = [P["bas"][i][1] for i in range(len(H))]
    ax.bar(xs - w, [v * 100 for v in cc], w, color=th["corr"], label="corr")
    ax.bar(xs, [v * 100 for v in cd], w, color=th["dtw"], label="DTW")
    ax.bar(xs + w, [v * 100 for v in bb], w, color=th["base"], label="baseline")
    ax.axhline(50, color=th["fg"], lw=.6, ls=":")
    ax.set_xticks(xs); ax.set_xticklabels([HL[h] for h in H]); ax.set_ylabel("P(up) %")
    ax.set_title(f"② {name} · up probability vs baseline", fontsize=9, loc="left"); ax.legend(fontsize=6.5, frameon=False)
    ax = axs[2]; yrs = [r[0] for r in S["py"]]
    vals = [((r[-1] if r[-1] is not None else 0) * 100) for r in S["py"]]
    ax.bar(range(len(yrs)), vals, color=[th["up"] if v >= 0 else th["dn"] for v in vals])
    ax.axhline(0, color=th["fg"], lw=.6); ax.set_xticks(range(len(yrs)))
    ax.set_xticklabels([str(y)[2:] for y in yrs], fontsize=6.5)
    ax.set_ylabel("return %"); ax.set_title(f"③ {name} · same-date return by year", fontsize=9, loc="left")
    fig.tight_layout(); return _b64(fig, th, plt)


def _edge_fig(group, prims, th, plt, np_):
    labels = []; rows = []
    for name, P in prims:
        c = P["condC"]; b = P["bas"]
        rows.append([(c[0][1] - b[0][1]) * 100, (c[2][1] - b[2][1]) * 100, (c[4][1] - b[4][1]) * 100])
        labels.append(name)
    g = np_.array(rows)
    fig, ax = plt.subplots(figsize=(5.6, 0.62 * len(labels) + 1.2))
    im = ax.imshow(g, cmap=th["cmap"], vmin=-16, vmax=16, aspect="auto")
    ax.set_yticks(range(len(labels))); ax.set_yticklabels(labels)
    ax.set_xticks(range(3)); ax.set_xticklabels(["near", "mid", "far"])
    for i in range(len(labels)):
        for j in range(3):
            ax.text(j, i, f"{g[i, j]:+.0f}", ha="center", va="center", fontsize=9, color="#10161f")
    ax.set_title("matched P(up) − baseline (pp)", fontsize=9.5, loc="left", pad=6)
    cb = fig.colorbar(im, ax=ax, shrink=.8); cb.ax.tick_params(colors=th["mut"])
    fig.tight_layout(); return _b64(fig, th, plt)


def build_charts(prim_by_sym, season_by_sym, grp_by_sym):
    """返回 {'dark':{sym:png,...,'EDGE_grp':png}, 'light':{...}}。"""
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    out = {}
    groups = {}
    for sym, grp in grp_by_sym.items():
        groups.setdefault(grp, []).append(sym)
    for theme, th in _TH.items():
        d = {}
        for grp, syms in groups.items():
            for sym in syms:
                d[sym] = _asset_fig(sym, prim_by_sym[sym], season_by_sym[sym], grp, th, plt, np)
            d["EDGE_" + grp] = _edge_fig(grp, [(s, prim_by_sym[s]) for s in syms], th, plt, np)
        out[theme] = d
    return out
