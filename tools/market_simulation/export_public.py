#!/usr/bin/env python3
"""Publish an allowlisted, read-only view of the existing paper ledger.

This process never runs a trading cycle or writes to the simulation service.
Credentials are supplied by Actions secrets (or a private cloud config file).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from crypto_flow import collect as collect_crypto_flow

ORIGIN = "https://hourly-six-lab-blikey.blikeywang.chatgpt.site"
SYMBOLS = ("BTC", "ETH", "XAU", "XAG", "NQ", "CL")
HORIZONS = ("10M", "1H", "4H", "1D", "1W")


def fields(names: str) -> dict:
    return dict.fromkeys(names.split(), True)


BAR = fields("time open high low close volume")
FACTOR = fields("name vote weight value reason")
COST = fields("valid reason from through bars volumeCoverage totalVolume vwap sigma poc val vah rowSize")
SETUP = {**fields("stage name reason side boundary triggeredAt confirmedAt stop target netRR"), "map": COST}
PLAN = fields("entry stop target side notBefore expires riskFraction maxHoldMs") | {"entryZone": [True]}
VALUE_AREA = fields("poc val vah")
AUCTION_PROFILE = {**fields("valid reason from through complete blocks expectedBlocks rowSize vwap"),
                   "tpo": VALUE_AREA, "vp": VALUE_AREA,
                   "rows": [fields("price count volume")], "singlePrints": [fields("low high")]}
AUCTION = {**fields("version through session state side location migration reason"),
           "current": AUCTION_PROFILE, "previous": AUCTION_PROFILE, "levels": [fields("price label")]}
REPORT = {
    **fields("id symbol horizon hour published dataThrough price direction regime score agreement stale summary counter action strategy source sourceUrl caveat hash version intervalMs origin"),
    "levels": fields("support resistance vwap ema20 ema50 atr rsi"), "plan": PLAN,
    "factors": [FACTOR], "costMap": COST, "setup": SETUP, "blockers": [True],
    "modelReview": fields("id thesis pairs validUntil"), "chartBars": [BAR],
    "auction": AUCTION,
}
ENTRY = {**fields("version published dataThrough summary action counter score agreement plannedEntry source sourceUrl hash"),
         "factors": [FACTOR], "costMap": COST, "setup": SETUP, "auction": AUCTION}
TRADE = {
    **fields("horizon maxHoldMs id reportId symbol strategy side quantity entry stop target opened processed risk entryFee closed exit exitFee pnl r reason version processedThrough exitLogic exitBarStart exitBarEnd executionIntervalMs"),
    "entrySnapshot": ENTRY, "events": [fields("time kind reason price pnl reportId")],
    "exitRequest": fields("published reason reviewId"),
}
LEVEL = fields("price label kind knownAt")
STRUCTURE = {**fields("version through"), "legs": [{
    **fields("symbol through price atr source sourceUrl"), "levels": [LEVEL], "bars": [BAR],
    "vwap": fields("price label"), "notes": [True],
}]}
PAIR_REPORT = {
    **fields("id pair slot published dataThrough version hash ratio mean z correlation beta sampleCount sampleFrom stage reason relative reversion"),
    "prices": [True], "sources": [True], "history": [fields("time ratio")], "structure": STRUCTURE,
    "plan": fields("side ratio stop target distance netRR expires"),
}
PAIR_TRADE = {
    **fields("id pair reportId version opened observedAt processedThrough entryRatio stopRatio targetRatio risk peakPnl protected closed exitObservedAt pnl reason"),
    "snapshot": PAIR_REPORT, "events": [fields("time reason")],
    "exitRequest": fields("published reason reviewId"),
    "legs": [fields("symbol side quantity entry entryFee exit exitFee pnl")],
}
GATE = fields("book key horizon verdict reason published reviewId")
CHECK = fields("book kind id verdict reason")
AUDIT = {**fields("id snapshotRun summary published hash"), "checks": [CHECK], "gates": [GATE]}
ACCOUNT = {
    **fields("initial started cash enabled lastRun revision engineVersion storageVersion peakEquity maxDrawdown"),
    "trades": [TRADE], "curve": [fields("time equity")], "decisions": [fields("time symbol reportId reason")],
}
PAIR_ACCOUNT = {**ACCOUNT, "trades": [PAIR_TRADE], "decisions": [fields("time pair reason")]}
MARKET = {
    **fields("symbol intervalMs volumeReliable source sourceUrl fetched dailyFetched cached"),
    **{key: [BAR] for key in ("bars", "executionBars", "contextBars", "dailyBars", "weeklyBars")},
}


def project(value, schema):
    """Unknown fields and wrong shapes never reach the public data files."""
    if value is None:
        return None
    if schema is True:
        if isinstance(value, (str, bool, int)):
            return value
        if isinstance(value, float) and math.isfinite(value):
            return value
        return None
    if isinstance(schema, list):
        return [project(row, schema[0]) for row in value] if isinstance(value, list) else []
    if not isinstance(value, dict):
        return {}
    result = {key: project(value[key], child) for key, child in schema.items() if key in value}
    if "sourceUrl" in result:
        parts = urllib.parse.urlsplit(result["sourceUrl"] or "")
        result["sourceUrl"] = urllib.parse.urlunsplit((parts.scheme, parts.hostname or "", parts.path, "", "")) if parts.scheme == "https" and not parts.username and not parts.password else ""
    return result


def latest(rows, key):
    found = {}
    for row in sorted(rows, key=lambda r: r.get("published", 0), reverse=True):
        found.setdefault(key(row), row)
    return list(found.values())


def prepare(raw: dict, published_at: int) -> tuple[dict, dict]:
    if set(m.get("symbol") for m in raw.get("markets", [])) != set(SYMBOLS):
        raise ValueError("The source does not contain all six instruments")
    if not isinstance(raw.get("account", {}).get("trades"), list) or not isinstance(raw.get("pairs", {}).get("account", {}).get("trades"), list):
        raise ValueError("The source paper ledgers are incomplete")
    for account in (raw["account"], raw["pairs"]["account"]):
        if not isinstance(account.get("initial"), (int, float)) or account["initial"] <= 0:
            raise ValueError("Invalid paper account")
        if len({t["id"] for t in account["trades"]}) != len(account["trades"]):
            raise ValueError("Duplicate paper trade IDs")
    as_of = raw.get("serverTime", 0)
    if not isinstance(as_of, (int, float)) or abs(published_at - as_of) > 15 * 60_000:
        raise ValueError("The source response timestamp is missing or stale")
    reports = [project(r, REPORT) for r in raw.get("reports", [])]
    pairs = [project(r, PAIR_REPORT) for r in raw["pairs"].get("reports", [])]
    markets = []
    for item in raw["markets"]:
        market = project(item, MARKET)
        for key, count in (("bars", 240), ("executionBars", 360), ("contextBars", 240), ("dailyBars", 365), ("weeklyBars", 160)):
            market[key] = market.get(key, [])[-count:]
        market["dataError"] = bool(item.get("error") or item.get("cached"))
        market["contextError"] = bool(item.get("contextError"))
        market["dailyError"] = bool(item.get("dailyError"))
        markets.append(market)
    account = project(raw["account"], ACCOUNT)
    pair_account = project(raw["pairs"]["account"], PAIR_ACCOUNT)
    consumed = set(raw["account"].get("consumed", []))
    pair_consumed = set(raw["pairs"]["account"].get("consumed", []))
    pending = lambda r, used: bool(r.get("plan") and r["plan"].get("expires", 0) > as_of and r["id"] not in used)
    cloud = project(raw.get("cloud", {}), fields("connected provider intervalMs lastAttempt lastSuccess lastScheduledSuccess lastSlot scheduledRuns freshSymbols") | {"freshSymbols": [True]})
    cloud["hasError"] = bool(raw.get("cloud", {}).get("lastError"))
    review = project(raw.get("review", {}), {"history": [AUDIT], "gates": [GATE], "schedule": fields("enabled provider intervalMinutes updated")})
    public = {
        "schema": "traderhome-public-paper-v1", "paper": True,
        "publishedAt": published_at, "serverTime": as_of,
        "publication": {"intervalMinutes": 10, "provider": "GitHub Actions", "commit": os.environ.get("GITHUB_SHA", ""), "runId": os.environ.get("GITHUB_RUN_ID", "")},
        "markets": markets, "account": account,
        **project(raw, fields("equity unrealized risk maxDrawdown running")),
        "reports": latest(reports, lambda r: (r["symbol"], r.get("horizon", "10M"))),
        "pendingPlans": [r for r in reports if pending(r, consumed)],
        "pairs": {"account": pair_account, "reports": latest(pairs, lambda r: r["pair"]),
                  "pendingPlans": [r for r in pairs if pending(r, pair_consumed)],
                  **project(raw["pairs"], fields("equity unrealized gross maxDrawdown") | {"stalePairs": [True]})},
        "cloud": cloud, "review": review,
        "model": project(raw.get("model", {}), fields("id published reviewId")),
        "history": {"file": "history.json", "singleCount": len(reports), "pairCount": len(pairs),
                    "from": min((r["published"] for r in reports + pairs), default=as_of), "through": max((r["published"] for r in reports + pairs), default=as_of),
                    "scope": "最近约 60 小时短线研判及最多 60 份各长周期研判；成交账本保留全部记录。"},
    }
    # Historical analysis is a separate lazy-loaded file. Full trade snapshots,
    # entry/exit evidence and every trade event remain in the main ledger.
    for r in pairs:
        r.pop("structure", None)
        r.pop("history", None)
    # Copy before slimming: current pair structure must remain available for charts.
    public["pairs"]["reports"] = [project(r, PAIR_REPORT) for r in latest(raw["pairs"]["reports"], lambda r: r["pair"])]
    public["pairs"]["pendingPlans"] = [project(r, PAIR_REPORT) for r in raw["pairs"]["reports"] if pending(r, pair_consumed)]
    return public, {"schema": public["schema"], "paper": True, "publishedAt": published_at, "reports": reports, "pairs": pairs}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_source(token: str) -> dict:
    if not token or len(token) < 16:
        raise ValueError("The private source read credential is not configured")
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(ORIGIN + "/api/dashboard", headers={"OAI-Sites-Authorization": "Bearer " + token, "Accept": "application/json"})
    for attempt in range(3):
        try:
            with opener.open(request, timeout=80) as response:
                if response.geturl() != request.full_url or "application/json" not in response.headers.get("Content-Type", ""):
                    raise ValueError("Unexpected source response")
                body = response.read(80_000_001)
                if len(body) > 80_000_000:
                    raise ValueError("Source response exceeds the size limit")
                return json.loads(body)
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise ValueError("Private paper data could not be read; the existing public deployment is retained") from None
            time.sleep(2 * (attempt + 1))
    raise ValueError("No source response")


def publish(public: dict, history: dict, output: Path, secrets=()) -> None:
    encoded = {"status.json": json.dumps({"schema": public["schema"], "publishedAt": public["publishedAt"]}),
               "latest.json": json.dumps(public, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
               "history.json": json.dumps(history, ensure_ascii=False, separators=(",", ":"), allow_nan=False)}
    for body in encoded.values():
        if any(secret and len(secret) >= 12 and secret in body for secret in secrets):
            raise ValueError("Credential content detected; refusing publication")
        if re.search(r'"(?:site_token|scheduler_secret|authorization|api_key|access_token)"\s*:', body, re.I):
            raise ValueError("Private fields detected; refusing publication")
    output.mkdir(parents=True, exist_ok=True)
    for name, body in encoded.items():
        temporary = output / (name + ".tmp")
        temporary.write_text(body, encoding="utf-8")
        temporary.replace(output / name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path, help="Private config, used only in the existing cloud runtime")
    args = parser.parse_args()
    config = json.loads(args.config.read_text()) if args.config else {}
    if config.get("site_url", ORIGIN).rstrip("/") != ORIGIN:
        raise ValueError("Unexpected private source origin")
    token = config.get("site_token") or os.environ.get("MARKET_SIMULATION_SITE_TOKEN", "")
    raw = fetch_source(token)
    public, history = prepare(raw, int(time.time() * 1000))
    public["cryptoOrderFlow"] = collect_crypto_flow()
    publish(public, history, args.output, (token, config.get("scheduler_secret", "")))
    print(json.dumps({"publishedAt": public["publishedAt"], "executionAt": public["account"]["lastRun"], "singleTrades": len(public["account"]["trades"]), "pairTrades": len(public["pairs"]["account"]["trades"]), "hourlyReviews": len(public["review"].get("history", []))}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never include request headers, config contents or upstream response bodies.
        print("Public paper export failed: " + (str(error) if isinstance(error, ValueError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
