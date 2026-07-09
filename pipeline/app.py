# -*- coding: utf-8 -*-
# ⚠️ 已过时(DEPRECATED)—— 请勿用本脚本重新生成 prototype/app.html。
# prototype/app.html 在此生成器之后经过大量手工迭代(加密打赏弹窗、埋点 track、
# FREE_MODE 全免费改造、检索/收藏夹等),这些改动**未回填**本脚本。
# 重新运行会覆盖并丢失所有后续改动。app.html 才是原型的唯一真源。
# 如需重构前端,请以 frontend/(工程化 SPA)为准,不要走这个生成器。
DATA=open("appdata.json",encoding="utf-8").read()

CSS = r"""
*{box-sizing:border-box}
:root{--maxw:1240px;--r:12px;
 --bg:#0f1620;--bg2:#141d2a;--pan:#17212f;--pan2:#131b27;--ink:#dce4f0;--ink2:#a9b6c9;--mut:#7e8ca3;
 --line:#26313f;--line2:#33404f;--acc:#5b9bd5;--acc2:#8496b6;--up:#54b98a;--dn:#e07a7a;--gold:#d3a24e;
 --hot:rgba(84,185,138,.26);--warm:rgba(84,185,138,.12);--cold:rgba(224,122,122,.16);
 --sh:0 1px 2px rgba(0,0,0,.4),0 12px 34px rgba(0,0,0,.38);--head:rgba(15,22,32,.82)}
html[data-theme=light]{--bg:#eceff4;--bg2:#e3e8f0;--pan:#ffffff;--pan2:#f6f8fb;--ink:#26303f;--ink2:#47536a;--mut:#78859a;
 --line:#dde3ec;--line2:#c9d2df;--acc:#3b6fb0;--acc2:#6b7a99;--up:#2f9e74;--dn:#cf6060;--gold:#a9762e;
 --hot:rgba(47,158,116,.18);--warm:rgba(47,158,116,.08);--cold:rgba(207,96,96,.12);
 --sh:0 1px 3px rgba(40,48,63,.08),0 10px 30px rgba(40,48,63,.06);--head:rgba(236,239,244,.85)}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Segoe UI,Roboto,sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased}
html[data-theme=dark] body{background:radial-gradient(1100px 560px at 82% -12%,#182a44 0,#0f1620 55%)}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
.hidden{display:none!important}
.btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line2);background:var(--pan);color:var(--ink);border-radius:9px;padding:9px 15px;font-size:13.5px;cursor:pointer;transition:.15s;font-weight:500}
.btn:hover{border-color:var(--acc)}
.btn.pri{background:var(--acc);border-color:var(--acc);color:#fff}html[data-theme=dark] .btn.pri{color:#08111c}
.btn.pri:hover{filter:brightness(1.07)}
.btn.ghost{background:transparent}.btn.sm{padding:6px 11px;font-size:12.5px}.btn.block{width:100%;justify-content:center}
.mut{color:var(--mut)}.up{color:var(--up);font-weight:500}.dn{color:var(--dn);font-weight:500}
.demobadge{font-size:10.5px;color:var(--gold);border:1px solid var(--gold);border-radius:6px;padding:1px 7px}
.mnav{position:sticky;top:0;z-index:40;background:var(--head);backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%);border-bottom:1px solid var(--line)}
.mnav-in{max-width:var(--maxw);margin:0 auto;display:flex;align-items:center;gap:12px;padding:12px 22px}
.brand{display:flex;align-items:center;gap:9px;font-weight:500;font-size:16px;cursor:pointer;white-space:nowrap}
.brand .logo{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,var(--acc),var(--acc2));display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px}
.brand small{color:var(--mut);font-size:11px;font-weight:400;margin-left:2px}
.mnav .links{display:flex;gap:4px;margin-left:8px}
.mnav .links a{padding:6px 11px;border-radius:8px;font-size:13.5px;color:var(--ink2);cursor:pointer}
.mnav .links a:hover{background:var(--bg2);color:var(--ink)}
.grow{flex:1}
.iconbtn{height:36px;min-width:36px;padding:0 9px;border-radius:9px;border:1px solid var(--line2);background:var(--pan);color:var(--ink);display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;transition:.15s;font-size:12.5px;font-weight:500}
.iconbtn:hover{border-color:var(--acc);color:var(--acc)}
.wrap{max-width:var(--maxw);margin:0 auto;padding:30px 22px 40px}
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:34px;align-items:center;padding:34px 2px 18px}
.hero .kick{font-size:12px;letter-spacing:3px;text-transform:uppercase;color:var(--acc);font-weight:500}
.hero h1{font-size:clamp(28px,5vw,46px);line-height:1.1;margin:12px 0 12px;font-weight:600;letter-spacing:.3px}
.hero h1 .zh{color:var(--acc)}
.hero p.lead{color:var(--ink2);font-size:clamp(14px,1.8vw,16px);margin:0 0 18px;max-width:560px}
.hero .cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}
.hero .fine{color:var(--mut);font-size:12px;margin-top:12px}
.heroart{background:var(--pan);border:1px solid var(--line);border-radius:16px;padding:14px;box-shadow:var(--sh)}
.heroart .cap{font-size:11.5px;color:var(--mut);margin:8px 4px 2px;display:flex;justify-content:space-between}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:26px 0}
.stat{background:var(--pan);border:1px solid var(--line);border-radius:var(--r);padding:15px 16px;box-shadow:var(--sh)}
.stat b{display:block;font-size:24px;font-weight:600}.stat span{font-size:12px;color:var(--mut)}
.section{margin:40px 0}
.section h2{font-size:clamp(20px,3vw,26px);font-weight:600;margin:0 0 6px}
.section .sub{color:var(--mut);font-size:13.5px;margin:0 0 20px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.step{background:var(--pan);border:1px solid var(--line);border-radius:var(--r);padding:20px;box-shadow:var(--sh)}
.step .num{width:30px;height:30px;border-radius:8px;background:var(--bg2);color:var(--acc);display:flex;align-items:center;justify-content:center;font-weight:600;margin-bottom:10px}
.step h3{font-size:15px;margin:0 0 6px;font-weight:500}.step p{font-size:13px;color:var(--ink2);margin:0}
.bfcards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.bfcard{background:var(--pan);border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:var(--sh);cursor:pointer;transition:.15s;border-top:3px solid var(--acc)}
.bfcard:hover{transform:translateY(-3px);border-color:var(--line2)}
.bfcard .bi{width:44px;height:44px;border-radius:11px;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:23px;color:var(--acc);margin-bottom:12px}
.bfcard h3{margin:0 0 5px;font-size:17px;font-weight:500}.bfcard p{margin:0;font-size:13px;color:var(--ink2)}
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:stretch}
.plan{background:var(--pan);border:1px solid var(--line);border-radius:16px;padding:24px;box-shadow:var(--sh);display:flex;flex-direction:column}
.plan.hi{border:1.5px solid var(--acc);position:relative}
.plan.hi:before{content:attr(data-pop);position:absolute;top:-11px;left:24px;background:var(--acc);color:#fff;font-size:11px;padding:2px 10px;border-radius:20px}html[data-theme=dark] .plan.hi:before{color:#08111c}
.plan h3{margin:0;font-size:17px;font-weight:500}
.plan .price{font-size:34px;font-weight:600;margin:10px 0 2px}.plan .price small{font-size:14px;color:var(--mut);font-weight:400}
.plan ul{list-style:none;padding:0;margin:16px 0;flex:1}
.plan li{font-size:13px;padding:7px 0;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:flex-start;color:var(--ink2)}
.plan li i{color:var(--up);font-size:16px;margin-top:1px}
.pay{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.paylabel{font-size:11.5px;color:var(--mut);width:100%}
.paym{display:inline-flex;align-items:center;gap:6px;border:1px dashed var(--line2);border-radius:8px;padding:5px 10px;font-size:12px;color:var(--ink2);background:var(--pan2)}
.paym i{font-size:15px;color:var(--acc)}
.paym .soon{font-size:9.5px;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;margin-left:2px}
.authbox{max-width:420px;margin:40px auto;background:var(--pan);border:1px solid var(--line);border-radius:16px;padding:30px;box-shadow:var(--sh)}
.authbox h2{margin:0 0 4px;font-size:22px;font-weight:600}.authbox .sub{color:var(--mut);font-size:13px;margin:0 0 20px}
.field{margin-bottom:14px}.field label{display:block;font-size:12.5px;color:var(--ink2);margin-bottom:6px}
.field input{width:100%;background:var(--pan2);border:1px solid var(--line2);border-radius:9px;padding:11px 13px;color:var(--ink);font-size:14px}
.field input:focus{outline:none;border-color:var(--acc)}
.swap{text-align:center;font-size:12.5px;color:var(--mut);margin-top:14px}.swap a{color:var(--acc);cursor:pointer}
.ob{max-width:900px;margin:30px auto}.ob h2{font-size:26px;font-weight:600;text-align:center;margin:0 0 6px}.ob .sub{text-align:center;color:var(--mut);font-size:14px;margin:0 0 26px}
.appbar{position:sticky;top:0;z-index:40;background:var(--head);backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%);border-bottom:1px solid var(--line)}
.appbar-in{max-width:1400px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:10px 18px}
.bfswitch{display:flex;gap:4px;background:var(--bg2);border-radius:10px;padding:3px}
.bfswitch button{border:0;background:transparent;color:var(--ink2);padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.bfswitch button.on{background:var(--pan);color:var(--acc)}
.quota{display:flex;align-items:center;gap:9px;background:var(--pan);border:1px solid var(--line2);border-radius:20px;padding:5px 12px;font-size:12.5px;white-space:nowrap}
.quota .ring{width:22px;height:22px;border-radius:50%;background:conic-gradient(var(--acc) calc(var(--p,0)*1%),var(--line) 0)}
.quota .ring.full{background:conic-gradient(var(--dn) 100%,var(--line) 0)}
.dash{max-width:1400px;margin:0 auto;display:grid;grid-template-columns:264px 1fr}
.side{border-right:1px solid var(--line);min-height:calc(100vh - 56px);padding:16px 12px}
.side .sh{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:1px;margin:6px 8px 8px}
.catlist{display:flex;flex-direction:column;gap:3px}
.cat{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:10px;cursor:pointer;transition:.12s;border:1px solid transparent}
.cat:hover{background:var(--bg2)}.cat.on{background:var(--bg2);border-color:var(--line2)}
.cat .ci{width:28px;height:28px;border-radius:8px;background:var(--bg2);display:flex;align-items:center;justify-content:center;color:var(--acc);font-size:16px;flex:0 0 auto}
.cat.on .ci{background:var(--pan)}
.cat .cn{font-size:13.5px;font-weight:500}.cat .csub{font-size:11px;color:var(--mut)}
.cat .cstate{margin-left:auto;font-size:14px;color:var(--mut)}.cat .cstate.opened{color:var(--up)}
.main{padding:20px 24px 70px;min-width:0}
.empty-h{font-size:20px;font-weight:600;margin:2px 0 4px}
.legend{background:var(--pan);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:16px 0}
.legend h4{margin:0 0 10px;font-size:14px;font-weight:500}
.legrow{display:flex;gap:12px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:13px}
.legrow:last-child{border-bottom:0}
.legrow .lk{flex:0 0 132px;color:var(--ink);font-weight:500;display:flex;gap:7px;align-items:center}
.legrow .lk i{color:var(--acc)}.legrow .lv{color:var(--ink2)}
.an-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
.an-title{display:flex;align-items:center;gap:11px}
.an-title .ai{width:40px;height:40px;border-radius:11px;background:var(--bg2);display:flex;align-items:center;justify-content:center;color:var(--acc);font-size:22px}
.an-title h2{margin:0;font-size:20px;font-weight:600}.an-title .as{color:var(--mut);font-size:12.5px}
.verd{font-size:13px;font-weight:500;padding:5px 14px;border-radius:20px;white-space:nowrap}
.verd.up{color:var(--up);background:var(--warm);border:1px solid var(--up)}
.verd.dn{color:var(--dn);background:var(--cold);border:1px solid var(--dn)}
.verd.mut{color:var(--mut);background:var(--bg2);border:1px solid var(--line2)}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.kpi{background:var(--pan);border:1px solid var(--line);border-radius:11px;padding:10px 14px;min-width:120px}
.kpi b{display:block;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}.kpi span{font-size:11px;color:var(--mut)}
.figbox{background:var(--pan);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:14px 0;box-shadow:var(--sh)}
.figbox .fcap{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.figbox .fcap b{font-size:14px;font-weight:500}
.figbox img{border-radius:10px;border:1px solid var(--line)}
.info{position:relative;cursor:help;color:var(--mut)}
.info .tip{position:absolute;right:0;top:24px;width:290px;background:var(--pan2);border:1px solid var(--line2);border-radius:10px;padding:11px 13px;font-size:12px;color:var(--ink2);box-shadow:var(--sh);display:none;z-index:5;line-height:1.6}
.info:hover .tip{display:block}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.tw{overflow-x:auto}
table.t{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}
table.t th,table.t td{border-bottom:1px solid var(--line);padding:6px 9px;text-align:left;white-space:nowrap}
table.t thead th{color:var(--mut);font-weight:500;font-size:11px}
table.t tbody tr:hover{background:var(--bg2)}
td.n{text-align:right}
s{color:var(--gold);text-decoration:none}
.note{font-size:11px;color:var(--mut);margin:7px 0 0}
h4.blk{font-size:13px;margin:16px 0 7px;font-weight:500}
.mask{position:fixed;inset:0;background:rgba(6,10,16,.6);display:flex;align-items:center;justify-content:center;z-index:80;padding:20px}
.modal{background:var(--pan);border:1px solid var(--line2);border-radius:16px;padding:26px;max-width:440px;width:100%;box-shadow:var(--sh)}
.modal h3{margin:0 0 6px;font-size:19px;font-weight:600}.modal p{color:var(--ink2);font-size:13.5px;margin:0 0 16px}
.modal .row{display:flex;gap:10px;margin-top:8px}
.foot{border-top:1px solid var(--line);margin-top:20px;padding:22px;color:var(--mut);font-size:12px;text-align:center;line-height:1.9}
@media(max-width:960px){
 .hero{grid-template-columns:1fr;gap:20px}.steps,.bfcards,.plans{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}
 .mnav .links{display:none}.grid2{grid-template-columns:1fr}
 .dash{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--line);min-height:auto;display:flex;gap:8px;overflow-x:auto;padding:12px}
 .side .sh{display:none}.catlist{flex-direction:row;gap:8px}.cat{flex:0 0 auto;min-width:150px}.appbar-in{flex-wrap:wrap}}
"""

