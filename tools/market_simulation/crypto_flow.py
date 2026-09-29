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

ORIGIN = 'https://www.okx.com'
DOCS = ORIGIN + '/docs-v5/en/'
STEP = 300_000
LAG = STEP  # Let the exchange finish its last closed statistics bucket.
MAX_AGE = 20 * 60_000
LOOKBACK = 48  # Four hours of completed five-minute observations.
VERSION = 'crypto-flow-1.0'
FLOW_PATH = '/api/v5/rubik/stat/taker-volume-contract'
SPOT_PATH = '/api/v5/rubik/stat/taker-volume'
OI_PATH = '/api/v5/rubik/stat/contracts/open-interest-history'
CANDLE_PATH = '/api/v5/market/candles'


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
        if path not in (FLOW_PATH, SPOT_PATH, OI_PATH, CANDLE_PATH):
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

    def history(self, path, params):
        rows = {}
        for _ in range(3):  # Up to 25 hours; documented maximum is 100 per page.
            page = self.get(path, {**params, 'limit': 100})
            if not page:
                break
            for row in page:
                rows.setdefault(int(row[0]), row)
            cursor = min(int(row[0]) for row in page)
            if 'end' in params and cursor >= params['end']:
                raise ValueError('History pagination did not advance')
            params = {**params, 'end': cursor}
            time.sleep(.22)
        return list(rows.values())


def suffix(rows):
    """CVD must not silently bridge missing buckets."""
    start = 0
    for i in range(1, len(rows)):
        if rows[i]['time'] - rows[i-1]['time'] != STEP:
            start = i
    return rows[start:]


def align(flow, candles, oi, now, perpetual=False):
    # OKX candles use opening timestamps; flow buckets share that timestamp.
    # OI history is a point observation at the END boundary, not a flow quantity.
    prices = {int(r[0]): r for r in candles if len(r) >= 9 and str(r[8]) == '1'}
    interest = {int(r[0]): r for r in oi}
    latest = now - LAG
    rows = {}
    for raw in flow:
        opened = int(raw[0])
        if opened % STEP or opened + STEP > latest or opened + STEP <= latest - 24 * 3600_000:
            continue
        candle = prices.get(opened)
        if candle is None:
            continue
        sell, buy = number(raw[1]), number(raw[2])
        o, h, l, c = (number(v) for v in candle[1:5])
        if min(sell, buy) < 0 or min(o, h, l, c) <= 0 or not l <= min(o, c) <= max(o, c) <= h:
            continue
        row = {'time': opened + STEP, 'open': o, 'high': h, 'low': l, 'close': c,
               'buy': buy, 'sell': sell, 'delta': buy - sell}
        if perpetual:
            volume = number(candle[6])  # Swap candle volCcy; contract flow explicitly unit=0.
            row['volumeCoverage'] = (buy + sell) / volume if volume > 0 else None
            item = interest.get(opened + STEP)
            if item:
                contracts, coins, usd = map(number, item[1:4])
                if min(contracts, coins, usd) > 0:
                    row.update(oi=coins, oiContracts=contracts, oiUsd=usd)
        rows[opened] = row
    ordered = [rows[k] for k in sorted(rows)]
    complete = suffix(ordered)
    cvd = 0
    for row in complete:
        cvd += row['delta']
        row['cvd'] = cvd
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


def divergences(rows):
    """Online range-divergence candidates; no future bar is used to discover one.

    Confirmation is a later close through the preceding 15-minute swing extreme.
    A later close beyond the reference range by 2 bps invalidates the candidate.
    This heuristic supplies model evidence, not an executable entry/exit rule.
    """
    events, last = [], {}
    for i in range(LOOKBACK, len(rows)):
        previous, row = rows[i-LOOKBACK:i], rows[i]
        cvd_low, cvd_high = min(r['cvd'] for r in previous), max(r['cvd'] for r in previous)
        low, high = min(r['low'] for r in previous), max(r['high'] for r in previous)
        tolerance = row['close'] * .0002
        epsilon = max(1e-9, sum(r['buy']+r['sell'] for r in previous) * .002)
        bull = row['cvd'] < cvd_low - epsilon and row['low'] >= low - tolerance
        bear = row['cvd'] > cvd_high + epsilon and row['high'] <= high + tolerance
        direction = 'bullish' if bull else 'bearish' if bear else None
        if not direction or i-last.get(direction, -1000) < 12:
            continue
        last[direction] = i
        reference = low if bull else high
        confirmation = max(r['high'] for r in previous[-3:]) if bull else min(r['low'] for r in previous[-3:])
        event = {'kind': direction, 'observedAt': row['time'], 'lookbackFrom': previous[0]['time']-STEP,
                 'referencePrice': reference, 'observedPrice': row['close'], 'observedCvd': row['cvd'],
                 'referenceCvd': cvd_low if bull else cvd_high,
                 'confirmationPrice': confirmation, 'invalidationPrice': reference + (-tolerance if bull else tolerance),
                 'status': 'candidate', 'label': 'CVD新低，价格未破区间低点' if bull else 'CVD新高，价格未破区间高点'}
        for later in rows[i+1:]:
            if event['status'] == 'candidate' and later['time'] - row['time'] > 3600_000:
                event['status'] = 'expired'
                break
            broken = later['close'] < event['invalidationPrice'] if bull else later['close'] > event['invalidationPrice']
            if broken:
                event.update(status='invalidated', invalidatedAt=later['time'])
                break
            confirmed = later['close'] > confirmation if bull else later['close'] < confirmation
            if confirmed and event['status'] == 'candidate':
                event.update(status='confirmed', confirmedAt=later['time'])
        if event['status'] == 'candidate' and rows[-1]['time'] - row['time'] > 3600_000:
            event['status'] = 'expired'
        if row['time'] >= rows[-1]['time'] - 4 * 3600_000:
            events.append(event)
    return events[-8:]


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
    result['divergences'] = divergences(rows) if result['status'] == 'ok' else []
    return result


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
    return result


def collect(now=None):
    now = int(time.time()*1000) if now is None else now
    with ThreadPoolExecutor(max_workers=2) as pool:
        assets = list(pool.map(lambda s: collect_asset(s, now), ('BTC', 'ETH')))
    result = {'schema': VERSION, 'generatedAt': now, 'venue': 'OKX', 'documentation': DOCS,
              'intervalMs': STEP, 'settlementLagMs': LAG, 'assets': assets,
              'interpretation': '单一场所观察，不代表全市场。CVD背离提示吸收可能；OI不直接区分多空，也不证明爆仓或挤空。短周期证据不单独推翻日/周计划。'}
    result['evidenceId'] = hashlib.sha256(json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()[:20]
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
