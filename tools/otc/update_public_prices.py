"""Bounded, unauthenticated public daily bars. Never fetches OTC or account data."""
import argparse
import json
import math
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

START = '2025-01-01'
CRYPTO = set('BTC ETH BNB SOL DOGE LTC PEPE SUI ZEC UNI ADA AAVE AVAX BCH CFX CRV ENA FARTCOIN FLOKI KAITO LDO LINK ONDO RAY SEI TRUMP VIRTUAL WLD PUMP HYPE'.split())
STOCKS = set('AAOI AAPL AMZN AXTI BABA COIN GLW GOOG HOOD MSFT MU NVDA PLTR SNDK TSLA'.split())
UA = 'Mozilla/5.0 (compatible; TraderHomeResearch/1.0)'

def get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent':UA,'Accept':'application/json'})
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)

def validate_bars(bars):
    result = {}
    for b in bars:
        datetime.strptime(b['date'], '%Y-%m-%d')
        if not all(isinstance(b[k], (int,float)) and math.isfinite(b[k]) and b[k]>0 for k in ['open','high','low','close']):
            raise ValueError('Non-finite or non-positive OHLC')
        if not b['low']<=min(b['open'],b['close'])<=max(b['open'],b['close'])<=b['high']:
            raise ValueError('OHLC range conflict')
        if b['date'] in result:
            raise ValueError('Duplicate bar date')
        result[b['date']] = b
    return sorted(result.values(),key=lambda b:b['date'])

def binance_bars(raw, now):
    if not isinstance(raw,list):
        raise ValueError('Unexpected Binance response')
    return validate_bars([{'date':datetime.fromtimestamp(r[0]/1000,timezone.utc).date().isoformat(),
        'open':float(r[1]),'high':float(r[2]),'low':float(r[3]),'close':float(r[4])} for r in raw if r[6]/1000 < now])

def yahoo_bars(raw, symbol, now):
    result = raw['chart']['result'][0]
    meta = result['meta']
    if meta['symbol'].upper()!=symbol.upper() or meta.get('instrumentType')!='EQUITY':
        raise ValueError('Provider symbol or instrument type mismatch')
    tz = ZoneInfo(meta['exchangeTimezoneName'])
    local_today = datetime.fromtimestamp(now,tz).date().isoformat()
    end = meta.get('currentTradingPeriod',{}).get('regular',{}).get('end')
    end_date = datetime.fromtimestamp(end,tz).date().isoformat() if end else None
    quote = result['indicators']['quote'][0]
    bars = []
    for i,stamp in enumerate(result.get('timestamp',[])):
        dt = datetime.fromtimestamp(stamp,tz)
        date = dt.date().isoformat()
        if date<START or date>local_today or dt.weekday()>4:
            continue
        # Same-session bars are only admitted after the official session end
        # reported by the provider, plus a 20-minute publication buffer.
        if date==local_today and not (end and end_date==date and now>end+1200):
            continue
        b={'date':date,**{k:quote[k][i] for k in ['open','high','low','close']}}
        if any(v is None for v in b.values()):
            continue
        bars.append(b)
    return validate_bars(bars),meta

def mapping(asset):
    symbol = asset.lstrip('$').upper()
    if symbol in CRYPTO:
        return 'binance',symbol+'USDT'
    if symbol in STOCKS:
        return 'yahoo',symbol
    return None

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--data-dir',type=Path,required=True)
    parser.add_argument('--assets',help='Optional comma-separated asset ids for a bounded refresh')
    args=parser.parse_args()
    snapshot=json.loads((args.data_dir/'snapshot.json').read_text())
    target=args.data_dir/'prices.json'
    previous=json.loads(target.read_text()) if target.exists() else {'assets':{}}
    now=time.time()
    checked=datetime.fromtimestamp(now,timezone.utc).isoformat(timespec='seconds')
    output={'schema':'traderhome_public_prices_v1','checkedAt':checked,'schedule':'每日 00:35 / 06:30 UTC，收盘后抓取已闭合日K；定时任务可能延迟。','assets':previous['assets']}
    selected=set(args.assets.split(',')) if args.assets else None
    successes=0
    blocked=set()
    for asset in snapshot['assets']:
        name=asset['id']
        if selected and name not in selected:
            continue
        route=mapping(name)
        if not route:
            continue
        provider,symbol=route
        old=output['assets'].get(name,{})
        row={**old,'provider':provider,'symbol':symbol,'checkedAt':checked,'status':'error'}
        try:
            if provider in blocked:
                raise ValueError('本轮该源已限流/拒绝访问，跳过后续请求')
            if provider=='binance':
                start=old['bars'][-14]['date'] if len(old.get('bars',[]))>=14 else START
                params=urllib.parse.urlencode({'symbol':symbol,'interval':'1d','startTime':int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp()*1000),'limit':1000})
                url='https://data-api.binance.vision/api/v3/klines?'+params
                bars=binance_bars(get_json(url),now)
                combined={b['date']:b for b in old.get('bars',[])}
                combined.update({b['date']:b for b in bars})
                bars=validate_bars(list(combined.values()))
                label=f'Binance {symbol} 现货 · UTC 已闭合日K · USDT'
                zone,currency='UTC','USDT'
            else:
                params=urllib.parse.urlencode({'period1':int(datetime.fromisoformat(START).replace(tzinfo=timezone.utc).timestamp()),'period2':int(now),'interval':'1d','includePrePost':'false','includeAdjustedClose':'false'})
                url=f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?'+params
                bars,meta=yahoo_bars(get_json(url),symbol,now)
                zone,currency=meta['exchangeTimezoneName'],meta.get('currency','未披露')
                label=f'Yahoo Finance {symbol} · {meta.get("fullExchangeName", "股票")} · {zone} 正规时段 · 原始OHLC（不以复权收盘缩放） · {currency}'
            if not bars:
                raise ValueError('No completed daily bars')
            row.update({'status':'ok','bars':bars,'latestDate':bars[-1]['date'],'updatedAt':checked,'source':url,'label':label,'timezone':zone,'currency':currency,'error':None})
            successes+=1
        except Exception as exc:
            if isinstance(exc,urllib.error.HTTPError) and exc.code in (403,429,451):
                blocked.add(provider)
            row['error']=str(exc)[:160]
            # Old bars retain their original dates and updatedAt. A failed
            # check is never represented as a successful market-data update.
        output['assets'][name]=row
        time.sleep(.18)
    output['successfulAssets']=sum(r.get('status')=='ok' for r in output['assets'].values())
    output['failedAssets']=sum(r.get('status')!='ok' for r in output['assets'].values())
    args.data_dir.mkdir(parents=True,exist_ok=True)
    temp=target.with_suffix('.tmp')
    temp.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n')
    temp.replace(target)
    print(json.dumps({'updated':successes,'available':len(output['assets']),'failed':output['failedAssets'],'checkedAt':checked}))

if __name__=='__main__':
    main()
