#!/usr/bin/env python3
"""Read-only OKX BTC/ETH flow evidence, shared by public export and hourly review.

CVD is cumulative reported taker buys minus sells, never signed candle volume.
Every snapshot has its own declared anchor; compare deltas, not two snapshot levels.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from crypto_pivots import HOUR, hourly_structure

ORIGIN = 'https://www.okx.com'
DOCS = ORIGIN + '/docs-v5/en/'
STEP = 300_000
LAG = STEP  # Let the exchange finish its last closed statistics bucket.
MAX_AGE = 20 * 60_000
VERSION = 'crypto-flow-2.0'
FLOW_PATH = '/api/v5/rubik/stat/taker-volume-contract'
SPOT_PATH = '/api/v5/rubik/stat/taker-volume'
OI_PATH = '/api/v5/rubik/stat/contracts/open-interest-history'
CANDLE_PATH = '/api/v5/market/candles'
HISTORY_CANDLE_PATH = '/api/v5/market/history-candles'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def number(value):
    x = float(value)
    if not math.isfinite(x):
        raise ValueError('Non-finite market value')
    return x


class Client:
    def __init__(self):
        self.opener = urllib.request.build_opener(NoRedirect())

    def get(self, path, params):
        if path not in (FLOW_PATH, SPOT_PATH, OI_PATH, CANDLE_PATH, HISTORY_CANDLE_PATH):
            raise ValueError('Unknown public endpoint')
        url = ORIGIN + path + '?' + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={'User-Agent': 'TraderHome-PaperResearch/1.0', 'Accept': 'application/json'})
        with self.opener.open(req, timeout=10) as response:
            if response.geturl() != url:
                raise ValueError('Unexpected public origin')
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError('Oversized public response')
            obj = json.loads(raw)
        if obj.get('code') != '0' or not isinstance(obj.get('data'), list):
            raise ValueError('Public source unavailable')
        return obj['data']

    def history(self, path, params, pages=3, cursor_name="end", page_size=100):
        rows = {}
        for _ in range(pages):
            page = self.get(path, {**params, 'limit': page_size})
            if not page:
                break
            for row in page:
                rows.setdefault(int(row[0]), row)
            cursor = min(int(row[0]) for row in page)
            if cursor_name in params and cursor >= params[cursor_name]:
                raise ValueError('History pagination did not advance')
            params = {**params, cursor_name: cursor}
            time.sleep(.42)
        return list(rows.values())


def suffix(rows, step=STEP):
    """CVD must not silently bridge missing buckets."""
    start = 0
    for i in range(1, len(rows)):
        if rows[i]['time'] - rows[i-1]['time'] != step:
            start = i
    return rows[start:]


def align(flow, candles, oi, now, perpetual=False, step=STEP, history_ms=24*HOUR, keep_segments=False):
    # OKX candles use opening timestamps; flow buckets share that timestamp.
    # OI history is a point observation at the END boundary, not a flow quantity.
    prices = {int(r[0]): r for r in candles if len(r) >= 9 and str(r[8]) == '1'}
    interest = {int(r[0]): r for r in oi}
    latest = now - LAG
    rows = {}
    for raw in flow:
        opened = int(raw[0])
        if opened % step or opened + step > latest or opened + step <= latest - history_ms:
            continue
        candle = prices.get(opened)
        if candle is None:
            continue
        sell, buy = number(raw[1]), number(raw[2])
        o, h, l, c = (number(v) for v in candle[1:5])
        if min(sell, buy) < 0 or min(o, h, l, c) <= 0 or not l <= min(o, c) <= max(o, c) <= h:
            continue
        row = {'time': opened + step, 'open': o, 'high': h, 'low': l, 'close': c,
               'buy': buy, 'sell': sell, 'delta': buy - sell}
        if perpetual:
            volume = number(candle[6])  # Swap candle volCcy; contract flow explicitly unit=0.
            row['volumeCoverage'] = (buy + sell) / volume if volume > 0 else None
            item = interest.get(opened + step)
            if item:
                contracts, coins, usd = map(number, item[1:4])
                if min(contracts, coins, usd) > 0:
                    row.update(oi=coins, oiContracts=contracts, oiUsd=usd)
        rows[opened] = row
    ordered = [rows[k] for k in sorted(rows)]
    complete = ordered if keep_segments else suffix(ordered, step)
    cvd, previous, anchor = 0, None, None
    for row in complete:
        if previous is None or row['time'] - previous != step:
            cvd, anchor = 0, row['time'] - step
        cvd += row['delta']
        row['cvd'] = cvd
        row['cvdAnchor'] = anchor
        previous = row['time']
    return complete, len(ordered) - len(complete)


def window(rows, n, perpetual):
    if len(rows) < n + 1:
        return {'status': 'insufficient', 'barsRequired': n + 1}
    before, current, sample = rows[-n-1], rows[-1], rows[-n:]
    buy, sell = sum(r['buy'] for r in sample), sum(r['sell'] for r in sample)
    pct = (current['close'] / before['close'] - 1) * 100
    out = {'status': 'ok', 'from': before['time'], 'through': current['time'],
           'delta': buy - sell, 'buy': buy, 'sell': sell,
           'imbalancePct': (buy-sell)/(buy+sell)*100 if buy+sell else 0, 'pricePct': pct}
    if perpetual:
        available = all('oi' in r for r in rows[-n-1:])
        out['oiStatus'] = 'ok' if available else 'incomplete'
        if available:
            change = (current['oi'] / before['oi'] - 1) * 100
            out.update(oiChange=current['oi']-before['oi'], oiPct=change,
                       oiUsdPct=(current['oiUsd']/before['oiUsd']-1)*100)
            out['oiState'] = ('价格近乎持平' if abs(pct) < .05 else '价格上行' if pct > 0 else '价格下行') + ' / ' + ('OI近乎持平' if abs(change) < .05 else '增仓' if change > 0 else '减仓')
    return out


def stream(symbol, kind, flow, candles, oi, now):
    perpetual = kind == 'perpetual'
    rows, dropped = align(flow, candles, oi, now, perpetual)
    result = {'kind': kind, 'unit': symbol, 'priceUnit': 'USDT',
              'instrument': symbol + ('-USDT-SWAP' if perpetual else '-USDT'),
              'scope': 'OKX USDT永续' if perpetual else 'OKX币种现货聚合；价格参照USDT现货',
              'sourceUrl': ORIGIN + (FLOW_PATH if perpetual else SPOT_PATH),
              'oiSourceUrl': ORIGIN + OI_PATH if perpetual else None,
              'status': 'unavailable', 'series': rows, 'droppedBeforeGap': dropped,
              'windows': {}, 'divergences': [], 'notes': []}
    if not rows:
        result['notes'].append('未取得对齐的完整主动买卖量和价格；不补零、不估算。')
        return result
    through = rows[-1]['time']
    result.update(status='stale' if now-through > MAX_AGE else 'ok', fromTime=rows[0]['time']-STEP,
                  through=through, bars=len(rows), anchorPolicy='当前连续样本首桶前归零；跨快照仅比较区间变化',
                  windows={name: window(rows, count, perpetual) for name, count in [('15m', 3), ('1h', 12), ('4h', 48)]})
    if dropped:
        result['notes'].append('遇到缺口后重新锚定CVD；较早的不连续数据未参与计算。')
    if not perpetual:
        result['notes'].append('现货主动量按币种聚合，价格为USDT单交易对；背离仅作跨口径候选证据。')
    else:
        coverage = [r['volumeCoverage'] for r in rows if r.get('volumeCoverage') is not None]
        if coverage:
            result['volumeCheck'] = {'min': min(coverage), 'median': sorted(coverage)[len(coverage)//2],
                                     'mismatchBars': sum(abs(v-1) > .01 for v in coverage), 'checkedBars': len(coverage)}
        result['notes'].append('主动量来自交易所统计，与K线总量可能不完全一致；OI用币本位数量衡量，美元估值变化另列。')
        result['oiStatus'] = 'ok' if 'oi' in rows[-1] else 'unavailable'
    # Five-minute window deltas are context only; structural comparisons use 1H below.
    return result


def collect_hourly(symbol, kind, now, client):
    try:
        perp = kind == 'perpetual'
        instrument = symbol + ('-USDT-SWAP' if perp else '-USDT')
        params = {'instId': instrument, 'period': '1H'}
        flow = client.history(FLOW_PATH, {**params, 'unit': '0'}, pages=8) if perp else client.get(SPOT_PATH, {'ccy': symbol, 'instType': 'SPOT', 'period': '1H'})
        candles = client.history(HISTORY_CANDLE_PATH, {'instId': instrument, 'bar': '1H'}, pages=3, cursor_name='after', page_size=300)
        try:
            oi = client.history(OI_PATH, params, pages=8) if perp else []
        except Exception:
            oi = []
        rows, _ = align(flow, candles, oi, now, perp, step=HOUR, history_ms=30*24*HOUR, keep_segments=True)
        return hourly_structure(rows, now)
    except Exception:
        return hourly_structure([], now)


def collect_asset(symbol, now, client=None):
    client = client or Client()
    result = {'symbol': symbol}
    for kind in ('spot', 'perpetual'):
        try:
            perp = kind == 'perpetual'
            instrument = symbol + ('-USDT-SWAP' if perp else '-USDT')
            params = {'instId': instrument, 'period': '5m'}
            flow = client.history(FLOW_PATH, {**params, 'unit': '0'}) if perp else client.get(SPOT_PATH, {'ccy': symbol, 'instType': 'SPOT', 'period': '5m'})
            candles = client.get(CANDLE_PATH, {'instId': instrument, 'bar': '5m', 'limit': 300})
            try:
                oi = client.history(OI_PATH, params) if perp else []
            except Exception:
                oi = []  # Missing OI must not silently become zero or destroy valid CVD.
            result[kind] = stream(symbol, kind, flow, candles, oi, now)
        except Exception:
            # No upstream response/error text can leak into public artifacts.
            result[kind] = {'kind': kind, 'unit': symbol, 'status': 'unavailable', 'series': [],
                            'windows': {}, 'divergences': [], 'notes': ['公开源本轮不可用；不以OHLCV、OBV或另一场所冒充。']}
    for kind in ('spot', 'perpetual'):
        result[kind]['hourly'] = collect_hourly(symbol, kind, now, client)
    # Spot has no own open interest. Sample the same venue's perpetual OI at
    # the spot A/B bar boundaries, never at the perpetual's DIFFERENT pivots.
    spot = result['spot']['hourly']
    oi_by_time = {r['time']:r for r in result['perpetual']['hourly'].get('series', [])}
    for row in spot.get('series', []):
        match = oi_by_time.get(row['time'], {})
        for field in ('oi', 'oiUsd', 'oiContracts'):
            if field in match:
                row[field] = match[field]
    result['spot']['hourly'] = hourly_structure(spot.get('series', []), now)
    for kind in ('spot', 'perpetual'):
        result[kind]['hourly']['oiScope'] = '同一小时收盘边界的 OKX ' + symbol + '-USDT-SWAP 未平仓币数量；不是现货持仓量。'
    return result


def collect(now=None):
    now = int(time.time()*1000) if now is None else now
    with ThreadPoolExecutor(max_workers=2) as pool:
        assets = list(pool.map(lambda s: collect_asset(s, now), ('BTC', 'ETH')))
    result = {'schema': VERSION, 'generatedAt': now, 'venue': 'OKX', 'documentation': DOCS,
              'intervalMs': STEP, 'structureIntervalMs': HOUR, 'settlementLagMs': LAG, 'assets': assets,
              'interpretation': '单一场所观察，不代表全市场。CVD背离提示吸收可能；OI不直接区分多空，也不证明爆仓或挤空。短周期证据不单独推翻日/周计划。'}
    result['evidenceId'] = hashlib.sha256(json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()[:20]
    return result


def review_evidence(full):
    """Keep model context bounded; the complete series remains in its frozen file."""
    result = {k: v for k, v in full.items() if k != 'assets'}
    result['assets'] = []
    for asset in full['assets']:
        compact = {'symbol': asset['symbol']}
        for kind in ('spot', 'perpetual'):
            source = asset[kind]
            compact[kind] = {k: v for k, v in source.items() if k not in ('series', 'hourly')}
            hourly = source.get('hourly', {})
            short = {k: v for k, v in hourly.items() if k not in ('series', 'pivots', 'comparisons')}
            pairs = hourly.get('comparisons', [])
            selected = []
            for side in ('low', 'high'):
                same = [p for p in pairs if p['kind'] == side]
                if not same:
                    continue
                latest_time = max(p['b']['time'] for p in same)
                current = [p for p in same if p['b']['time'] == latest_time]
                # Include the deepest/highest unbroken anchor and the nearest one,
                # even if minor turns have appeared between the user's A and B.
                major = sorted(current, key=lambda p:p['a']['price'], reverse=side=='high')[:2]
                selected.extend({p['id']:p for p in major+current[-4:]}.values())
            short['comparisons'] = selected
            short['availableComparisons'] = len(pairs)
            short['availableHourlyBars'] = len(hourly.get('series', []))
            compact[kind]['hourly'] = short
        result['assets'].append(compact)
    result['fullEvidenceFile'] = '/workspace/data/market-simulation-review/flow-' + full['evidenceId'] + '.json'
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = collect()
    body = json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(body, encoding='utf-8')
        print(json.dumps({'evidenceId': result['evidenceId'], 'assets': {a['symbol']: {k: a[k]['status'] for k in ('spot', 'perpetual')} for a in result['assets']}}))
    else:
        print(body)
