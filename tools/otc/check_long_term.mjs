// Read-only unless acknowledging a specific eligible event in the private state folder.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {createHash} from 'node:crypto';
import {evaluateLongTerm,validateBook} from '../../portal/vendor/otc/long-term-engine.mjs';
const flags=process.argv.slice(2), arg=k=>flags.includes(k)?flags[flags.indexOf(k)+1]:null;
const folder=arg('--data-dir'),state=arg('--state-dir'),ack=arg('--ack');
const origin='https://traderhome-histroy.xyz/otc/data/';
const now=new Date(),asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const get=async name=>{if(folder)return JSON.parse(await readFile(join(folder,name),'utf8'));const r=await fetch(origin+name,{cache:'no-cache',redirect:'error',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(name+' HTTP '+r.status);return r.json();};
const key=id=>createHash('sha256').update(id).digest('hex')+'.json';
async function sent(id){if(!state)return false;try{const j=JSON.parse(await readFile(join(state,key(id)),'utf8'));if(j.id!==id)throw Error('告警去重记录不匹配');return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
try{
 const [book,snap,prices]=await Promise.all(['long-term-levels.json','snapshot.json','prices.json'].map(get));validateBook(book);
 if(snap.schema!=='traderhome_otc_daily_v1'||prices.schema!=='traderhome_public_prices_v1')throw Error('正式资料版本不符');
 const r=evaluateLongTerm(book,snap,prices,asOf);const ageDays=d=>(Date.parse(asOf)-Date.parse(d))/86400000;
 const freshStamp=d=>Number.isFinite(Date.parse(d))&&now-Date.parse(d)>=0&&now-Date.parse(d)<48*3600000;
 const fresh=e=>ageDays(e.date)>=0&&ageDays(e.date)<=2&&ageDays(snap.dataDate)>=0&&ageDays(snap.dataDate)<=2&&freshStamp(prices.assets[e.asset]?.updatedAt)&&freshStamp(prices.checkedAt);
 const eligible=r.events.filter(fresh), alerts=[];
 for(const e of eligible)if(!await sent(e.id))alerts.push(e);
 if(ack){
  if(!state||folder)throw Error('确认送达只允许正式资料及指定私有状态目录');
  if(!eligible.some(e=>e.id===ack))throw Error('拒绝确认未获证据支持的提醒');
  await mkdir(state,{recursive:true});
  try{await writeFile(join(state,key(ack)),JSON.stringify({id:ack,deliveredAt:now.toISOString()})+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
 }
 console.log(JSON.stringify({status:r.active?'checked':'pending_author_clarification',asOf,sourceDate:snap.dataDate,edition:r.edition?.date||null,levelCount:r.rows.length,pricesCheckedAt:prices.checkedAt||null,ruleSource:r.rule?.authorSource||null,priceOnlyToday:r.rows.filter(x=>x.priceState==='touched').map(x=>x.label),alerts,acknowledged:ack||null},null,2));
}catch(e){console.error('远期核查未完成，不判断触发：'+e.message);process.exitCode=1;}
