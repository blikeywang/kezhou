import {finite,escape as E,tradeHorizonOf} from './model.mjs';

export function performance(trades,started,now){
 const closed=(trades??[]).filter(t=>finite(t.closed)&&t.closed<=now&&finite(t.pnl));
 const wins=closed.filter(t=>t.pnl>0),losses=closed.filter(t=>t.pnl<0),sum=a=>a.reduce((s,t)=>s+t.pnl,0);
 const positive=sum(wins),negative=-sum(losses),net=positive-negative;
 const days=finite(started)&&now>started?(now-started)/86400000:0;
 return {closed:closed.length,wins:wins.length,winRate:closed.length?wins.length/closed.length:null,net,
  expectancy:closed.length?net/closed.length:null,profitFactor:negative?positive/negative:null,
  avgWin:wins.length?positive/wins.length:null,avgLoss:losses.length?-negative/losses.length:null,
  entries:(trades??[]).filter(t=>finite(t.opened)&&t.opened<=now).length,
  entriesPerDay:days?trades.filter(t=>finite(t.opened)&&t.opened<=now).length/days:null,
  costs:closed.reduce((s,t)=>s+(t.legs?t.legs.reduce((n,l)=>n+(l.entryFee??0)+(l.exitFee??0),0):(t.entryFee??0)+(t.exitFee??0)),0)};
}
export function groups(trades,key,started,now){
 const map=new Map();for(const t of trades){const label=key(t);map.set(label,[...(map.get(label)??[]),t]);}
 return [...map].map(([label,rows])=>({label,...performance(rows,started,now)})).sort((a,b)=>a.net-b.net);
}
export function modelTime(data){return Math.max(data.model?.published??0,...(data.reports??[]).filter(r=>r.origin==='model').map(r=>r.published));}
export function renderPerformance(data,{fmt,cash,dt,badge,now=Date.now()}){
 const table=(rows)=>'<div class="ms-table-wrap"><table class="ms-table"><thead><tr><th>策略 / 版本</th><th>已平</th><th>胜率</th><th>净收益</th><th>每笔净期望</th><th>盈亏因子</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+E(r.label)+'</td><td>'+r.closed+'</td><td>'+(r.winRate===null?'—':fmt(r.winRate*100,1)+'%')+'</td><td>'+cash(r.net)+'</td><td>'+cash(r.expectancy)+'</td><td>'+fmt(r.profitFactor,2)+'</td></tr>').join('')+'</tbody></table></div>';
 const book=(account,title)=>{
  const p=performance(account.trades,account.started,now),stats=[['已平 / 盈利',p.closed+' / '+p.wins],['胜率',p.winRate===null?'—':fmt(p.winRate*100,1)+'%'],['每笔净期望',cash(p.expectancy)],['盈亏因子',fmt(p.profitFactor,2)],['日均入场',fmt(p.entriesPerDay,2)],['已平双边费用','$'+fmt(p.costs,2)]];
  const rows=groups(account.trades,t=>(t.strategy??t.pair??'组合')+' · '+tradeHorizonOf(t),account.started,now);
  const versions=groups(account.trades,t=>t.version??'历史版本',account.started,now);
  return '<article class="ms-detail-section"><h3>'+title+'</h3><div class="ms-levels">'+stats.map(([label,value])=>'<div><small>'+label+'</small><b>'+value+'</b></div>').join('')+'</div>'+table(rows)+'<details class="ms-event"><summary>按规则版本比较</summary>'+table(versions)+'</details></article>';
 };
 const model=modelTime(data),audit=data.review?.history?.[0]?.published;
 return '<div class="ms-row"><div><h2>策略复盘</h2><p>胜率、费用后净期望、交易次数分别看；账户独立统计，旧成交不重算成新策略成绩。</p></div>'+badge('真实模拟账本')+'</div>'+book(data.account,'单标的')+book(data.pairs.account,'相对价值组合')+
  '<article class="ms-detail-section"><h3>当前改进与验证</h3><p class="ms-prose">拍卖回归：失败突破后回到价值区，且没有相反的价值迁移。拍卖延续：连续收盘在冻结价值区外被接受，再等顺势回测。目标采用前方最近的POC、价值区边沿、未回补SP行或确认的结构拐点；缺目标时不给远价投射。新规则单笔风险0.125%，同向止损后至少等待一小时的新结构。</p><p class="ms-source">新版本为前向实验，样本不足时不能宣称提高胜率。日均入场按从开户至今的自然日计算，包含休市；费用不重复计入已净额结算的收益。</p></article><article class="ms-detail-section"><h3>模型工作是否持续</h3><p>最近模型研判：'+dt(model||null)+'<br>最近小时复核：'+dt(audit)+'</p><p class="ms-source">规则检查更新不代表模型已运行。只依据实际提交记录显示时间。</p></article>';
}
