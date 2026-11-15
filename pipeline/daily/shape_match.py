"""Supplemental, descriptive multi-duration analogues; never a trading probability.

Each method has an independent shortlist. Only known close paths are scored.
Historical outcomes must finish BEFORE the reference begins. Original corr/DTW
statistics are deliberately untouched. No OHLC, volume or named pattern is invented.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo
import numpy as np

SCALES = (.75, 1., 1.25, 1.5)
POINTS = 32
PREFILTER = 48  # per independent method and duration, disclosed in output
METHODS = ('elastic', 'returns', 'pivots')
SPECS = {
    'elastic': {'label': '弹性路径', 'description': '32点对数收盘标准化路径；受限DTW，允许局部节奏伸缩'},
    'returns': {'label': '多尺度涨跌', 'description': '4/8/16段对数收益方向和相对幅度；保留段落顺序'},
    'pivots': {'label': '拐点结构', 'description': '12%窗口对数振幅的方向变化确认拐点；顺序、相对幅度、时长编辑距离'},
}


def normalized(values):
    values = np.asarray(values, float)
    sd = float(np.std(values))
    return (values - np.mean(values)) / sd if sd > 1e-12 else np.zeros_like(values)


def sampled(values, count=POINTS):
    return np.interp(np.linspace(0, len(values)-1, count), np.arange(len(values)), values)


def return_features(path):
    features = []
    for count in (4, 8, 16):
        returns = np.diff(sampled(path, count+1))
        norm = np.linalg.norm(returns)
        features.extend(returns/norm if norm > 1e-12 else returns*0)
    return np.asarray(features)


def confirmed_pivots(close):
    """Directional changes confirmed within THIS window; trailing extreme omitted.

