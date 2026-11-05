# -*- coding: utf-8 -*-
"""原始行情抓取:加密走 Binance(4h),美股/大宗走 Yahoo(日线,已复权)。

返回 (ts秒, close, low),同时保留同批完成 K 线用于历史核对。纯标准库。
注意:数据源商用/再分发授权由使用者自行负责(见 docs/PRELAUNCH_CHECKLIST §0)。
"""
from __future__ import annotations
import json, math, time, urllib.request, urllib.error
from datetime import datetime, timezone
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo
from universe import load_names

UA = "Mozilla/5.0 (compatible; TraderHome/1.0; +https://traderhome-histroy.xyz)"

NAMES = load_names()
CRYPTO = {s: m["ticker"] for s, m in NAMES.items() if m["provider"] == "binance"}
YAHOO = {s: m["ticker"] for s, m in NAMES.items() if m["provider"] == "yahoo"}
GROUP = {s: m["grp"] for s, m in NAMES.items()}

# Binance 官方文档列出的只读市场数据入口。GitHub 托管机偶尔会被主站点
# 按地域拒绝,因此优先 data-api,失败后才切到其它官方入口。
BINANCE_BASES = (
    "https://data-api.binance.vision",
    "https://api-gcp.binance.com",
    "https://api.binance.com",
)
LAST_ENDPOINT = {}
LAST_QUALITY = {}
LAST_HISTORY = {}
YAHOO_BASES = ("https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com")
DAILY_HISTORY_START = "1998-01-01"


def _prices(close, low, allow_separate_close=False):
    if not all(math.isfinite(v) and v > 0 for v in (close, low)):
        raise ValueError("prices must be finite and positive for log-price matching")
    if low > close * (1 + 1e-6) and not allow_separate_close:
        raise ValueError("low exceeds close")


def _get(url, timeout=25, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            last = e; time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"GET failed after {retries}: {url}\n{last}")


