export const SYMBOLS = ['BTC','ETH','XAU','XAG','NQ','CL'];
export const HORIZONS = ['10M','1H','4H','1D','1W'];
export const INSTRUMENTS = {
  BTC:{name:'比特币',unit:'BTC',multiplier:1,tick:.01,fee:.0004,slip:.0002},
  ETH:{name:'以太坊',unit:'ETH',multiplier:1,tick:.01,fee:.0004,slip:.0002},
  XAU:{name:'黄金 · GC 代理',unit:'虚拟盎司',multiplier:1,tick:.1,fee:.0001,slip:.0001},
  XAG:{name:'白银 · SI 代理',unit:'虚拟盎司',multiplier:1,tick:.005,fee:.00015,slip:.0002},
  NQ:{name:'纳指 · NQ 代理',unit:'微型等效手',multiplier:2,tick:.25,fee:0,slip:.00005},
  CL:{name:'原油 · CL 代理',unit:'微型等效手',multiplier:100,tick:.01,fee:0,slip:.0002},
};
export const PAIRS = {'XAU-XAG':'金银比','XAU-CL':'金油比','BTC-XAU':'BTC / 黄金','ETH-BTC':'ETH / BTC','NQ-XAU':'纳指 / 黄金'};
export const tradeHorizonOf = trade => trade.horizon ?? ((trade.version??trade.entrySnapshot?.version)==='rules-1.0'?'1H':'10M');
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validSnapshot(d){
  return d?.schema === 'traderhome-public-paper-v1' && d.paper === true && finite(d.publishedAt) && finite(d.serverTime) &&
    Array.isArray(d.account?.trades) && Array.isArray(d.pairs?.account?.trades) &&
    Array.isArray(d.markets) && SYMBOLS.every(s=>d.markets.some(m=>m.symbol===s)) && Array.isArray(d.reports);
}
export function closedBars(rows,step,now){
  return (rows??[]).filter(b=>[b.time,b.open,b.high,b.low,b.close].every(finite)&&b.open>0&&b.low>0&&b.high>=b.low&&b.time+step<=now).sort((a,b)=>a.time-b.time);
}
export function quote(m,now){
  const rows=closedBars(m?.executionBars?.length?m.executionBars:m?.bars,m?.executionBars?.length?300000:600000,now), bar=rows.at(-1), step=m?.executionBars?.length?300000:600000;
  return {price:bar?.close??null,through:bar?bar.time+step:null,stale:!bar||now-bar.time-step>1200000||!!m?.dataError};
}
export function chartBars(m,h,now){
  if(h==='10M')return closedBars(m?.bars,600000,now).slice(-80);
  if(h==='1H')return closedBars(m?.contextBars,3600000,now).slice(-80);
  if(h==='1D')return closedBars(m?.dailyBars,86400000,now).slice(-80);
  if(h==='1W'){
    if(!['BTC','ETH'].includes(m?.symbol))return closedBars(m?.weeklyBars,604800000,now).slice(-80);
    const day=86400000,week=7*day,groups=new Map();
    for(const b of closedBars(m?.dailyBars,day,now)){
      const key=Math.floor((b.time+3*day)/week)*week-3*day;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(b);
    }
    return [...groups].filter(([t,b])=>t+week<=now&&b.length===7&&b.every((r,i)=>r.time===t+i*day)).map(([time,b])=>({time,open:b[0].open,high:Math.max(...b.map(x=>x.high)),low:Math.min(...b.map(x=>x.low)),close:b[6].close,volume:b.reduce((s,x)=>s+(x.volume??0),0)})).slice(-80);
  }
  const groups=new Map();
  for(const b of closedBars(m?.contextBars,3600000,now)){
    const key=Math.floor(b.time/14400000)*14400000;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(b);
  }
  return [...groups].filter(([t,b])=>t+14400000<=now&&b.length===4&&b.every((r,i)=>r.time===t+i*3600000)).map(([time,b])=>({time,open:b[0].open,high:Math.max(...b.map(x=>x.high)),low:Math.min(...b.map(x=>x.low)),close:b[3].close,volume:b.reduce((s,x)=>s+(x.volume??0),0)})).slice(-80);
}
export function currentGate(gates,book,key,horizon='10M'){
  return (gates??[]).filter(g=>g.book===book&&g.key===key&&g.horizon===horizon).sort((a,b)=>b.published-a.published)[0]??null;
}
export function lastCheck(reviews,book,id){
  for(const r of [...(reviews??[])].sort((a,b)=>b.published-a.published)){
    const check=r.checks?.find(c=>c.book===book&&c.id===id);
    if(check)return {...check,published:r.published};
  }
  return null;
}
export function planState(report,gate,now){
  if(gate?.verdict==='suspended')return {label:'新入场挂起',tone:'warn'};
  if(report?.stale||report?.stage==='data')return {label:'数据滞后 / 不足',tone:'warn'};
  if(!report?.plan)return {label:report?.stage==='closed'?'休市':'等待条件',tone:''};
  if(report.plan.expires<=now)return {label:'计划已到期',tone:''};
  if(report.plan.notBefore>now)return {label:'等待执行窗口',tone:''};
  return {label:report.plan.side===1?'计划做多':'计划做空',tone:report.plan.side===1?'good':'bad'};
}
export function legTargets(leg,side){
  if(!leg||!finite(leg.price)||![1,-1].includes(side))return {targets:[],invalidation:null};
  const tick=INSTRUMENTS[leg.symbol]?.tick??.01,atr=leg.atr??0,minDistance=Math.max(tick*3,atr*.2),buffer=Math.max(tick,atr*.1);
  const round=v=>Number((Math.round(v/tick)*tick).toFixed(8));
  const zone=l=>({...l,price:round(l.price),low:round(Math.max(tick,l.price-buffer)),high:round(l.price+buffer)});
  const levels=(leg.levels??[]).filter(l=>finite(l.price)&&l.price>0&&l.knownAt<=leg.through);
  const ahead=levels.filter(l=>(l.price-leg.price)*side>minDistance).sort((a,b)=>(a.price-b.price)*side),selected=[];
  for(const l of ahead)if(selected.every(s=>Math.abs(s.price-l.price)>Math.max(tick*3,atr*.5))){selected.push(l);if(selected.length===2)break;}
  while(selected.length<2&&atr>0){const price=selected.length?selected.at(-1).price+side*atr:leg.price+side*atr*1.5;if(price<=tick)break;selected.push({price,label:selected.length?'ATR 延伸推演（非历史结构）':'1.5 ATR 推演（未找到前方结构）',kind:'projection',knownAt:leg.through});}
  const behind=levels.filter(l=>(l.price-leg.price)*side< -minDistance).sort((a,b)=>(b.price-a.price)*side)[0];
  const invalid=behind?{...behind,price:behind.price-side*Math.max(atr*.15,tick*2),label:behind.label+'之外'}:atr>0?{price:leg.price-side*1.5*atr,label:'1.5 ATR 失效推演（非历史结构）',kind:'projection',knownAt:leg.through}:null;
  return {targets:selected.map(zone),invalidation:invalid&&invalid.price>0?zone(invalid):null};
}
export function conditionalPrices(prices,ratio){
  return Array.isArray(prices)&&prices.length===2&&[...prices,ratio].every(v=>finite(v)&&v>0)?[ratio*prices[1],prices[0]/ratio]:null;
}
export function estimatedNet(trade,prices){
  const legs=trade.legs??[trade];let pnl=0;
  for(const leg of legs){
    const s=INSTRUMENTS[leg.symbol],price=prices[leg.symbol];
    if(!s||!finite(price)||price<=0)return null;
    const raw=price*(1-leg.side*s.slip),exit=(leg.side===-1?Math.ceil(raw/s.tick):Math.floor(raw/s.tick))*s.tick;
    const fee=['NQ','CL'].includes(leg.symbol)?leg.quantity*1.25:leg.quantity*exit*s.multiplier*s.fee;
    pnl+=leg.side*(exit-leg.entry)*leg.quantity*s.multiplier-(leg.entryFee??0)-fee;
  }
  return pnl;
}
