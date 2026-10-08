import {renderReviewCards} from './reviews.mjs?v=1';
import {renderPerformance,modelTime} from './performance.mjs?v=1';
import {renderFlow,updateFlowChoice} from './flow.mjs?v=2';
import {SYMBOLS,HORIZONS,INSTRUMENTS,PAIRS,finite,escape as E,validSnapshot,quote,chartBars,currentGate,lastCheck,planState,legTargets,conditionalPrices,estimatedNet,tradeHorizonOf} from './model.mjs?v=2';

const $=id=>document.getElementById(id);
const fmt=(n,d)=>finite(n)?n.toLocaleString('en-US',{maximumFractionDigits:d??(Math.abs(n)<1?6:Math.abs(n)<100?3:2),minimumFractionDigits:0}):'—';
const cash=n=>finite(n)?(n>0?'+':n<0?'−':'')+'$'+fmt(Math.abs(n),2):'—';
const color=n=>!finite(n)?'muted':n>=0?'good':'bad-text';
const dt=(n,short=false)=>finite(n)&&n>0?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Singapore',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',...(short?{}:{second:'2-digit'}),hourCycle:'h23'}).format(n):'尚无记录';
const age=(t,now=Date.now())=>!finite(t)||t<=0?'未知':Math.max(0,Math.round((now-t)/60000))+' 分钟前';
const badge=(label,tone='')=>'<span class="ms-badge '+tone+'">'+E(label)+'</span>';
const empty=text=>'<div class="ms-empty">'+E(text)+'</div>';
const side=s=>s===1?'多':'空';
const levels=items=>'<div class="ms-levels">'+items.map(([label,value,tone])=>'<div><small>'+E(label)+'</small><b class="'+(tone??'')+'">'+E(value)+'</b></div>').join('')+'</div>';
const source=r=>'<div class="ms-source">'+E(r.source??'')+' · 数据截止 '+dt(r.dataThrough??r.through)+'（UTC+8）'+(r.caveat?'<br>'+E(r.caveat):'')+'</div>';
let data=null,history=null,tab='plans',horizon='10M',tradeBook='all',tradeHorizon='all',journalSymbol='all',journalHorizon='all',journalPage=0,loading=false,historyError='',clockTimer;
const market=s=>data.markets.find(m=>m.symbol===s);
const gate=(book,key,h='10M')=>currentGate(data.review?.gates,book,key,h);
const review=(book,id)=>lastCheck(data.review?.history,book,id);
const allTrades=()=>[...data.account.trades.map(t=>({...t,book:'single'})),...data.pairs.account.trades.map(t=>({...t,book:'pair'}))];
const pairReport=p=>data.pairs.reports.find(r=>r.pair===p);
const reviewMark=c=>c?badge((c.verdict==='green'?'✓ 合理':'! 挂起提示')+(Date.now()-c.published>5400000?' · 复核已旧':''),c.verdict==='green'&&Date.now()-c.published<=5400000?'good':'warn'):badge('待复核');
const action=(kind,id,label)=>'<button type="button" data-action="'+kind+'" data-id="'+E(id)+'">'+label+'</button>';

