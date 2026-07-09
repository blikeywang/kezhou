# -*- coding: utf-8 -*-
import json, math
CP=json.load(open("crypto_payload.json")); CS=json.load(open("crypto_season.json"))
SP=json.load(open("stock_payload.json")); CH=json.load(open("charts2.json"))

CRYPTO_H=[6,30,60,90,180]; CRYPTO_HL={6:"1天",30:"5天",60:"10天",90:"15天",180:"30天"}
STOCK_H=[5,10,21,42,63]; STOCK_HL={5:"1周",10:"2周",21:"1月",42:"2月",63:"3月"}
CN={"BTC":"比特币","ETH":"以太坊","SOL":"Solana","AAPL":"苹果","NVDA":"英伟达","SPY":"标普500 ETF","QQQ":"纳指100 ETF","DJI":"道琼斯指数","IXIC":"纳指综合"}
ICON={"BTC":"currency-bitcoin","ETH":"currency-ethereum","SOL":"sun","AAPL":"brand-apple","NVDA":"cpu","SPY":"chart-candle","QQQ":"chart-line","DJI":"building-bank","IXIC":"chart-histogram"}

ASSETS=[]
for k in ["BTC","ETH","SOL"]:
    ASSETS.append(dict(k=k,grp="crypto",P=CP["PRIM"][k],S=CS[k],H=CRYPTO_H,HL=CRYPTO_HL,n=50,tf="4小时线 · 60根"))
for k in ["AAPL","NVDA","SPY","QQQ","DJI","IXIC"]:
    ASSETS.append(dict(k=k,grp="stock",P=SP["PRIM"][k],S=SP["SEASON"][k],H=STOCK_H,HL=STOCK_HL,n=40,tf="日线 · 40根"))

def binom_p(pup,n,p0):
    se=math.sqrt(p0*(1-p0)/n);  return 1.0 if se==0 else 2*(1-0.5*(1+math.erf(abs(pup-p0)/se/math.sqrt(2))))
def sig(pup,n,p0):
    p=binom_p(pup,n,p0); return "★★" if p<0.05 else("★" if p<0.10 else "")
def pc(x): return f"{x*100:+.1f}%"
def col(x): return "up" if x>0 else("dn" if x<0 else "")
def img(key,alt):
    return (f"<img class='ch only-light' loading='lazy' alt='{alt}' src='{CH['light'][key]}'>"
            f"<img class='ch only-dark' loading='lazy' alt='{alt}' src='{CH['dark'][key]}'>")

