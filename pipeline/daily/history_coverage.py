"""Source coverage audit. Freshness, listing coverage and continuity are distinct."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from replay import candle_valid

ROOT = Path(__file__).resolve().parents[2]
LIFECYCLES = json.loads(Path(__file__).with_name("lifecycle.json").read_text())


@lru_cache(maxsize=4)
def cash_sessions(end_year):
    import exchange_calendars
    # Do not extend the holiday audit into early exchange regimes without validation.
    calendar = exchange_calendars.get_calendar("XNYS", start="1970-01-01", end=f"{end_year}-12-31")
    return tuple(day.date().isoformat() for day in calendar.sessions)


def audit(symbol, meta, history, interval, now):
    rows = history["bars"]
    tz = ZoneInfo(history["timeZone"])
    dates = [datetime.fromtimestamp(r[0], tz).date().isoformat() for r in rows]
    first, last = dates[0], dates[-1]
    reference = LIFECYCLES.get(symbol)
    status = "unverified"
    if reference:
        status = ("network-not-price" if reference["kind"] == "network" else
                  "missing-early" if first > reference["date"] else
                  "start-reached" if first == reference["date"] else "before-reference")
    continuity = {"status": "not-audited", "calendar": None, "from": first, "to": last,
                  "missingCount": None, "missingExamples": [], "unexpectedCount": None,
                  "uncheckedEarlierBars": 0}
    if meta["grp"] == "crypto" and interval in {"4h", "1d"}:
        step = 14400 if interval == "4h" else 86400
        expected = set(range(rows[0][0], rows[-1][0]+1, step))
        actual = {r[0] for r in rows}
        missing, unexpected = sorted(expected-actual), sorted(actual-expected)
        continuity.update(status="checked", calendar="24/7 UTC", expected=len(expected), observed=len(actual),
                          missingCount=len(missing), unexpectedCount=len(unexpected),
                          missingExamples=[datetime.fromtimestamp(t, timezone.utc).isoformat() for t in missing[:12]])
    elif meta["provider"] == "yahoo" and meta["kind"] in {"stock", "index_etf", "index", "metal_etf", "commodity_fund"}:
        start = max(first, "1970-01-01")
        expected = {d for d in cash_sessions(int(last[:4])) if start <= d <= last}
        actual = {d for d in dates if d >= start}
        continuity.update(status="checked", calendar="XNYS session screen (1970+)", **{"from": start},
                          expected=len(expected), observed=len(actual), missingCount=len(expected-actual),
                          unexpectedCount=len(actual-expected), missingExamples=sorted(expected-actual)[:12],
                          uncheckedEarlierBars=sum(d < start for d in dates))
    return {"version": 1, "checkedAt": datetime.fromtimestamp(now, timezone.utc).isoformat(),
            "source": history.get("source"), "ticker": history.get("ticker", meta["ticker"]),
            "interval": interval, "first": first, "last": last, "bars": len(rows),
            "requestedStart": history.get("requestedStart"), "providerFirstDate": history.get("providerFirstDate"),
            "priceBasis": history["priceBasis"], "dataKind": history.get("dataKind", "ohlcv"),
            "sourceUrl": history.get("sourceUrl"), "license": history.get("license"),
            "licenseUrl": history.get("licenseUrl"), "lifecycle": reference,
            "startStatus": status, "fullHistoryVerified": False, "continuity": continuity,
            "invalidCandles": sum(not candle_valid(r) for r in rows),
            "missingFields": {name: sum(r[i] is None for r in rows)
                              for i, name in ((1,"open"),(2,"high"),(3,"low"),(5,"volume"))},
            "ingestQuality": history.get("ingestQuality", {})}


def write_report(assets, generated_at, path=ROOT / "docs" / "HISTORY_COVERAGE_AUDIT.md"):
    lines = ["# Historical Data Coverage Audit", "", f"Generated: {generated_at}", "",
             "Fresh data is not proof of complete lifetime history. No series is certified as fully verified.",
             "Network genesis is not a market-price start. Provider firstTradeDate is not independent IPO evidence.",
             "Only dated primary-source references in lifecycle.json have been checked; all others remain unverified.",
             "Cash-market gaps are a 1970+ XNYS session screen, not proof of missing trades (halts and calendar differences need review).",
             "Earlier cash sessions and futures exchange calendars are not audited. No missing prices are interpolated.",
             "Coin Metrics PriceUSD is an independent USD close-only series, not exchange OHLCV or a Binance splice.",
             "US ADRs, SPAC predecessors, when-issued trades and corporate reorganizations may have distinct start dates.", "",
             "| Symbol | Series | Actual first | Actual last | Bars | Verified lifecycle reference | Start status | Suspected gaps | OHLC-invalid bars |",
             "|---|---|---|---|---:|---|---|---:|---:|"]
    details = []
    for symbol, asset in assets.items():
        scopes = {"base": asset.get("coverage")}
        scopes.update(asset.get("dailyCoverage", {}))
        for key, item in scopes.items():
            if not item:
                lines.append(f"| {symbol} | {key} | unavailable | | | unverified | unverified | not audited | |")
                continue
            ref, cont = item.get("lifecycle"), item["continuity"]
            label = f"[{ref['date']} ({ref['kind']})]({ref['sourceUrl']})" if ref else "unverified"
            gaps = cont["missingCount"] if cont["missingCount"] is not None else "not audited"
            quality = "n/a (close-only)" if item["dataKind"] == "close-only" else str(item["invalidCandles"])
            source = item.get("source") or "unknown"
            lines.append(f"| {symbol} | {key}: {source} {item['interval']} | {item['first']} | {item['last']} | {item['bars']} | {label} | {item['startStatus']} | {gaps} | {quality} |")
            if cont.get("missingExamples"):
                details.append(f"- {symbol}/{key}: " + ", ".join(cont["missingExamples"]) + " (up to 12 examples)")
            if item.get("refreshStatus") == "cached":
                details.append(f"- {symbol}/{key}: cached audit from {item['checkedAt']}; no successful source refresh this run.")
    lines += ["", "## Gap Samples", ""] + (details or ["No suspected gaps in the audited portions."])
    lines += ["", "## Sources", "",
              "- [Coin Metrics Community Data](https://docs.coinmetrics.io/packages/coin-metrics-community-data), [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).",
              "- [Binance market-data API](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints).",
              "- [Yahoo Finance](https://finance.yahoo.com/): explicit daily requests starting 1900-01-01; this is a request boundary, not a claim of 1900 coverage.",
              "- [exchange_calendars](https://github.com/gerrymanoim/exchange_calendars), pinned 4.13.2; session screen only.", ""]
    path.write_text("\n".join(lines), encoding="utf-8")