Threshold depends on the known window, not an online trading rule. The returned
confirmation index is indispensable: a high is only known after the reversal.
    """
    values = np.log(np.asarray(close, float))
    span = float(np.ptp(values))
    if span < 1e-10:
        return []
    threshold = .12 * span
    direction, high, low, result = 0, 0, 0, []
    for i in range(1, len(values)):
        if direction == 0:
            if values[i] >= values[high]: high = i
            if values[i] <= values[low]: low = i
            if values[i]-values[low] >= threshold:
                result.append({'index': low, 'price': float(close[low]), 'type':'low', 'confirmedAt':i})
                direction, high = 1, i
            elif values[high]-values[i] >= threshold:
                result.append({'index': high, 'price':float(close[high]), 'type':'high', 'confirmedAt':i})
                direction, low = -1, i
        elif direction == 1:
            if values[i] >= values[high]: high = i
            elif values[high]-values[i] >= threshold:
                result.append({'index':high,'price':float(close[high]),'type':'high','confirmedAt':i})
                direction, low = -1, i
        else:
            if values[i] <= values[low]: low = i
            elif values[i]-values[low] >= threshold:
                result.append({'index':low,'price':float(close[low]),'type':'low','confirmedAt':i})
                direction, high = 1, i
    return result


def pivot_signature(close):
    pivots = confirmed_pivots(close)
    if len(pivots) < 3:
        return pivots, None
    values = np.log(np.asarray(close,float))
    span = float(np.ptp(values))
    points = []
    for previous, current in zip(pivots,pivots[1:]):
        points.append([(values[current['index']]-values[previous['index']])/span,
                       (current['index']-previous['index'])/(len(close)-1)])
    return pivots, np.asarray(points)


def pivot_distance(a, b):
    if a is None or b is None: return None
    # Edit alignment preserves event order, with insertion/deletion penalties.
    previous = np.arange(len(b)+1, dtype=float)
    for i, x in enumerate(a,1):
        current = np.full(len(b)+1, np.inf); current[0] = i
        for j, y in enumerate(b,1):
            cost = min(2., abs(x[0]-y[0]) + .5*abs(x[1]-y[1]) + (np.sign(x[0]) != np.sign(y[0]))*.5)
            current[j] = min(previous[j]+1, current[j-1]+1, previous[j-1]+cost)
        previous = current
    return float(previous[-1]/max(len(a),len(b)))


def elastic_distance(a,b):
    previous = np.full(len(b)+1,np.inf); previous[0]=0
    band = 5
    for i,x in enumerate(a,1):
        current = np.full(len(b)+1,np.inf)
        for j in range(max(1,i-band),min(len(b),i+band)+1):
            current[j] = abs(x-b[j-1])+min(previous[j],current[j-1],previous[j-1])
        previous=current
    return float(previous[-1]/len(a))


def _score(distance):
    return None if distance is None else round(float(100*np.exp(-distance)),4)


def _coarse_structure(paths):
    # A separate retrieval screen, not corr's shortlist. Event direction and
    # coarse turning locations; precise confirmed-pivot edit scores rerank it.
    d = np.diff(paths,axis=1)
    s = np.where(np.abs(d)>.08,np.sign(d),0)
    turns = s[:,1:]-s[:,:-1]
    return np.concatenate((s*.25,turns*.5),axis=1)


def build_shape_matches(rows, window, horizon, time_zone='UTC', interval='1d',
                        group='stock', session_ends=None, limit=4):
    n=len(rows); ref_start=n-window
    if window < 8 or horizon < 1 or n < window:
        raise ValueError('Invalid shape matching bounds')
    ts=np.asarray([r[0] for r in rows]); close=np.asarray([r[4] for r in rows],float)
    if not np.all(np.isfinite(close)) or np.any(close<=0) or np.any(np.diff(ts)<=0):
        raise ValueError('Invalid shape prices or timestamps')
    tz=ZoneInfo(time_zone)
    days=[datetime.fromtimestamp(int(t),tz).date() for t in ts]
    expected=7 if interval=='1w' else (1 if interval=='1d' and group=='crypto' else None)
    gaps=np.r_[0,np.cumsum(np.diff(ts)!=14400)] if interval=='4h' else np.r_[0,np.cumsum([(b-a).days!=expected for a,b in zip(days,days[1:])])] if expected else np.zeros(n,int)
    if gaps[-1]!=gaps[ref_start]: raise ValueError('Current shape window crosses a data gap')
    log=np.log(close); ref=normalized(sampled(log[ref_start:])); ref_returns=return_features(ref)
    current_pivots,ref_pivots=pivot_signature(close[ref_start:])
    ref_structure=_coarse_structure(ref[None,:])[0]
    pool={}; counts={}; lengths=sorted(set(max(8,round(window*s)) for s in SCALES))
    for length in lengths:
        ends=np.arange(length-1,ref_start-horizon,dtype=int)
        ends=ends[gaps[ends+horizon]==gaps[ends-length+1]]
        counts[str(length)]=len(ends)
        if not len(ends): continue
        positions=np.linspace(0,length-1,POINTS)
        lo=np.floor(positions).astype(int); hi=np.ceil(positions).astype(int); weight=positions-lo
        starts=ends-length+1
        paths=log[starts[:,None]+lo]*(1-weight)+log[starts[:,None]+hi]*weight
        sds=paths.std(axis=1); paths=(paths-paths.mean(axis=1)[:,None])/np.maximum(sds[:,None],1e-12)
        level_dist=np.mean((paths-ref)**2,axis=1)
        # Return screen uses exactly the same sampled paths as final score.
        rfeatures=np.vstack([return_features(p) for p in paths])
        return_dist=np.mean((rfeatures-ref_returns)**2,axis=1)
        structural=_coarse_structure(paths)
        pivot_dist=np.mean((structural-ref_structure)**2,axis=1)
        for distances in (level_dist,return_dist,pivot_dist):
            for index in np.argsort(distances,kind='stable')[:PREFILTER]:
                e=int(ends[index]); pool[(e,length)]=paths[index]
    entries=[]
    for (end,length),path in pool.items():
        start=end-length+1
        pivots,signature=pivot_signature(close[start:end+1])
        # Signature normalizes return magnitude within the window, so this is
        # shape rather than equal realized volatility; disclose this explicitly.
        scores={'elastic':_score(elastic_distance(ref,path)),
                'returns':_score(float(np.linalg.norm(return_features(path)-ref_returns)/np.sqrt(3))),
                'pivots':_score(pivot_distance(ref_pivots,signature))}
        entries.append(dict(end=end,start=start,window=length,scores=scores,pivots=pivots))
    cases={}
    for method in METHODS:
        ranked=sorted((e for e in entries if e['scores'][method] is not None),key=lambda e:(-e['scores'][method],e['end'],e['window']))
        selected=[]
        for e in ranked:
            if any(not(e['end']<x['start'] or e['start']>x['end']) for x in selected): continue
            selected.append(e)
            if len(selected)>=limit: break
        cases[method]=[]
        for e in selected:
            left=max(0,e['start']-window); right=e['end']+horizon+1
            assert right<=ref_start
            bars=rows[left:right]
            cases[method].append({'id':f"shape-{method}-{ts[e['end']]}-{e['window']}",
                'window':e['window'],'scale':e['window']/window,'start':e['start']-left,'end':e['end']-left,
                'startTime':int(ts[e['start']]),'endTime':int(ts[e['end']]),
                'endDate':session_ends[e['end']] if session_ends else days[e['end']].isoformat(),
                'score':e['scores'][method],'scores':e['scores'],'pivots':e['pivots'],'bars':bars})
    return {'version':1,'referenceWindow':window,'methods':list(METHODS),
            'specs':{key:dict(value,scoreRange=[0,100],higherIsBetter=True) for key,value in SPECS.items()},
            'cases':cases,'currentPivots':current_pivots,'scales':list(SCALES),
            'limits':{'prefilterPerMethodPerDuration':PREFILTER,'sampledPoints':POINTS,
                      'eligibleByLength':counts,'scoredCandidates':len(entries),'futureBeforeCurrent':True,
                      'uses':'close-only','scoreIsProbability':False,'pivotThresholdFraction':.12,
                      'namedPatternClassifier':False,'search':'independent bounded prefilters; not exhaustive DTW',
                      'volatilityNormalized':True}}
