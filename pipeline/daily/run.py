# -*- coding: utf-8 -*-
"""每日刷新编排:fetch → build(PRIM/season/asset) → charts → inject app.html。

用法:
  python pipeline/daily/run.py            # 真抓取(需要网络,CI 用)
  python pipeline/daily/run.py --self-test  # 合成数据自测,不联网,验证全链路
"""
from __future__ import annotations
import sys, os, time, json, re, argparse, subprocess
from datetime import datetime, timezone
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build, inject  # noqa: E402

UI_PATCH = os.path.join(os.path.dirname(__file__), "ui-explanations.patch")
UI_MARKER = 'data-methods-version="2026-07-10"'
V21_PATCH = os.path.join(os.path.dirname(__file__), "ui-v21.patch")
V21_MARKER = 'data-trust-version="2.1"'


def _ensure_ui_explanations():
    """首次部署时应用讲解层;后续日更检测标记后保持现有 UI 不变。"""
    html = open(inject.APP_HTML, encoding="utf-8").read()
    if UI_MARKER in html:
        print("UI explanations already present")
        return
    if not os.path.exists(UI_PATCH):
        raise RuntimeError(f"UI explanations patch missing: {UI_PATCH}")
    result = subprocess.run(
        ["git", "apply", "--unidiff-zero", "--whitespace=nowarn", UI_PATCH],
        cwd=inject.ROOT, text=True, capture_output=True, check=False,
    )
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"failed to apply UI explanations patch: {detail}")
    if UI_MARKER not in open(inject.APP_HTML, encoding="utf-8").read():
        raise RuntimeError("UI explanations patch applied without version marker")
    print("applied UI explanations patch")


def _ensure_ui_v21():
    """首次部署 V2.1 时应用可信度 UI 补丁;之后只更新 APPDATA。"""
    html = open(inject.APP_HTML, encoding="utf-8").read()
    if V21_MARKER in html:
        print("V2.1 trust UI already present")
        return
    if not os.path.exists(V21_PATCH):
        raise RuntimeError(f"V2.1 UI patch missing: {V21_PATCH}")
    result = subprocess.run(
        ["git", "apply", "--unidiff-zero", "--whitespace=nowarn", V21_PATCH],
        cwd=inject.ROOT, text=True, capture_output=True, check=False,
    )
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"failed to apply V2.1 UI patch: {detail}")
    if V21_MARKER not in open(inject.APP_HTML, encoding="utf-8").read():
        raise RuntimeError("V2.1 UI patch applied without version marker")
    print("applied V2.1 trust UI")


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
        ts, close, low = _synth(nbars, 1500000000, step, sum(map(ord, sym)))
        return ts, close, low, {"source": "Synthetic", "endpoint": "self-test"}
    import fetch
    ts, close, low = fetch.fetch_symbol(sym)
    source = "Binance" if grp == "crypto" else "Yahoo Finance"
    return ts, close, low, {"source": source, "endpoint": fetch.LAST_ENDPOINT.get(sym, source)}


def main(self_test=False):
    names = inject.load_meta_names()               # {sym:{nz,ne,grp}}
    old_assets, old_charts = _load_existing()
    assets, prims, seasons, grp_by = {}, {}, {}, {}
    failed = []
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    for sym, meta in names.items():
        grp = meta["grp"]
        t0 = time.time()
        try:
            ts, close, low, fetch_meta = get_ohlc(sym, grp, self_test)
            P = build.build_prim(ts, close, low, grp)
            S = build.build_season(ts, close, grp)
            assets[sym] = build.build_asset(sym, meta["nz"], meta["ne"], grp, P, S)
            build.attach_previous(assets[sym], old_assets.get(sym))
            assets[sym]["health"] = {
                "status": "fresh", "asof": P["refRange"][1], "generatedAt": generated_at,
                "bars": len(close), "source": fetch_meta["source"], "endpoint": fetch_meta["endpoint"],
            }
            prims[sym] = P; seasons[sym] = S; grp_by[sym] = grp
            print(f"  {sym:5} {grp:9} bars={len(close):6} corr={P['corrRange']} "
                  f"verdict={assets[sym]['vk']:8} ({time.time()-t0:.1f}s)")
        except Exception as e:  # noqa: BLE001
            # 兜底:该标的沿用上一次的数据,不因单个失败而中断全站
            if sym in old_assets:
                assets[sym] = dict(old_assets[sym]); failed.append(sym)
                previous = (old_assets[sym].get("health") or {})
                asof = previous.get("asof") or old_assets[sym].get("refRange", [None, None])[-1]
                try:
                    age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(asof).date()).days
                except (TypeError, ValueError):
                    age = 99
                assets[sym]["health"] = dict(previous, status="stale" if age > 2 else "cached",
                    asof=asof, generatedAt=generated_at, error=str(e).splitlines()[0][:160])
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

    run_status = "healthy" if not failed else "partial"
    run_meta = {"generatedAt": generated_at, "status": run_status,
                "fresh": len(assets) - len(failed), "cached": len(failed), "failed": failed}
    appdata = inject.assemble(assets, charts, run_meta)
    inject.inject(appdata)
    _ensure_ui_explanations()
    _ensure_ui_v21()
    ok = len(assets) - len(failed)
    print(f"injected {len(assets)} symbols ({ok} fresh, {len(failed)} kept) into app.html")
    if failed:
        names_s = ", ".join(failed)
        print(f"::warning title=Partial data refresh::{names_s} kept previous data")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"## Kezhou refresh\n\n- Status: **{run_status}**\n- Fresh: **{ok}**\n- Cached/Stale: **{len(failed)}**\n")
            if failed:
                f.write(f"- Kept previous data: `{', '.join(failed)}`\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true", help="synthetic data, no network")
    a = ap.parse_args()
    main(self_test=a.self_test)
