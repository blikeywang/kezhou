"""引擎回归/性质测试。核心断言:结构正确、相关系数有界、**无未来函数**。"""
import numpy as np
from app.engine.matcher import analyze, seasonality


def _series(n=4000, seed=1):
    rng = np.random.default_rng(seed)
    steps = rng.normal(0, 0.01, n)
    close = 100 * np.exp(np.cumsum(steps))
    low = close * (1 - np.abs(rng.normal(0, 0.004, n)))
    return close, low


def test_structure_and_bounds():
    close, low = _series()
    res = analyze(close, low, window=60, horizons=(6, 30, 60), top_k=20, min_sep=30, prefilter=120)
    assert set(res) >= {"corr", "dtw", "baseline", "significance", "n_candles"}
    lo, hi = res["corr"]["range"]
    assert -1.0001 <= lo <= hi <= 1.0001
    for h in (6, 30, 60):
        assert res["baseline"][h]["n"] > 0
        assert 0.0 <= res["corr"]["cond"][h]["p_up"] <= 1.0
    # topK matches selected, each has forward returns + drawdown
    assert len(res["corr"]["matches"]) <= 20
    for m in res["corr"]["matches"]:
        assert "ret_6" in m and "max_dd" in m


def test_no_lookahead():
    """每个匹配片段的结束点必须严格早于参考窗口起点,且其前瞻数据落在历史内。"""
    close, low = _series()
    window, max_h = 60, 60
    res = analyze(close, low, window=window, horizons=(6, 30, max_h), top_k=20, min_sep=30, prefilter=120)
    n = len(close)
    ref_start = n - window
    for m in res["corr"]["matches"] + res["dtw"]["matches"]:
        e = m["index"]
        assert e < ref_start, "match window overlaps or postdates the current window"
        assert e + max_h <= n - 1, "forward horizon exceeds available history"


def test_seasonality():
    close, _ = _series(n=2000)
    ts = list(range(1_500_000_000, 1_500_000_000 + 2000 * 86400, 86400))
    s = seasonality(ts, close, days=[7, 30])
    assert "per_year" in s and isinstance(s["per_year"], list)
