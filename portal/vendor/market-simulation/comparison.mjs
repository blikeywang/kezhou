// ICT-2 is computed in the repo (tools/market_simulation/ict2.py) and published as data/ict2.json.
// ict2Book() maps that file onto the same book shape as data.comparison.books, so the table,
// cards and ledger reuse one renderer. Without ict2.json the page shows the original two books.
const SIDE={long:'做多',short:'做空',none:'无方向'},TREND={bull:'多',bear:'空',neutral:'中性'},
 FLOW={pass:'通过',reject:'反对',unavailable:'无订单流数据'},FLOW_STATUS={ok:'',unavailable:'无订单流数据',stale:'数据过期'};
const STATES={data:'数据不足',htf_none:'HTF 无方向',waiting:'等待扫单',sweep:'扫单已收回',shift:'结构已转向',ob_marked:'订单块已标记',
 outside_kz:'不在 Kill Zone',wrong_zone:'不在折价/溢价区',flow_reject:'订单流反对',ready:'满足条件',blocked:'空间不足',quota:'本时段额度已用',open:'持仓中',invalid:'事件作废'};
const isIct2=b=>b.key==='ICT-2';
export function ict2Book(doc){
 if(!doc||!Array.isArray(doc.trades)||!Array.isArray(doc.reports)||!doc.metrics)return null;
 const ICT_KEYS=['stage','stageLabel','grade','bias','killZone','ob','zone','flow','sweep','shift','gap','entry','stop','target','targetLabel','netRR','eventId','side','nextKillZone'];
 return {key:'ICT-2',label:doc.label??'ICT-2',rules:doc.rules,metrics:doc.metrics,
  account:{initial:doc.initial,trades:doc.trades.map(t=>({...t,entrySnapshot:{summary:t.snapshot?.reason??''},exitLogic:t.reason})),decisions:doc.decisions??[]},
  reports:doc.reports.map(r=>({symbol:r.symbol,summary:r.reason??'',action:r.nextKillZone?'下一个 Kill Zone：'+r.nextKillZone:'',chartBars:r.chartBars,dataThrough:r.dataThrough,published:doc.updated,
   ict:Object.fromEntries(ICT_KEYS.filter(k=>k in r).map(k=>[k,r[k]]))}))};
}
function ict2Cells(e,{E,fmt,dt,badge}){
 const b=e.bias,kz=e.killZone,ob=e.ob,f=e.flow;
 if(!b&&!kz&&!ob&&!f)return '';
 let html='<div class="ms-levels" style="border-top:0;margin-top:-12px">';
 html+='<div><small>HTF 偏向（D1 / H4）</small><b>'+(b?E(SIDE[b.side]??'—')+' <span class="muted">'+E(TREND[b.d1]??'—')+' / '+E(TREND[b.h4]??'—')+'</span>':'—')+'</b></div>';
 html+='<div><small>H4 区间 · 平衡点</small><b>'+(b?fmt(b.rangeLow)+'–'+fmt(b.rangeHigh)+' · '+fmt(b.eq):'—')+'</b></div>';
 html+='<div><small>Kill Zone</small><b class="'+(kz?.active?'good':'muted')+'">'+(kz?E(kz.name??'—')+(kz.date?' · '+E(kz.date):''):E(e.nextKillZone?'下一个：'+e.nextKillZone:'—'))+'</b></div>';
 html+='<div><small>订单块 OB</small><b>'+(ob?fmt(ob.low)+'–'+fmt(ob.high):'—')+'</b></div>';
 html+='<div><small>OB 中位</small><b>'+(ob?fmt(ob.mean)+(ob.mitigated==null?'':' · '+(ob.mitigated?'已缓解':'未缓解')):'—')+'</b></div>';
 html+='<div><small>订单流</small><b class="'+(f?.verdict==='pass'?'good':f?.verdict==='reject'?'bad-text':'muted')+'">'+(f?E(f.status&&f.status!=='ok'?FLOW_STATUS[f.status]??f.status:FLOW[f.verdict]??'—')+(f.oiScore!=null&&f.verdict!=='unavailable'?' · OI '+(f.oiScore>0?'+':'')+fmt(f.oiScore,0):''):'—')+'</b></div>';
 html+='</div>';
 const tags=[];
 if(e.grade)tags.push(badge('入场区 '+e.grade+(e.grade==='A'?' · OB∩FVG':' · OB'),e.grade==='A'?'good':''));
 if(e.valueEdge)tags.push(badge('价值区边缘'));
 if(f&&f.status&&f.status!=='ok')tags.push(badge(FLOW_STATUS[f.status]??f.status,'warn'));
 return html+(tags.length?'<div class="ms-gates">'+tags.join('')+'</div>':'');
}
function ict2Notes(e,{E,fmt,dt}){
 const n=[],f=e.flow,z=e.zone;
 if(z)n.push('入场区：'+fmt(z.low)+'–'+fmt(z.high)+(e.grade==='A'?'（OB 与 FVG 重叠）':''));
 if(e.ob?.from)n.push('OB 形成：'+dt(e.ob.from,true)+(e.ob.through?'–'+dt(e.ob.through,true):''));
 if(e.targetLabel)n.push('目标：'+E(e.targetLabel));
 if(f?.status==='ok')n.push('订单流：扫单失衡 '+fmt(f.sweepImb,2)+' · 位移失衡 '+fmt(f.dispImb,2)+' · 回踩失衡 '+fmt(f.retestImb,2)+' · 扫单 OI '+fmt(f.sweepOiPct,2)+'% · 位移 OI '+fmt(f.dispOiPct,2)+'%'+(f.reason?' · '+E(f.reason):''));
 else if(f?.reason)n.push('订单流：'+E(f.reason));
 return n.length?'<p class="ms-source">'+n.join('<br>')+'</p>':'';
}
export function renderComparison(source,{E,fmt,cash,dt,badge,empty,candles},ict2Doc=null){
 const extra=ict2Book(ict2Doc),data=source&&extra?{...source,books:[...source.books.filter(b=>b.key!=='ICT-2'),extra]}:source;
 if(!data)return '<h2>ICT × TPO 同期对照</h2>'+empty('等待下一轮云端检查初始化前向对照；尚无成绩。');
 let html='<div class="ms-row"><div><h2>ICT × TPO 同期对照</h2><p>同一段市场，各组独立模拟账户。先记录，再判断哪种方法适合哪些行情。</p></div>'+badge('前向实验')+'</div><p class="ms-inline-note">'+E(data.rules)+'</p><p class="ms-source">开始 '+dt(data.started)+' · 最近检查 '+dt(data.updated)+' · 各组表现不与原主账户混算</p>';
 html+='<div class="ms-table-wrap"><table class="ms-table"><thead><tr><th>方法</th><th>在持 / 已平</th><th>总损益（含浮动）</th><th>已实现净损益</th><th>胜率</th><th>平均净 R</th><th>盈利因子</th><th>最大回撤</th></tr></thead><tbody>';
 for(const b of data.books){const m=b.metrics;html+='<tr><td><b>'+E(b.label)+'</b></td><td>'+m.open+' / '+m.closed+'</td><td>'+cash(m.equity-b.account.initial)+'</td><td>'+cash(m.netPnl)+'</td><td>'+(m.winRate==null?'—':fmt(m.winRate*100,1)+'%')+'</td><td>'+fmt(m.meanR,2)+'</td><td>'+fmt(m.profitFactor,2)+'</td><td>'+fmt(m.maxDrawdown*100,2)+'%</td></tr>';}
 html+='</tbody></table></div><p class="ms-notice">'+E(data.books.some(b=>b.metrics.closed<30||b.metrics.days<14)?'样本不足：每组至少30笔平仓、14天后，才开始描述性比较。零交易不代表零风险或更好的策略。':'可开始描述性比较，仍需按行情与时段持续观察；没有证明某组长期更优。')+' 盈利因子在尚无亏损交易时显示“—”。</p>';
 for(const book of data.books.filter(b=>b.key==='ICT'||isIct2(b))){const v2=isIct2(book);
 html+='<div class="ms-row ms-section-gap"><div><h2>'+E(book.label??book.key)+' 现在怎么看</h2><p>'+(v2?(book.rules??'在原 ICT 信号上加四道门槛：HTF 偏向一致 → Kill Zone 内 → 入场区是订单块（最好与 FVG 重叠）→ 订单流不反对（仅 BTC/ETH）。'):'扫过已确认摆动高低点 → 位移与结构转向（MSS）→ 三柱缺口（FVG）→ 独立回踩 → 最近流动性目标。')+'</p></div></div><div class="ms-plan-grid">';
 for(const r of (book.reports??[]).filter((r,i,a)=>i===a.findIndex(x=>x.symbol===r.symbol))){const e=r.ict??{},p=r.plan,states={...STATES,retest:v2?'等待回踩订单块':'等待FVG回踩'};html+='<article class="ms-card"><div class="ms-card-head"><h3>'+E(r.symbol)+'</h3>'+badge(e.stageLabel??states[e.stage]??'等待',e.stage==='ready'?'good':e.stage==='invalid'||e.stage==='flow_reject'?'bad':'')+'</div><p class="ms-prose">'+E(r.summary)+'</p><div class="ms-levels"><div><small>扫单参考位</small><b>'+fmt(e.sweep?.level)+'</b></div><div><small>MSS 边界</small><b>'+fmt(e.shift?.level)+'</b></div><div><small>FVG</small><b>'+fmt(e.gap?.low)+'–'+fmt(e.gap?.high)+'</b></div><div><small>冻结止损</small><b>'+fmt(e.stop)+'</b></div><div><small>最近结构目标</small><b>'+fmt(e.target)+'</b></div><div><small>费用后预估 R</small><b>'+fmt(e.netRR,2)+'</b></div></div>'+ict2Cells(e,{E,fmt,dt,badge})+'<details><summary>价格图与下一步</summary>'+candles(r.chartBars??[],[{value:e.sweep?.level,label:'扫单位'},{value:e.shift?.level,label:'MSS'},{value:e.gap?.low,label:'FVG下沿',color:'#8cb7ff'},{value:e.gap?.high,label:'FVG上沿',color:'#8cb7ff'},{value:e.stop,label:'止损',color:'#ec919a'},{value:e.target,label:'目标',color:'#76d9b9'},{value:e.ob?.low,label:'OB下沿',color:'#d6a8ff'},{value:e.ob?.high,label:'OB上沿',color:'#d6a8ff'},{value:e.bias?.eq,label:'H4平衡',color:'#f0bf70'}],r.symbol+' '+(book.label??book.key)+' 5M冻结证据')+'<p class="ms-prose">'+E(r.action)+'</p>'+ict2Notes(e,{E,fmt,dt})+'<p class="ms-source">'+(v2?'':E(e.premiumDiscount??'区间位置尚未形成')+' · '+E(e.session??'')+'<br>')+'数据截止 '+dt(r.dataThrough)+' · 发布 '+dt(r.published)+(p?'<br>可执行窗口 '+dt(p.notBefore)+'–'+dt(p.expires):'')+'</p></details></article>';}
 html+='</div>';}
 html+='<div class="ms-two ms-section-gap">';
 for(const b of data.books){html+='<section class="ms-detail-section"><h3>'+E(b.label)+' · 独立账本</h3><p>'+E(b.metrics.assessment)+'</p><details><summary>持仓与历史成交（'+b.account.trades.length+'）</summary>';
 if(!b.account.trades.length)html+=empty('暂未成交。满足预先发布条件后的交易会记录在这里。');
 else html+='<div class="ms-table-wrap"><table class="ms-table"><thead><tr><th>标的 / 方向</th><th>入场</th><th>原止损 / 目标</th><th>出场 / 净盈亏</th><th>依据</th></tr></thead><tbody>'+[...b.account.trades].reverse().map(t=>'<tr><td>'+E(t.symbol)+' '+(t.side===1?'多':'空')+'<br>'+dt(t.opened)+'</td><td>'+fmt(t.entry)+'</td><td>'+fmt(t.stop)+' / '+fmt(t.target)+'</td><td>'+(t.closed?fmt(t.exit)+'<br>'+cash(t.pnl)+' · '+fmt(t.r,2)+'R<br>'+dt(t.closed):'持仓中')+'</td><td><details><summary>查看原始依据</summary><p>'+E(t.entrySnapshot?.summary??'')+'</p><p>'+E(t.exitLogic??'按原保护价管理')+'</p></details></td></tr>').join('')+'</tbody></table></div>';
 html+='</details><details><summary>最近执行与放弃原因</summary>'+(b.account.decisions.length?b.account.decisions.slice(-12).reverse().map(d=>'<p class="ms-source">'+dt(d.time)+' · '+E(d.symbol)+'<br>'+E(d.reason)+'</p>').join(''):empty('尚无执行事件'))+'</details></section>';}
 html+='</div><details class="ms-detail-section"><summary>实验定义与限制</summary><p class="ms-prose">这是 ICT 2022 思路的机械近似：摆动点需左右各两根完整5M确认；扫过至少一跳并收回；六根内出现反向MSS，位移实体至少0.8 ATR、全幅至少1.2 ATR；三柱FVG至少两跳，再等后续回踩收回中位。信号只在观察时最新完整柱确认，不回补旧入场。原始结构止损固定，最近已知摆动目标不足净1R即等待。纽约时段和折溢价记录为背景，未作为六标的共同硬门槛。以上阈值是本实验定义，并非官方承诺。</p><p class="ms-prose">各组使用相同的费用、风险和撮合规则；主账户与各组对照本金互相独立。对照组展示方法本身，小时模型评价记录在研判中。胜率需要结合平均净R、盈利因子、回撤及持仓数量一起看。</p><a href="https://www.youtube.com/watch?v=Bkt8B3kLATQ" target="_blank" rel="noopener noreferrer">ICT 官方 2022 第6课：FVG 与结构转向 ↗</a></details>';
 return html;
}
