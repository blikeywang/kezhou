# -*- coding: utf-8 -*-
import json, math
CP=json.load(open("crypto_payload.json")); CS=json.load(open("crypto_season.json"))
SP=json.load(open("stock_payload.json")); CH=json.load(open("charts2.json"))

CRYPTO_H=[6,30,60,90,180]; CRYPTO_HL={6:"1天",30:"5天",60:"10天",90:"15天",180:"30天"}
STOCK_H=[5,10,21,42,63]; STOCK_HL={5:"1周",10:"2周",21:"1月",42:"2月",63:"3月"}
CN={"BTC":"比特币","ETH":"以太坊","SOL":"Solana","AAPL":"苹果","NVDA":"英伟达","SPY":"标普500 ETF","QQQ":"纳指100 ETF","DJI":"道琼斯指数","IXIC":"纳指综合"}

ASSETS=[]
for k in ["BTC","ETH","SOL"]:
    ASSETS.append(dict(k=k,grp="crypto",P=CP["PRIM"][k],S=CS[k],H=CRYPTO_H,HL=CRYPTO_HL,n=50,tf="4小时线·60根"))
for k in ["AAPL","NVDA","SPY","QQQ","DJI","IXIC"]:
    ASSETS.append(dict(k=k,grp="stock",P=SP["PRIM"][k],S=SP["SEASON"][k],H=STOCK_H,HL=STOCK_HL,n=40,tf="日线·40根"))

def binom_p(pup,n,p0):
    se=math.sqrt(p0*(1-p0)/n)
    if se==0:return 1.0
    z=abs(pup-p0)/se
    return 2*(1-0.5*(1+math.erf(z/math.sqrt(2))))
def sig(pup,n,p0):
    p=binom_p(pup,n,p0); return "★★" if p<0.05 else("★" if p<0.10 else "")
def pc(x): return f"{x*100:+.1f}%"
def col(x): return "up" if x>0 else("dn" if x<0 else "")

