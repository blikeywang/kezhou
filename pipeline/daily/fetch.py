# -*- coding: utf-8 -*-
"""原始行情抓取:加密走 Binance(4h),美股/大宗走 Yahoo(日线,已复权)。

只取「收盘 / 最低」用于衍生分析;返回 (ts秒, close, low)。纯标准库,便于 CI 运行。
注意:数据源商用/再分发授权由使用者自行负责(见 docs/PRELAUNCH_CHECKLIST §0)。
"""
from __future__ import annotations
import json, time, urllib.request, urllib.error

UA = "Mozilla/5.0 (compatible; KezhouBot/1.0; +https://kezhou.example)"

# v1 标的 → 数据源代码
CRYPTO = {"BTC": "BTCUSDT", "ETH": "ETHUSDT", "SOL": "SOLUSDT"}
YAHOO = {"AAPL": "AAPL", "NVDA": "NVDA", "GLD": "GLD", "USO": "USO"}
GROUP = {"BTC": "crypto", "ETH": "crypto", "SOL": "crypto",
         "AAPL": "stock", "NVDA": "stock", "GLD": "commodity", "USO": "commodity"}

# Binance 官方文档列出的只读市场数据入口。GitHub 托管机偶尔会被主站点
# 按地域拒绝,因此优先 data-api,失败后才切到其它官方入口。
BINANCE_BASES = (
    "https://data-api.binance.vision",
    "https://api-gcp.binance.com",
    "https://api.binance.com",
)
LAST_ENDPOINT = {}


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
    out = []  # rows: [openTime_ms, close, low]
    end = None
    endpoint = base.rstrip("/") + "/api/v3/klines"
    while len(out) < bars:
        url = f"{endpoint}?symbol={pair}&interval={interval}&limit=1000"
        if end is not None:
            url += f"&endTime={end}"
        rows = _get(url)
        if not rows:
            break
        chunk = [[int(r[0]), float(r[4]), float(r[3])] for r in rows]
        out = chunk + out
        end = chunk[0][0] - 1
        if len(rows) < 1000:
            break
        time.sleep(0.25)
    out = out[-bars:]
    if not out:
        raise RuntimeError(f"empty Binance response from {base}")
    if any(out[i][0] >= out[i + 1][0] for i in range(len(out) - 1)):
        raise RuntimeError(f"non-monotonic Binance timestamps from {base}")
    ts = [int(r[0] / 1000) for r in out]
    return ts, [r[1] for r in out], [r[2] for r in out]


def fetch_binance(pair, interval="4h", bars=12000):
    """抓取 Binance K线;在官方只读入口间故障转移。"""
    errors = []
    for base in BINANCE_BASES:
        try:
            data = _fetch_binance_from(base, pair, interval, bars)
            globals()["LAST_BINANCE_BASE"] = base
            return data
        except Exception as e:  # noqa: BLE001
            errors.append(f"{base}: {e}")
    raise RuntimeError("all Binance endpoints failed\n" + "\n".join(errors))


def fetch_yahoo(symbol, rng="15y", interval="1d"):
    """Yahoo chart API,复权(adjclose/close 比例)后返回 (ts秒, close, low)。"""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
           f"?range={rng}&interval={interval}&includeAdjustedClose=true")
    d = _get(url)
    res = d["chart"]["result"][0]
    ts = res["timestamp"]
    q = res["indicators"]["quote"][0]
    close = q["close"]; low = q["low"]
    adj = None
    try:
        adj = res["indicators"]["adjclose"][0]["adjclose"]
    except (KeyError, IndexError):
        pass
    ots, oc, ol = [], [], []
    for i in range(len(ts)):
        c = close[i]; lo = low[i]
        if c is None or lo is None:
            continue
        ratio = (adj[i] / c) if (adj and adj[i]) else 1.0
        ots.append(int(ts[i])); oc.append(c * ratio); ol.append(lo * ratio)
    return ots, oc, ol


def fetch_symbol(sym):
    if sym in CRYPTO:
        data = fetch_binance(CRYPTO[sym])
        LAST_ENDPOINT[sym] = globals().get("LAST_BINANCE_BASE", "Binance")
        return data
    if sym in YAHOO:
        data = fetch_yahoo(YAHOO[sym])
        LAST_ENDPOINT[sym] = "query1.finance.yahoo.com"
        return data
    raise KeyError(f"unknown symbol {sym}")


ALL_SYMBOLS = list(CRYPTO) + list(YAHOO)

if __name__ == "__main__":
    # 冒烟:抓一个加密一个美股,打印长度(需要网络,CI 中运行)
    for s in ["BTC", "AAPL"]:
        ts, c, l = fetch_symbol(s)
        print(f"{s}: {len(c)} bars, {ts[0]}..{ts[-1]}, lastClose={c[-1]:.2f}")