function lineChart(points,marks=[],title='价格结构',candles=false,limit=90){
  const rows=points.filter(p=>finite(p.time)&&finite(p.value)).slice(-limit);
  if(rows.length<2)return empty('可用完整行情不足，暂不绘图');
  const clean=marks.filter(m=>finite(m.value)&&m.value>0),W=760,H=270,left=12,right=118,top=22,bottom=32,pw=W-left-right,ph=H-top-bottom;
  const values=rows.flatMap(p=>candles?[p.high,p.low]:[p.value]).filter(finite).concat(clean.map(m=>m.value));
  let lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||hi*.01||1;lo-=range*.09;hi+=range*.12;range=hi-lo;
  const y=v=>top+(hi-v)/range*ph,x=i=>left+i*pw/(rows.length-1);
  let body='<svg class="ms-chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+E(title)+'"><title>'+E(title)+'</title>';
  for(let i=0;i<4;i++){const value=lo+range*i/3,py=y(value);body+='<path d="M'+left+' '+py+'H'+(left+pw)+'" stroke="#233349" stroke-dasharray="3 5"/><text x="'+(left+pw+9)+'" y="'+(py+4)+'">'+fmt(value)+'</text>';}
  if(candles){
    const width=Math.max(2,Math.min(7,pw/rows.length*.65));
    rows.forEach((p,i)=>{const c=p.value>=p.open?'#62cdb0':'#e78791',py=Math.min(y(p.open),y(p.value)),bh=Math.max(1,Math.abs(y(p.value)-y(p.open)));
      body+='<g><title>'+E(dt(p.time)+' 开 '+fmt(p.open)+' 高 '+fmt(p.high)+' 低 '+fmt(p.low)+' 收 '+fmt(p.value))+'</title><line x1="'+x(i)+'" x2="'+x(i)+'" y1="'+y(p.high)+'" y2="'+y(p.low)+'" stroke="'+c+'"/><rect x="'+(x(i)-width/2)+'" y="'+py+'" width="'+width+'" height="'+bh+'" fill="'+c+'"/></g>';
    });
  }else{
    body+='<polyline points="'+rows.map((p,i)=>x(i)+','+y(p.value)).join(' ')+'" fill="none" stroke="#72ddc1" stroke-width="2.2"/>';
    rows.forEach((p,i)=>{body+='<circle cx="'+x(i)+'" cy="'+y(p.value)+'" r="5" fill="transparent"><title>'+E(dt(p.time)+' · '+fmt(p.value))+'</title></circle>';});
  }
  rows.forEach((p,i)=>{if(p.pointLabel){const py=y(finite(p.markValue)?p.markValue:p.value);body+='<circle cx="'+x(i)+'" cy="'+py+'" r="5" fill="#f0bf70" stroke="#111c2a" stroke-width="2"/><text x="'+(x(i)+7)+'" y="'+(py-8)+'" style="fill:#f0bf70;font-size:14px;font-weight:700">'+E(p.pointLabel)+'</text>';}});
  let lastLabel=-100;
  clean.sort((a,b)=>b.value-a.value).forEach(m=>{const py=y(m.value),ly=Math.min(H-bottom-3,Math.max(py,lastLabel+17));lastLabel=ly;const c=m.color??'#c9b984';
    body+='<path d="M'+left+' '+py+'H'+(left+pw)+'" stroke="'+c+'" stroke-width="1" stroke-dasharray="5 4" opacity=".8"/><text class="chart-label" x="'+(left+pw+9)+'" y="'+(ly-3)+'" style="fill:'+c+'">'+E(m.label)+' '+fmt(m.value)+'</text>';
  });
  body+='<text x="'+left+'" y="'+(H-8)+'">'+E(dt(rows[0].time,true))+'</text><text x="'+(left+pw)+'" y="'+(H-8)+'" text-anchor="end">'+E(dt(rows.at(-1).time,true))+'</text></svg>';
  return body;
}
function candles(rows,marks,title){return lineChart((rows??[]).map(b=>({...b,value:b.close})),marks,title,true);}
function spark(curve){
  const rows=(curve??[]).filter(p=>finite(p.equity)).slice(-160);if(rows.length<2)return '';
  const min=Math.min(...rows.map(p=>p.equity)),max=Math.max(...rows.map(p=>p.equity)),r=max-min||1;
  return '<svg class="ms-spark" viewBox="0 0 150 68" role="img" aria-label="账户权益曲线"><polyline points="'+rows.map((p,i)=>i*150/(rows.length-1)+','+(60-(p.equity-min)/r*52)).join(' ')+'" fill="none" stroke="#65c7b2" stroke-width="1.8"/></svg>';
}
function accountCard(book,title){
  const account=book==='single'?data.account:data.pairs.account,box=book==='single'?data:data.pairs,pnl=box.equity-account.initial,closed=account.trades.filter(t=>t.closed),wins=closed.filter(t=>t.pnl>0).length;
  return '<article class="ms-account"><div class="ms-account-top"><div><div class="ms-kicker">'+title+' / 独立模拟账户</div><div class="ms-equity">$'+fmt(box.equity,2)+'<small>USD 权益</small></div><span class="'+color(pnl)+'">'+cash(pnl)+' · '+fmt(pnl/account.initial*100,2)+'%</span></div>'+spark(account.curve)+'</div><div class="ms-account-stats"><span>初始资金<b>$'+fmt(account.initial)+'</b></span><span>在持 / 已平<b>'+(account.trades.length-closed.length)+' / '+closed.length+'</b></span><span>历史胜率<b>'+(closed.length?fmt(wins/closed.length*100,1)+'%':'—')+'</b></span><span>最大回撤<b>'+fmt(box.maxDrawdown*100,2)+'%</b></span><span>开始时间<b>'+dt(account.started,true)+'</b></span></div></article>';
}
function renderStatus(){
  if(!data)return;
  const now=Date.now(),exec=data.cloud?.lastScheduledSuccess??data.account.lastRun,latest=data.review?.history?.[0],stale=data.markets.filter(m=>quote(m,now).stale);
  const model=modelTime(data);
  $('status').innerHTML='<span>交易检查 <b>'+dt(exec)+'</b> · '+age(exec)+'</span><span>模型研判 <b>'+dt(model||null)+'</b> · '+age(model)+'</span><span>小时复核 <b>'+dt(latest?.published)+'</b></span><span>页面发布 <b>'+dt(data.publishedAt)+'</b> · '+age(data.publishedAt)+' · UTC+8</span>';
  const notes=[];
  if(now-data.publishedAt>1500000)notes.push('公开快照发布于 '+age(data.publishedAt)+'，正在等待下一次同步');
  if(!exec||now-exec>1500000)notes.push('云端交易检查超过预期间隔');
  if(!latest||now-latest.published>5400000)notes.push('小时模型复核尚未更新');
  if(!model||now-model>5400000)notes.push('模型交易研判未持续更新；规则检查与模型研判是两个步骤');
  if(stale.length)notes.push(stale.map(m=>m.symbol).join(' / ')+' 的执行行情滞后或不可用；下方显示最后有效报价');
  $('connection').className='ms-notice'+(notes.length?' warn':'');
  $('connection').textContent=notes.join('。')+(notes.length?'。':'无需登录 · 模拟盘云端运行中 · 页面数据会自动更新');
  $('markets').innerHTML=SYMBOLS.map(s=>{const m=market(s),q=quote(m,now);return '<button class="ms-ticker" data-symbol="'+s+'"><div class="ms-ticker-head"><strong>'+s+'</strong>'+badge(q.stale?'行情滞后':'已更新',q.stale?'warn':'good')+'</div><div class="ms-ticker-price">'+fmt(q.price)+'</div><small>'+E(INSTRUMENTS[s].name)+'</small><small>截至 '+dt(q.through,true)+'</small></button>';}).join('');
}
function render(){
  renderStatus();$('accounts').innerHTML=accountCard('single','单标的')+accountCard('pair','相对价值组合');
  const trades=allTrades();$('openCount').textContent=trades.filter(t=>!t.closed).length;$('closedCount').textContent=trades.filter(t=>t.closed).length;
  $('workspace').hidden=false;$('download').disabled=false;renderPanel();
}
function planCard(r){
  const h=r.horizon??'10M',g=gate('single',r.symbol,h),state=planState({...r,stale:r.stale||quote(market(r.symbol),Date.now()).stale},g,Date.now()),p=r.plan;
  return '<article class="ms-card"><div class="ms-card-head"><h3>'+E(r.symbol)+'<small>'+E(INSTRUMENTS[r.symbol]?.name)+'</small></h3>'+badge(state.label,state.tone)+'</div><div class="ms-plan-price">'+fmt(r.price)+'<small>'+h+' 研判参考价</small></div><p class="ms-reason clamp">'+E(r.summary)+'</p>'+levels(p?[['计划入场',p.entryZone?p.entryZone.map(v=>fmt(v)).join(' – '):fmt(p.entry)],['止损',fmt(p.stop),'bad-text'],['目标止盈',fmt(p.target),'good']]:[['支撑',fmt(r.levels?.support)],['成交重心',fmt(r.costMap?.vwap??r.levels?.vwap)],['阻力',fmt(r.levels?.resistance)]])+'<div class="ms-card-foot"><small>'+dt(r.published,true)+'<br>'+E(r.strategy)+'</small>'+action('report',r.id,'依据与图表 ↗')+'</div></article>';
}
function renderPlans(){
  let html='<div class="ms-row"><div><h2>多周期交易计划</h2><p>每个周期独立记录条件、保护价和有效期。行情检查每 10 分钟运行，不等于每轮必须开仓。</p></div><div class="ms-segment">'+HORIZONS.map(h=>'<button data-horizon="'+h+'" class="'+(h===horizon?'active':'')+'">'+h+'</button>').join('')+'</div></div>';
  const pending=(data.pendingPlans??[]).filter(r=>(r.horizon??'10M')===horizon&&r.plan.expires>Date.now());
  if(pending.length)html+='<div class="ms-inline-note">尚在有效期的条件计划：'+pending.map(r=>action('report',r.id,E(r.symbol)+' '+side(r.plan.side)+' · '+dt(r.plan.expires,true)+' 到期')).join(' ')+'</div>';
  html+='<div class="ms-plan-grid">'+SYMBOLS.map(s=>{const r=data.reports.find(r=>r.symbol===s&&(r.horizon??'10M')===horizon);return r?planCard(r):'<article class="ms-card"><h3>'+s+'</h3>'+empty('该周期尚无研判')+'</article>';}).join('')+'</div>';
  html+='<div class="ms-row ms-section-gap"><div><h2>组合与相对价值</h2><p>比值交易按双腿同步行情执行。单腿结构目标是参考，组合退出仍按原计划。</p></div>'+badge('当前组合执行周期 10M')+'</div><div class="ms-pair-grid">';
  html+=data.pairs.reports.map(r=>{const state=planState(r,gate('pair',r.pair),Date.now());return '<article class="ms-card"><div class="ms-card-head"><h3>'+E(PAIRS[r.pair]??r.pair)+'</h3>'+badge(state.label,state.tone)+'</div><div class="ms-plan-price">'+fmt(r.ratio)+'</div><p class="ms-reason clamp">'+E(r.reason)+'</p>'+levels([['Z 分数',fmt(r.z,2)],['相关系数',fmt(r.correlation,2)]])+'<div class="ms-card-foot"><small>'+dt(r.dataThrough,true)+'</small>'+action('pair',r.id,'结构图 ↗')+'</div></article>';}).join('')+'</div>';
  return html;
}
function tradeLevels(t){
  return t.book==='pair'?levels([['入场比值',fmt(t.entryRatio)],['比值止损',fmt(t.stopRatio),'bad-text'],['比值止盈',fmt(t.targetRatio),'good']]):levels([['入场',fmt(t.entry)],['止损',fmt(t.stop),'bad-text'],['目标止盈',fmt(t.target),'good']]);
}
function tradePreview(t){
  const isPair=t.book==='pair',name=isPair?PAIRS[t.pair]??t.pair:t.symbol,p=Object.fromEntries(data.markets.map(m=>[m.symbol,quote(m,Date.now()).price])),net=estimatedNet(t,p);
  const stale=(isPair?t.legs.map(l=>l.symbol):[t.symbol]).some(s=>quote(market(s),Date.now()).stale);
  let html='<article class="ms-card"><div class="ms-card-head"><h3>'+E(name)+'<small>'+(isPair?'组合':(tradeHorizonOf(t))+' '+side(t.side))+'</small></h3>'+reviewMark(review(t.book,t.id))+'</div>';
  if(isPair)html+='<p class="ms-reason">'+t.legs.map(l=>E(side(l.side)+' '+l.symbol+' '+fmt(l.quantity)+' '+INSTRUMENTS[l.symbol].unit+' @ '+fmt(l.entry))).join('　/　')+'</p>';
  else html+='<p class="ms-reason">'+E(t.strategy)+' · '+fmt(t.quantity)+' '+E(INSTRUMENTS[t.symbol].unit)+'</p>';
  html+=tradeLevels(t)+'<div class="ms-stat-line"><span>估算平仓净损益 <b class="'+color(net)+'">'+cash(net)+'</b></span><span>初始风险 <b>$'+fmt(t.risk)+'</b></span></div>';
  if(t.exitRequest)html+='<p class="ms-inline-note">'+badge('已请求退出 · 等待执行','warn')+' 请求于 '+dt(t.exitRequest.published)+'。等待请求之后的新完整执行柱，实际成交会记入历史账本。</p>';
  if(stale)html+='<p class="ms-chart-caption warn-text">报价滞后，估算损益不代表当前可成交结果。</p>';
  const g=gate(t.book,isPair?t.pair:t.symbol,tradeHorizonOf(t));if(g?.verdict==='suspended')html+='<p>'+badge('该范围暂停新入场 · 原仓保护继续','warn')+'</p>';
  if(isPair){const r=pairReport(t.pair);html+=lineChart((r?.history??[]).map(p=>({...p,value:p.ratio})),[{value:t.entryRatio,label:'入场',color:'#8cb7ff'},{value:t.stopRatio,label:'止损',color:'#ec919a'},{value:t.targetRatio,label:'止盈',color:'#76d9b9'}],'组合比值与原始保护价');}
  else html+=candles(chartBars(market(t.symbol),tradeHorizonOf(t),Date.now()),[{value:t.entry,label:'入场',color:'#8cb7ff'},{value:t.stop,label:'止损',color:'#ec919a'},{value:t.target,label:'止盈',color:'#76d9b9'}],'最新结构与原始入场保护价');
  return html+'<div class="ms-card-foot"><small>入场 '+dt(t.opened)+'<br>费用与不利滑点已计入估算</small>'+action('trade',t.id,'持仓逻辑 / 单腿目标 ↗')+'</div></article>';
}
function renderPositions(){
  const trades=allTrades().filter(t=>!t.closed).sort((a,b)=>b.opened-a.opened);
  return '<div class="ms-row"><div><h2>当前持仓</h2><p>入场时的计划、止损和目标保持原始记录；复核挂起不取消既有仓位的保护性退出。</p></div>'+badge(trades.length+' 笔模拟持仓')+'</div>'+(trades.length?'<div class="ms-position-grid">'+trades.map(tradePreview).join('')+'</div>':empty('当前没有持仓。可在交易计划中查看下一步条件，历史成交保留在账本中。'));
}
function select(name,value,options,label){return '<select data-filter="'+name+'" aria-label="'+label+'">'+options.map(([v,text])=>'<option value="'+v+'"'+(v===value?' selected':'')+'>'+text+'</option>').join('')+'</select>';}
function renderClosed(){
  const trades=allTrades().filter(t=>t.closed&&(tradeBook==='all'||t.book===tradeBook)&&(tradeHorizon==='all'||(tradeHorizonOf(t))===tradeHorizon)).sort((a,b)=>b.closed-a.closed);
  let html='<div class="ms-row"><div><h2>历史成交</h2><p>全部已平仓模拟交易，保留进出场点位、双边费用和当时逻辑。</p></div><div class="ms-filter">'+select('tradeBook',tradeBook,[['all','全部账户'],['single','单标的'],['pair','组合']],'筛选账户')+select('tradeHorizon',tradeHorizon,[['all','全部周期'],...HORIZONS.map(h=>[h,h])],'筛选成交周期')+'</div></div>';
  if(!trades.length)return html+empty('此筛选下暂无已平仓记录');
  return html+'<div class="ms-table-wrap"><table class="ms-table"><thead><tr><th>交易</th><th>入场时间 / 出场时间</th><th>入场 / 出场</th><th>原止损 / 止盈</th><th>净损益</th><th>出场原因 / 复核</th><th>记录</th></tr></thead><tbody>'+trades.map(t=>'<tr><td><b>'+E(t.book==='pair'?PAIRS[t.pair]??t.pair:t.symbol+' '+side(t.side))+'</b><small>'+E(tradeHorizonOf(t))+' · '+E(t.book==='pair'?'双腿组合':t.strategy)+'</small></td><td>'+dt(t.opened,true)+'<small>'+dt(t.closed,true)+'</small></td><td>'+fmt(t.entryRatio??t.entry)+'<small>'+(t.book==='pair'?'双腿出场见详情':fmt(t.exit))+'</small></td><td>'+fmt(t.stopRatio??t.stop)+'<small>'+fmt(t.targetRatio??t.target)+'</small></td><td class="'+color(t.pnl)+'"><b>'+cash(t.pnl)+'</b>'+(finite(t.r)?'<small>'+fmt(t.r,2)+'R</small>':'')+'</td><td>'+E(t.reason??'')+'<small>'+reviewMark(review(t.book,t.id))+'</small></td><td>'+action('trade',t.id,'查看逻辑 ↗')+'</td></tr>').join('')+'</tbody></table></div>';
}
function renderReviews(){return renderReviewCards(data,{dt,badge,empty});}

