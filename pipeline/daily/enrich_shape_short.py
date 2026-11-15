"""Only supplement existing inline short replays; never rebuild base signals."""
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
import fetch, inject, cycles
from enrich_shape_history import enrich


def get(symbol,meta):
    if meta['provider']=='binance':
        fetch.fetch_binance(meta['ticker'],interval='4h')
        return fetch.LAST_HISTORY[(meta['ticker'],'4h')]
    return json.loads((cycles.PROFILE_DIR/(symbol+'-primary-source-history.json')).read_text())


def main():
    now=time.time();path=Path(inject.APP_HTML);document=path.read_text()
    data=json.loads(inject._APPDATA_RE.search(document).group(2));names=inject.load_meta_names()
    updates={};outcomes={}
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures={executor.submit(get,s,m):(s,m) for s,m in names.items()}
        for future in as_completed(futures):
            symbol,meta=futures[future]
            try:
                old=data['assets'][symbol]['replay']
                updates[symbol]=enrich(old,future.result(),meta,now)
                outcomes[symbol]={'status':'enriched','asof':old['asof']}
            except Exception as error:outcomes[symbol]={'status':'preserved','error':str(error)[:200]}
            print(symbol,outcomes[symbol],flush=True)
    if path.read_text()!=document:raise RuntimeError('app.html changed concurrently; no write performed')
    for symbol,result in updates.items():data['assets'][symbol]['replay']=result
    data['shapeShortEnrichment']={'generatedAt':datetime.fromtimestamp(now,timezone.utc).isoformat(),
        'scope':'supplemental-only-original-asof-unchanged','assets':outcomes}
    inject.inject(data)
    print('DONE',len(updates),'updated;',len(outcomes)-len(updates),'preserved',flush=True)

if __name__=='__main__':main()
