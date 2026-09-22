export const DAY=86400000;
export const isoDay=n=>new Date(n).toISOString().slice(0,10);
export const dayTime=d=>Date.parse(d+'T00:00:00Z');
export function calendar(start,end){const out=[];for(let d=dayTime(start);d<=dayTime(end);d+=DAY)out.push(isoDay(d));return out;}
export function atDate(asset,date){return asset.points.filter(p=>p.date<=date).at(-1)||null;}
export function thresholdState(p){if(!p)return [];return [...(p.otc<1000?['场外低于1000']:[]),...(p.burst<200?['爆破低于200']:[])];}
export function tier(p){if(!p)return 'missing';if(p.cycle==='进场'&&p.quality==='优质'&&p.otc>=1000&&p.burst>0)return 'focus';if(p.quality==='劣质'||p.otc<1000||p.burst<0)return 'avoid';if(p.cycle==='进场'&&p.day<=3&&p.unit==='天')return 'new';return 'watch';}
export function planFor(asset,p,asOf,today){
 if(!p)return {title:'没有此前记录',tone:'muted',why:'不能使用后来出现的数据解释这一天。',next:['换一个来源已覆盖的日期。'],invalid:[],missing:['该标的当日来源'],executable:false};
 const missing=[];if(p.date<asOf)missing.push(asOf+'来源缺失，当前显示'+p.date);if(p.date<today)missing.push('不是今日数据，先补齐最新原页');if(!p.source)missing.push('原始页面链接缺失');if(asset.mapping==='unverified')missing.push('产品身份、交易所和完整合约未核实');
 missing.push(...(p.dataWarnings||[]),'可成交价格、价格结构和有效止损未确认','独立体系同向及账户风险许可未确认');
 let title,tone,why,next,invalid;
 if(p.unit==='月') {title='月度背景，不作日线进场';tone='muted';why='地产为月更周期，图上逐日记录不改变它的月度含义。';next=['结合月度更新复核，不从每日重复数值生成信号。'];invalid=['来源更新周期或口径发生变化。'];}
 else if(p.cycle==='进场'){
  if(p.otc<1000){title='进场标签，强度仍不足';tone='amber';why='场外指数仍低于1000；新周期或动能回升不足以单独支持追涨。';}
  else if(p.quality==='劣质'){title='回避单边追涨';tone='red';why='本周期历史节点质量较差，日常小幅上涨不能改写评级。';}
  else if(p.quality==='优质'&&p.burst>0){title='多头研究优先复核';tone='green';why='进场周期、场外高于1000，历史质量较好；这只是研究顺序，不是当前买点。';}
  else {title=p.day<=3?'新周期，等待展开':'观察，不急于确认';tone='amber';why=p.quality==='待定'?'缺少本周期足够的关键节点，尚不能确认质量。':'周期仍在进场，但历史质量存疑或短期动能不足。';}
  next=['等待价格结构与独立信号同向；确认进场条件和失效位后再讨论风险预算。',p.burst>200?'若后续爆破从200以上跌回200以下，记录节点场外值，与同周期前节点比较。':'观察爆破能否展开；上穿200本身不升级质量。'];
  invalid=['转退场、场外跌至1000下方或新节点恶化时，撤销多头优先观察。','价格结构失效或市场门控不允许时，不以场外评级覆盖风险。'];
 }else{
  title=p.burst>0?'退场中有反弹风险':'退场，等待结构确认';tone=p.quality==='劣质'?'red':'amber';why=p.quality==='劣质'?'这里的劣质是做空周期质量差，不等于股票或项目基本面差；不适合据此追空。':'退场是周期标签；爆破转正或反弹时，不直接追空。';
  next=['若出现相邻来源日爆破负转正，比较节点场外值是否继续下降。','空头研究仍需价格破位、有效止损和独立确认；现有持仓与新开仓分开评估。'];invalid=['转进场或退场节点指数不降反升时，撤销空头优先假设。'];
 }
 return {title,tone,why,next,invalid,missing,executable:false};
}
export function parseBars(text){
 const lines=text.replace(/^\ufeff/,'').trim().split(/\r?\n/);if(lines.length<2)throw Error('CSV至少需要表头和一行数据');
 const h=lines.shift().split(',').map(s=>s.trim().toLowerCase());const keys=['date','open','high','low','close'];if(!keys.every(k=>h.includes(k)))throw Error('需要 date,open,high,low,close 五列');
 const bars=lines.filter(l=>l.trim()).map(l=>{const a=l.split(','),p=Object.fromEntries(keys.map(k=>[k,a[h.indexOf(k)]?.trim()]));if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(dayTime(p.date))||isoDay(dayTime(p.date))!==p.date)throw Error('无效日期');for(const k of keys.slice(1)){if(!p[k])throw Error('价格缺失');p[k]=Number(p[k]);if(!Number.isFinite(p[k])||p[k]<=0)throw Error('价格必须为正数');}if(p.low>Math.min(p.open,p.close)||p.high<Math.max(p.open,p.close)||p.low>p.high)throw Error('OHLC高低范围冲突');return p;});
 if(bars.length>10000)throw Error('最多导入10000行');if(new Set(bars.map(b=>b.date)).size!==bars.length)throw Error('CSV含重复日期');return bars.sort((a,b)=>a.date.localeCompare(b.date));
}
