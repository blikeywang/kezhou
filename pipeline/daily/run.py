# -*- coding: utf-8 -*-
"""每日刷新编排:fetch → build(PRIM/season/asset) → charts → inject app.html。

用法:
  python pipeline/daily/run.py            # 真抓取(需要网络,CI 用)
  python pipeline/daily/run.py --self-test  # 合成数据自测,不联网,验证全链路
"""
from __future__ import annotations
import sys, os, time, json, re, argparse, subprocess
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build, inject, replay, cycles, history_coverage  # noqa: E402

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
    details = {"source": source, "endpoint": fetch.LAST_ENDPOINT.get(sym, source),
                            "quality": fetch.LAST_QUALITY.get(fetch.NAMES[sym]["ticker"], {}),
                            "history": fetch.LAST_HISTORY.get(fetch.NAMES[sym]["ticker"])}
    if grp == "crypto":
        try:
            pair = fetch.NAMES[sym]["ticker"]
            fetch.fetch_binance(pair, interval="1d")
            details["dailyHistory"] = fetch.LAST_HISTORY[(pair, "1d")]
        except Exception as error:
            details["profileError"] = str(error).splitlines()[0][:160]
    else:
        details["dailyHistory"] = details["history"]
    if sym in {"BTC", "ETH"}:
        try:
            details["referenceHistory"] = fetch.fetch_coinmetrics(sym.lower())
        except Exception as error:
            details["referenceError"] = str(error).splitlines()[0][:160]
    return ts, close, low, details


def data_status(last_ts, group, now=None):
    max_age = 18 * 3600 if group == "crypto" else 5 * 86400
    return "stale" if (time.time() if now is None else now) - last_ts > max_age else "fresh"