def morph(nc):
    n=len(nc);tot=nc[-1]/nc[0]-1;hi=max(nc);lo=min(nc)
    pos=(nc[-1]-lo)/(hi-lo) if hi>lo else .5
    recent=nc[-1]/nc[-max(5,n//6)]-1; dd=lo/hi-1
    tr="上行趋势" if tot>0.02 else("下行趋势" if tot<-0.02 else "横盘震荡")
    pp="接近区间高点" if pos>0.7 else("接近区间低点" if pos<0.3 else "居区间中部")
    rr="近端走强" if recent>0.01 else("近端回落" if recent<-0.01 else "近端走平")
    return tot,pos,dd,tr,pp,rr
def cfgkey(a): return ({"BTC":"BTCUSDT","ETH":"ETHUSDT","SOL":"SOLUSDT"}[a["k"]]+"_4h_60") if a["grp"]=="crypto" else a["k"]+"_1d_40"
def mat(a): return CP["MATRIX"] if a["grp"]=="crypto" else SP["MATRIX"]
def verdict(a):
    M=mat(a)[cfgkey(a)]; edge=M["corr"][2]-M["bas"][1]; q=M["cR"][1]; midp=M["corr"][2]
    if a["grp"]=="crypto": qtxt="相似度高" if q>0.9 else("中等" if q>0.75 else "偏低")
    else: qtxt="相似度高" if q>0.8 else("中等" if q>0.65 else "偏低·类比弱")
    if edge>0.05: t,c=("偏多","up") if q>(0.9 if a["grp"]=="crypto" else 0.7) else ("偏多·弱","up")
    elif edge<-0.05: t,c="弱于基准","dn"
    else: t,c="中性","mut"
    return t,c,midp,M["bas"][1],qtxt

def chips():
    h=""
    for a in ASSETS:
        t,c,mp,bp,qt=verdict(a)
        h+=f"""<a class='chip {c}' href='#a-{a['k']}'><div class='chip-t'><i class='ti ti-{ICON[a['k']]}'></i><span class='ck'>{a['k']}</span><span class='cn'>{CN[a['k']]}</span></div>
        <div class='cv'>{t}</div><div class='cd'>中期涨 <b>{mp*100:.0f}%</b> <span>基准{bp*100:.0f}%</span></div><div class='cq'>{qt}</div></a>"""
    return h

def matrix_table(grp):
    rows=""
    if grp=="crypto":
        syms=[("BTC","BTCUSDT"),("ETH","ETHUSDT"),("SOL","SOLUSDT")]; cfgs=[("4h × 60","4h_60"),("4h × 30","4h_30"),("日线 × 60","1d_60")]; M=CP["MATRIX"]; qhi=0.9;qmid=0.75
    else:
        syms=[(s,s) for s in ["AAPL","NVDA","SPY","QQQ","DJI","IXIC"]]; cfgs=[("日线 × 40","1d_40"),("日线 × 30","1d_30"),("周线 × 30","1wk_30")]; M=SP["MATRIX"]; qhi=0.8;qmid=0.65
    for disp,sym in syms:
        first=True
        for cl,ck in cfgs:
            e=M[sym+"_"+ck]
            def cell(p,b):
                edge=p-b; cls="hot" if edge>0.08 else("warm" if edge>0.03 else("cold" if edge<-0.03 else ""))
                return f"<td class='n {cls}'>{p*100:.0f}<i>{b*100:.0f}</i></td>"
            c=e["corr"]; d=e["dtw"]; b=e["bas"]; q=e["cR"][1]
            qb="qhi" if q>qhi else("qmid" if q>qmid else "qlo")
            head=f"<td class='sym' rowspan='3'><i class='ti ti-{ICON[disp]}'></i>{disp}<span>{CN[disp]}</span></td>" if first else ""
            rows+=f"<tr>{head}<td class='cfg'>{cl}</td>{cell(c[0],b[0])}{cell(c[2],b[1])}{cell(c[4],b[2])}{cell(d[0],b[0])}{cell(d[2],b[1])}{cell(d[4],b[2])}<td class='q {qb}'>{q:.2f}</td></tr>"
            first=False
    return rows

def cond_rows(a):
    P=a["P"]; n=a["n"]; out=""
    for i,h in enumerate(a["H"]):
        c=P["condC"][i]; d=P["condD"][i]; b=P["bas"][i]
        out+=f"""<tr><td>{a['HL'][h]}</td>
        <td class='n'><b>{c[1]*100:.0f}%</b> <s>{sig(c[1],n,b[1])}</s></td><td class='n {col(c[2])}'>{pc(c[2])}</td>
        <td class='n'><b>{d[1]*100:.0f}%</b> <s>{sig(d[1],n,b[1])}</s></td><td class='n {col(d[2])}'>{pc(d[2])}</td>
        <td class='n mut'>{b[1]*100:.0f}%</td><td class='n mut'>{pc(b[2])}</td><td class='n mut'>{pc(c[3])} … {pc(c[4])}</td></tr>"""
    return out
def season_rows(a):
    s=a["S"]["sum"]; out=""
    order=[("7","7天"),("30","30天"),("90","90天")] if a["grp"]=="crypto" else [("5","1周"),("21","1月"),("63","3月")]
    for key,lab in order:
        pu,md,nn=s[key]
        out+=f"<tr><td>{lab}</td><td class='n'>{pu*100:.0f}%</td><td class='n {col(md)}'>{pc(md)}</td><td class='n mut'>{nn}</td></tr>"
    return out
def match_rows(a):
    out=""
    if a["grp"]=="crypto":
        hd=["历史日期","相关","+1天","+10天","+30天","回撤"]
        for m in a["P"]["mC"][:6]:
            out+=f"<tr><td>{m[0]}</td><td class='n'>{m[1]:.2f}</td><td class='n {col(m[2])}'>{pc(m[2])}</td><td class='n {col(m[3])}'>{pc(m[3])}</td><td class='n {col(m[4])}'>{pc(m[4])}</td><td class='n dn'>{pc(m[5])}</td></tr>"
    else:
        hd=["历史日期","相关","+1月","+3月","回撤"]
        for m in a["P"]["mC"][:6]:
            out+=f"<tr><td>{m[0]}</td><td class='n'>{m[1]:.2f}</td><td class='n {col(m[2])}'>{pc(m[2])}</td><td class='n {col(m[3])}'>{pc(m[3])}</td><td class='n dn'>{pc(m[4])}</td></tr>"
    return hd,out

ONELINERS={
 "BTC":"震荡后爬升至局部高位、近端小回落。corr 与 DTW 一致指向<b>中期偏多</b>——5–10天上涨概率 68–72%,显著高于基准 ~53%,相似度极高。",
 "ETH":"强势拉升后高位盘整。方向偏多但<b>离散度极大</b>(10天涨概率 60%,分位从 −5% 到 +15%),超额有限。",
 "SOL":"高位宽幅震荡。近端 corr 68%,中远期 56–60%、中位涨幅可观但回撤大,相似度高、波动最猛。",
 "AAPL":"V型急跌后修复至近高位。<b>短线偏弱</b>(1–2周涨概率≤55%、低于基准),3月转强(67–68%)。",
 "NVDA":"深调后处窗口低位。<b>短线强</b>——1周 corr 80%、中位 +5.4%,相似度较高,但个股基本面权重大。",
 "SPY":"低波慢涨近高位。各周期涨概率高(70–78%),<b>但≈基准(慢牛惯性)且相似度偏低</b>,非独特信号。",
 "QQQ":"与 SPY 类似的慢牛结构,远期(3月)涨概率 80–82%,略高于基准,相似度偏低。",
 "DJI":"当前形态<b>相似度很高(0.85–0.96)</b>,但类比之后<b>弱于基准</b>(3月 60% vs 基准 72%)——少见负向信号,警惕。",
 "IXIC":"远期(3月)涨概率 78–83%、明显高于基准,近端中性,相似度中等。",
}

def asset_section(a):
    P=a["P"]; tot,pos,dd,tr,pp,rr=morph(P["nc"]); t,c,mp,bp,qt=verdict(a)
    hd,mr=match_rows(a); mh="".join(f"<th>{x}</th>" for x in hd); cr=P["corrRange"]
    return f"""
    <article class='asset' id='a-{a['k']}' data-grp='{a['grp']}'>
      <header class='ahead'>
        <div class='atitle'><span class='asym'><i class='ti ti-{ICON[a['k']]}'></i>{a['k']}</span><span class='cn2'>{CN[a['k']]}</span></div>
        <div class='averd {c}'>{t}</div>
      </header>
      <div class='ameta'>{a['tf']} · 参考 {P['refRange'][0]} → {P['refRange'][1]} · 相似度 {cr[0]:.2f}–{cr[1]:.2f}</div>
      <div class='chart'>{img(a['k'], a['k']+' 形态与前瞻概率图')}</div>
      <div class='agrid'>
        <div>
          <h4>形态拆解</h4>
          <p class='body'>{tr},窗口累计 <b class='{col(tot)}'>{pc(tot)}</b>;当前价{pp}(分位 {pos*100:.0f}%),{rr}。期间最大回撤 <b class='dn'>{pc(dd)}</b>。匹配相似度{qt}。</p>
          <h4>同期季节性</h4>
          <div class='tw'><table class='t'><thead><tr><th>此后</th><th>上涨年%</th><th>中位</th><th>样本</th></tr></thead><tbody>{season_rows(a)}</tbody></table></div>
          <h4>最相似历史片段(相关系数)</h4>
          <div class='tw'><table class='t sm'><thead><tr>{mh}</tr></thead><tbody>{mr}</tbody></table></div>
        </div>
        <div>
          <h4>相似结构 → 前瞻概率 <span class='hint'>corr / DTW / 基准</span></h4>
          <div class='tw'><table class='t'><thead><tr><th>前瞻</th><th>涨概率<br>corr</th><th>corr<br>中位</th><th>涨概率<br>DTW</th><th>DTW<br>中位</th><th>基准</th><th>基准<br>中位</th><th>corr 25–75%</th></tr></thead><tbody>{cond_rows(a)}</tbody></table></div>
          <p class='note'>★ p&lt;0.10,★★ p&lt;0.05(二项近似;窗口重叠→有效样本更小)。corr 与 DTW 方向越一致越可信。</p>
        </div>
      </div>
    </article>"""

def oneliners():
    return "".join(f"<li><span class='ol-k'>{a['k']}</span> {CN[a['k']]}:{ONELINERS[a['k']]}</li>" for a in ASSETS)
def all_assets(): return "".join(asset_section(a) for a in ASSETS)

CSS=r"""
*{box-sizing:border-box}
:root{
 --maxw:1200px; --r:14px;
 --bg:#faf8f4; --bg2:#f1ede4; --pan:#ffffff; --pan2:#fbfaf7; --ink:#1d222c; --ink2:#41485a; --mut:#8b8f9c;
 --line:#e9e4d9; --line2:#ded8ca; --acc:#4f46e5; --acc2:#c2410c; --up:#0e9f6e; --dn:#e02424; --gold:#b45309;
 --hot:rgba(14,159,110,.20); --warm:rgba(14,159,110,.09); --cold:rgba(224,36,36,.11);
 --shadow:0 1px 3px rgba(60,50,30,.06),0 8px 24px rgba(60,50,30,.05);
 --head-bg:rgba(250,248,244,.82);
}
html[data-theme=dark]{
 --bg:#0a0e1a; --bg2:#0e1424; --pan:#121a2e; --pan2:#0f1728; --ink:#e8edf7; --ink2:#b7c1d6; --mut:#7f8fac;
 --line:#213049; --line2:#2b3b57; --acc:#38bdf8; --acc2:#a78bfa; --up:#34d399; --dn:#fb7185; --gold:#fbbf24;
 --hot:rgba(52,211,153,.26); --warm:rgba(52,211,153,.12); --cold:rgba(251,113,133,.17);
 --shadow:0 1px 2px rgba(0,0,0,.4),0 14px 40px rgba(0,0,0,.4);
 --head-bg:rgba(10,14,26,.8);
}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Segoe UI,Roboto,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased}
html[data-theme=dark] body{background:radial-gradient(1100px 560px at 14% -12%,#152244 0%,#0a0e1a 55%)}
a{color:inherit;text-decoration:none}
.only-dark{display:none}.only-light{display:block}
html[data-theme=dark] .only-dark{display:block}html[data-theme=dark] .only-light{display:none}

.head{position:sticky;top:0;z-index:40;background:var(--head-bg);backdrop-filter:saturate(140%) blur(10px);-webkit-backdrop-filter:saturate(140%) blur(10px);border-bottom:1px solid var(--line)}
.head-in{max-width:var(--maxw);margin:0 auto;display:flex;align-items:center;gap:14px;padding:11px 20px}
.brand{display:flex;align-items:center;gap:9px;font-weight:500;font-size:15px;white-space:nowrap}
.brand i{color:var(--acc);font-size:19px}
.nav{display:flex;gap:2px;margin-left:6px;overflow-x:auto;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav a{padding:6px 11px;border-radius:9px;font-size:13px;color:var(--ink2);white-space:nowrap}
.nav a:hover{background:var(--bg2);color:var(--ink)}
.nav a.on{color:var(--acc);background:var(--bg2)}
.hspace{flex:1}
.tbtn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line2);background:var(--pan);color:var(--ink);border-radius:20px;padding:6px 12px;font-size:12.5px;cursor:pointer;transition:.15s}
.tbtn:hover{border-color:var(--acc);color:var(--acc)}
.tbtn .ti{font-size:16px}

.wrap{max-width:var(--maxw);margin:0 auto;padding:26px 20px 90px}
.hero{padding:20px 2px 6px}
.kick{font-size:11.5px;letter-spacing:3px;text-transform:uppercase;color:var(--acc2);font-weight:500}
.hero h1{font-size:clamp(24px,4.4vw,36px);line-height:1.14;margin:10px 0 8px;font-weight:500;letter-spacing:.2px}
.hero p{color:var(--ink2);font-size:clamp(13px,1.6vw,14.5px);max-width:820px;margin:0}
.badges{margin-top:14px;display:flex;flex-wrap:wrap;gap:8px}
.badge{font-size:11px;color:var(--ink2);border:1px solid var(--line);background:var(--pan2);padding:4px 11px;border-radius:20px;font-variant-numeric:tabular-nums}

.chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:12px;margin:22px 0 6px}
.chip{background:var(--pan);border:1px solid var(--line);border-radius:var(--r);padding:13px 14px;box-shadow:var(--shadow);position:relative;overflow:hidden;transition:.15s;border-top-width:3px}
.chip:hover{transform:translateY(-2px);border-color:var(--line2)}
.chip.up{border-top-color:var(--up)}.chip.dn{border-top-color:var(--dn)}.chip.mut{border-top-color:var(--mut)}
.chip-t{display:flex;align-items:center;gap:6px}
.chip-t i{color:var(--mut);font-size:16px}.chip .ck{font-weight:500;font-size:15px}.chip .cn{color:var(--mut);font-size:10.5px;margin-left:auto}
.chip .cv{font-size:14px;font-weight:500;margin:6px 0 2px}
.chip.up .cv{color:var(--up)}.chip.dn .cv{color:var(--dn)}.chip.mut .cv{color:var(--mut)}
.chip .cd{font-size:11.5px;color:var(--ink2);font-variant-numeric:tabular-nums}.chip .cd span{color:var(--mut)}
.chip .cq{font-size:10.5px;color:var(--mut);margin-top:2px}

.card{background:var(--pan);border:1px solid var(--line);border-radius:16px;padding:22px 24px;margin:20px 0;box-shadow:var(--shadow)}
.sec-h{display:flex;align-items:baseline;gap:10px;margin-bottom:4px}
.sec-n{font-size:12px;color:var(--acc);border:1px solid var(--line2);border-radius:7px;padding:1px 7px;font-variant-numeric:tabular-nums}
h2{font-size:clamp(18px,2.5vw,21px);margin:0;font-weight:500}
.sec-s{color:var(--mut);font-size:12.5px;margin:6px 0 14px}
.chart{margin:8px 0}
img.ch{width:100%;border-radius:12px;border:1px solid var(--line);display:block}

.filter{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 14px}
.fbtn{border:1px solid var(--line2);background:var(--pan2);color:var(--ink2);border-radius:20px;padding:5px 14px;font-size:12.5px;cursor:pointer;transition:.15s}
.fbtn:hover{border-color:var(--acc)}
.fbtn.on{background:var(--acc);color:#fff;border-color:var(--acc)}
html[data-theme=dark] .fbtn.on{color:#06121f}

.asset{border-top:1px solid var(--line);padding-top:20px;margin-top:22px}
.asset:first-of-type{border-top:0;margin-top:6px;padding-top:4px}
.ahead{display:flex;justify-content:space-between;align-items:center;gap:12px}
.atitle{display:flex;align-items:baseline;gap:9px}
.asym{font-size:18px;font-weight:500;display:inline-flex;align-items:center;gap:7px}.asym i{color:var(--acc);font-size:19px}
.cn2{color:var(--mut);font-size:13px}
.averd{font-size:12.5px;font-weight:500;padding:4px 13px;border-radius:20px;white-space:nowrap}
.averd.up{color:var(--up);background:var(--warm);border:1px solid var(--up)}
.averd.dn{color:var(--dn);background:var(--cold);border:1px solid var(--dn)}
.averd.mut{color:var(--mut);background:var(--bg2);border:1px solid var(--line2)}
.ameta{color:var(--mut);font-size:11.5px;margin:5px 0 4px;font-variant-numeric:tabular-nums}
.agrid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:10px}
.agrid h4{font-size:13px;margin:14px 0 7px;color:var(--ink);font-weight:500;display:flex;align-items:baseline;gap:8px}
.hint{font-size:10.5px;color:var(--mut);font-weight:400}
.body{font-size:13px;margin:0;color:var(--ink2)}

.tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
table.t,table.mtx{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}
table.t th,table.t td{border-bottom:1px solid var(--line);padding:6px 9px;text-align:left;white-space:nowrap}
table.t thead th{color:var(--mut);font-weight:500;font-size:11px}
table.t tbody tr{transition:background .12s}
table.t tbody tr:hover{background:var(--bg2)}
td.n{text-align:right}.mut{color:var(--mut)}.up{color:var(--up);font-weight:500}.dn{color:var(--dn);font-weight:500}
s{color:var(--gold);text-decoration:none}
.sm{font-size:11px}.note{font-size:11px;color:var(--mut);margin:7px 0 0}

.mtx{margin-top:4px;min-width:640px}
.mtx td,.mtx th{border:1px solid var(--line);padding:6px 7px;text-align:center;font-size:11.5px}
.mtx thead th{color:var(--mut);background:var(--pan2);font-weight:500}
.mtx .sym{font-weight:500;background:var(--pan2);text-align:left;white-space:nowrap}
.mtx .sym i{color:var(--acc);margin-right:5px}.mtx .sym span{display:block;color:var(--mut);font-size:10px}
.mtx .cfg{text-align:left;color:var(--ink2);white-space:nowrap}
.mtx td.n i{display:block;font-style:normal;color:var(--mut);font-size:9px}
.mtx td.hot{background:var(--hot)}.mtx td.warm{background:var(--warm)}.mtx td.cold{background:var(--cold)}
.mtx .q{font-weight:500}.mtx .qhi{color:var(--up)}.mtx .qmid{color:var(--gold)}.mtx .qlo{color:var(--dn)}

.callout{border-radius:12px;padding:16px 18px;margin:14px 0;font-size:13px}
.callout b{font-weight:500}
.info{background:var(--bg2);border:1px solid var(--line2)}
.warn{background:var(--cold);border:1px solid var(--dn)}
html[data-theme=dark] .warn{background:rgba(251,191,36,.09);border-color:rgba(251,191,36,.35)}
.callout.warn{background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.4)}
ul{margin:6px 0 0;padding-left:20px}li{margin:6px 0;font-size:13px;color:var(--ink2)}
.ol-k{font-weight:500;color:var(--ink)}
details{margin-top:8px}summary{cursor:pointer;font-size:13px;color:var(--acc);font-weight:500}
.foot{text-align:center;color:var(--mut);font-size:11.5px;margin-top:30px;line-height:1.8}

.totop{position:fixed;right:18px;bottom:18px;z-index:50;width:42px;height:42px;border-radius:50%;border:1px solid var(--line2);background:var(--pan);color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:var(--shadow);opacity:0;pointer-events:none;transition:.2s}
.totop.show{opacity:1;pointer-events:auto}.totop:hover{border-color:var(--acc);color:var(--acc)}

@media(max-width:860px){.agrid{grid-template-columns:1fr;gap:14px}.wrap{padding:18px 14px 80px}.card{padding:18px 15px}.nav{display:none}.brand span.long{display:none}}
@media(max-width:520px){.chips{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}}
"""

JS=r"""
(function(){
 var d=document.documentElement;
 function setT(t){d.dataset.theme=t;try{localStorage.setItem('kl_theme',t)}catch(e){}
   var b=document.getElementById('tbtn');if(b)b.innerHTML='<i class="ti ti-'+(t==='dark'?'sun':'moon')+'"></i>'+(t==='dark'?'浅色':'深色');}
 var btn=document.getElementById('tbtn');if(btn)btn.addEventListener('click',function(){setT(d.dataset.theme==='dark'?'light':'dark')});
 setT(d.dataset.theme||'dark');
 // filter
 document.querySelectorAll('.fbtn').forEach(function(f){f.addEventListener('click',function(){
   document.querySelectorAll('.fbtn').forEach(function(x){x.classList.remove('on')});f.classList.add('on');
   var g=f.dataset.f;document.querySelectorAll('.asset').forEach(function(a){a.style.display=(g==='all'||a.dataset.grp===g)?'':'none'});});});
 // scroll spy
 var links=[].slice.call(document.querySelectorAll('.nav a'));
 var secs=links.map(function(l){return document.querySelector(l.getAttribute('href'))}).filter(Boolean);
 function spy(){var y=window.scrollY+120,cur=secs[0];secs.forEach(function(s){if(s.offsetTop<=y)cur=s});
   links.forEach(function(l){l.classList.toggle('on',l.getAttribute('href')==='#'+ (cur&&cur.id))});}
 window.addEventListener('scroll',spy,{passive:true});spy();
 links.forEach(function(l){l.addEventListener('click',function(e){var t=document.querySelector(l.getAttribute('href'));if(t){e.preventDefault();window.scrollTo({top:t.offsetTop-72,behavior:'smooth'})}})});
 // to top
 var tt=document.getElementById('totop');
 window.addEventListener('scroll',function(){tt.classList.toggle('show',window.scrollY>600)},{passive:true});
 tt.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'})});
})();
"""

HTML=f"""<!doctype html><html lang="zh" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>K线结构匹配 · 概率仪表盘</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.7.0/dist/tabler-icons.min.css">
<style>{CSS}</style>
<script>try{{var t=localStorage.getItem('kl_theme');if(!t)t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';document.documentElement.dataset.theme=t;}}catch(e){{}}</script>
</head><body>
<div class="head"><div class="head-in">
  <div class="brand"><i class="ti ti-chart-candle"></i><span class="long">K线结构匹配</span></div>
  <nav class="nav">
    <a href="#overview">总览</a><a href="#assets">标的明细</a><a href="#mx-crypto">加密矩阵</a><a href="#mx-stock">美股矩阵</a><a href="#method">方法</a>
  </nav>
  <div class="hspace"></div>
  <button class="tbtn" id="tbtn" aria-label="切换主题"><i class="ti ti-sun"></i>浅色</button>
</div></div>

<div class="wrap">
<section class="hero">
  <div class="kick">Quantitative Pattern Study</div>
  <h1>K线结构匹配 · 历史概率分析</h1>
  <p>给定当前K线形态,在历史上寻找结构最相似的片段,统计其“之后”的走势分布,判断涨跌概率并与无条件基准对照。相关系数与 DTW 双度量,覆盖 3 类加密 + 6 类美股/指数,多周期多窗口。</p>
  <div class="badges">
    <span class="badge">锚定 2026-07-08</span><span class="badge">加密 4h/日线 · Binance</span><span class="badge">美股/指数 日线/周线 · Yahoo</span><span class="badge">相关系数 + DTW</span><span class="badge">9 标的 · 3 周期/窗口</span>
  </div>
  <div class="chips">{chips()}</div>
</section>

<section class="card" id="overview">
  <div class="sec-h"><span class="sec-n">01</span><h2>总览 · 超额上涨概率</h2></div>
  <p class="sec-s">格子=相似历史片段之后该标的上涨概率 − 其无条件基准(百分点)。绿=历史上该形态后更易涨,红=更弱。near/mid/far 为近/中/远前瞻期。</p>
  <div class="chart">{img('EDGE','各标的超额上涨概率热力图')}</div>
  <div class="callout info"><b>一句话结论</b><ul>{oneliners()}</ul></div>
</section>

<section class="card" id="assets">
  <div class="sec-h"><span class="sec-n">02</span><h2>标的明细 · 相似结构前瞻概率</h2></div>
  <p class="sec-s">主配置:加密 4小时线×60根、美股 日线×40根。每个标的含形态拆解、corr/DTW/基准三方概率、同期季节性与最相似历史片段。</p>
  <div class="filter">
    <button class="fbtn on" data-f="all">全部</button><button class="fbtn" data-f="crypto">加密</button><button class="fbtn" data-f="stock">美股 / 指数</button>
  </div>
  {all_assets()}
</section>

<section class="card" id="mx-crypto">
  <div class="sec-h"><span class="sec-n">03</span><h2>配置对照矩阵 · 加密</h2></div>
  <p class="sec-s">同一标的在不同周期/窗口下的<b>中位前瞻上涨概率(%)</b>,大字=匹配后、小字=基准。绿越深=超额越大;最右为匹配相似度。</p>
  <div class="tw"><table class="mtx"><thead><tr><th>标的</th><th>配置</th><th colspan="3">相关系数 近/中/远</th><th colspan="3">DTW 近/中/远</th><th>相似度</th></tr></thead><tbody>{matrix_table('crypto')}</tbody></table></div>
  <p class="note">近/中/远:4h配置≈1天/10天/30天;日线配置≈3天/14天/60天。</p>
</section>

<section class="card" id="mx-stock">
  <div class="sec-h"><span class="sec-n">04</span><h2>配置对照矩阵 · 美股 / 指数</h2></div>
  <p class="sec-s">中位前瞻上涨概率(%),大字=匹配后、小字=基准。QQQ/DJI/IXIC 为新增。</p>
  <div class="tw"><table class="mtx"><thead><tr><th>标的</th><th>配置</th><th colspan="3">相关系数 近/中/远</th><th colspan="3">DTW 近/中/远</th><th>相似度</th></tr></thead><tbody>{matrix_table('stock')}</tbody></table></div>
  <p class="note">近/中/远:日线配置≈1周/1月/3月;周线配置≈2周/2月/6月。</p>
</section>

<section class="card" id="method">
  <div class="sec-h"><span class="sec-n">05</span><h2>方法与局限</h2></div>
  <div class="callout warn"><b>重要局限(务必先读)</b><ul>
    <li>基于历史相似度的<b>概率描述,不是买卖建议</b>;历史相似 ≠ 未来重复。非投资顾问,风险自负。</li>
    <li>相似片段窗口<b>部分重叠</b>,有效样本小于标注的 40–50;季节性样本仅 5–15 年,只能看方向。</li>
    <li>仅用价格形态,<b>未纳入基本面/宏观/资金面</b>。SPY/QQQ 相似度偏低,更多是“慢牛惯性”。</li>
    <li><b>DJI</b> 是反例:相似度很高但类比之后弱于基准——高相似度≠看多。</li>
  </ul></div>
  <details><summary>展开匹配方法细节</summary>
  <p class="body" style="margin-top:8px">取最近 N 根K线,对<b>对数收盘价</b>做 z-标准化只留形状;全史滑动窗口计算<b>相关系数</b>与<b>DTW 距离</b>(带 Sakoe-Chiba 限制,先用相关预筛前 400 再 DTW 精排),各取最像且间隔≥半窗口的 40–50 段,统计其之后前瞻收益并与无条件基准对照。<b>无未来函数</b>:候选片段严格早于当前窗口,其前瞻收益全为已实现历史。</p>
  </details>
</section>

<p class="foot">数据:Binance 公开行情(加密 4h/日线)、Yahoo Finance(美股/指数 日线/周线,复权)。相关系数 + DTW 双度量。<br>生成于分析会话,仅供研究参考,非投资建议。</p>
</div>
<button class="totop" id="totop" aria-label="回到顶部"><i class="ti ti-arrow-up"></i></button>
<script>{JS}</script>
</body></html>"""

open("report.html","w",encoding="utf-8").write(HTML)
print("wrote report.html",len(HTML))