async function loadHistory(){
  if(history||historyError)return;historyError='loading';
  try{const response=await fetch(new URL('data/history.json?v='+data.publishedAt,import.meta.url),{cache:'no-store',credentials:'omit',redirect:'error'});if(!response.ok)throw Error();
    const h=await response.json();if(h.schema!==data.schema||h.paper!==true||!Array.isArray(h.reports)||!Array.isArray(h.pairs))throw Error();
    history=h;historyError='';
  }catch{historyError='研判档案暂时读取失败；持仓与成交数据仍可查看。';}
  if(tab==='journal')renderPanel();
}
function renderJournal(){
  if(!history){if(!historyError)void loadHistory();return empty(historyError==='loading'?'正在读取研判档案…':historyError||'正在读取研判档案…');}
  const rows=[...history.reports.map(r=>({...r,book:'single'})),...history.pairs.map(r=>({...r,book:'pair'}))].filter(r=>(journalSymbol==='all'||(r.symbol??r.pair)===journalSymbol)&&(journalHorizon==='all'||(r.horizon??'10M')===journalHorizon)).sort((a,b)=>b.published-a.published),pages=Math.max(1,Math.ceil(rows.length/30));journalPage=Math.min(journalPage,pages-1);
  return '<div class="ms-row"><div><h2>研判记录</h2><p>'+E(data.history.scope)+' 时间 '+dt(data.history.from,true)+' — '+dt(data.history.through,true)+'</p></div><div class="ms-filter">'+select('journalSymbol',journalSymbol,[['all','全部标的 / 比值'],...SYMBOLS.map(s=>[s,s]),...Object.entries(PAIRS)],'筛选研判标的')+select('journalHorizon',journalHorizon,[['all','全部周期'],...HORIZONS.map(h=>[h,h])],'筛选研判周期')+'</div></div><div class="ms-table-wrap"><table class="ms-table"><thead><tr><th>发布时间</th><th>标的 / 周期</th><th>判断</th><th>参考入场</th><th>止损 / 目标</th><th>依据</th></tr></thead><tbody>'+rows.slice(journalPage*30,(journalPage+1)*30).map(r=>'<tr><td>'+dt(r.published,true)+'</td><td>'+E(r.symbol??r.pair)+'<small>'+E(r.horizon??'10M')+'</small></td><td>'+E(r.book==='pair'?({data:'数据不足',closed:'休市',ready:'有条件计划',waiting:'等待',blocked:'条件受阻'}[r.stage]??r.stage):{long:'偏多',short:'偏空',wait:'观望'}[r.direction])+'</td><td>'+fmt(r.plan?.entry??r.plan?.ratio)+'</td><td>'+fmt(r.plan?.stop)+'<small>'+fmt(r.plan?.target)+'</small></td><td>'+action(r.book==='pair'?'pair':'report',r.id,'原始依据 ↗')+'</td></tr>').join('')+'</tbody></table></div><div class="ms-journal-page"><button data-page="-1"'+(journalPage===0?' disabled':'')+'>上一页</button><span>第 '+(journalPage+1)+' / '+pages+' 页 · '+rows.length+' 份</span><button data-page="1"'+(journalPage>=pages-1?' disabled':'')+'>下一页</button></div>';
}
function renderPanel(){
  document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false');});
  $('panel').innerHTML=tab==='plans'?renderPlans():tab==='positions'?renderPositions():tab==='closed'?renderClosed():tab==='reviews'?renderReviews():tab==='performance'?renderPerformance(data,{fmt,cash,dt,badge}):tab==='flow'?renderFlow(data.cryptoOrderFlow,{E,fmt,dt,badge,empty,lineChart}):renderJournal();
}
function singleDetail(r){
  const p=r.plan,h=r.horizon??'10M',current=data.reports.some(x=>x.id===r.id);
  const marks=p?[{value:p.entry,label:'入场',color:'#8cb7ff'},{value:p.stop,label:'止损',color:'#ec919a'},{value:p.target,label:'止盈',color:'#76d9b9'}]:[{value:r.levels?.support,label:'支撑'},{value:r.levels?.resistance,label:'阻力'},{value:r.costMap?.vwap??r.levels?.vwap,label:'成本',color:'#8cb7ff'}];
  let html='<p class="ms-prose">'+E(r.summary)+'</p>'+levels(p?[['计划入场',p.entryZone?p.entryZone.map(v=>fmt(v)).join(' – '):fmt(p.entry)],['原始止损',fmt(p.stop),'bad-text'],['目标止盈',fmt(p.target),'good']]:[['支撑',fmt(r.levels?.support)],['成交重心',fmt(r.costMap?.vwap??r.levels?.vwap)],['阻力',fmt(r.levels?.resistance)]]);
  if(r.auction?.previous?.tpo){const ref=r.auction.previous.tpo;marks.push({value:ref.val,label:'TPO VAL',color:'#d4b97b'},{value:ref.poc,label:'TPO POC',color:'#d4b97b'},{value:ref.vah,label:'TPO VAH',color:'#d4b97b'});}
  if(current)html+=candles(r.chartBars?.length?r.chartBars:chartBars(market(r.symbol),h,Date.now()),marks,r.symbol+' '+h+' 价格与计划')+'<p class="ms-chart-caption">最新可用的完整 '+h+' K 线与本次研判价位。悬停蜡烛可读价格；历史研判不借用后续行情补画当时图形。</p>';
  html+='<div class="ms-two"><section class="ms-detail-section"><h4>下一步行为</h4><p class="ms-prose">'+E(r.action)+'</p>'+(p?'<p class="ms-source">执行窗口 '+dt(p.notBefore??r.published)+' — '+dt(p.expires)+'</p>':'')+'</section><section class="ms-detail-section"><h4>失效与相反证据</h4><p class="ms-prose">'+E(r.counter)+'</p></section></div>';
  if(r.costMap)html+='<section class="ms-detail-section"><h4>市场成本位置</h4>'+levels([['VWAP',fmt(r.costMap.vwap)],['成交密集区 POC*',fmt(r.costMap.poc)],['价值区',fmt(r.costMap.val)+' — '+fmt(r.costMap.vah)]])+'<p class="ms-source">'+E(r.costMap.reason)+' · OHLCV 估算，不代表实际市场持仓成本。</p></section>';
  if(r.auction){const a=r.auction,p=a.previous,t=p.tpo,v=p.vp;html+='<section class="ms-detail-section"><h4>TPO与拍卖状态</h4>'+levels([['位置',E(a.location)],['接受 / 拒绝',E(a.state)],['价值迁移',E(a.migration)],['前日TPO VAL / POC / VAH',t?[t.val,t.poc,t.vah].map(x=>fmt(x)).join(' / '):'历史不足'],['前日VP* VAL / POC / VAH',v?[v.val,v.poc,v.vah].map(x=>fmt(x)).join(' / '):'成交量不足'],['30M完整块',p.blocks+' / '+p.expectedBlocks]])+'<p class="ms-prose">'+E(a.reason)+'</p><p class="ms-source">'+E(a.session)+' · '+dt(p.from)+' — '+dt(p.through)+'<br>'+E(p.reason)+' 前三周等较长分布尚未取得完整源历史，不冒充已有数据。</p></section>';}
  html+='<section class="ms-detail-section"><h4>判断依据</h4><div class="ms-checks">'+(r.factors??[]).map(f=>'<div class="ms-check"><header><strong>'+E(f.name)+'</strong><span>'+E(f.value)+'</span></header><p>'+E(f.reason)+'</p></div>').join('')+'</div></section>';
  const g=gate('single',r.symbol,h);if(g)html+='<section class="ms-detail-section"><h4>当前复核范围</h4>'+badge(g.verdict==='suspended'?'新入场挂起':'已通过复核',g.verdict==='suspended'?'warn':'good')+'<p class="ms-prose">'+E(g.reason)+'</p></section>';
  return html+source(r)+'<div class="ms-source">发布时间 '+dt(r.published)+' · 版本 '+E(r.version)+'<br>原始研判校验 '+E(r.hash)+'</div>';
}
function pairStructure(r,t){
  const legs=r?.structure?.legs;if(!legs?.length)return empty('本份记录没有保存单腿结构，暂不生成结构目标或补造图形');
  const planSide=t?t.legs[0].side:r.plan?.side??(r.relative?.startsWith(r.pair.split('-')[0])?1:-1),sides=[planSide,-planSide];
  let html='<p class="ms-inline-note">单腿价位是结构参考，组合硬止盈止损仍以比值执行。若未找到历史结构，ATR 推演会明确标记。'+(!t&&!r.plan?' 当前没有组合入场计划，以下仅按相对强弱方向观察。':'')+'</p><div class="ms-two">';
  legs.forEach((leg,i)=>{const targets=legTargets(leg,sides[i]),entry=t?.legs[i]?.entry;
    html+='<section><h4>'+E(side(sides[i])+' '+leg.symbol)+' · 单腿结构参考</h4>'+candles(leg.bars,[...(entry?[{value:entry,label:'入场',color:'#8cb7ff'}]:[]),...targets.targets.map((v,n)=>({value:v.price,label:'T'+(n+1),color:'#76d9b9'})),{value:targets.invalidation?.price,label:'结构失效',color:'#ec919a'}],leg.symbol+' 结构目标')+'<div class="ms-checks">'+targets.targets.map((v,n)=>'<div class="ms-check"><b>T'+(n+1)+'　'+fmt(v.low)+' – '+fmt(v.high)+'</b><p>'+E(v.label)+'</p></div>').join('')+'</div><p class="ms-source">结构截至 '+dt(leg.through)+'<br>'+E((leg.notes??[]).join('；'))+'</p></section>';
  });
  html+='</div>';
  const ratio=t?.targetRatio??r.plan?.target,condition=conditionalPrices(r.prices,ratio);
  if(condition)html+='<section class="ms-detail-section"><h4>比值止盈的条件价格</h4><p class="ms-prose">目标比值 '+fmt(ratio)+'：若 '+E(legs[1].symbol)+' 保持 '+fmt(r.prices[1])+'，则 '+E(legs[0].symbol)+' 对应 '+fmt(condition[0])+'；若 '+E(legs[0].symbol)+' 保持 '+fmt(r.prices[0])+'，则 '+E(legs[1].symbol)+' 对应 '+fmt(condition[1])+'。这是两种独立假设，不是一对必须同时达到的止盈价。</p></section>';
  return html;
}
function pairDetail(r,t){
  const p=r.plan,marks=t?[{value:t.entryRatio,label:'入场',color:'#8cb7ff'},{value:t.stopRatio,label:'止损',color:'#ec919a'},{value:t.targetRatio,label:'止盈',color:'#76d9b9'}]:p?[{value:p.ratio,label:'计划入场',color:'#8cb7ff'},{value:p.stop,label:'止损',color:'#ec919a'},{value:p.target,label:'止盈',color:'#76d9b9'}]:[];
  return '<p class="ms-prose">'+E(r.reason)+'</p>'+lineChart((r.history??[]).map(v=>({...v,value:v.ratio})),marks,'比值走势与计划')+levels([['最新同步比值',fmt(r.ratio)],['Z 分数',fmt(r.z,2)],['样本相关性',fmt(r.correlation,2)]])+'<p class="ms-source">共同数据截至 '+dt(r.dataThrough)+' · '+E((r.sources??[]).join(' / '))+'</p><section class="ms-detail-section"><h4>双腿结构与目标参考</h4>'+pairStructure(r,t)+'</section><p class="ms-source">'+E(r.reversion)+'</p>';
}
function tradeDetail(t){
  let html=tradeLevels(t)+'<div class="ms-stat-line"><span>入场时间 <b>'+dt(t.opened)+'</b></span><span>初始风险 <b>$'+fmt(t.risk)+'</b></span>'+(t.closed?'<span>出场时间 <b>'+dt(t.closed)+'</b></span><span>已实现净损益 <b class="'+color(t.pnl)+'">'+cash(t.pnl)+'</b></span>':'')+'</div>';
  if(t.exitRequest)html+='<section class="ms-detail-section"><h4>模型退出请求</h4>'+badge(t.closed?'仓位已平':'等待新完整柱执行',t.closed?'good':'warn')+'<p class="ms-prose">'+E(t.exitRequest.reason)+'</p><p class="ms-source">请求时间 '+dt(t.exitRequest.published)+' · 研判 '+E(t.exitRequest.reviewId)+'。提交与实际成交分别记录。</p></section>';
  if(t.book==='pair'){
    html+='<div class="ms-table-wrap"><table class="ms-table"><thead><tr><th>方向 / 标的</th><th>数量</th><th>入场</th><th>出场</th><th>双边费用</th><th>净损益</th></tr></thead><tbody>'+t.legs.map(l=>'<tr><td>'+side(l.side)+' '+l.symbol+'</td><td>'+fmt(l.quantity)+' '+E(INSTRUMENTS[l.symbol].unit)+'</td><td>'+fmt(l.entry)+'</td><td>'+fmt(l.exit)+'</td><td>$'+fmt(l.entryFee+(l.exitFee??0))+'</td><td>'+cash(l.pnl)+'</td></tr>').join('')+'</tbody></table></div><section class="ms-detail-section"><h4>入场时冻结的依据</h4><p class="ms-prose">'+E(t.snapshot?.reason)+'</p><p class="ms-source">研判发布时间 '+dt(t.snapshot?.published)+' · 校验 '+E(t.snapshot?.hash)+'</p></section>';
    if(!t.closed){const r=pairReport(t.pair);if(r)html+='<section class="ms-detail-section"><h4>当前双腿结构（原始比值保护价保持不变）</h4>'+pairDetail(r,t)+'</section>';}
    else if(t.snapshot?.structure)html+=pairStructure(t.snapshot,t);
  }else{
    html+='<p class="ms-source">'+E(t.version??'')+' · '+E(t.strategy)+' · '+fmt(t.quantity)+' '+E(INSTRUMENTS[t.symbol].unit)+' · 入场费 $'+fmt(t.entryFee)+' / 出场费 '+(t.closed?'$'+fmt(t.exitFee):'未发生')+'</p><section class="ms-detail-section"><h4>入场时冻结的依据</h4><p class="ms-prose">'+E(t.entrySnapshot?.summary??'这笔历史记录没有冻结的入场描述')+'</p><p class="ms-prose">'+E(t.entrySnapshot?.action)+'</p><p class="ms-source">发布 '+dt(t.entrySnapshot?.published)+' · 数据截至 '+dt(t.entrySnapshot?.dataThrough)+'<br>校验 '+E(t.entrySnapshot?.hash)+'</p></section>';
    if(t.exitLogic)html+='<section class="ms-detail-section"><h4>实际退出依据</h4><p class="ms-prose">'+E(t.exitLogic)+'</p><p class="ms-source">执行柱区间 '+dt(t.exitBarStart)+' — '+dt(t.exitBarEnd)+'</p></section>';
  }
  const c=review(t.book,t.id);if(c)html+='<section class="ms-detail-section"><h4>最近一次模型复核</h4>'+reviewMark(c)+'<p class="ms-prose">'+E(c.reason)+'</p><p class="ms-source">'+dt(c.published)+'</p></section>';
  return html+'<section class="ms-detail-section"><h4>持仓事件记录 · '+(t.events??[]).length+' 条</h4><div class="ms-events">'+[...(t.events??[])].reverse().map(e=>'<details class="ms-event"><summary><time>'+dt(e.time)+'</time>'+E(({open:'入场',exit:'出场',review:'持仓复核',migration:'规则版本'}[e.kind]??'持仓记录'))+(finite(e.price)?' · '+fmt(e.price):'')+'</summary><p>'+E(e.reason)+'</p></details>').join('')+'</div></section>';
}
function openDetail(kind,id){
  if(!data)return;
  let title,body;
  if(kind==='trade'){const t=allTrades().find(t=>t.id===id);if(!t)return;title=(t.book==='pair'?PAIRS[t.pair]??t.pair:t.symbol)+' · '+(t.closed?'历史成交':'当前持仓');body=tradeDetail(t);}
  else if(kind==='report'){const r=[...data.reports,...(data.pendingPlans??[]),...(history?.reports??[])].find(r=>r.id===id);if(!r)return;title=r.symbol+' · '+(r.horizon??'10M')+' · '+dt(r.published,true);body=singleDetail(r);}
  else{const r=[...data.pairs.reports,...(data.pairs.pendingPlans??[]),...(history?.pairs??[])].find(r=>r.id===id);if(!r)return;title=(PAIRS[r.pair]??r.pair)+' · '+dt(r.published,true);body=pairDetail(r);}
  $('detailTitle').textContent=title;$('detailBody').innerHTML=body;if(!$('detail').open)$('detail').showModal();$('detail').scrollTop=0;
}
async function refresh(manual=false){
  if(loading)return;loading=true;$('refresh').disabled=true;
  try{
    const options={cache:'no-store',credentials:'omit',redirect:'error'};
    const versionResponse=await fetch(new URL('data/status.json?v='+Math.floor(Date.now()/60000),import.meta.url),options);
    if(!versionResponse.ok)throw Error('无法读取发布版本');
    const version=await versionResponse.json();
    if(version.schema!=='traderhome-public-paper-v1'||!finite(version.publishedAt))throw Error('发布版本无效');
    if(data&&version.publishedAt===data.publishedAt){
      renderStatus();if(tab!=='journal')renderPanel();
      if(manual)$('connection').textContent+=' · 已检查，目前没有更新的公开快照。';
      return;
    }
    const response=await fetch(new URL('data/latest.json?v='+Math.floor(Date.now()/60000),import.meta.url),{cache:'no-store',credentials:'omit',redirect:'error'});
    if(!response.ok)throw Error('HTTP '+response.status);
    const next=await response.json();if(!validSnapshot(next))throw Error('快照格式无效');
    if(next.publishedAt<version.publishedAt)throw Error('部署缓存尚未同步');
    if(data&&next.publishedAt<data.publishedAt)throw Error('缓存版本落后于当前页面');
    const changed=!data||next.publishedAt!==data.publishedAt;
    data=next;if(changed){history=null;historyError='';render();}else renderStatus();
    if(manual&&!changed){$('connection').textContent+=' · 已检查，目前没有更新的公开快照。';}
  }catch{
    $('connection').className='ms-notice bad';$('connection').textContent=data?'本次同步未成功，保留上次完整账本；页面不会补造行情或订单。':'公开数据尚未读取成功，请稍后更新页面；无需登录。';
  }finally{loading=false;$('refresh').disabled=false;}
}
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.tab){tab=b.dataset.tab;renderPanel();}
  else if(b.dataset.horizon){horizon=b.dataset.horizon;renderPanel();}
  else if(b.dataset.action)openDetail(b.dataset.action,b.dataset.id);
  else if(b.dataset.symbol&&data){const r=data.reports.find(r=>r.symbol===b.dataset.symbol&&(r.horizon??'10M')===horizon);if(r)openDetail('report',r.id);}
  else if(b.dataset.page){journalPage+=Number(b.dataset.page);renderPanel();}
});
document.addEventListener('change',event=>{
  const e=event.target;if(e.dataset.flowKey){updateFlowChoice(e.dataset.flowKey,e.dataset.flowField,e.value);renderPanel();return;}if(!e.dataset.filter)return;
  if(e.dataset.filter==='tradeBook')tradeBook=e.value;
  if(e.dataset.filter==='tradeHorizon')tradeHorizon=e.value;
  if(e.dataset.filter==='journalSymbol'){journalSymbol=e.value;journalPage=0;}
  if(e.dataset.filter==='journalHorizon'){journalHorizon=e.value;journalPage=0;}
  renderPanel();
});
$('refresh').addEventListener('click',()=>refresh(true));$('closeDetail').addEventListener('click',()=>$('detail').close());
$('detail').addEventListener('click',e=>{if(e.target===$('detail')){const r=$('detail').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('detail').close();}});
$('download').addEventListener('click',()=>{if(!data)return;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='traderhome-paper-ledger-'+new Date(data.publishedAt).toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
void refresh();clockTimer=setInterval(()=>{if(!document.hidden)void refresh();},60000);