JS = r"""
var D=JSON.parse(document.getElementById('APPDATA').textContent);
var app=document.getElementById('app');
var S={theme:'dark',lang:'zh',screen:'landing',member:'free',bf:'crypto',cat:null,date:'',opened:{},authMode:'signup'};
function today(){return new Date().toISOString().slice(0,10)}
function load(){try{var s=JSON.parse(localStorage.getItem('kzqj'));if(s)Object.assign(S,s)}catch(e){}if(S.date!==today()){S.date=today();S.opened={}}}
function save(){try{localStorage.setItem('kzqj',JSON.stringify({theme:S.theme,lang:S.lang,member:S.member,bf:S.bf,date:S.date,opened:S.opened,auth:S.auth}))}catch(e){}}
function L(){return S.lang}
function t(k){var v=T[k];return v?(v[S.lang]||v.zh):k}

var T={
 brand_sub:{zh:"历史K线",en:"Historical K-Line"},
 nav_home:{zh:"首页",en:"Home"},nav_how:{zh:"如何工作",en:"How it works"},nav_bf:{zh:"主战场",en:"Markets"},nav_pricing:{zh:"定价",en:"Pricing"},
 login:{zh:"登录",en:"Log in"},start_free:{zh:"免费开始",en:"Start free"},
 hero_kick:{zh:"历史K线形态引擎",en:"Historical K-Line Pattern Engine"},
 hero_h1:{zh:"在历史的刻痕里,<br>为你标出<span class='zh'>下一剑</span>的落点",en:"In history's notches,<br>we mark where the <span class='zh'>next move</span> may land"},
 hero_lead:{zh:"给我一段当前K线,「刻舟求剑」在数十年历史里找出结构最像的片段,统计它们“之后”怎么走——上涨概率、涨跌分布、形态拆解,相关系数与 DTW 双重匹配。我们坦白:船在动、剑会移,但把历史刻得够细,也能帮你逼近胜率。",en:"Give us your current candles. Kezhou finds the most structurally similar segments across decades of history and measures what happened next — up-probability, return distribution, pattern breakdown — matched by both correlation and DTW. We admit it: the boat drifts and the sword moves. But notch history finely enough and you can still close in on the odds."},
 hero_c1:{zh:"免费开始 · 每天 5 个品类",en:"Start free · 5 symbols/day"},hero_c2:{zh:"直接看演示",en:"See the demo"},
 hero_fine:{zh:"无需信用卡 · 加密 / 美股 / 大宗三大战场 · 灰蓝交易终端",en:"No card needed · Crypto / US stocks / Commodities · Slate trading terminal"},
 hero_cap1:{zh:"示例:BTC · 4小时线结构匹配",en:"Sample: BTC · 4h structural match"},hero_cap2:{zh:"相似度 0.92–0.96",en:"Similarity 0.92–0.96"},
 stat1:{zh:"真实标的已接入",en:"real symbols live"},stat2:{zh:"单标的历史K线深度",en:"candles of history / symbol"},stat3:{zh:"匹配度量(corr + DTW)",en:"match metrics (corr + DTW)"},stat4:{zh:"主战场:加密/美股/大宗",en:"markets: crypto/stocks/commodities"},
 how_t:{zh:"如何工作",en:"How it works"},how_s:{zh:"三步,从一段形态到一张概率地图。",en:"Three steps, from a pattern to a probability map."},
 s1h:{zh:"选主战场与品类",en:"Pick a market & symbol"},s1p:{zh:"加密、美股或大宗,挑一个你熟悉的品类。系统取其最近一段K线作为“当前形态”。",en:"Crypto, stocks or commodities — pick one you know. We take its latest window as the current pattern."},
 s2h:{zh:"全史滑动匹配",en:"Sliding match over history"},s2p:{zh:"对数收盘价归一化后,用相关系数与 DTW 在数十年里找出最像的历史片段,严格只取“当时之前”的数据。",en:"On normalized log-close, correlation and DTW find the closest historical windows — strictly using only data before each point."},
 s3h:{zh:"读懂概率地图",en:"Read the probability map"},s3p:{zh:"相似片段“之后”的上涨概率、涨跌分布、季节性与形态拆解,并与无条件基准对照,每张图都配注释。",en:"See up-probability, return spread, seasonality and pattern notes after the analogs — versus an unconditional baseline, every chart annotated."},
 bf_t:{zh:"选择你的主战场",en:"Choose your market"},bf_s:{zh:"进入后可随时切换。",en:"Switch anytime once inside."},
 bfc_h:{zh:"加密货币",en:"Crypto"},bfc_p:{zh:"BTC · ETH · SOL 及主流山寨,4小时线高频形态,历史最长、样本最多。",en:"BTC · ETH · SOL and majors, 4h intraday patterns — the deepest history and largest samples."},
 bfs_h:{zh:"美股 / 指数",en:"US stocks / indices"},bfs_p:{zh:"苹果、英伟达、标普、纳指、道琼斯……日线结构,复权价。",en:"Apple, NVIDIA, S&P, Nasdaq, Dow … daily structure, adjusted prices."},
 bfm_h:{zh:"大宗商品",en:"Commodities"},bfm_p:{zh:"黄金 · 原油 · 白银,避险与周期品的历史回声。",en:"Gold · Oil · Silver — the historical echoes of havens and cyclicals."},
 price_t:{zh:"价格",en:"Pricing"},price_s:{zh:"免费起步,$19/月 解锁 10 倍查询额度。随时取消。",en:"Free to start. $19/mo unlocks 10× queries. Cancel anytime."},
 plan_free:{zh:"免费 Free",en:"Free"},plan_pro:{zh:"Pro",en:"Pro"},plan_team:{zh:"Team",en:"Team"},
 per_mo:{zh:"/月",en:"/mo"},price_custom:{zh:"定制",en:"Custom"},pop:{zh:"最受欢迎",en:"Most popular"},
 cta_free:{zh:"免费开始",en:"Start free"},cta_pro:{zh:"升级 Pro",en:"Upgrade to Pro"},cta_team:{zh:"联系我们",en:"Contact us"},
 pay_soon:{zh:"支付方式(即将支持):",en:"Payment methods (coming soon):"},soon:{zh:"即将",en:"Soon"},
 pay_alipay:{zh:"支付宝",en:"Alipay"},pay_stripe:{zh:"Stripe 卡支付",en:"Stripe (cards)"},pay_crypto:{zh:"加密支付",en:"Crypto"},
 signup_t:{zh:"创建账户",en:"Create account"},login_t:{zh:"登录",en:"Log in"},
 signup_s:{zh:"邮箱注册,免费开始每天 5 个品类",en:"Sign up with email — free, 5 symbols a day"},login_s:{zh:"欢迎回来",en:"Welcome back"},
 email_l:{zh:"邮箱",en:"Email"},pass_l:{zh:"密码",en:"Password"},
 signup_btn:{zh:"创建账户并开始",en:"Create account & start"},login_btn:{zh:"登录",en:"Log in"},
 have_acct:{zh:"已有账户?",en:"Already have an account? "},no_acct:{zh:"还没有账户?",en:"No account yet? "},
 to_login:{zh:"登录",en:"Log in"},to_signup:{zh:"免费注册",en:"Sign up free"},back_home:{zh:"← 返回首页",en:"← Back to home"},
 ob_t:{zh:"选择你的主战场",en:"Choose your market"},ob_s:{zh:"先挑一个熟悉的市场,进入后可随时切换。",en:"Pick a familiar market to start — switch anytime inside."},
 g_crypto:{zh:"加密",en:"Crypto"},g_stock:{zh:"美股",en:"Stocks"},g_commodity:{zh:"大宗",en:"Commod."},
 gm_crypto:{zh:"加密货币",en:"Crypto"},gm_stock:{zh:"美股",en:"US Stocks"},gm_commodity:{zh:"大宗商品",en:"Commodities"},
 upgrade:{zh:"升级",en:"Upgrade"},logout:{zh:"退出",en:"Log out"},cats_h:{zh:"品类",en:"Symbols"},
 q_today:{zh:"今日",en:"Today"},q_syms:{zh:"品类",en:"symbols"},q_free:{zh:"免费",en:"Free"},q_pro:{zh:"Pro",en:"Pro"},
 ov_title:{zh:"战场总览",en:"Market overview"},
 ov_desc:{zh:"左侧选择一个品类,系统会在历史K线里找出与其当前形态最相似的片段,统计“之后”的走势。每查询一个新品类消耗 1 次今日额度。",en:"Pick a symbol on the left. We find the segments most similar to its current pattern across history and measure what came next. Each new symbol uses one of today's queries."},
 edge_cap:{zh:"各品类:匹配后相对基准的超额上涨概率",en:"By symbol: matched up-probability minus baseline"},
 edge_tip:{zh:"格子=历史相似片段之后,该品类上涨概率减去它自身的无条件基准(百分点)。绿=历史上此形态后更易涨,红=更弱。near/mid/far=近/中/远前瞻期。",en:"Cell = up-probability after similar historical windows minus the symbol's own unconditional baseline (pp). Green = historically more likely up after this shape; red = weaker. near/mid/far = short/mid/long horizon."},
 leg_title:{zh:"图例 · 每张图与图标的含义",en:"Legend · what each chart & icon means"},
 leg_k1:{zh:"形态+投影",en:"Pattern + projection"},leg_v1:{zh:"左图。<b>白/黑线</b>=所选品类最近窗口的归一化收盘;<b>蓝线</b>=相关系数匹配出的历史相似片段“之后”的中位走势;<b>紫线</b>=DTW 匹配的中位走势;竖虚线=“今天”分界,右侧为历史类比的推演,并非预测。",en:"Left. <b>White/black line</b> = normalized close of the current window; <b>blue</b> = median path after correlation-matched analogs; <b>purple</b> = median after DTW analogs; dashed line = today. The right side is a historical analogy, not a forecast."},
 leg_k2:{zh:"上涨概率",en:"Up-probability"},leg_v2:{zh:"中图。每个前瞻期三根柱:<b>corr</b>(相关匹配)、<b>DTW</b>、<b>基准</b>(该品类所有时点的无条件涨概率)。匹配柱高于基准=该形态历史上带来正向超额。50% 为参考线。",en:"Middle. Three bars per horizon: <b>corr</b>, <b>DTW</b>, and <b>baseline</b> (the symbol's unconditional up-rate). Match bars above baseline = positive edge historically. 50% reference line."},
 leg_k3:{zh:"同期季节性",en:"Same-date seasonality"},leg_v3:{zh:"右图。过去每年“同一日历日”之后的收益,<span class='up'>绿</span>涨<span class='dn'>红</span>跌。样本仅十余年,只看方向。",en:"Right. Return after the same calendar date each past year — <span class='up'>green</span> up, <span class='dn'>red</span> down. Only ~10-15 samples; read direction only."},
 leg_k4:{zh:"热力图",en:"Heatmap"},leg_v4:{zh:"战场总览。匹配后上涨概率减基准(百分点),横向近/中/远。",en:"Overview. Matched up-probability minus baseline (pp), across near/mid/far."},
 leg_k5:{zh:"图标",en:"Icons"},leg_v5:{zh:"<b class='up'>偏多</b>/<b class='dn'>弱于基准</b>=综合方向;<b>相似度</b> 0–1(越高类比越可靠);<s>★</s>=统计显著(★ p&lt;0.10,★★ p&lt;0.05);<span class='demobadge'>示例</span>=演示数据。",en:"<b class='up'>Bullish</b>/<b class='dn'>Below baseline</b> = overall direction; <b>similarity</b> 0–1 (higher = more reliable); <s>★</s> = significant (★ p&lt;0.10, ★★ p&lt;0.05); <span class='demobadge'>Demo</span> = sample data."},
 leg_k6:{zh:"免责",en:"Disclaimer"},leg_v6:{zh:"基于历史相似度的<b>概率描述,不是买卖建议</b>。历史相似≠未来重复——这正是“刻舟求剑”。风险自负。",en:"A <b>probabilistic description</b> from historical similarity — <b>not investment advice</b>. Similar history ≠ repeated future; that is the whole point of Kezhou. Trade at your own risk."},
 demo_note:{zh:"示例数据 — 该品类实时行情陆续接入,当前图表借用同类结构演示产品能力。",en:"Demo data — live feed for this symbol is being added; the chart borrows a similar structure to show the product."},
 kpi_mid:{zh:"中期上涨概率(基准 ",en:"Mid-horizon up-prob (baseline "},kpi_mid2:{zh:"%)",en:"%)"},
 kpi_sim:{zh:"最高相似度",en:"Peak similarity"},kpi_last:{zh:"最新收盘",en:"Last close"},kpi_rel:{zh:"类比可靠度",en:"Analog reliability"},
 fig_cap:{zh:"形态匹配全景:形态+投影 / 上涨概率 / 同期季节性",en:"Match panorama: pattern+projection / up-probability / seasonality"},
 fig_tip:{zh:"左:当前形态(白/黑)与相似历史片段之后的中位路径(蓝=corr,紫=DTW),竖虚线为今日。中:各前瞻期 corr/DTW/基准 的上涨概率。右:历年同期之后的收益。详见下方图例。",en:"Left: current pattern (white/black) vs median analog paths (blue=corr, purple=DTW); dashed = today. Middle: up-probability by horizon for corr/DTW/baseline. Right: return after the same date each year. See legend below."},
 morph_l:{zh:"形态拆解:",en:"Pattern: "},
 cond_t:{zh:"相似结构 → 前瞻概率",en:"Similar structure → forward probability"},
 sig_note:{zh:"★ p<0.10,★★ p<0.05(二项近似;窗口重叠→有效样本更小)。",en:"★ p<0.10, ★★ p<0.05 (binomial approx.; overlapping windows → smaller effective sample)."},
 season_t:{zh:"同期季节性",en:"Same-date seasonality"},matches_t:{zh:"最相似历史片段(相关系数)",en:"Most similar historical segments (correlation)"},
 h_fwd:{zh:"前瞻",en:"Horizon"},h_pupc:{zh:"涨概率<br>corr",en:"P(up)<br>corr"},h_medc:{zh:"corr中位",en:"corr med"},h_pupd:{zh:"涨概率<br>DTW",en:"P(up)<br>DTW"},h_medd:{zh:"DTW中位",en:"DTW med"},h_base:{zh:"基准",en:"base"},h_basem:{zh:"基准中位",en:"base med"},h_iqr:{zh:"corr 25–75%",en:"corr 25–75%"},
 se_after:{zh:"此后",en:"After"},se_up:{zh:"上涨年%",en:"up-years%"},se_med:{zh:"中位",en:"median"},se_n:{zh:"样本",en:"n"},
 modal_t:{zh:"今日额度已用完",en:"Daily quota reached"},
 modal_p:{zh:"免费版每天可查询 5 个品类。升级 <b>Pro($19/月)</b> 可将额度提升到每天 50 个品类,并解锁多周期对照与历史片段导出。",en:"Free covers 5 symbols per day. <b>Pro ($19/mo)</b> raises it to 50/day and unlocks multi-timeframe comparison and analog export."},
 modal_up:{zh:"立即升级 Pro(演示)",en:"Upgrade to Pro (demo)"},modal_price:{zh:"查看定价",en:"See pricing"},modal_later:{zh:"明天再来",en:"Maybe tomorrow"},
 back:{zh:"← 返回",en:"← Back"},
 foot:{zh:"刻舟求剑 · 历史K线概率引擎 &nbsp;|&nbsp; 数据:Binance / Yahoo Finance &nbsp;|&nbsp; 仅供研究,非投资建议",en:"Kezhou · Historical K-Line probability engine &nbsp;|&nbsp; Data: Binance / Yahoo Finance &nbsp;|&nbsp; Research only, not investment advice"}
};
var HLAB={crypto:{zh:['1天','5天','10天','15天','30天'],en:['1d','5d','10d','15d','30d']},day:{zh:['1周','2周','1月','2月','3月'],en:['1w','2w','1m','2m','3m']}};
var SLAB={crypto:{zh:['7天','30天','90天'],en:['7d','30d','90d']},day:{zh:['1周','1月','3月'],en:['1w','1m','3m']}};
var MHEAD={crypto:{zh:['日期','相关','+1天','+10天','+30天','回撤'],en:['Date','Corr','+1d','+10d','+30d','MaxDD']},day:{zh:['日期','相关','+1月','+3月','回撤'],en:['Date','Corr','+1m','+3m','MaxDD']}};
var VERD={bull:{zh:'偏多',en:'Bullish'},bullweak:{zh:'偏多·弱',en:'Bullish · weak'},below:{zh:'弱于基准',en:'Below baseline'},neutral:{zh:'中性',en:'Neutral'}};
var QMAP={high:{zh:'相似度高',en:'High'},mid:{zh:'中等',en:'Moderate'},low:{zh:'偏低',en:'Low'}};
function lset(grp){return grp==='crypto'?'crypto':'day'}

function setTheme(th){S.theme=th;document.documentElement.dataset.theme=th;save();renderScreen()}
function setLang(l){S.lang=l;save();renderScreen()}
function iconFor(k){return D.icons[k]||'circle'}
function refreshCharts(){document.querySelectorAll('img[data-ck]').forEach(function(im){im.src=D.charts[S.theme][im.dataset.ck]||''})}
function limit(){return S.member==='pro'?50:5}
function usedCount(){return Object.keys(S.opened[S.bf]||{}).length}

function show(scr){S.screen=scr;if(scr==='dashboard'&&!S.cat)S.cat=null;window.scrollTo(0,0);renderScreen()}
function renderScreen(){
 var h='';var s=S.screen;
 if(s==='dashboard')h=scr_dashboard();
 else h=mnav()+({landing:scr_landing,auth:scr_auth,onboarding:scr_onboarding,pricing:scr_pricing}[s]||scr_landing)();
 h+=modalHTML();
 app.innerHTML=h;
 if(s==='dashboard'){document.querySelectorAll('.bfswitch button').forEach(function(b){b.onclick=function(){switchBF(b.dataset.g)}});renderDash();}
 refreshCharts();
}
function langbtn(){return '<button class="iconbtn" onclick="setLang(S.lang===\'zh\'?\'en\':\'zh\')">'+(S.lang==='zh'?'EN':'中')+'</button>'}
function themebtn(){return '<button class="iconbtn" onclick="setTheme(S.theme===\'dark\'?\'light\':\'dark\')"><i class="ti ti-'+(S.theme==='dark'?'sun':'moon')+'"></i></button>'}

function mnav(){return '<div class="mnav"><div class="mnav-in">'+
 '<div class="brand" onclick="show(\'landing\')"><span class="logo">刻</span><span>'+(S.lang==='zh'?'刻舟求剑':'Kezhou')+'<small>'+t('brand_sub')+'</small></span></div>'+
 '<div class="links"><a onclick="show(\'landing\')">'+t('nav_home')+'</a><a onclick="show(\'landing\');setTimeout(function(){scrollToId(\'how\')},60)">'+t('nav_how')+'</a><a onclick="show(\'landing\');setTimeout(function(){scrollToId(\'bf\')},60)">'+t('nav_bf')+'</a><a onclick="show(\'pricing\')">'+t('nav_pricing')+'</a></div>'+
 '<div class="grow"></div>'+langbtn()+themebtn()+
 '<button class="btn ghost sm" onclick="S.authMode=\'login\';show(\'auth\')">'+t('login')+'</button>'+
 '<button class="btn pri sm" onclick="S.authMode=\'signup\';show(\'auth\')">'+t('start_free')+'</button></div></div>'}

function payStrip(){return '<div class="pay"><div class="paylabel">'+t('pay_soon')+'</div>'+
 '<span class="paym"><i class="ti ti-brand-alipay"></i>'+t('pay_alipay')+'<span class="soon">'+t('soon')+'</span></span>'+
 '<span class="paym"><i class="ti ti-credit-card"></i>'+t('pay_stripe')+'<span class="soon">'+t('soon')+'</span></span>'+
 '<span class="paym"><i class="ti ti-currency-bitcoin"></i>'+t('pay_crypto')+'<span class="soon">'+t('soon')+'</span></span></div>'}

function plans(){var cta="onclick=\"S.authMode='signup';show('auth')\"";
 var freeL=S.lang==='zh'?['每天 <b>5 个</b>品类查询','加密 / 美股 / 大宗全战场','corr + DTW 双匹配','形态 / 概率 / 季节性图','深浅色 · 中英双语']:['<b>5</b> symbol queries / day','All markets: crypto/stocks/commod.','corr + DTW dual match','pattern / probability / seasonality','dark-light · EN/中'];
 var proL=S.lang==='zh'?['每天 <b>50 个</b>品类查询','全部免费功能','多周期/多窗口对照','历史相似片段导出','优先接入新品类']:['<b>50</b> symbol queries / day','Everything in Free','multi-timeframe comparison','export historical analogs','priority new symbols'];
 var teamL=S.lang==='zh'?['不限品类 / 多席位','API 与批量匹配','自定义品类接入','专属支持']:['unlimited / multi-seat','API & batch matching','custom symbol onboarding','dedicated support'];
 function ul(a){return '<ul>'+a.map(function(x){return '<li><i class="ti ti-check"></i>'+x+'</li>'}).join('')+'</ul>'}
 return '<div class="plans">'+
 '<div class="plan"><h3>'+t('plan_free')+'</h3><div class="price">$0<small>'+t('per_mo')+'</small></div>'+ul(freeL)+'<button class="btn block" '+cta+'>'+t('cta_free')+'</button>'+payStrip()+'</div>'+
 '<div class="plan hi" data-pop="'+t('pop')+'"><h3>'+t('plan_pro')+'</h3><div class="price">$19<small>'+t('per_mo')+'</small></div>'+ul(proL)+'<button class="btn pri block" '+cta+'>'+t('cta_pro')+'</button>'+payStrip()+'</div>'+
 '<div class="plan"><h3>'+t('plan_team')+'</h3><div class="price">'+t('price_custom')+'</div>'+ul(teamL)+'<button class="btn block" onclick="alert(\'demo · sales@kezhouqiujian.app\')">'+t('cta_team')+'</button></div></div>'}

function scr_landing(){return '<div class="wrap">'+
 '<section class="hero"><div>'+
 '<div class="kick">'+t('hero_kick')+'</div><h1>'+t('hero_h1')+'</h1><p class="lead">'+t('hero_lead')+'</p>'+
 '<div class="cta"><button class="btn pri" onclick="S.authMode=\'signup\';show(\'auth\')"><i class="ti ti-arrow-right"></i>'+t('hero_c1')+'</button>'+
 '<button class="btn ghost" onclick="show(\'onboarding\')"><i class="ti ti-eye"></i>'+t('hero_c2')+'</button></div>'+
 '<div class="fine">'+t('hero_fine')+'</div></div>'+
 '<div class="heroart"><img data-ck="BTC" alt="BTC"><div class="cap"><span>'+t('hero_cap1')+'</span><span>'+t('hero_cap2')+'</span></div></div></section>'+
 '<div class="stats"><div class="stat"><b>9+</b><span>'+t('stat1')+'</span></div><div class="stat"><b>19,467</b><span>'+t('stat2')+'</span></div><div class="stat"><b>2</b><span>'+t('stat3')+'</span></div><div class="stat"><b>3</b><span>'+t('stat4')+'</span></div></div>'+
 '<section class="section" id="how"><h2>'+t('how_t')+'</h2><p class="sub">'+t('how_s')+'</p><div class="steps">'+
 '<div class="step"><div class="num">1</div><h3>'+t('s1h')+'</h3><p>'+t('s1p')+'</p></div>'+
 '<div class="step"><div class="num">2</div><h3>'+t('s2h')+'</h3><p>'+t('s2p')+'</p></div>'+
 '<div class="step"><div class="num">3</div><h3>'+t('s3h')+'</h3><p>'+t('s3p')+'</p></div></div></section>'+
 '<section class="section" id="bf"><h2>'+t('bf_t')+'</h2><p class="sub">'+t('bf_s')+'</p><div class="bfcards">'+
 '<div class="bfcard" onclick="show(\'onboarding\')"><div class="bi"><i class="ti ti-currency-bitcoin"></i></div><h3>'+t('bfc_h')+'</h3><p>'+t('bfc_p')+'</p></div>'+
 '<div class="bfcard" onclick="show(\'onboarding\')"><div class="bi"><i class="ti ti-chart-candle"></i></div><h3>'+t('bfs_h')+'</h3><p>'+t('bfs_p')+'</p></div>'+
 '<div class="bfcard" onclick="show(\'onboarding\')"><div class="bi"><i class="ti ti-barbell"></i></div><h3>'+t('bfm_h')+'</h3><p>'+t('bfm_p')+'</p></div></div></section>'+
 '<section class="section"><h2>'+t('price_t')+'</h2><p class="sub">'+t('price_s')+'</p>'+plans()+'</section>'+
 '</div><div class="foot">'+t('foot')+'</div>'}

function scr_auth(){var m=S.authMode;
 return '<div class="wrap"><div class="authbox">'+
 '<h2>'+t(m==='signup'?'signup_t':'login_t')+'</h2><p class="sub">'+t(m==='signup'?'signup_s':'login_s')+'</p>'+
 '<div class="field"><label>'+t('email_l')+'</label><input id="au-email" type="email" placeholder="you@example.com"></div>'+
 '<div class="field"><label>'+t('pass_l')+'</label><input type="password" placeholder="••••••••"></div>'+
 '<button class="btn pri block" onclick="doAuth()">'+t(m==='signup'?'signup_btn':'login_btn')+'</button>'+
 '<div class="swap">'+(m==='signup'?t('have_acct')+'<a onclick="S.authMode=\'login\';renderScreen()">'+t('to_login')+'</a>':t('no_acct')+'<a onclick="S.authMode=\'signup\';renderScreen()">'+t('to_signup')+'</a>')+'</div>'+
 '<div class="swap" style="margin-top:16px"><a onclick="show(\'landing\')">'+t('back_home')+'</a></div></div></div>'}

function scr_onboarding(){return '<div class="wrap"><div class="ob"><h2>'+t('ob_t')+'</h2><p class="sub">'+t('ob_s')+'</p><div class="bfcards">'+
 '<div class="bfcard" onclick="pickBF(\'crypto\')"><div class="bi"><i class="ti ti-currency-bitcoin"></i></div><h3>'+t('bfc_h')+'</h3><p>'+t('bfc_p')+'</p></div>'+
 '<div class="bfcard" onclick="pickBF(\'stock\')"><div class="bi"><i class="ti ti-chart-candle"></i></div><h3>'+t('bfs_h')+'</h3><p>'+t('bfs_p')+'</p></div>'+
 '<div class="bfcard" onclick="pickBF(\'commodity\')"><div class="bi"><i class="ti ti-barbell"></i></div><h3>'+t('bfm_h')+'</h3><p>'+t('bfm_p')+'</p></div></div>'+
 '<div class="swap" style="margin-top:22px"><a onclick="show(\'landing\')">'+t('back_home')+'</a></div></div></div>'}

function scr_pricing(){return '<div class="wrap"><section class="section"><h2>'+t('price_t')+'</h2><p class="sub">'+t('price_s')+'</p>'+plans()+
 '<div class="swap" style="margin-top:22px"><a onclick="show(S.auth?\'dashboard\':\'landing\')">'+t('back')+'</a></div></section></div>'}

function scr_dashboard(){return '<div class="appbar"><div class="appbar-in">'+
 '<div class="brand" onclick="show(\'landing\')"><span class="logo">刻</span><span>'+(S.lang==='zh'?'刻舟求剑':'Kezhou')+'</span></div>'+
 '<div class="bfswitch"><button data-g="crypto"><i class="ti ti-currency-bitcoin"></i>'+t('g_crypto')+'</button><button data-g="stock"><i class="ti ti-chart-candle"></i>'+t('g_stock')+'</button><button data-g="commodity"><i class="ti ti-barbell"></i>'+t('g_commodity')+'</button></div>'+
 '<div class="grow"></div><div class="quota" id="quota"></div>'+
 '<button class="btn pri sm" onclick="showUpgrade()"><i class="ti ti-bolt"></i>'+t('upgrade')+'</button>'+langbtn()+themebtn()+
 '<button class="iconbtn" onclick="show(\'landing\')" title="'+t('logout')+'"><i class="ti ti-logout"></i></button></div></div>'+
 '<div class="dash"><aside class="side"><div class="sh">'+t('cats_h')+'</div><div class="catlist" id="catlist"></div></aside><main class="main" id="dmain"></main></div>'}

function doAuth(){var em=document.getElementById('au-email');S.auth=true;S.email=(em&&em.value)||'trader@demo.com';save();show('onboarding')}
function pickBF(g){S.bf=g;S.cat=null;save();show('dashboard')}
function switchBF(g){S.bf=g;S.cat=null;save();renderDash()}
function catName(c){return S.lang==='zh'?c.nz:c.ne}
function catData(c){return D.assets[c.demo?c.tmpl:c.k]}
function assetName(a){return S.lang==='zh'?a.nz:a.ne}

function renderDash(){
 var g=S.bf,cats=D.cats[g];
 document.querySelectorAll('.bfswitch button').forEach(function(b){b.classList.toggle('on',b.dataset.g===g)});
 updateQuota();
 var sl=document.getElementById('catlist');sl.innerHTML='';
 cats.forEach(function(c){var opened=(S.opened[g]||{})[c.k];
  var d=document.createElement('div');d.className='cat'+(S.cat===c.k?' on':'');
  d.innerHTML='<div class="ci"><i class="ti ti-'+iconFor(c.k)+'"></i></div><div><div class="cn">'+c.k+(c.demo?' <span class="demobadge">'+(S.lang==='zh'?'示例':'Demo')+'</span>':'')+'</div><div class="csub">'+catName(c)+'</div></div><div class="cstate '+(opened?'opened':'')+'"><i class="ti ti-'+(opened?'circle-check':'lock-open')+'"></i></div>';
  d.onclick=function(){openCat(c)};sl.appendChild(d)});
 if(!S.cat)renderEmpty(g);else{var c=cats.find(function(x){return x.k===S.cat});if(c)renderAnalysis(c)}
 refreshCharts();
}
function updateQuota(){var u=usedCount(),l=limit(),p=Math.min(100,u/l*100);var q=document.getElementById('quota');
 q.innerHTML='<div class="ring '+(u>=l?'full':'')+'" style="--p:'+p+'"></div><span>'+t('q_today')+' <b>'+u+'</b>/'+l+' '+t('q_syms')+' · '+(S.member==='pro'?t('q_pro'):t('q_free'))+'</span>'}
function legendHTML(){return '<div class="legend"><h4>'+t('leg_title')+'</h4>'+
 [['chart-line','leg_k1','leg_v1'],['chart-bar','leg_k2','leg_v2'],['calendar','leg_k3','leg_v3'],['grid-dots','leg_k4','leg_v4'],['','leg_k5','leg_v5'],['alert-triangle','leg_k6','leg_v6']].map(function(r){
   return '<div class="legrow"><div class="lk">'+(r[0]?'<i class="ti ti-'+r[0]+'"></i>':'')+t(r[1])+'</div><div class="lv">'+t(r[2])+'</div></div>'}).join('')+'</div>'}
function renderEmpty(g){var gm=t('gm_'+g);document.getElementById('dmain').innerHTML=
 '<div class="empty-h">'+gm+' · '+t('ov_title')+'</div><p class="mut" style="font-size:13.5px;margin:2px 0 4px">'+t('ov_desc')+'</p>'+
 '<div class="figbox"><div class="fcap"><b>'+t('edge_cap')+'</b><span class="info"><i class="ti ti-info-circle"></i><span class="tip">'+t('edge_tip')+'</span></span></div><img data-ck="EDGE_'+g+'" alt="heatmap"></div>'+legendHTML()}
function openCat(c){var g=S.bf;S.opened[g]=S.opened[g]||{};if(!S.opened[g][c.k]){if(usedCount()>=limit()){showUpgrade();return}S.opened[g][c.k]=1;save()}S.cat=c.k;renderDash()}

function fmt(x){return (x>=0?'+':'')+x.toFixed(1)+'%'}
function cls(x){return x>0?'up':(x<0?'dn':'')}
function renderAnalysis(c){var a=catData(c),g=a.grp,ls=lset(g);
 var hl=HLAB[ls][L()],sl=SLAB[ls][L()],mh=MHEAD[ls][L()];
 var condRows=a.cond.map(function(r,i){return '<tr><td>'+hl[i]+'</td><td class="n"><b>'+r[0]+'%</b> <s>'+r[2]+'</s></td><td class="n '+cls(r[1])+'">'+fmt(r[1])+'</td><td class="n"><b>'+r[3]+'%</b> <s>'+r[5]+'</s></td><td class="n '+cls(r[4])+'">'+fmt(r[4])+'</td><td class="n mut">'+r[6]+'%</td><td class="n mut">'+fmt(r[7])+'</td><td class="n mut">'+fmt(r[8])+' … '+fmt(r[9])+'</td></tr>'}).join('');
 var seaRows=a.season.map(function(r,i){return '<tr><td>'+sl[i]+'</td><td class="n">'+r[0]+'%</td><td class="n '+cls(r[1])+'">'+fmt(r[1])+'</td><td class="n mut">'+r[2]+'</td></tr>'}).join('');
 var mhh=mh.map(function(x){return '<th>'+x+'</th>'}).join('');
 var mRows=a.matches.map(function(r){var tds='<td>'+r[0]+'</td><td class="n">'+r[1].toFixed(2)+'</td>';for(var i=2;i<r.length-1;i++)tds+='<td class="n '+cls(r[i])+'">'+fmt(r[i])+'</td>';tds+='<td class="n dn">'+fmt(r[r.length-1])+'</td>';return '<tr>'+tds+'</tr>'}).join('');
 var demoN=c.demo?'<div style="background:var(--warm);border:1px solid var(--gold);border-radius:10px;padding:10px 13px;font-size:12.5px;margin:10px 0;color:var(--ink2)"><b class="mut">'+(S.lang==='zh'?'示例数据':'Demo data')+'</b> — '+t('demo_note')+'</div>':'';
 document.getElementById('dmain').innerHTML=
 '<div class="an-head"><div class="an-title"><div class="ai"><i class="ti ti-'+iconFor(c.k)+'"></i></div><div><h2>'+c.k+' <span class="mut" style="font-size:14px">'+catName(c)+'</span>'+(c.demo?' <span class="demobadge">'+(S.lang==='zh'?'示例':'Demo')+'</span>':'')+'</h2>'+
 '<div class="as">'+(g==='crypto'?(S.lang==='zh'?'4小时线·60根':'4h · 60 bars'):(S.lang==='zh'?'日线·40根':'daily · 40 bars'))+' · '+a.refRange[0]+' → '+a.refRange[1]+' · '+(S.lang==='zh'?'相似度':'similarity')+' '+a.corr[0].toFixed(2)+'–'+a.corr[1].toFixed(2)+'</div></div></div>'+
 '<div class="verd '+a.vc+'">'+VERD[a.vk][L()]+'</div></div>'+demoN+
 '<div class="kpis"><div class="kpi"><b class="'+a.vc+'">'+a.midp+'%</b><span>'+t('kpi_mid')+a.basmid+t('kpi_mid2')+'</span></div>'+
 '<div class="kpi"><b>'+a.corr[1].toFixed(2)+'</b><span>'+t('kpi_sim')+'</span></div>'+
 '<div class="kpi"><b>'+a.last+'</b><span>'+t('kpi_last')+'</span></div>'+
 '<div class="kpi"><b>'+QMAP[a.qk][L()]+'</b><span>'+t('kpi_rel')+'</span></div></div>'+
 '<div class="figbox"><div class="fcap"><b>'+t('fig_cap')+'</b><span class="info"><i class="ti ti-info-circle"></i><span class="tip">'+t('fig_tip')+'</span></span></div><img data-ck="'+a.chart+'" alt="'+c.k+'"></div>'+
 '<p class="mut" style="font-size:13px">'+t('morph_l')+(S.lang==='zh'?a.mz:a.me)+'</p>'+
 '<div class="grid2"><div><h4 class="blk">'+t('cond_t')+' <span class="mut" style="font-weight:400;font-size:11px">corr / DTW / '+t('h_base')+'</span></h4>'+
 '<div class="tw"><table class="t"><thead><tr><th>'+t('h_fwd')+'</th><th>'+t('h_pupc')+'</th><th>'+t('h_medc')+'</th><th>'+t('h_pupd')+'</th><th>'+t('h_medd')+'</th><th>'+t('h_base')+'</th><th>'+t('h_basem')+'</th><th>'+t('h_iqr')+'</th></tr></thead><tbody>'+condRows+'</tbody></table></div><p class="note">'+t('sig_note')+'</p></div>'+
 '<div><h4 class="blk">'+t('season_t')+'</h4><div class="tw"><table class="t"><thead><tr><th>'+t('se_after')+'</th><th>'+t('se_up')+'</th><th>'+t('se_med')+'</th><th>'+t('se_n')+'</th></tr></thead><tbody>'+seaRows+'</tbody></table></div>'+
 '<h4 class="blk">'+t('matches_t')+'</h4><div class="tw"><table class="t"><thead><tr>'+mhh+'</tr></thead><tbody>'+mRows+'</tbody></table></div></div></div>'+legendHTML();
 refreshCharts();
}
function modalHTML(){return '<div id="mask" class="mask hidden"><div class="modal"><h3>'+t('modal_t')+'</h3><p>'+t('modal_p')+'</p>'+
 '<div class="row"><button class="btn pri block" onclick="doUpgrade()"><i class="ti ti-bolt"></i>'+t('modal_up')+'</button></div>'+
 '<div class="row"><button class="btn block" onclick="goPricing()">'+t('modal_price')+'</button><button class="btn ghost block" onclick="closeUpgrade()">'+t('modal_later')+'</button></div>'+
 payStrip()+'</div></div>'}
function showUpgrade(){document.getElementById('mask').classList.remove('hidden')}
function closeUpgrade(){var m=document.getElementById('mask');if(m)m.classList.add('hidden')}
function doUpgrade(){S.member='pro';save();closeUpgrade();if(S.screen==='dashboard')renderDash()}
function goPricing(){closeUpgrade();show('pricing')}
function scrollToId(id){var e=document.getElementById(id);if(e)e.scrollIntoView({behavior:'smooth'})}

load();
document.addEventListener('DOMContentLoaded',function(){document.documentElement.dataset.theme=S.theme;renderScreen()});
"""

HEAD_SCRIPT = "try{var s=localStorage.getItem('kzqj');var t=s?JSON.parse(s).theme:null;if(!t)t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}"

HTML = ("<!doctype html><html lang=\"zh\" data-theme=\"dark\"><head><meta charset=\"utf-8\">"
 "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
 "<title>刻舟求剑 · 历史K线概率引擎 / Kezhou</title>"
 "<link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.7.0/dist/tabler-icons.min.css\">"
 "<style>"+CSS+"</style><script>"+HEAD_SCRIPT+"</script></head><body>"
 "<div id=\"app\"></div>"
 "<script id=\"APPDATA\" type=\"application/json\">"+DATA+"</script>"
 "<script>"+JS+"</script></body></html>")

open("app.html","w",encoding="utf-8").write(HTML)
print("wrote app.html",len(HTML))
