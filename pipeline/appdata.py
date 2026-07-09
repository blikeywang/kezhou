# -*- coding: utf-8 -*-
import json, math
CP=json.load(open("crypto_payload.json")); CS=json.load(open("crypto_season.json"))
SP=json.load(open("stock_payload.json")); COM=json.load(open("commodities_payload.json"))
CHS=json.load(open("charts_slate.json"))

CH_H=[6,30,60,90,180]
ST_H=[5,10,21,42,63]

def binom_p(pup,n,p0):
    se=math.sqrt(p0*(1-p0)/n); return 1.0 if se==0 else 2*(1-0.5*(1+math.erf(abs(pup-p0)/se/math.sqrt(2))))
def sig(pup,n,p0):
    p=binom_p(pup,n,p0); return "★★" if p<0.05 else("★" if p<0.10 else "")

def morph(nc):
    n=len(nc);tot=nc[-1]/nc[0]-1;hi=max(nc);lo=min(nc);pos=(nc[-1]-lo)/(hi-lo) if hi>lo else .5
    recent=nc[-1]/nc[-max(5,n//6)]-1;dd=lo/hi-1
    tr_z="上行趋势" if tot>0.02 else("下行趋势" if tot<-0.02 else "横盘震荡")
    tr_e="Uptrend" if tot>0.02 else("Downtrend" if tot<-0.02 else "Range-bound")
    pp_z="接近区间高点" if pos>0.7 else("接近区间低点" if pos<0.3 else "居区间中部")
    pp_e="near range high" if pos>0.7 else("near range low" if pos<0.3 else "mid-range")
    rr_z="近端走强" if recent>0.01 else("近端回落" if recent<-0.01 else "近端走平")
    rr_e="strengthening lately" if recent>0.01 else("pulling back lately" if recent<-0.01 else "flat lately")
    z=f"{tr_z},窗口累计 {tot*100:+.1f}%;当前价{pp_z}(分位 {pos*100:.0f}%),{rr_z}。期间最大回撤 {dd*100:.1f}%。"
    e=f"{tr_e}; window return {tot*100:+.1f}%. Price {pp_e} (percentile {pos*100:.0f}%), {rr_e}. Max drawdown {dd*100:.1f}%."
    return z,e

def verdict(condC,bas,cr,grp):
    edge=condC[2][1]-bas[2][1]; q=cr[1]
    qk="high" if q>(0.9 if grp=="crypto" else 0.8) else("mid" if q>(0.75 if grp=="crypto" else 0.65) else "low")
    if edge>0.05: vk,c=("bull","up") if q>(0.9 if grp=="crypto" else 0.7) else ("bullweak","up")
    elif edge<-0.05: vk,c="below","dn"
    else: vk,c="neutral","mut"
    return vk,c,qk

def build_asset(k,nz,ne,grp,P,S,H,n):
    condC=P["condC"]; condD=P["condD"]; bas=P["bas"]
    cond=[]
    for i,h in enumerate(H):
        c=condC[i]; d=condD[i]; b=bas[i]
        cond.append([round(c[1]*100), round(c[2]*1000)/10, sig(c[1],n,b[1]),
                     round(d[1]*100), round(d[2]*1000)/10, sig(d[1],n,b[1]),
                     round(b[1]*100), round(b[2]*1000)/10, round(c[3]*1000)/10, round(c[4]*1000)/10])
    skeys=["7","30","90"] if grp=="crypto" else ["5","21","63"]
    season=[[round(S["sum"][key][0]*100), round(S["sum"][key][1]*1000)/10, S["sum"][key][2]] for key in skeys]
    if grp=="crypto":
        matches=[[m[0],m[1],round(m[2]*1000)/10,round(m[3]*1000)/10,round(m[4]*1000)/10,round(m[5]*1000)/10] for m in P["mC"][:6]]
    else:
        matches=[[m[0],m[1],round(m[2]*1000)/10,round(m[3]*1000)/10,round(m[4]*1000)/10] for m in P["mC"][:6]]
    vk,vc,qk=verdict(condC,bas,P["corrRange"],grp)
    mz,me=morph(P["nc"])
    return dict(k=k,nz=nz,ne=ne,grp=grp,refRange=P["refRange"],last=P["lastClose"],
        corr=[P["corrRange"][0],P["corrRange"][1]],vk=vk,vc=vc,qk=qk,
        midp=round(condC[2][1]*100),basmid=round(bas[2][1]*100),
        mz=mz,me=me,cond=cond,season=season,matches=matches,chart=k)

REAL={
 "crypto":[("BTC","比特币","Bitcoin"),("ETH","以太坊","Ethereum"),("SOL","Solana","Solana")],
 "stock":[("AAPL","苹果","Apple"),("NVDA","英伟达","NVIDIA"),("SPY","标普500 ETF","S&P 500 ETF"),("QQQ","纳指100 ETF","Nasdaq-100 ETF"),("DJI","道琼斯指数","Dow Jones"),("IXIC","纳指综合","Nasdaq Composite")],
 "commodity":[("GLD","黄金 GLD","Gold (GLD)"),("USO","原油 USO","Oil (USO)"),("SLV","白银 SLV","Silver (SLV)")],
}
PRIMS={"crypto":CP["PRIM"],"stock":SP["PRIM"],"commodity":COM["PRIM"]}
SEAS ={"crypto":CS,"stock":SP["SEASON"],"commodity":COM["SEASON"]}
HZ   ={"crypto":CH_H,"stock":ST_H,"commodity":ST_H}
NN   ={"crypto":50,"stock":40,"commodity":40}

ASSETS={}
for grp,lst in REAL.items():
    for k,nz,ne in lst:
        ASSETS[k]=build_asset(k,nz,ne,grp,PRIMS[grp][k],SEAS[grp][k],HZ[grp],NN[grp])

DEMO={
 "crypto":[("BNB","BNB","BNB","ETH"),("XRP","瑞波 XRP","Ripple","SOL"),("ADA","艾达 ADA","Cardano","ETH"),("DOGE","狗狗币","Dogecoin","SOL"),("AVAX","雪崩 AVAX","Avalanche","BTC")],
 "stock":[("MSFT","微软","Microsoft","AAPL"),("TSLA","特斯拉","Tesla","NVDA"),("AMZN","亚马逊","Amazon","QQQ"),("GOOGL","谷歌","Alphabet","IXIC"),("META","Meta","Meta","AAPL")],
 "commodity":[("HG","铜","Copper","SLV"),("NG","天然气","Natural Gas","USO"),("ZC","玉米","Corn","GLD"),("KC","咖啡","Coffee","USO")],
}
CATS={}
for grp in REAL:
    lst=[{"k":k,"nz":nz,"ne":ne,"demo":False,"tmpl":k} for k,nz,ne in REAL[grp]]
    for k,nz,ne,tp in DEMO[grp]:
        lst.append({"k":k,"nz":nz,"ne":ne,"demo":True,"tmpl":tp})
    CATS[grp]=lst

ICONS={"BTC":"currency-bitcoin","ETH":"currency-ethereum","SOL":"sun","BNB":"hexagon","XRP":"circle","ADA":"triangle","DOGE":"dog","AVAX":"mountain",
 "AAPL":"brand-apple","NVDA":"cpu","SPY":"chart-candle","QQQ":"chart-line","DJI":"building-bank","IXIC":"chart-histogram","MSFT":"brand-windows","TSLA":"car","AMZN":"brand-amazon","GOOGL":"brand-google","META":"brand-meta",
 "GLD":"coin","USO":"droplet","SLV":"coin","HG":"flame","NG":"flame","ZC":"plant","KC":"coffee"}

out=dict(assets=ASSETS,cats=CATS,icons=ICONS,charts={"dark":CHS["dark"],"light":CHS["light"]})
json.dump(out,open("appdata.json","w"),ensure_ascii=False)
print("assets",len(ASSETS),"cats",{g:len(CATS[g]) for g in CATS})
