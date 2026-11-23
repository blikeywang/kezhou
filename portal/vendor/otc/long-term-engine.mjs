// No network, DOM, local price import, broker access, or order execution.
const iso=v=>typeof v==="string"&&/^\d{4}-\d\d-\d\d$/.test(v);
const origin=v=>typeof v==="string"&&/^https:\/\/serious-club-96d\.notion\.site\/[0-9a-f]{32}$/.test(v);
const previous=d=>new Date(Date.parse(d+"T12:00:00Z")-86400000).toISOString().slice(0,10);
const anchor=(arr,d)=>arr.filter(x=>x.date<=d).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
export function validateBook(book){
 if(book?.schema!=="traderhome_long_term_levels_v1"||!Array.isArray(book.editions)||!book.editions.length||!Array.isArray(book.rules)||!book.rules.length)throw Error("长期区资料格式不符");
 for(const list of [book.editions,book.rules])if(list.some((v,i)=>!iso(v.date)||!origin(v.source)||(i&&list[i-1].date>=v.date)))throw Error("长期区资料版本或来源不符");
 for(const e of book.editions){
  if(!Number.isFinite(Date.parse(e.knownAt))||!Array.isArray(e.levels)||new Set(e.levels.map(l=>l.id)).size!==e.levels.length)throw Error("长期区版次不完整");
  for(const l of e.levels){
   if(typeof l.id!=="string"||typeof l.label!=="string"||!(Number.isFinite(l.value)&&l.value>0)||!iso(l.since)||l.since>e.date)throw Error("长期区价位无效");
   const start=book.editions.find(x=>x.date===l.since)?.levels.find(x=>x.id===l.id);
   if(!start||start.value!==l.value||start.since!==l.since)throw Error("长期区价位起始版本不符");
  }
 }
 return book;
}
function validBar(b){return iso(b?.date)&&[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)&&b.low<=Math.min(b.open,b.close)&&Math.max(b.open,b.close)<=b.high;}
function knownDay(stamp,zone){return new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(stamp));}
function direct(l,prices){const ref=l.priceRef,row=prices?.assets?.[l.id];if(!ref||prices?.schema!=="traderhome_public_prices_v1"||row?.status!=="ok"||row.provider!==ref.provider||row.symbol!==ref.symbol||row.currency!==ref.currency||row.timezone!==ref.zone||!Array.isArray(row.bars))return null;return row;}
function evidence(asset,date){
 let chain=[],prev=null,latest=null;
 for(const p of asset?.points||[]){
  if(p.date>date)break;
  const firstParty=p.sourceKind==="user_notion"&&origin(p.source);
  const adjacent=firstParty&&prev?.sourceKind==="user_notion"&&origin(prev.source)&&prev.date===previous(p.date)&&!p.gapBefore&&p.cycle===prev.cycle&&!p.transition;
  if(!adjacent)chain=[];
  if(adjacent&&!p.unconfirmedNode&&p.node==="负转正"&&prev.burst<0&&p.burst>0&&Number.isFinite(p.otc)&&Number.isFinite(p.burst))
   chain=[...chain.slice(-1),{date:p.date,otc:p.otc,burst:p.burst}];
  prev=p;if(firstParty)latest=p;
 }
 return {chain,point:latest,exact:latest?.date===date};
}
// An unconfirmed, unknown, missing or future policy cannot enable a notification.
function approvedRule(r){return r?.status==="confirmed_by_author"&&r.alertsEnabled===true&&origin(r.authorSource)&&iso(r.date)&&["otc","burst"].includes(r.basis);}
export function evaluateLongTerm(book,snapshot,prices,asOf){
 validateBook(book);if(!iso(asOf))throw Error("观察日期无效");
 const edition=anchor(book.editions,asOf),rule=anchor(book.rules,asOf);
 if(!edition)return {asOf,edition:null,rule:null,rows:[],events:[]};
 const byId=new Map((snapshot?.assets||[]).map(a=>[a.id,a]));const active=approvedRule(rule);
 const rows=edition.levels.map(l=>{
  const asset=byId.get(l.id);const ev=evidence(asset,asOf);const price=direct(l,prices);
  const firstEdition=book.editions.find(x=>x.date===l.since);
  // Do not count a candle partly or entirely before the level was first known.
  const start=l.priceRef?knownDay(firstEdition.knownAt,l.priceRef.zone):l.since;
  const available=(price?.bars||[]).filter(b=>validBar(b)&&b.date<=asOf&&b.date<=price.latestDate).sort((a,b)=>a.date.localeCompare(b.date));
  const lastAvailable=available.at(-1)?.date||null;
  const eligible=available.filter(b=>b.date>start&&b.date>l.since);
  const bar=eligible.find(b=>b.date===asOf);
  const touches=eligible.filter(b=>b.low<=l.value&&l.value<=b.high);
  const lastTouch=touches.at(-1);const touched=!!bar&&bar.low<=l.value&&l.value<=bar.high;
  const priceState=!l.priceRef?"unmapped":!price?"unavailable":asOf<=start||asOf<=l.since?"before_first_full_bar":!bar?"no_bar":touched?"touched":"not_touched";
  let event=null;
  // For a clarified policy, use the first eligible touch with same-date source,
  // consecutive usable nodes and its actual policy/level edition; do not backfill before activation.
  if(active){
   for(const h of touches){
    if(h.date<=rule.date)continue;
    const her=anchor(book.rules,h.date),level=anchor(book.editions,h.date)?.levels.find(x=>x.id===l.id);
    if(her?.date!==rule.date||level?.since!==l.since||level.value!==l.value)continue;
    const e=evidence(asset,h.date);if(!e.exact||e.point.unconfirmedNode||e.chain.length!==2)continue;
    const [a,b]=e.chain;if(!(b[rule.basis]>a[rule.basis]))continue;
    event={id:[l.since,l.id,l.value,rule.date].join(":"),asset:l.id,label:l.label,date:h.date,level:l.value,low:h.low,high:h.high,price:price.symbol,nodeBasis:rule.basis,nodes:e.chain,source:level&&anchor(book.editions,h.date).source,ruleSource:rule.authorSource};break;
   }
  }
  return {...l,priceState,bar:bar?{date:bar.date,low:bar.low,high:bar.high}:null,lastAvailable,lastTouch:lastTouch?{date:lastTouch.date,low:lastTouch.low,high:lastTouch.high}:null,sourceDay:ev.point?.date||null,candidate:ev.exact&&!!ev.point?.unconfirmedNode,nodes:ev.chain,event};
 });
 return {asOf,edition,rule,active,rows,events:rows.flatMap(r=>r.event?[r.event]:[])};
}
