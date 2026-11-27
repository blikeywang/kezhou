#!/usr/bin/env python3
"""ICT-2 forward paper book: ICT sweep/MSS + order block + Kill Zone + HTF bias + OKX order flow.

Runs inside the GitHub Pages publisher after export_public.py. It reads only the
public latest.json just written (5M execution bars, 1H context bars, daily bars,
OKX BTC/ETH taker flow and OI), steps its own independent paper ledger forward
and writes ict2.json. It never touches the main ledger or the external engine.

Rules: see the ICT-2 规则说明 doc. Every threshold below marked GUESS is an
initial experiment parameter, not an official ICT or Fabio number.
Only closed bars are used; a signal executes only when its confirmation bar is
the newest unprocessed closed bar. Old signals are never back-filled.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

VERSION = 'ict2-1.0'
SCHEMA = 'traderhome-ict2-v1'
PUBLIC_URL = 'https://traderhome-histroy.xyz/market-simulation/data/ict2.json'
NY = ZoneInfo('America/New_York')
M5, H1, H4, D1 = 300_000, 3_600_000, 14_400_000, 86_400_000
SYMBOLS = ('BTC', 'ETH', 'XAU', 'XAG', 'NQ', 'CL')
TICK = {'BTC': 0.1, 'ETH': 0.01, 'XAU': 0.1, 'XAG': 0.005, 'NQ': 0.25, 'CL': 0.01}
FLOW_SYMBOLS = ('BTC', 'ETH')
INITIAL = 100_000.0
RISK_FRACTION = 0.00125
FEE_RATE = 0.0005          # GUESS: per side, of notional
SLIP_TICKS = 1             # GUESS: per fill
MIN_NET_R = 2.0            # GUESS (existing ICT book uses 1R)
MAX_HOLD_BARS = 48         # GUESS: 4 hours
EVENT_BARS = 36            # GUESS: sweep -> confirmation
MSS_BARS = 6
RETEST_BARS = 6            # GUESS: first touch -> confirmation
OB_MAX_ATR = 1.5           # GUESS
OB_MERGE = 3               # GUESS
STOP_ATR = 0.1             # GUESS
FRESH_MS = 20 * 60_000
DAILY_LIMIT = 2
NEUTRAL_AFTER = {'D1': 20, 'H4': 30}   # GUESS
FLOW = {'disp': 0.10, 'retest': -0.15, 'oiDrop': -0.3}  # GUESS
# Minutes of New York day. GUESS: per-instrument allocation.
KZ = {
    'NQ': [(510, 600, '纽约上午'), (600, 660, '纽约银弹'), (810, 960, '纽约下午')],
    'CL': [(540, 600, '纽约上午'), (600, 660, '纽约银弹')],
    'XAU': [(120, 300, '伦敦'), (500, 600, '纽约上午')],
    'XAG': [(120, 300, '伦敦'), (500, 600, '纽约上午')],
    'BTC': [(120, 300, '伦敦'), (420, 600, '纽约上午'), (600, 660, '纽约银弹')],
    'ETH': [(120, 300, '伦敦'), (420, 600, '纽约上午'), (600, 660, '纽约银弹')],
}
STAGES = {'data': '数据不足', 'htf_none': 'HTF 无方向', 'waiting': '等待扫单', 'sweep': '扫单已收回',
          'shift': '结构已转向', 'retest': '等待回踩订单块', 'outside_kz': '不在 Kill Zone',
          'wrong_zone': '不在折价/溢价区', 'flow_reject': '订单流反对', 'blocked': '空间不足',
          'quota': '本时段额度已用', 'ready': '满足条件', 'invalid': '事件作废', 'open': '持仓中'}


def finite(*xs):
    return all(isinstance(x, (int, float)) and math.isfinite(x) for x in xs)


def closed(rows, step, now):
    out = {}
    for b in rows or []:
        if not isinstance(b, dict) or not finite(b.get('time'), b.get('open'), b.get('high'), b.get('low'), b.get('close')):
            continue
        if b['low'] <= 0 or b['high'] < max(b['open'], b['close']) or b['low'] > min(b['open'], b['close']):
            continue
        if b['time'] + step <= now:
            out[int(b['time'])] = {k: b[k] for k in ('time', 'open', 'high', 'low', 'close')}
    return [out[k] for k in sorted(out)]


def h4_bars(hourly):
    groups = {}
    for b in hourly:
        groups.setdefault(b['time'] // H4 * H4, []).append(b)
    out = []
    for t in sorted(groups):
        g = groups[t]
        if len(g) == 4 and all(r['time'] == t + i * H1 for i, r in enumerate(g)):
            out.append({'time': t, 'open': g[0]['open'], 'high': max(r['high'] for r in g),
                        'low': min(r['low'] for r in g), 'close': g[-1]['close']})
    return out


def atr(bars, i, n=14):
    if i < 1:
        return None
    trs = [max(bars[j]['high'], bars[j-1]['close']) - min(bars[j]['low'], bars[j-1]['close']) for j in range(max(1, i-n+1), i+1)]
    return sum(trs) / len(trs) if trs else None


def swings(bars):
    """Confirmed pivots (2 left / 2 right). confirmed = index of the bar that confirms it."""
    out = []
    for i in range(2, len(bars) - 2):
        win = bars[i-2:i+3]
        if bars[i]['high'] > max(b['high'] for j, b in enumerate(win) if j != 2):
            out.append({'kind': 'high', 'i': i, 'price': bars[i]['high'], 'confirmed': i + 2})
        if bars[i]['low'] < min(b['low'] for j, b in enumerate(win) if j != 2):
            out.append({'kind': 'low', 'i': i, 'price': bars[i]['low'], 'confirmed': i + 2})
    return out


def structure(bars, neutral_after):
    """Direction of the most recent CLOSE through a confirmed, still unbroken swing."""
    piv = swings(bars)
    state, last_break, broken = 'neutral', None, set()
    for i, b in enumerate(bars):
        known = [p for p in piv if p['confirmed'] < i and id(p) not in broken]
        for p in known:
            if p['kind'] == 'high' and b['close'] > p['price']:
                state, last_break = 'bull', i
                broken.add(id(p))
            elif p['kind'] == 'low' and b['close'] < p['price']:
                state, last_break = 'bear', i
                broken.add(id(p))
    if last_break is None or len(bars) - 1 - last_break > neutral_after:
        state = 'neutral'
    highs = [p for p in piv if p['kind'] == 'high']
    lows = [p for p in piv if p['kind'] == 'low']
    return {'state': state, 'lastBreak': bars[last_break]['time'] if last_break is not None else None,
            'swingHigh': highs[-1]['price'] if highs else None, 'swingLow': lows[-1]['price'] if lows else None,
            'pivots': piv}


def htf_bias(daily, h4):
    if len(daily) < 10 or len(h4) < 10:
        return None
    d, h = structure(daily, NEUTRAL_AFTER['D1']), structure(h4, NEUTRAL_AFTER['H4'])
    side = 'none'
    if h['state'] == 'bull' and d['state'] in ('bull', 'neutral'):
        side = 'long'
    elif h['state'] == 'bear' and d['state'] in ('bear', 'neutral'):
        side = 'short'
    hi, lo = h['swingHigh'], h['swingLow']
    eq = (hi + lo) / 2 if hi is not None and lo is not None and hi > lo else None
    return {'d1': d['state'], 'h4': h['state'], 'side': side, 'rangeHigh': hi, 'rangeLow': lo, 'eq': eq,
            '_d': d, '_h': h}


def liquidity_targets(side, entry, daily, h4, bias):
    """Untouched H4 swings, previous day high/low, untouched D1 swings in the bias direction."""
    cands = []
    for bars, s, label in ((h4, bias['_h'], 'H4 摆动'), (daily, bias['_d'], 'D1 摆动')):
        for p in s['pivots']:
            want = 'high' if side == 1 else 'low'
            if p['kind'] != want:
                continue
            after = bars[p['i']+1:]
            touched = any((b['high'] >= p['price']) if side == 1 else (b['low'] <= p['price']) for b in after)
            if not touched:
                cands.append((p['price'], label + ('高点' if side == 1 else '低点')))
    if len(daily) >= 1:
        prev = daily[-1]
        cands.append((prev['high'] if side == 1 else prev['low'], '前一日' + ('高点' if side == 1 else '低点')))
    cands = [c for c in cands if (c[0] > entry if side == 1 else c[0] < entry)]
    return sorted(set(cands), key=lambda c: abs(c[0] - entry))


def in_kill_zone(symbol, close_ms):
    t = datetime.fromtimestamp(close_ms / 1000, tz=timezone.utc).astimezone(NY)
    minute = t.hour * 60 + t.minute
    for start, end, name in KZ[symbol]:
        # Bar CLOSE time inside (start, end]: the bar finished during the session.
        if start < minute <= end:
            return {'name': name, 'date': t.date().isoformat(), 'start': start, 'end': end, 'active': True}
    return None


def next_kill_zone(symbol, now):
    t = datetime.fromtimestamp(now / 1000, tz=timezone.utc).astimezone(NY)
    minute = t.hour * 60 + t.minute
    for start, end, name in KZ[symbol]:
        if minute <= end:
            return name + ' 纽约 %02d:%02d–%02d:%02d' % (start // 60, start % 60, end // 60, end % 60)
    s, e, n = KZ[symbol][0]
    return n + ' 纽约 %02d:%02d–%02d:%02d（次日）' % (s // 60, s % 60, e // 60, e % 60)


def find_event(bars, side, tick):
    """Latest sweep -> MSS (with displacement and FVG) -> order block, for the bias side only."""
    piv = swings(bars)
    n = len(bars)
    best = None
    start = max(5, n - EVENT_BARS - MSS_BARS - 2)
    for s in range(start, n):
        b = bars[s]
        a = atr(bars, s)
        if not a:
            continue
        lows = [p for p in piv if p['kind'] == ('low' if side == 1 else 'high') and p['confirmed'] < s]
        if not lows:
            continue
        ref = lows[-1]
        if side == 1:
            swept = b['low'] <= ref['price'] - tick and b['close'] > ref['price']
        else:
            swept = b['high'] >= ref['price'] + tick and b['close'] < ref['price']
        if not swept:
            continue
        opp = [p for p in piv if p['kind'] == ('high' if side == 1 else 'low') and p['confirmed'] <= s and p['i'] > ref['i']]
        if not opp:
            opp = [p for p in piv if p['kind'] == ('high' if side == 1 else 'low') and p['confirmed'] <= s]
        if not opp:
            continue
        boundary = opp[-1]['price']
        for m in range(s + 1, min(n, s + 1 + MSS_BARS)):
            seg = bars[s:m+1]
            ext_rel = min(range(len(seg)), key=lambda k: seg[k]['low']) if side == 1 else max(range(len(seg)), key=lambda k: seg[k]['high'])
            x = s + ext_rel
            extreme = bars[x]['low'] if side == 1 else bars[x]['high']
            if (side == 1 and bars[m]['close'] <= boundary) or (side == -1 and bars[m]['close'] >= boundary):
                continue
            leg = bars[x+1:m+1]
            am = atr(bars, m)
            disp = any(abs(r['close'] - r['open']) >= 0.8 * am and r['high'] - r['low'] >= 1.2 * am
                       and (r['close'] - r['open']) * side > 0 for r in leg) if am else False
            gap = None
            for g in range(max(x + 2, 2), m + 1):
                if side == 1 and bars[g]['low'] - bars[g-2]['high'] >= 2 * tick:
                    gap = {'low': bars[g-2]['high'], 'high': bars[g]['low'], 'from': bars[g-2]['time'], 'through': bars[g]['time'] + M5}
                    break
                if side == -1 and bars[g-2]['low'] - bars[g]['high'] >= 2 * tick:
                    gap = {'low': bars[g]['high'], 'high': bars[g-2]['low'], 'from': bars[g-2]['time'], 'through': bars[g]['time'] + M5}
                    break
            ob_idx = []
            j = x
            while j >= max(0, x - 10):
                if (bars[j]['close'] - bars[j]['open']) * side < 0:
                    ob_idx = [j]
                    k = j - 1
                    while k >= 0 and len(ob_idx) < OB_MERGE and (bars[k]['close'] - bars[k]['open']) * side < 0:
                        ob_idx.append(k)
                        k -= 1
                    break
                j -= 1
            ev = {'side': side, 'sweepIndex': s, 'extremeIndex': x, 'mssIndex': m,
                  'sweep': {'time': b['time'], 'level': ref['price'], 'extreme': extreme},
                  'shift': {'time': bars[m]['time'], 'level': boundary}, 'displacement': disp, 'gap': gap, 'ob': None,
                  'atr': am}
            if gap:
                gap['mid'] = (gap['low'] + gap['high']) / 2
            if ob_idx:
                lo = min(bars[k]['low'] for k in ob_idx)
                hi = max(bars[k]['high'] for k in ob_idx)
                ev['ob'] = {'from': bars[min(ob_idx)]['time'], 'through': bars[max(ob_idx)]['time'] + M5,
                            'low': lo, 'high': hi, 'mean': (lo + hi) / 2, 'bars': len(ob_idx)}
            ev['id'] = '%s-%d-%d' % ('L' if side == 1 else 'S', b['time'], bars[m]['time'])
            best = ev
            break
    return best


def flow_rows(flow_market):
    series = (flow_market or {}).get('series') or []
    return {int(r['time']): r for r in series if isinstance(r, dict) and finite(r.get('time'), r.get('buy'), r.get('sell'))}


def imbalance(rows, bars, lo, hi):
    picked = []
    for b in bars[lo:hi+1]:
        r = rows.get(b['time'] + M5)
        if r is None:
            return None
        picked.append(r)
    buy, sell = sum(r['buy'] for r in picked), sum(r['sell'] for r in picked)
    return (buy - sell) / (buy + sell) if buy + sell > 0 else None


def oi_pct(rows, t0, t1):
    a, b = rows.get(t0, {}).get('oi'), rows.get(t1, {}).get('oi')
    return (b / a - 1) * 100 if finite(a, b) and a > 0 else None


def order_flow(symbol, bars, ev, conf, touch, flow_doc, now):
    if symbol not in FLOW_SYMBOLS:
        return {'status': 'unavailable', 'verdict': 'unavailable', 'reason': '该标的没有订单流数据'}
    asset = next((a for a in (flow_doc or {}).get('assets', []) if a.get('symbol') == symbol), None)
    perp = (asset or {}).get('perpetual') or {}
    rows = flow_rows(perp)
    through = max(rows) if rows else 0
    if not rows or now - through > FRESH_MS or through < bars[conf]['time'] + M5:
        return {'status': 'stale', 'verdict': 'unavailable', 'reason': 'OKX 订单流缺失或过期'}
    s, x, m, side = ev['sweepIndex'], ev['extremeIndex'], ev['mssIndex'], ev['side']
    sweep_imb = imbalance(rows, bars, s, min(s + 1, len(bars) - 1))
    disp_imb = imbalance(rows, bars, x + 1, m) if m > x else None
    retest_imb = imbalance(rows, bars, touch, conf)
    if None in (sweep_imb, disp_imb, retest_imb):
        return {'status': 'unavailable', 'verdict': 'unavailable', 'reason': '所需 5M 订单流桶不完整'}
    sweep_oi = oi_pct(rows, bars[s]['time'], bars[s]['time'] + M5)
    disp_oi = oi_pct(rows, bars[x]['time'] + M5, bars[m]['time'] + M5)
    score = 0
    if sweep_oi is not None and sweep_oi < 0:
        score += 1
    if disp_oi is not None and disp_oi > 0:
        score += 1
    if disp_oi is not None and disp_oi < FLOW['oiDrop']:
        score -= 1
    f1 = side * sweep_imb <= 0
    f2 = side * disp_imb >= FLOW['disp']
    f3 = side * retest_imb >= FLOW['retest']
    verdict = 'pass'
    if not f2 or ((not f1 or not f3) and score <= 0):
        verdict = 'reject'
    return {'status': 'ok', 'verdict': verdict, 'sweepImb': sweep_imb, 'dispImb': disp_imb, 'retestImb': retest_imb,
            'sweepOiPct': sweep_oi, 'dispOiPct': disp_oi, 'oiScore': score, 'f1': f1, 'f2': f2, 'f3': f3,
            'reason': ('通过' if verdict == 'pass' else '否决') + '：扫单吸收%s，位移主动%s，回踩未现反向主动%s，OI 分 %d' % (
                '是' if f1 else '否', '是' if f2 else '否', '是' if f3 else '否', score)}


def costs(symbol, price, qty):
    return qty * price * FEE_RATE


def evaluate(symbol, market, flow_doc, state, now):
    """Return (report, signal or None). Pure function of closed bars and state."""
    tick = TICK[symbol]
    m5 = closed(market.get('executionBars'), M5, now)
    hourly = closed(market.get('contextBars'), H1, now)
    daily = closed(market.get('dailyBars'), D1, now)
    report = {'symbol': symbol, 'stage': 'data', 'nextKillZone': next_kill_zone(symbol, now),
              'chartBars': m5[-80:], 'dataThrough': m5[-1]['time'] + M5 if m5 else None}
    if len(m5) < 60 or market.get('dataError') or now - (m5[-1]['time'] + M5) > FRESH_MS:
        report['reason'] = '5M 数据不足或已过期（期货休市时属正常）'
        return report, None
    h4 = h4_bars(hourly)
    bias = htf_bias(daily, h4)
    if not bias:
        report['reason'] = 'D1/H4 已收盘柱不足'
        return report, None
    report['bias'] = {k: v for k, v in bias.items() if not k.startswith('_')}
    if bias['side'] == 'none':
        report.update(stage='htf_none', reason='D1 %s / H4 %s：没有一致方向，不交易' % (bias['d1'], bias['h4']))
        return report, None
    side = 1 if bias['side'] == 'long' else -1
    ev = find_event(m5, side, tick)
    if not ev:
        report.update(stage='waiting', reason='等待与%s偏向一致的扫单与结构转向' % ('做多' if side == 1 else '做空'))
        return report, None
    report.update(eventId=ev['id'], sweep=ev['sweep'], shift=ev['shift'], gap=ev['gap'], ob=ev['ob'], side=bias['side'])
    if not ev['displacement'] or not ev['gap']:
        report.update(stage='shift', reason='结构已转向，但缺少合格位移或 FVG')
        return report, None
    ob = ev['ob']
    if not ob or ob['high'] - ob['low'] > OB_MAX_ATR * ev['atr']:
        report.update(stage='shift', reason='没有合格订单块（缺失或过宽）')
        return report, None
    gap = ev['gap']
    lo, hi = max(ob['low'], gap['low']), min(ob['high'], gap['high'])
    zone, grade = ({'low': lo, 'high': hi}, 'A') if hi > lo else ({'low': ob['low'], 'high': ob['high']}, 'B')
    zone['mid'] = (zone['low'] + zone['high']) / 2
    report.update(zone=zone, grade=grade)
    m, n = ev['mssIndex'], len(m5)
    distal = ob['low'] if side == 1 else ob['high']
    touch = conf = None
    for i in range(m + 1, n):
        b = m5[i]
        if (side == 1 and b['close'] < distal) or (side == -1 and b['close'] > distal):
            report.update(stage='invalid', reason='5M 收盘穿过订单块远端')
            return report, None
        if touch is None and ((side == 1 and b['low'] <= zone['high']) or (side == -1 and b['high'] >= zone['low'])):
            touch = i
        if touch is not None and ((side == 1 and b['close'] > zone['mid']) or (side == -1 and b['close'] < zone['mid'])):
            conf = i
            break
        if touch is not None and i - touch >= RETEST_BARS:
            report.update(stage='invalid', reason='触及订单块后未及时收回中位，视为已缓解')
            return report, None
    if conf is None:
        if n - 1 - ev['sweepIndex'] > EVENT_BARS:
            report.update(stage='invalid', reason='扫单后超过 %d 根仍未确认' % EVENT_BARS)
        else:
            report.update(stage='retest', reason='等待价格回到订单块并收回中位')
        return report, None
    if conf - ev['sweepIndex'] > EVENT_BARS:
        report.update(stage='invalid', reason='扫单到确认超过 %d 根' % EVENT_BARS)
        return report, None
    bar = m5[conf]
    close_ms = bar['time'] + M5
    if any(t.get('eventId') == ev['id'] and t['symbol'] == symbol for t in state['trades']):
        report.update(stage='open', reason='本事件已入场，按原止损和目标管理')
        return report, None
    if close_ms <= state.get('processedThrough', 0):
        # Confirmation was already seen by an earlier run: never back-fill.
        report.update(stage='invalid', reason='确认柱已过去，不回补入场')
        return report, None
    last = m5[-1]
    # Confirmation is in a bar this run has not seen yet (cadence is 10M, bars 5M).
    # Fill at the NEWEST close, never at an older price, and only if nothing after
    # the confirmation already crossed the order block's far edge.
    if any((side == 1 and b['low'] <= distal) or (side == -1 and b['high'] >= distal) for b in m5[conf+1:]):
        report.update(stage='invalid', reason='确认后价格已触及订单块远端')
        return report, None
    kz = in_kill_zone(symbol, close_ms)
    report['killZone'] = kz
    if not kz:
        report.update(stage='outside_kz', reason='确认柱不在允许的 Kill Zone')
        return report, None
    if bias['eq'] is None or (side == 1 and zone['mid'] >= bias['eq']) or (side == -1 and zone['mid'] <= bias['eq']):
        report.update(stage='wrong_zone', reason='入场区不在 H4 区间的%s区' % ('折价' if side == 1 else '溢价'))
        return report, None
    flow = order_flow(symbol, m5, ev, conf, touch, flow_doc, now)
    report['flow'] = flow
    if flow['verdict'] == 'reject':
        report.update(stage='flow_reject', reason=flow['reason'])
        return report, None
    entry = last['close'] + side * SLIP_TICKS * tick
    close_ms = last['time'] + M5
    stop_a = distal - side * STOP_ATR * ev['atr']
    stop_b = ev['sweep']['extreme'] - side * tick
    stop = min(stop_a, stop_b) if side == 1 else max(stop_a, stop_b)
    stop = round(stop / tick) * tick
    risk_px = abs(entry - stop)
    if risk_px <= 0:
        report.update(stage='blocked', reason='止损距离无效')
        return report, None
    equity = state['cash']
    qty = equity * RISK_FRACTION / risk_px
    target = net_r = label = None
    for level, lab in liquidity_targets(side, entry, daily, h4, bias):
        t = level - side * tick
        fees = costs(symbol, entry, qty) + costs(symbol, t, qty)
        r = (abs(t - entry) * qty - fees) / (risk_px * qty + fees)
        if r >= MIN_NET_R:
            target, net_r, label = t, r, lab
            break
    report.update(stop=stop, entry=entry)
    if target is None:
        report.update(stage='blocked', reason='最近流动性目标扣费后不足 %.1fR' % MIN_NET_R)
        return report, None
    report.update(target=target, targetLabel=label, netRR=net_r)
    day_trades = [t for t in state['trades'] if t['symbol'] == symbol and t.get('kz', {}).get('date') == kz['date']]
    if any(t.get('kz', {}).get('name') == kz['name'] for t in day_trades) or len(day_trades) >= DAILY_LIMIT \
            or any(t['symbol'] == symbol and not t.get('closed') for t in state['trades']):
        report.update(stage='quota', reason='本 Kill Zone 或当日额度已用，或已有持仓')
        return report, None
    report.update(stage='ready', reason='全部条件满足，按确认柱收盘价入场')
    signal = {'symbol': symbol, 'side': side, 'entry': entry, 'stop': stop, 'target': target, 'quantity': qty,
              'opened': close_ms, 'eventId': ev['id'], 'grade': grade, 'kz': kz, 'targetLabel': label, 'netRR': net_r,
              'entryFee': costs(symbol, entry, qty), 'risk': equity * RISK_FRACTION,
              'snapshot': {k: report.get(k) for k in ('bias', 'sweep', 'shift', 'gap', 'ob', 'zone', 'flow', 'killZone', 'reason')}}
    return report, signal


def manage(trade, bars, now, tick):
    """Walk closed 5M bars after entry. Stop wins when both levels sit in the same bar."""
    side = trade['side']
    for b in bars:
        if b['time'] < trade.get('processedThrough', trade['opened']):
            continue
        close_ms = b['time'] + M5
        hit_stop = b['low'] <= trade['stop'] if side == 1 else b['high'] >= trade['stop']
        hit_tgt = b['high'] >= trade['target'] if side == 1 else b['low'] <= trade['target']
        held = (close_ms - trade['opened']) // M5
        exit_px = reason = None
        if hit_stop:
            exit_px, reason = trade['stop'] - side * SLIP_TICKS * tick, '触及原始止损'
        elif hit_tgt:
            exit_px, reason = trade['target'], '到达流动性目标'
        elif held >= MAX_HOLD_BARS:
            exit_px, reason = b['close'] - side * SLIP_TICKS * tick, '达到最长持仓 %d 根，按收盘离场' % MAX_HOLD_BARS
        trade['processedThrough'] = close_ms
        if exit_px is not None:
            fee = trade['quantity'] * exit_px * FEE_RATE
            pnl = (exit_px - trade['entry']) * side * trade['quantity'] - trade['entryFee'] - fee
            trade.update(closed=close_ms, exit=exit_px, exitFee=fee, pnl=pnl, r=pnl / trade['risk'], reason=reason)
            return pnl
    return None


def metrics(state, marks):
    closed_t = [t for t in state['trades'] if t.get('closed')]
    wins = [t for t in closed_t if t['pnl'] > 0]
    losses = [t for t in closed_t if t['pnl'] <= 0]
    unreal = 0.0
    for t in state['trades']:
        if not t.get('closed') and t['symbol'] in marks:
            unreal += (marks[t['symbol']] - t['entry']) * t['side'] * t['quantity'] - t['entryFee']
    equity = state['cash'] + unreal
    loss_sum = -sum(t['pnl'] for t in losses)
    days = (state['updated'] - state['started']) / D1
    return {'equity': equity, 'unrealized': unreal, 'closed': len(closed_t), 'open': len(state['trades']) - len(closed_t),
            'winRate': len(wins) / len(closed_t) if closed_t else None,
            'netPnl': sum(t['pnl'] for t in closed_t), 'meanR': sum(t['r'] for t in closed_t) / len(closed_t) if closed_t else None,
            'profitFactor': sum(t['pnl'] for t in wins) / loss_sum if loss_sum > 0 else None,
            'maxDrawdown': state.get('maxDrawdown', 0), 'days': days,
            'assessment': '样本不足：至少 30 笔平仓、14 天后才做描述性比较。' if len(closed_t) < 30 or days < 14 else '可开始描述性比较，仍需分时段观察。'}


def fresh_state(now):
    return {'schema': SCHEMA, 'version': VERSION, 'started': now, 'updated': now, 'initial': INITIAL, 'cash': INITIAL,
            'peakEquity': INITIAL, 'maxDrawdown': 0.0, 'processedThrough': {}, 'trades': [], 'decisions': [], 'curve': [],
            'lastStage': {}}


def step(state, latest, now):
    markets = {m.get('symbol'): m for m in latest.get('markets', [])}
    flow_doc = latest.get('cryptoOrderFlow')
    reports, marks = [], {}
    for symbol in SYMBOLS:
        market = markets.get(symbol) or {}
        m5 = closed(market.get('executionBars'), M5, now)
        if m5:
            marks[symbol] = m5[-1]['close']
        for t in state['trades']:
            if t['symbol'] == symbol and not t.get('closed'):
                pnl = manage(t, m5, now, TICK[symbol])
                if pnl is not None:
                    state['cash'] += pnl
                    state['decisions'].append({'time': t['closed'], 'symbol': symbol, 'reason': '平仓：' + t['reason']})
        sym_state = {'cash': state['cash'], 'trades': state['trades'],
                     'processedThrough': state['processedThrough'].get(symbol, 0)}
        report, signal = evaluate(symbol, market, flow_doc, sym_state, now)
        if m5:
            state['processedThrough'][symbol] = max(state['processedThrough'].get(symbol, 0), m5[-1]['time'] + M5)
        if signal:
            signal['id'] = 'ict2-' + hashlib.sha256(json.dumps([symbol, signal['eventId'], signal['opened']]).encode()).hexdigest()[:16]
            if not any(t['id'] == signal['id'] for t in state['trades']):
                state['trades'].append({**signal, 'processedThrough': signal['opened'], 'version': VERSION})
                state['decisions'].append({'time': signal['opened'], 'symbol': symbol, 'reason': '开仓：%s %s 级，%s' % (
                    '多' if signal['side'] == 1 else '空', signal['grade'], signal['kz']['name'])})
        key = (report['stage'], report.get('eventId'))
        if state['lastStage'].get(symbol) != list(key):
            state['lastStage'][symbol] = list(key)
            state['decisions'].append({'time': now, 'symbol': symbol, 'reason': STAGES.get(report['stage'], report['stage']) + '：' + report.get('reason', '')})
        report['stageLabel'] = STAGES.get(report['stage'], report['stage'])
        reports.append(report)
    state['updated'] = now
    m = metrics(state, marks)
    state['peakEquity'] = max(state['peakEquity'], m['equity'])
    state['maxDrawdown'] = max(state['maxDrawdown'], 1 - m['equity'] / state['peakEquity'])
    m['maxDrawdown'] = state['maxDrawdown']
    if not state['curve'] or now - state['curve'][-1]['time'] >= H1:
        state['curve'].append({'time': now, 'equity': m['equity']})
    state['decisions'] = state['decisions'][-300:]
    state['curve'] = state['curve'][-2000:]
    return {**state, 'reports': reports, 'metrics': m, 'label': 'ICT-2（OB + Kill Zone + HTF + 订单流）',
            'rules': '扫单 → 位移 MSS + FVG → 订单块 → HTF 偏向一致 → Kill Zone 内回踩确认 → 折溢价正确 → 订单流不反对（仅 BTC/ETH）→ 扣费后 ≥2R。独立账本，USD 100,000，每笔 0.125% 风险。'}


def valid_state(obj):
    return isinstance(obj, dict) and obj.get('schema') == SCHEMA and isinstance(obj.get('trades'), list) \
        and finite(obj.get('cash'), obj.get('updated'), obj.get('started'))


def load_previous(url, cache_path):
    """Newest of the published file and the Actions cache. (None, reason) when neither exists."""
    found, errors = [], []
    try:
        req = urllib.request.Request(url + '?t=%d' % time.time(), headers={'User-Agent': 'TraderHome-ICT2/1.0', 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as r:
            obj = json.loads(r.read(20_000_001))
            if valid_state(obj):
                found.append(obj)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            errors.append('published HTTP %d' % e.code)
    except Exception as e:
        errors.append('published ' + type(e).__name__)
    if cache_path and cache_path.exists():
        try:
            obj = json.loads(cache_path.read_text())
            if valid_state(obj):
                found.append(obj)
        except Exception as e:
            errors.append('cache ' + type(e).__name__)
    if found:
        return max(found, key=lambda o: o['updated']), errors
    return None, errors


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--latest', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--cache', type=Path)
    p.add_argument('--previous-url', default=PUBLIC_URL)
    a = p.parse_args()
    latest = json.loads(a.latest.read_text())
    now = int(time.time() * 1000)
    prev, errors = load_previous(a.previous_url, a.cache)
    if prev is None and errors:
        # A transient read failure must not silently restart the ledger.
        raise SystemExit('ICT-2 state unavailable (%s); not publishing a reset ledger' % ', '.join(errors))
    state = {k: v for k, v in (prev or fresh_state(now)).items() if k not in ('reports', 'metrics', 'label', 'rules')}
    out = step(state, latest, now)
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(body, encoding='utf-8')
    if a.cache:
        a.cache.parent.mkdir(parents=True, exist_ok=True)
        a.cache.write_text(body, encoding='utf-8')
    print(json.dumps({'ict2': VERSION, 'trades': len(out['trades']), 'open': out['metrics']['open'],
                      'stages': {r['symbol']: r['stage'] for r in out['reports']}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
