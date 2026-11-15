"""Evidence-only enrichment: never refresh base signals, outcomes, charts or trades.
Fetch full primary daily source once; supplement existing snapshots at THEIR asof.
Fail closed on provider revisions to existing evidence; preserve all old fields.
"""
from __future__ import annotations
import copy
import math
import json
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import cycles, fetch, inject, history_coverage
from shape_match import build_shape_matches


def enrich(snapshot, history, meta, now):
    # Reaggregate at recorded observation cutoff, not today's moving window.
    if snapshot['interval']=='1w':
        source=cycles.weekly_history(history,meta['grp'],now)
    else: source=history
    bars=[r for r in source['bars'] if r[0]<=snapshot['asof']]
    if not bars or bars[-1][0]!=snapshot['asof']:
        raise ValueError('Recorded asof not present in source')
    lookup={r[0]:r for r in bars}
    evidence=[snapshot['current'], *sum(snapshot['cases'].values(),[]), *sum(snapshot.get('annualCases',{}).values(),[])]
    for segment in evidence:
        for row in segment['bars']:
            actual=lookup.get(row[0])
            equal=actual is not None and len(actual)==len(row) and actual[0]==row[0] and all(
                a==b or (isinstance(a,(int,float)) and isinstance(b,(int,float))
                and math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-9)) for a,b in zip(actual,row))
            if not equal:
                raise ValueError('Source revised existing evidence; retained original snapshot')
    session_ends=source.get('sessionEnds')
    if session_ends:session_ends=session_ends[:len(bars)]
    result=copy.deepcopy(snapshot)
    result['shapeMatches']=build_shape_matches(bars,snapshot['window'],max(snapshot['horizons']),
        source['timeZone'],snapshot['interval'],meta['grp'],session_ends)
    result['shapeGeneratedAt']=datetime.fromtimestamp(now,timezone.utc).isoformat()
    # Existing current/cases/probabilities are invariant, not silently recomputed.
    assert {k:v for k,v in result.items() if k not in ('shapeMatches','shapeGeneratedAt')} == {k:v for k,v in snapshot.items() if k not in ('shapeMatches','shapeGeneratedAt')}
    return result


def get_history(symbol,meta):
    if meta['provider']=='binance':
        fetch.fetch_binance(meta['ticker'],interval='1d')
        return fetch.LAST_HISTORY[(meta['ticker'],'1d')]
    fetch.fetch_symbol(symbol)
    return fetch.LAST_HISTORY[meta['ticker']]


def save(path,value):
    temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False))
    temporary.replace(path)


def main():
    now=time.time();stamp=datetime.fromtimestamp(now,timezone.utc).isoformat()
    names=inject.load_meta_names(); outcomes={}; descriptors={}
    with ThreadPoolExecutor(max_workers=4) as executor:
        pending={executor.submit(get_history,s,m):(s,m) for s,m in names.items()}
        for future in as_completed(pending):
            symbol,meta=pending[future]
            try:
                history=future.result()
                history['coverage']=history_coverage.audit(symbol,meta,history,'1d',now)
                archive=cycles.PROFILE_DIR/(symbol+'-primary-source-history.json')
                save(archive,dict(history,symbol=symbol,interval='1d',generatedAt=stamp))
                descriptors[symbol]={'url':'./history-profiles/'+archive.name,'source':history['source'],
                    'dataKind':history.get('dataKind','ohlcv'),'generatedAt':stamp,
                    'first':history['coverage']['first'],'last':history['coverage']['last'],'bars':len(history['bars'])}
                outcomes[symbol]={'source':descriptors[symbol],'profiles':{}}
                for key in cycles.configurations(meta['grp']):
                    path=cycles.PROFILE_DIR/(symbol+'-'+key+'.json')
                    try:
                        old=json.loads(path.read_text())
                        new=enrich(old,history,meta,now)
                        save(path,new)
                        outcomes[symbol]['profiles'][key]={'status':'enriched','asof':old['asof'],'candidates':new['shapeMatches']['limits']['scoredCandidates']}
                    except Exception as error:
                        outcomes[symbol]['profiles'][key]={'status':'preserved','error':str(error)[:200]}
                print(symbol,outcomes[symbol]['profiles'],flush=True)
            except Exception as error:
                outcomes[symbol]={'error':str(error)[:300]};print(symbol,'ERROR',str(error)[:120],flush=True)
    # No HTML modification: coordinator merges links only after concurrent source
    # backfill is done; source descriptors and audit are an explicit handoff.
    report={'generatedAt':stamp,'scope':'supplemental-shape-and-source-history-only','assets':outcomes,'descriptors':descriptors}
    save(cycles.PROFILE_DIR/'shape-enrichment-audit.json',report)
    print('DONE',len(outcomes),'assets',flush=True)


if __name__=='__main__': main()
