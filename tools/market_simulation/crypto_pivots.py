"""Compare 1H price swing points with CVD and OI sampled at those SAME bars.

Anchor A may be days/weeks before B. There is no elapsed-time pairing cutoff.
History availability bounds evidence, not the definition of a divergence.
"""
HOUR = 3_600_000
LEFT = RIGHT = 2


def price_pivots(rows):
    points = []
    for i in range(LEFT, len(rows)):
        row, before, after = rows[i], rows[i-LEFT:i], rows[i+1:i+1+RIGHT]
        if any(r['cvdAnchor'] != row['cvdAnchor'] for r in before + after):
            continue
        for kind, field in [('low', 'low'), ('high', 'high')]:
            low = kind == 'low'
            turns = row[field] < min(r[field] for r in before) if low else row[field] > max(r[field] for r in before)
            holds = all(row[field] <= r[field] for r in after) if low else all(row[field] >= r[field] for r in after)
            if not turns or not holds:
                continue
            confirmed = len(after) == RIGHT
            points.append({'kind': kind, 'index': i, 'time': row['time'], 'barTime': row['time']-HOUR,
                           'price': row[field], 'cvd': row['cvd'], 'oi': row.get('oi'),
                           'oiUsd': row.get('oiUsd'), 'cvdAnchor': row['cvdAnchor'],
                           'pivotStatus': 'confirmed' if confirmed else 'provisional',
                           'pivotConfirmedAt': after[-1]['time'] if confirmed else None})
    return points


def compare_points(a, b, kind):
    """Same-bar samples; OI qualifies evidence rather than voting for a side."""
    if a['time'] >= b['time'] or a['cvdAnchor'] != b['cvdAnchor']:
        return {'comparable': False, 'reason': 'A/B不在同一段连续CVD上，或时间先后无效。'}
    pd, cd = b['price']-a['price'], b['cvd']-a['cvd']
    signal, label = 'none', '这两个价格拐点未满足CVD背离关系'
    if kind == 'low':
        if pd >= 0 and cd < 0:
            signal, label = 'bullish_absorption', '价格低点未下移，CVD低于前低对应值'
        elif pd < 0 and cd > 0:
            signal, label = 'bullish_exhaustion', '价格低点下移，CVD高于前低对应值'
    else:
        if pd <= 0 and cd > 0:
            signal, label = 'bearish_absorption', '价格高点未上移，CVD高于前高对应值'
        elif pd > 0 and cd < 0:
            signal, label = 'bearish_exhaustion', '价格高点上移，CVD低于前高对应值'
    result = {'comparable': True, 'signal': signal, 'label': label, 'cvdChange': cd,
              'priceChange': pd, 'priceChangePct': pd/a['price']*100,
              'elapsedHours': (b['time']-a['time'])/HOUR,
              'oiChange': None, 'oiChangePct': None}
    if a.get('oi') is not None and b.get('oi') is not None and a['oi'] > 0:
        result.update(oiChange=b['oi']-a['oi'], oiChangePct=(b['oi']/a['oi']-1)*100)
    return result


def pivot_comparisons(rows):
    pivots = price_pivots(rows)
    comparisons = []
    for b in pivots:
        candidates = [a for a in pivots if a['kind'] == b['kind'] and a['index'] < b['index']
                      and a['pivotConfirmedAt'] is not None and a['pivotConfirmedAt'] <= b['time']
                      and a['cvdAnchor'] == b['cvdAnchor']]
        if not candidates:
            continue
        low = b['kind'] == 'low'
        # Always compare the nearest confirmed same-type price pivot. Also retain
        # earlier structural anchors never breached between A and B: a minor
        # intervening turn must not discard last week's/previous day's major low.
        references = []
        for a in candidates:
            middle = rows[a['index']+1:b['index']+1]
            unbroken = all(r['low'] >= a['price'] for r in middle) if low else all(r['high'] <= a['price'] for r in middle)
            if a is candidates[-1] or unbroken:
                references.append((a, 'nearest' if a is candidates[-1] else 'unbroken_structure'))
        for a, role in references:
            result = compare_points(a, b, b['kind'])
            middle = rows[a['index']+1:b['index']]
            boundary = (max(r['high'] for r in middle) if low else min(r['low'] for r in middle)) if middle else None
            result.update(id=f"{b['kind']}:{a['time']}:{b['time']}", kind=b['kind'], a=a, b=b,
                          referenceRole=role, observedAt=b['time'], structurePrice=boundary,
                          status='no_divergence' if result['signal'] == 'none' else
                          'pivot_pending' if b['pivotStatus'] == 'provisional' else 'divergence')
            if result['signal'] != 'none':
                for later in rows[b['index']+1:]:
                    if later['cvdAnchor'] != b['cvdAnchor']:
                        result['status'] = 'data_gap'
                        break
                    broken = later['low'] < b['price'] if low else later['high'] > b['price']
                    if broken:
                        result.update(status='invalidated', invalidatedAt=later['time'])
                        break
                    breakout = boundary is not None and (later['close'] > boundary if low else later['close'] < boundary)
                    if breakout and 'breakoutAt' not in result:
                        result.update(status='breakout', breakoutAt=later['time'])
            comparisons.append(result)
    return pivots, comparisons[-120:]


def hourly_structure(rows, now):
    through = rows[-1]['time'] if rows else None
    pivots, comparisons = pivot_comparisons(rows)
    return {'schema': 'price-pivot-cvd-1h-v2', 'intervalMs': HOUR,
            'status': 'unavailable' if not rows else 'ok' if now-through <= HOUR+1_200_000 else 'stale',
            'fromTime': rows[0]['time']-HOUR if rows else None, 'through': through,
            'series': rows, 'pivots': pivots, 'comparisons': comparisons,
            'method': '1H价格拐点配对；A为前一同类拐点或尚未被价格突破的更早结构极值；两点间隔不限小时数。',
            'samplePolicy': '价格取该1H柱的低/高点；CVD和OI取同一根柱收盘边界的值，不冒充小时内极值成交瞬间的数据。',
            'pivotPolicy': '左侧2根识别拐点候选，右侧2根完整1H柱才确认；未确认拐点单独标记，背离成立不等于反转已完成。',
            'anchorPolicy': '同一连续1H样本中累加主动买量减卖量，不按小时或日期归零；跨缺口不配对，新快照统一重算A/B。',
            'coverageNote': '本轮最多回溯公开源可用的30天1H历史；这是数据覆盖边界，不是背离的固定比较窗口。OI是A/B时点存量，不要求与CVD同方向。'}