def main(self_test=False):
    names = inject.load_meta_names()               # {sym:{nz,ne,grp}}
    old_assets, old_charts = _load_existing()
    assets, prims, seasons, grp_by = {}, {}, {}, {}
    daily_history, reference_history = {}, {}
    failed, unavailable = [], []
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    # Limit source concurrency; matching and matplotlib stay on the main thread.
    executor = ThreadPoolExecutor(max_workers=4)
    pending = {sym: executor.submit(get_ohlc, sym, meta["grp"], self_test) for sym, meta in names.items()}
    executor.shutdown(wait=False)
    print(f"fetching {len(names)} symbols (up to 4 concurrent requests) ...", flush=True)
    for sym, meta in names.items():
        grp = meta["grp"]
        t0 = time.time()
        try:
            ts, close, low, fetch_meta = pending[sym].result()
            daily_history[sym] = fetch_meta.get("dailyHistory")
            reference_history[sym] = fetch_meta.get("referenceHistory")
            if not self_test:
                for scope, interval in (("history", "4h" if grp == "crypto" else "1d"),
                                        ("dailyHistory", "1d"), ("referenceHistory", "1d")):
                    source_history = fetch_meta.get(scope)
                    if source_history and "coverage" not in source_history:
                        source_history["coverage"] = history_coverage.audit(sym, meta, source_history, interval, time.time())
            P = build.build_prim(ts, close, low, grp)
            S = build.build_season(ts, close, grp)
            asset = build.build_asset(sym, meta["nz"], meta["ne"], grp, P, S)
            asset["replay"] = replay.build_replay(
                sym, grp, P, ts, close, fetch_meta.get("history"), fetch_meta["source"], meta["ticker"])
            asset["health"] = {
                "status": data_status(ts[-1], grp), "asof": P["refRange"][1], "generatedAt": generated_at,
                "asofTimestamp": ts[-1], "historyStart": build._date(ts[0]),
                "interval": "4h" if grp == "crypto" else "1d",
                "bars": len(close), "source": fetch_meta["source"], "endpoint": fetch_meta["endpoint"],
                "quality": fetch_meta.get("quality", {}),
                "requestedStart": (fetch_meta.get("history") or {}).get("requestedStart"),
            }
            asset["coverage"] = (fetch_meta.get("history") or {}).get("coverage")
            build.attach_previous(asset, old_assets.get(sym))
            assets[sym] = asset
            prims[sym] = P; seasons[sym] = S; grp_by[sym] = grp
            print(f"  {sym:5} {grp:9} bars={len(close):6} corr={P['corrRange']} "
                  f"verdict={assets[sym]['vk']:8} ({time.time()-t0:.1f}s)")
        except Exception as e:  # noqa: BLE001
            failed.append(sym)
            # 兜底:该标的沿用上一次的数据,不因单个失败而中断全站
            if sym in old_assets:
                assets[sym] = dict(old_assets[sym])
                previous = (old_assets[sym].get("health") or {})
                asof = previous.get("asof") or old_assets[sym].get("refRange", [None, None])[-1]
                try:
                    age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(asof).date()).days
                except (TypeError, ValueError):
                    age = 99
                assets[sym]["health"] = dict(previous, status="stale" if age > 2 else "cached",
                    asof=asof, generatedAt=generated_at, error=str(e).splitlines()[0][:160])
                if assets[sym].get("coverage"):
                    assets[sym]["coverage"] = dict(assets[sym]["coverage"], refreshStatus="cached")
                print(f"  {sym:5} FETCH/BUILD FAILED -> keep previous data ({e})")
            else:
                unavailable.append(sym)
                print(f"  {sym:5} FAILED and no previous data -> skipped ({e})")

    if not prims and not assets:
        raise SystemExit("all symbols failed and no previous data; aborting (site unchanged)")

    profile_issues = []
    if not self_test:
        now = time.time()
        for sym, asset in assets.items():
            asset["profiles"] = cycles.refresh_profiles(sym, names[sym], daily_history.get(sym),
                (old_assets.get(sym) or {}).get("profiles"), now)
            if sym in {"BTC", "ETH"}:
                asset["profiles"].update(cycles.refresh_profiles(sym, names[sym], reference_history.get(sym),
                    (old_assets.get(sym) or {}).get("profiles"), now, series="usd"))
            asset["dailyCoverage"] = {}
            for series, source in (("primary", daily_history.get(sym)), ("usd", reference_history.get(sym))):
                if source:
                    asset["dailyCoverage"][series] = source["coverage"]
                else:
                    previous = (old_assets.get(sym) or {}).get("dailyCoverage", {}).get(series)
                    if previous:
                        asset["dailyCoverage"][series] = dict(previous, refreshStatus="cached")
            profile_issues.extend(f"{sym}:{key}" for key, p in asset["profiles"].items() if p["status"] != "fresh")
        count = sum(len(a["profiles"]) for a in assets.values())
        print(f"long profiles: {count-len(profile_issues)} fresh, {len(profile_issues)} cached/stale/unavailable", flush=True)
        history_coverage.write_report(assets, generated_at)

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

    stale = [s for s, a in assets.items() if a.get("health", {}).get("status") == "stale"]
    fresh = sum(a.get("health", {}).get("status") == "fresh" for a in assets.values())
    cached = [s for s in failed if s in assets]
    run_status = "healthy" if not failed and not stale and not profile_issues else "partial"
    run_meta = {"generatedAt": generated_at, "status": run_status,
                "configured": len(names), "available": len(assets), "fresh": fresh,
                "cached": len(cached), "failed": failed, "unavailable": unavailable, "stale": stale,
                "profileIssues": profile_issues}
    appdata = inject.assemble(assets, charts, run_meta)
    inject.inject(appdata)
    _ensure_ui_explanations()
    _ensure_ui_v21()
    ok = fresh
    print(f"injected {len(assets)} symbols ({fresh} fresh, {len(cached)} kept, {len(unavailable)} unavailable) into app.html")
    if failed:
        names_s = ", ".join(failed)
        print(f"::warning title=Partial data refresh::{names_s}; cached={len(cached)}, unavailable={len(unavailable)}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"## Kezhou refresh\n\n- Status: **{run_status}**\n- Fresh: **{ok}**\n- Cached: **{len(cached)}**\n- Unavailable: **{len(unavailable)}**\n- Stale: **{len(stale)}**\n")
            if failed:
                f.write(f"- Failed: `{', '.join(failed)}`\n")


if __name__ == "__main__":
    import matplotlib  # Check chart dependencies before any network work.
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true", help="synthetic data, no network")
    a = ap.parse_args()
    main(self_test=a.self_test)
