import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {atDate,calendar,planFor,parseBars,tier,dayTime,DAY} from './vendor/otc/engine.mjs';
const snapshot=JSON.parse(fs.readFileSync(new URL('./vendor/otc/data/snapshot.json',import.meta.url),'utf8'));

test('as-of selection never uses a future point',()=>{
 const asset={points:[{date:'2026-09-18'},{date:'2026-09-20'}]};
 assert.equal(atDate(asset,'2026-09-17'),null);
 assert.equal(atDate(asset,'2026-09-19').date,'2026-09-18');
 assert.deepEqual(calendar('2026-09-18','2026-09-20'),['2026-09-18','2026-09-19','2026-09-20']);
});
test('research plans never silently grant execution authority',()=>{
 for(const asset of snapshot.assets){
  for(const p of asset.points){
   const plan=planFor(asset,p,p.date,'2099-01-01');
   assert.equal(plan.executable,false);
   assert.ok(plan.missing.some(s=>s.includes('不是今日')));
   assert.ok(plan.missing.some(s=>s.includes('止损')));
   if(asset.mapping==='unverified')assert.ok(plan.missing.some(s=>s.includes('产品身份')));
  }
 }
 const asset=snapshot.assets[0],p=asset.points.at(-1);
 assert.ok(planFor(asset,p,'2099-01-01','2099-01-01').missing.some(s=>s.includes('来源缺失')));
 assert.equal(tier(null),'missing');
 assert.equal(planFor(asset,null,'2020-01-01','2026-01-01').executable,false);
});
test('formal nodes require consecutive dates and the same cycle',()=>{
 let nodes=0,gaps=0;
 for(const a of snapshot.assets){
  assert.equal(new Set(a.points.map(p=>p.date)).size,a.points.length);
  for(let i=0;i<a.points.length;i++){
   const p=a.points[i],prev=a.points[i-1];
   if(prev)assert.ok(p.date>prev.date);
   if(p.gapBefore){gaps++;assert.equal(p.node,null);}
   if(p.source)assert.match(p.source,/^https:\/\/serious-club-96d\.notion\.site\/[a-f0-9]{32}$/);
   if(prev)for(const key of ['otc','burst']){
    if(p[key+'Delta']!==null&&Math.abs(p[key]-prev[key]-p[key+'Delta'])>0.11)assert.ok(p.dataWarnings.length>0);
   }
   if(p.node){
    nodes++;assert.ok(prev);assert.equal(dayTime(p.date)-dayTime(prev.date),DAY);assert.equal(p.cycle,prev.cycle);
    assert.ok((p.node==='跌回200'&&prev.burst>200&&p.burst<200)||(p.node==='负转正'&&prev.burst<0&&p.burst>0));
   }
  }
 }
 assert.ok(nodes>0);assert.ok(gaps>0);
});
test('CSV validates dates, duplicates and OHLC without inventing missing values',()=>{
 const header='date,open,high,low,close\n';
 assert.equal(parseBars(header+'2026-09-19,2,3,1,2.5')[0].close,2.5);
 for(const row of ['2026-02-30,2,3,1,2','2026-09-19,2,1,1,2','2026-09-19,,3,1,2','2026-09-19,0,3,1,2'])assert.throws(()=>parseBars(header+row));
 assert.throws(()=>parseBars(header+'2026-09-19,2,3,1,2\n2026-09-19,2,3,1,2'));
 assert.throws(()=>parseBars('date,close\n2026-09-19,2'));
});
