"""Refresh independent crypto USD history only; no trades or base-signal refresh.
Keeps all existing primary history/profiles. Never synthesizes OHLCV from closes.
"""
import json
import time
from datetime import datetime, timezone
from pathlib import Path
import cycles, fetch, history_coverage, inject


def main():
    now = time.time()
    generated = datetime.fromtimestamp(now, timezone.utc).isoformat()
    path = Path(inject.APP_HTML)
    document = path.read_text()
    data = json.loads(inject._APPDATA_RE.search(document).group(2))
    names = inject.load_meta_names()
    results = {}
    # No network source replaces primary candles, base statistics or existing charts.
    for symbol in fetch.CRYPTO:
        history = fetch.fetch_coinmetrics(symbol.lower(), now=now)
        history["coverage"] = history_coverage.audit(symbol, names[symbol], history, "1d", now)
        # Preserve the complete returned source series, not only matching windows.
        archive = cycles.PROFILE_DIR / (symbol+"-usd-source-history.json")
        payload = dict(history, symbol=symbol, generatedAt=generated, interval="1d")
        archive.with_suffix(".tmp").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
        archive.with_suffix(".tmp").replace(archive)
        asset = data["assets"][symbol]
        profiles = cycles.refresh_profiles(symbol, names[symbol], history,
            asset.get("profiles", {}), now, series="usd")
        if any(p["status"] != "fresh" for p in profiles.values()):
            raise RuntimeError(f"{symbol}: reference profiles did not all refresh")
        asset.setdefault("profiles", {}).update(profiles)
        asset.setdefault("sourceHistory", {})["usd"] = {
            "url": "./history-profiles/"+archive.name, "dataKind": "close-only",
            "first": history["coverage"]["first"], "last": history["coverage"]["last"],
            "bars": len(history["bars"]), "generatedAt": generated, "source": "Coin Metrics"}
        asset.setdefault("dailyCoverage", {})["usd"] = history["coverage"]
        results[symbol] = {k: history["coverage"][k] for k in ("first", "last", "bars", "dataKind")}
        print(symbol, results[symbol], flush=True)
    # Keep base generatedAt unchanged: this is not a whole-site market refresh.
    data["referenceBackfill"] = {"generatedAt": generated, "source": "Coin Metrics",
        "scope": "independent-USD-close-only", "fullLifetimeVerified": False, "assets": results}
    # Refuse to overwrite concurrent data edits.
    if path.read_text() != document:
        raise RuntimeError("app.html changed during backfill; rerun against current data")
    inject.inject(data)
    history_coverage.write_report(data["assets"], generated)


if __name__ == "__main__":
    main()