def morph(nc):
    n=len(nc);tot=nc[-1]/nc[0]-1;hi=max(nc);lo=min(nc)
    pos=(nc[-1]-lo)/(hi-lo) if hi>lo else .5
    recent=nc[-1]/nc[-max(5,n//6)]-1; dd=lo/hi-1
    tr="上行趋势" if tot>0.02 else("下行趋势" if tot<-0.02 else "横盘震荡")
    pp="接近区间高点" if pos>0.7 else("接近区间低点" if pos<0.3 else "居区间中部")
    rr="近端走强" if recent>0.01 else("近端回落" if recent<-0.01 else "近端走平")
    return tot,pos,dd,tr,pp,rr

def cfgkey(a):
    return ({"BTC":"BTCUSDT","ETH":"ETHUSDT","SOL":"SOLUSDT"}[a["k"]]+"_4h_60") if a["grp"]=="crypto" else a["k"]+"_1d_40"
def mat(a): return (CP["MATRIX"] if a["grp"]=="crypto" else SP["MATRIX"])

def verdict(a):
    M=mat(a)[cfgkey(a)]
    edge=(M["corr"][2]-M["bas"][1]) # mid pUp edge
    q=M["cR"][1]
    midp=M["corr"][2]
    if a["grp"]=="crypto": qtxt="相似度高" if q>0.9 else("中" if q>0.75 else "偏低")
    else: qtxt="相似度高" if q>0.8 else("中" if q>0.65 else "偏低,类比弱")
    if edge>0.05: d=("偏多","up") if q>(0.9 if a["grp"]=="crypto" else 0.7) else ("偏多·弱信号","up")
    elif edge<-0.05: d=("弱于基准/偏空","dn")
    else: d=("中性","mut")
    return d[0],d[1],midp,M["bas"][1],qtxt,q

# ---- verdict chips ----
def chips():
    h=""
    for a in ASSETS:
        t,c,mp,bp,qt,q=verdict(a)
        h+=f"""<div class='chip {c}'><div class='ck'>{a['k']}</div>
        <div class='cn'>{CN[a['k']]}</div><div class='cv'>{t}</div>
        <div class='cd'>中期上涨 {mp*100:.0f}% <span>基准{bp*100:.0f}%</span></div>
        <div class='cq'>{qt}</div></div>"""
    return h

# ---- config matrix ----
def matrix_table(grp):
    rows=""
    if grp=="crypto":
        syms=[("BTC","BTCUSDT"),("ETH","ETHUSDT"),("SOL","SOLUSDT")]
        cfgs=[("4h × 60","4h_60"),("4h × 30","4h_30"),("日线 × 60","1d_60")]
        M=CP["MATRIX"]
    else:
        syms=[(s,s) for s in ["AAPL","NVDA","SPY","QQQ","DJI","IXIC"]]
        cfgs=[("日线 × 40","1d_40"),("日线 × 30","1d_30"),("周线 × 30","1wk_30")]
        M=SP["MATRIX"]
    for disp,sym in syms:
        first=True
        for cl,ck in cfgs:
            e=M[sym+"_"+ck]
            def cell(p,b):
                edge=p-b; cls="hot" if edge>0.08 else("warm" if edge>0.03 else("cold" if edge<-0.03 else ""))
                return f"<td class='n {cls}'>{p*100:.0f}<i>{b*100:.0f}</i></td>"
            c=e["corr"]; d=e["dtw"]; b=e["bas"]
            q=e["cR"][1]; qb="qhi" if q>(0.9 if grp=='crypto' else 0.8) else("qmid" if q>(0.75 if grp=='crypto' else 0.65) else "qlo")
            head=f"<td class='sym' rowspan='3'>{disp}<span>{CN[disp]}</span></td>" if first else ""
            rows+=f"""<tr>{head}<td class='cfg'>{cl}</td>
            {cell(c[0],b[0])}{cell(c[2],b[1])}{cell(c[4],b[2])}
            {cell(d[0],b[0])}{cell(d[2],b[1])}{cell(d[4],b[2])}
            <td class='q {qb}'>{q:.2f}</td></tr>"""
            first=False
    return rows

# ---- per asset detail ----
def cond_rows(a):
    P=a["P"]; n=a["n"]; out=""
    for i,h in enumerate(a["H"]):
        c=P["condC"][i]; d=P["condD"][i]; b=P["bas"][i]
        sc=sig(c[1],n,b[1]); sd=sig(d[1],n,b[1])
        out+=f"""<tr><td>{a['HL'][h]}</td>
        <td class='n'><b>{c[1]*100:.0f}%</b> <s>{sc}</s></td>
        <td class='n {col(c[2])}'>{pc(c[2])}</td>
        <td class='n'><b>{d[1]*100:.0f}%</b> <s>{sd}</s></td>
        <td class='n {col(d[2])}'>{pc(d[2])}</td>
        <td class='n mut'>{b[1]*100:.0f}%</td>
        <td class='n mut'>{pc(b[2])}</td>
        <td class='n mut'>{pc(c[3])} … {pc(c[4])}</td></tr>"""
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
        hd=["日期","相关","+1d","+10d","+30d","回撤"]
        for m in a["P"]["mC"][:6]:
            out+=f"<tr><td>{m[0]}</td><td class='n'>{m[1]:.2f}</td><td class='n {col(m[2])}'>{pc(m[2])}</td><td class='n {col(m[3])}'>{pc(m[3])}</td><td class='n {col(m[4])}'>{pc(m[4])}</td><td class='n dn'>{pc(m[5])}</td></tr>"
    else:
        hd=["日期","相关","+1月","+3月","回撤"]
        for m in a["P"]["mC"][:6]:
            out+=f"<tr><td>{m[0]}</td><td class='n'>{m[1]:.2f}</td><td class='n {col(m[2])}'>{pc(m[2])}</td><td class='n {col(m[3])}'>{pc(m[3])}</td><td class='n dn'>{pc(m[4])}</td></tr>"
    return hd,out

def asset_section(a,theme):
    P=a["P"]; tot,pos,dd,tr,pp,rr=morph(P["nc"])
    t,c,mp,bp,qt,q=verdict(a)
    hd,mr=match_rows(a)
    mh="".join(f"<th>{x}</th>" for x in hd)
    cr=P["corrRange"];
    return f"""
    <section class='asset'>
      <div class='ahead'>
        <div><h3>{a['k']} <span class='cn2'>{CN[a['k']]}</span></h3>
        <div class='ameta'>{a['tf']}｜参考 {P['refRange'][0]} → {P['refRange'][1]}｜相似度 {cr[0]:.2f}–{cr[1]:.2f}</div></div>
        <div class='averd {c}'>{t}</div>
      </div>
      <img src='{CH[theme][a['k']]}'/>
      <div class='agrid'>
        <div>
          <h4>形态拆解</h4>
          <p>{tr}，窗口累计 {pc(tot)}；当前价{pp}（分位 {pos*100:.0f}%），{rr}。期间最大回撤 {pc(dd)}。匹配相似度{qt}。</p>
          <h4>同期季节性</h4>
          <table class='t'><tr><th>此后</th><th>上涨年%</th><th>中位</th><th>样本</th></tr>{season_rows(a)}</table>
          <h4>最相似历史片段（相关系数）</h4>
          <table class='t sm'><tr>{mh}</tr>{mr}</table>
        </div>
        <div>
          <h4>相似结构 → 前瞻概率（相关 vs DTW vs 基准）</h4>
          <table class='t'><tr><th>前瞻</th><th>涨概率<br>corr</th><th>corr<br>中位</th><th>涨概率<br>DTW</th><th>DTW<br>中位</th><th>基准</th><th>基准<br>中位</th><th>corr<br>25–75%</th></tr>{cond_rows(a)}</table>
          <p class='note'>★ p&lt;0.10，★★ p&lt;0.05（二项近似；窗口重叠→有效样本更小）。corr 与 DTW 两套度量并列,方向一致度越高越可信。</p>
        </div>
      </div>
    </section>"""

# ---- verdict one-liners ----
ONELINERS={
 "BTC":"震荡后爬升至局部高位、近端小回落。corr 与 DTW 一致指向<b>中期偏多</b>——5–10天上涨概率 68–72%(DTW 更高)、显著高于基准 ~53%,相似度极高。",
 "ETH":"强势拉升后高位盘整。方向偏多但<b>离散度极大</b>(10天涨概率 60%,分位从 -5% 到 +15%),超额有限。",
 "SOL":"高位宽幅震荡。近端(1天)corr 给到 68%,中远期涨概率 56–60%、中位涨幅可观但回撤也大,相似度高、波动最猛。",
 "AAPL":"V型急跌后修复至近高位。<b>短线偏弱</b>(1–2周涨概率≤55%、低于基准),3月转强(67–68%)。",
 "NVDA":"深调后处窗口低位。<b>短线强</b>——1周 corr 80%/DTW 65%、中位 +5.4%,相似度较高,但个股基本面权重大。",
 "SPY":"低波慢涨近高位。各周期涨概率高(70–78%),<b>但基本≈基准(慢牛惯性),且相似度偏低</b>,非独特形态信号。",
 "QQQ":"与 SPY 类似的慢牛结构,远期(3月)涨概率 80–82%,略高于基准,相似度偏低。",
 "DJI":"当前形态<b>历史相似度很高(0.85–0.96)</b>,但这些类比之后<b>弱于基准</b>(3月涨概率 60% vs 基准 72%)——少见的负向信号,值得警惕。",
 "IXIC":"纳指综合,远期(3月)涨概率 78–83%、明显高于基准,近端中性;相似度中等。",
}
def oneliner_list():
    return "".join(f"<li><b>{a['k']} {CN[a['k']]}</b>:{ONELINERS[a['k']]}</li>" for a in ASSETS)

def crypto_sections(theme): return "".join(asset_section(a,theme) for a in ASSETS if a["grp"]=="crypto")
def stock_sections(theme): return "".join(asset_section(a,theme) for a in ASSETS if a["grp"]=="stock")

DARK_CSS="""
:root{--bg:#0b1020;--pan:#121a2e;--pan2:#0f1728;--fg:#e6ebf5;--mut:#8595b3;--line:#22304d;--cy:#22d3ee;--vi:#a78bfa;--up:#34d399;--dn:#fb7185;--gold:#fbbf24}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 15% -10%,#152244 0%,#0b1020 55%);color:var(--fg);font-family:-apple-system,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;line-height:1.6}
.wrap{max-width:1180px;margin:0 auto;padding:30px 22px 70px}
.hero h1{font-size:30px;margin:0;letter-spacing:.5px;background:linear-gradient(90deg,#fff,#7dd3fc);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero .s{color:var(--mut);font-size:13px;margin:8px 0 0}
.badge{display:inline-block;font-size:11px;color:#7dd3fc;border:1px solid #1e3a5f;background:#0e1c33;padding:3px 10px;border-radius:20px;margin:12px 8px 0 0;font-variant-numeric:tabular-nums}
.chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin:22px 0}
.chip{background:linear-gradient(180deg,var(--pan),var(--pan2));border:1px solid var(--line);border-radius:14px;padding:13px 14px;position:relative;overflow:hidden}
.chip:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px}
.chip.up:before{background:var(--up)}.chip.dn:before{background:var(--dn)}.chip.mut:before{background:var(--mut)}
.chip .ck{font-weight:700;font-size:15px}.chip .cn{color:var(--mut);font-size:11px;margin-bottom:6px}
.chip .cv{font-size:14px;font-weight:600}.chip.up .cv{color:var(--up)}.chip.dn .cv{color:var(--dn)}.chip.mut .cv{color:var(--mut)}
.chip .cd{font-size:11.5px;color:#cbd5e1;margin-top:4px;font-variant-numeric:tabular-nums}.chip .cd span{color:var(--mut)}
.chip .cq{font-size:10.5px;color:var(--mut);margin-top:3px}
.card{background:linear-gradient(180deg,var(--pan),var(--pan2));border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin:20px 0;box-shadow:0 10px 30px rgba(0,0,0,.35)}
h2{font-size:20px;margin:0 0 4px}.sec-s{color:var(--mut);font-size:12.5px;margin:0 0 14px}
img{width:100%;border-radius:10px;border:1px solid var(--line);margin:6px 0}
table.t,table.mtx{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}
table.t th,table.t td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}
table.t th{color:var(--mut);font-weight:600;font-size:11px}
td.n{text-align:right}.mut{color:var(--mut)}.up{color:var(--up);font-weight:600}.dn{color:var(--dn);font-weight:600}
s{color:var(--gold);text-decoration:none}
.mtx{margin-top:6px}.mtx td,.mtx th{border:1px solid var(--line);padding:6px 7px;text-align:center;font-size:11.5px}
.mtx th{color:var(--mut);background:#0e1729;font-weight:600}
.mtx .sym{font-weight:700;background:#0e1729;text-align:left}.mtx .sym span{display:block;color:var(--mut);font-size:10px;font-weight:400}
.mtx .cfg{text-align:left;color:#cbd5e1}
.mtx td.n{position:relative}.mtx td.n i{display:block;font-style:normal;color:var(--mut);font-size:9px}
.mtx td.hot{background:rgba(52,211,153,.28)}.mtx td.warm{background:rgba(52,211,153,.13)}.mtx td.cold{background:rgba(251,113,133,.18)}
.mtx .q{font-weight:700}.mtx .qhi{color:var(--up)}.mtx .qmid{color:var(--gold)}.mtx .qlo{color:var(--dn)}
.asset{border-top:1px solid var(--line);padding-top:18px;margin-top:18px}
.ahead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.ahead h3{margin:0;font-size:18px}.cn2{color:var(--mut);font-size:13px;font-weight:400}
.ameta{color:var(--mut);font-size:11.5px;margin-top:3px}
.averd{font-size:13px;font-weight:700;padding:5px 12px;border-radius:20px;white-space:nowrap}
.averd.up{color:var(--up);background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.3)}
.averd.dn{color:var(--dn);background:rgba(251,113,133,.12);border:1px solid rgba(251,113,133,.3)}
.averd.mut{color:var(--mut);background:rgba(133,149,179,.12);border:1px solid var(--line)}
.agrid{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:12px}
.agrid h4{font-size:13px;margin:14px 0 6px;color:#cbd5e1}
.sm{font-size:11px}.note{font-size:11px;color:var(--mut);margin:6px 0 0}
.callout{border-radius:14px;padding:16px 18px;margin:14px 0;font-size:13.5px}
.warn{background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3)}
.info{background:rgba(34,211,238,.07);border:1px solid rgba(34,211,238,.25)}
ul{margin:6px 0 0;padding-left:20px}li{margin:5px 0}
.foot{text-align:center;color:var(--mut);font-size:11.5px;margin-top:26px}
@media(max-width:760px){.agrid{grid-template-columns:1fr}}
"""

LIGHT_CSS="""
:root{--bg:#fbf9f5;--pan:#ffffff;--ink:#20242e;--mut:#8b8f9b;--line:#ece7dd;--ind:#4f46e5;--or:#c2410c;--up:#059669;--dn:#dc2626;--gold:#b45309}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;line-height:1.7}
.wrap{max-width:980px;margin:0 auto;padding:40px 26px 80px}
.hero{border-bottom:3px double #d9d2c4;padding-bottom:22px;margin-bottom:8px}
.hero .kick{font-size:12px;letter-spacing:3px;text-transform:uppercase;color:var(--or);font-weight:700}
.hero h1{font-family:Georgia,"Songti SC",serif;font-size:38px;line-height:1.15;margin:8px 0 6px;font-weight:700;letter-spacing:.3px}
.hero .s{color:#6b7280;font-size:13.5px;max-width:760px}
.badge{display:inline-block;font-size:11px;color:#4b5563;border:1px solid var(--line);background:#faf7f1;padding:3px 10px;border-radius:4px;margin:12px 8px 0 0;font-variant-numeric:tabular-nums}
.chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin:26px 0}
.chip{background:var(--pan);border:1px solid var(--line);border-radius:10px;padding:14px;border-top:3px solid #ddd}
.chip.up{border-top-color:var(--up)}.chip.dn{border-top-color:var(--dn)}.chip.mut{border-top-color:var(--mut)}
.chip .ck{font-family:Georgia,serif;font-weight:700;font-size:16px}.chip .cn{color:var(--mut);font-size:11px;margin-bottom:6px}
.chip .cv{font-size:14px;font-weight:700}.chip.up .cv{color:var(--up)}.chip.dn .cv{color:var(--dn)}.chip.mut .cv{color:var(--mut)}
.chip .cd{font-size:11.5px;color:#4b5563;margin-top:4px;font-variant-numeric:tabular-nums}.chip .cd span{color:var(--mut)}
.chip .cq{font-size:10.5px;color:var(--mut);margin-top:3px}
.card{background:var(--pan);border:1px solid var(--line);border-radius:12px;padding:24px 26px;margin:22px 0;box-shadow:0 1px 3px rgba(60,50,30,.05)}
h2{font-family:Georgia,"Songti SC",serif;font-size:24px;margin:0 0 4px}.sec-s{color:var(--mut);font-size:12.5px;margin:0 0 16px}
img{width:100%;border-radius:8px;border:1px solid var(--line);margin:6px 0}
table.t,table.mtx{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}
table.t th,table.t td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}
table.t th{color:var(--mut);font-weight:700;font-size:11px}
td.n{text-align:right}.mut{color:var(--mut)}.up{color:var(--up);font-weight:700}.dn{color:var(--dn);font-weight:700}
s{color:var(--gold);text-decoration:none}
.mtx{margin-top:6px}.mtx td,.mtx th{border:1px solid var(--line);padding:6px 7px;text-align:center;font-size:11.5px}
.mtx th{color:#4b5563;background:#faf7f1;font-weight:700}
.mtx .sym{font-family:Georgia,serif;font-weight:700;background:#faf7f1;text-align:left}.mtx .sym span{display:block;color:var(--mut);font-size:10px;font-weight:400}
.mtx .cfg{text-align:left;color:#4b5563}
.mtx td.n i{display:block;font-style:normal;color:var(--mut);font-size:9px}
.mtx td.hot{background:rgba(5,150,105,.20)}.mtx td.warm{background:rgba(5,150,105,.09)}.mtx td.cold{background:rgba(220,38,38,.12)}
.mtx .q{font-weight:700}.mtx .qhi{color:var(--up)}.mtx .qmid{color:var(--gold)}.mtx .qlo{color:var(--dn)}
.asset{border-top:1px solid var(--line);padding-top:20px;margin-top:20px}
.ahead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.ahead h3{font-family:Georgia,serif;margin:0;font-size:19px}.cn2{color:var(--mut);font-size:13px;font-weight:400}
.ameta{color:var(--mut);font-size:11.5px;margin-top:3px}
.averd{font-size:13px;font-weight:700;padding:5px 12px;border-radius:6px;white-space:nowrap}
.averd.up{color:var(--up);background:#ecfdf5;border:1px solid #a7f3d0}
.averd.dn{color:var(--dn);background:#fef2f2;border:1px solid #fecaca}
.averd.mut{color:var(--mut);background:#f6f6f4;border:1px solid var(--line)}
.agrid{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:12px}
.agrid h4{font-size:13px;margin:14px 0 6px;color:#374151}
.sm{font-size:11px}.note{font-size:11px;color:var(--mut);margin:6px 0 0}
.callout{border-radius:10px;padding:18px 20px;margin:16px 0;font-size:13.5px}
.warn{background:#fffbeb;border:1px solid #fde68a}
.info{background:#eef2ff;border:1px solid #c7d2fe}
ul{margin:6px 0 0;padding-left:20px}li{margin:6px 0}
.foot{text-align:center;color:var(--mut);font-size:11.5px;margin-top:28px}
@media(max-width:760px){.agrid{grid-template-columns:1fr}}
"""

def render(theme):
    css=DARK_CSS if theme=="dark" else LIGHT_CSS
    hero_extra = "" if theme=="dark" else "<div class='kick'>Quantitative Pattern Study</div>"
    badges="".join(f"<span class='badge'>{b}</span>" for b in
        ["锚定 2026-07-08","加密 4h/日线 · Binance","美股/指数 日线/周线 · Yahoo","相关系数 + DTW 双度量","9 标的 · 3 周期/窗口","z-标准化滑动匹配"])
    return f"""<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>K线结构匹配 · 概率仪表盘</title>
<style>{css}</style></head><body><div class="wrap">
<div class="hero">{hero_extra}<h1>K线结构匹配 · 历史概率分析</h1>
<p class="s">给定当前K线形态,在历史上寻找结构最相似的片段,统计它们“之后”的走势分布,判断涨跌概率并与无条件基准对照。相关系数与 DTW 两种度量并行,覆盖 3 类加密 + 6 类美股/指数,多周期多窗口。</p>
<div>{badges}</div></div>

<div class="chips">{chips()}</div>

<div class="card">
<h2>总览 · 超额上涨概率</h2>
<p class="sec-s">格子=相似历史片段之后该标的上涨概率 − 其无条件基准(百分点)。绿=历史上该形态后更容易涨,红=更弱。near/mid/far 为近/中/远前瞻期。</p>
<img src="{CH[theme]['EDGE']}"/>
<div class="callout info"><b>一句话结论</b><ul>{oneliner_list()}</ul></div>
</div>

<div class="card">
<h2>加密 · 相似结构前瞻概率</h2>
<p class="sec-s">主配置 4小时线×60根。下方每个标的含形态拆解、corr/DTW/基准三方概率、同期季节性与最相似历史片段。</p>
{crypto_sections(theme)}
</div>

<div class="card">
<h2>配置对照矩阵 · 加密</h2>
<p class="sec-s">同一标的在不同周期/窗口下的<b>中位前瞻上涨概率(%)</b>,大字=匹配后、小字=基准。绿越深=超额越大;最右为匹配相似度(越高越可信)。</p>
<table class="mtx"><tr><th>标的</th><th>配置</th><th colspan="3">相关系数 near/mid/far</th><th colspan="3">DTW near/mid/far</th><th>相似度</th></tr>
{matrix_table('crypto')}</table>
<p class="note">near/mid/far:4h配置≈1天/10天/30天;日线配置≈3天/14天/60天。</p>
</div>

<div class="card">
<h2>美股 / 指数 · 相似结构前瞻概率</h2>
<p class="sec-s">主配置 日线×40根(约2个月)。QQQ/DJI/IXIC 为本轮新增。</p>
{stock_sections(theme)}
</div>

<div class="card">
<h2>配置对照矩阵 · 美股 / 指数</h2>
<p class="sec-s">中位前瞻上涨概率(%),大字=匹配后、小字=基准。</p>
<table class="mtx"><tr><th>标的</th><th>配置</th><th colspan="3">相关系数 near/mid/far</th><th colspan="3">DTW near/mid/far</th><th>相似度</th></tr>
{matrix_table('stock')}</table>
<p class="note">near/mid/far:日线配置≈1周/1月/3月;周线配置≈2周/2月/6月。</p>
</div>

<div class="card">
<h2>方法与局限</h2>
<div class="callout warn"><b>重要局限（务必先读）</b><ul>
<li>这是<b>基于历史相似度的概率描述,不是买卖建议</b>;历史相似 ≠ 未来重复。非投资顾问,风险自负。</li>
<li>相似片段时间窗口<b>部分重叠</b>,有效样本小于标注的 40–50;季节性样本仅 5–15 年,只能看方向。</li>
<li>仅用价格形态,<b>未纳入基本面/宏观/资金面</b>。SPY/QQQ 等相似度偏低,结论更多是“慢牛惯性”而非独特信号。</li>
<li><b>DJI</b> 是反例:相似度很高但类比之后弱于基准——高相似度≠看多。</li>
</ul></div>
<p style="font-size:13px">匹配:取最近 N 根K线,对<b>对数收盘价</b>做 z-标准化只留形状;全史滑动窗口计算<b>相关系数</b>与<b>DTW 距离</b>(带 Sakoe-Chiba 限制,先用相关预筛前 400 再 DTW 精排),各取最像且间隔≥半窗口的 40–50 段,统计其之后前瞻收益并与无条件基准对照。<b>无未来函数</b>:候选片段严格早于当前窗口,其前瞻收益全为已实现历史。</p>
</div>

<p class="foot">数据:Binance 公开行情(加密 4h/日线)、Yahoo Finance(美股/指数 日线/周线,复权)。相关系数与 DTW 双度量。生成于分析会话,仅供研究参考,非投资建议。</p>
</div></body></html>"""

for theme,fn in [("dark","report_dark.html"),("light","report_light.html")]:
    open(fn,"w",encoding="utf-8").write(render(theme))
    print("wrote",fn)