def _fetch_binance_from(base, pair, interval, bars):
    """从一个 Binance 官方入口向前分页;中途失败则整批丢弃。"""
    out = []  # rows: [time_s, open, high, low, close, volume]
    now_ms = int(time.time() * 1000)
    end = now_ms
    endpoint = base.rstrip("/") + "/api/v3/klines"
    while len(out) < bars:
        url = f"{endpoint}?symbol={pair}&interval={interval}&limit=1000"
        if end is not None:
            url += f"&endTime={end}"
        rows = _get(url)
        if not rows:
            break
        chunk = []
        for r in rows:
            if int(r[6]) >= now_ms:
                continue
            close, low = float(r[4]), float(r[3])
            _prices(close, low)
            chunk.append([int(r[0]) // 1000, float(r[1]), float(r[2]), low, close, float(r[5])])
        out = chunk + out
        next_end = int(rows[0][0]) - 1
        if next_end >= end:
            raise RuntimeError("Binance pagination did not move backwards")
        end = next_end
        if len(rows) < 1000:
            break
        time.sleep(0.25)
    out = out[-bars:]
    if not out:
        raise RuntimeError(f"empty Binance response from {base}")
    if any(out[i][0] >= out[i + 1][0] for i in range(len(out) - 1)):
        raise RuntimeError(f"non-monotonic Binance timestamps from {base}")
    LAST_HISTORY[pair] = {"bars": out, "timeZone": "UTC", "priceBasis": "spot"}
    return [r[0] for r in out], [r[4] for r in out], [r[3] for r in out]


def fetch_binance(pair, interval="4h", bars=12000):
    """抓取 Binance K线;在官方只读入口间故障转移。"""
    errors = []
    for base in BINANCE_BASES:
        try:
            data = _fetch_binance_from(base, pair, interval, bars)
            LAST_ENDPOINT[pair] = base
            return data
        except Exception as e:  # noqa: BLE001
            errors.append(f"{base}: {e}")
    raise RuntimeError("all Binance endpoints failed\n" + "\n".join(errors))


def _parse_yahoo(d, now=None, quality=None, history=None):
    """Use completed daily sessions only; Yahoo may append a live duplicate."""
    now = time.time() if now is None else now
    chart = d["chart"]
    if chart.get("error") or not chart.get("result"):
        raise ValueError("Yahoo chart has no valid result")
    res = chart["result"][0]
    ts = res.get("timestamp") or []
    meta = res["meta"]
    futures = meta.get("instrumentType") == "FUTURE"
    tz = ZoneInfo(meta["exchangeTimezoneName"])
    regular = meta.get("currentTradingPeriod", {}).get("regular", {})
    # A missing calendar must not turn the current day's partial bar into a close.
    cutoff = datetime.fromtimestamp(now, tz).date()
    if regular.get("start") and regular.get("end"):
        cutoff = (datetime.fromtimestamp(regular["start"], tz).date()
                  if now < regular["end"] + 900 else None)
    q = res["indicators"]["quote"][0]
    close = q["close"]; low = q["low"]
    adj = None
    try:
        adj = res["indicators"]["adjclose"][0]["adjclose"]
    except (KeyError, IndexError):
        pass
    sessions = {}
    for i in range(len(ts)):
        stamp = int(ts[i])
        day = datetime.fromtimestamp(stamp, tz).date()
        if stamp > now or (cutoff is not None and day >= cutoff):
            continue
        c = close[i]; lo = low[i]
        if c is None or lo is None:
            continue
        c, lo = float(c), float(lo)
        _prices(c, lo, allow_separate_close=futures)
        if futures and lo > c * (1 + 1e-6) and quality is not None:
            quality["separateCloseRows"] = quality.get("separateCloseRows", 0) + 1
        adjusted = adj[i] if adj and i < len(adj) else None
        ratio = float(adjusted) / c if adjusted is not None else 1.0
        _prices(c * ratio, lo * ratio, allow_separate_close=futures)
        # Keep one row per exchange-local session, even when the endpoint appends
        # a regularMarketTime row for the same date. Preserve the session timestamp.
        first_stamp = sessions[day][0] if day in sessions else stamp
        def field(name, multiplier=1):
            values = q.get(name) or []
            value = values[i] if i < len(values) else None
            if value is None:
                return None
            value = float(value) * multiplier
            return value if math.isfinite(value) and value >= 0 else None
        sessions[day] = [first_stamp, field("open", ratio), field("high", ratio),
                         lo * ratio, c * ratio, field("volume")]
    rows = [sessions[day] for day in sorted(sessions)]
    if not rows or any(rows[i][0] >= rows[i + 1][0] for i in range(len(rows) - 1)):
        raise ValueError("empty or non-monotonic completed Yahoo history")
    if history is not None:
        history.update(bars=rows, timeZone=meta["exchangeTimezoneName"],
                       priceBasis="adjusted" if adj else "source")
    return [r[0] for r in rows], [r[4] for r in rows], [r[3] for r in rows]


def fetch_yahoo(symbol, rng=None, interval="1d", start=DAILY_HISTORY_START):
    now = int(time.time())
    params = {"interval": interval, "includeAdjustedClose": "true"}
    if rng is not None:
        params["range"] = rng
    else:
        params.update(period1=int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp()),
                      period2=now)
    errors = []
    for base in YAHOO_BASES:
        url = (f"{base}/v8/finance/chart/{quote(symbol, safe='')}?"
               + urlencode(params))
        try:
            quality, history = {}, {}
            raw = _get(url)
            result = raw.get("chart", {}).get("result") or []
            granularity = result[0].get("meta", {}).get("dataGranularity") if result else None
            if granularity and granularity != interval:
                raise ValueError(f"Requested {interval}, received {granularity}")
            data = _parse_yahoo(raw, now=now, quality=quality, history=history)
            history["requestedStart"] = start if rng is None else None
            LAST_ENDPOINT[symbol] = base
            LAST_QUALITY[symbol] = quality
            LAST_HISTORY[symbol] = history
            return data
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{base}: {exc}")
    raise RuntimeError("all Yahoo endpoints failed\n" + "\n".join(errors))


def fetch_symbol(sym):
    if sym in CRYPTO:
        data = fetch_binance(CRYPTO[sym])
        LAST_ENDPOINT[sym] = LAST_ENDPOINT[CRYPTO[sym]]
        return data
    if sym in YAHOO:
        data = fetch_yahoo(YAHOO[sym])
        LAST_ENDPOINT[sym] = LAST_ENDPOINT[YAHOO[sym]]
        return data
    raise KeyError(f"unknown symbol {sym}")


ALL_SYMBOLS = list(CRYPTO) + list(YAHOO)

if __name__ == "__main__":
    # 冒烟:抓一个加密一个美股,打印长度(需要网络,CI 中运行)
    for s in ["BTC", "AAPL"]:
        ts, c, l = fetch_symbol(s)
        print(f"{s}: {len(c)} bars, {ts[0]}..{ts[-1]}, lastClose={c[-1]:.2f}")
