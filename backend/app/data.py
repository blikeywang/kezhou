"""预计算分析结果加载器(骨架)。

现在从仓库 `data/*.json`(原型算出的真实结果)读取,充当"数据库/引擎缓存";
生产替换为:命中缓存 → 有则返回;否则调 engine.analyze() 现算(冷门标的按需 fetch)。
"""
from __future__ import annotations
import json
from pathlib import Path

_DATA = Path(__file__).resolve().parents[2] / "data"
_FILES = {
    "crypto": ("crypto_payload.json", "4h"),
    "stock": ("stock_payload.json", "1d"),
    "commodity": ("commodities_payload.json", "1d"),
}
_INDEX: dict[str, dict] = {}


def _load():
    if _INDEX:
        return
    for market, (fn, tf) in _FILES.items():
        p = _DATA / fn
        if not p.exists():
            continue
        prim = json.loads(p.read_text()).get("PRIM", {})
        for sym, obj in prim.items():
            _INDEX[sym] = {"market": market, "timeframe": tf, "prim": obj}


def get_symbol(symbol: str) -> dict | None:
    _load()
    return _INDEX.get(symbol.upper())


def build_analysis(symbol: str, plan: str) -> dict | None:
    """把 PRIM 组织成 API 响应,并按 plan 做服务端裁剪(免费不下发锁定字段)。"""
    rec = get_symbol(symbol)
    if not rec:
        return None
    p = rec["prim"]
    cond_c = p["condC"]; bas = p["bas"]
    mid = cond_c[2]
    out = {
        "symbol": symbol.upper(), "market": rec["market"], "timeframe": rec["timeframe"],
        "window": 60 if rec["market"] == "crypto" else 40,
        "as_of": p["refRange"][1],
        "verdict": _verdict(cond_c, bas),
        "kpi": {
            "mid_p_up": round(mid[1] * 100),
            "baseline": round(bas[2][1] * 100),
            "peak_similarity": p["corrRange"][1],
            "last_close": p["lastClose"],
        },
        "morphology": "trend/position/momentum summary (server-computed)",
        "chart_url": f"/charts/{symbol.upper()}.png",
        "locked": [],
    }
    pro = {
        "prob_table": [
            {"h": r[0], "corr_p_up": round(r[1] * 100), "corr_median": round(r[2] * 1000) / 10,
             "baseline": round(bas[i][1] * 100)} for i, r in enumerate(cond_c)
        ],
        "seasonality_years": p.get("mC") and None or None,  # placeholder; seasonality served separately
        "matches": [{"date": m[0], "corr": m[1], "returns": {}, "max_dd": m[-1]} for m in p["mC"][:6]],
    }
    if plan == "free":
        out["locked"] = ["prob_table", "seasonality_years", "matches"]
        # 关键:锁定字段不下发(值为 None)
        out["prob_table"] = None
        out["seasonality_years"] = None
        out["matches"] = None
    else:
        out.update(pro)
    return out


def _verdict(cond_c, bas):
    edge = cond_c[2][1] - bas[2][1]
    if edge > 0.05:
        return "bull"
    if edge < -0.05:
        return "below"
    return "neutral"
