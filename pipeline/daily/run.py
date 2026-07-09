# -*- coding: utf-8 -*-
"""每日刷新编排:fetch → build(PRIM/season/asset) → charts → inject app.html。

用法:
  python pipeline/daily/run.py            # 真抓取(需要网络,CI 用)
  python pipeline/daily/run.py --self-test  # 合成数据自测,不联网,验证全链路
"""
from __future__ import annotations
import sys, os, time, json, re, argparse
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build, inject  # noqa: E402


def _load_existing():
    """读取当前 app.html 里已有的 assets / charts,作为抓取失败时的兜底。"""
    try:
        h = open(inject.APP_HTML, encoding="utf-8").read()
        m = inject._APPDATA_RE.search(h)
        D = json.loads(m.group(2))
        return D.get("assets", {}), D.get("charts", {"dark": {}, "light": {}})
    except Exception:  # noqa: BLE001
        return {}, {"dark": {}, "light": {}}


def _synth(n, start_ts, step, seed):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(rng.normal(0, 0.02, n).cumsum())
    low = close * (1 - np.abs(rng.normal(0, 0.005, n)))
    ts = [start_ts + i * step for i in range(n)]
    return ts, close.tolist(), low.tolist()


def get_ohlc(sym, grp, self_test):
    if self_test:
        step = 14400 if grp == "crypto" else 86400
        nbars = 12000 if grp == "crypto" else 4000
        return _synth(nbars, 1500000000, step, hash(sym) % 1000)
    import fetch
    return fetch.fetch_symbol(sym)


def main(self_test=False):
    names = inject.load_meta_names()               # {sym:{nz,ne,grp}}
    old_assets, old_charts = _load_existing()
    assets, prims, seasons, grp_by = {}, {}, {}, {}
    failed = []
    for sym, meta in names.items():
        grp = meta["grp"]
        t0 = time.time()
        try:
            ts, close, low = get_ohlc(sym, grp, self_test)
            P = build.build_prim(ts, close, low, grp)
            S = build.build_season(ts, close, grp)
            assets[sym] = build.build_asset(sym, meta["nz"], meta["ne"], grp, P, S)
            prims[sym] = P; seasons[sym] = S; grp_by[sym] = grp
            print(f"  {sym:5} {grp:9} bars={len(close):6} corr={P['corrRange']} "
                  f"verdict={assets[sym]['vk']:8} ({time.time()-t0:.1f}s)")
        except Exception as e:  # noqa: BLE001
            # 兜底:该标的沿用上一次的数据,不因单个失败而中断全站
            if sym in old_assets:
                assets[sym] = old_assets[sym]; failed.append(sym)
                print(f"  {sym:5} FETCH/BUILD FAILED -> keep previous data ({e})")
            else:
                print(f"  {sym:5} FAILED and no previous data -> skipped ({e})")

    if not prims and not assets:
        raise SystemExit("all symbols failed and no previous data; aborting (site unchanged)")

    print("rendering charts …")
    charts = build.build_charts(prims, seasons, grp_by) if prims else {"dark": {}, "light": {}}
    # 只为「失败标的」及「整组失败的组」沿用旧图,绝不引入 v1 之外的标的
    fresh_groups = set(grp_by.values())
    failed_groups = {names[s]["grp"] for s in failed} - fresh_groups   # 整组无新数据的组
    for theme in ("dark", "light"):
        th = charts.setdefault(theme, {})
        for sym in failed:                                            # 失败标的的资产图
            if sym in old_charts.get(theme, {}):
                th[sym] = old_charts[theme][sym]
        for grp in failed_groups:                                     # 整组失败 → 沿用该组旧 EDGE
            ek = "EDGE_" + grp
            if ek in old_charts.get(theme, {}):
                th[ek] = old_charts[theme][ek]

    appdata = inject.assemble(assets, charts)
    inject.inject(appdata)
    ok = len(assets) - len(failed)
    print(f"injected {len(assets)} symbols ({ok} fresh, {len(failed)} kept) into app.html")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true", help="synthetic data, no network")
    a = ap.parse_args()
    main(self_test=a.self_test)
