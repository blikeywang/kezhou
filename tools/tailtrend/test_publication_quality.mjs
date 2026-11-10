import test from 'node:test';import assert from 'node:assert/strict';
import {assertTailtrendQuality,assertHistoryUnchanged} from './publication-quality.mjs';
function valid(){const symbols=Array.from({length:30},(_,i)=>`S${i}`);return {dataAsOf:'2026-11-09',mode:'complete',status:'COMPLETE',universe:{symbols},records:symbols.map(symbol=>({symbol,tradingDate:'2026-11-09',dataStatus:'FRESH'})),health:{fresh:30,cached:0,stale:0,error:0,missing:[],errors:[]},eventCalendar:{status:'VERIFIED',coveredSymbols:symbols,errors:[]}};}
test('complete inputs pass',()=>assert.equal(assertTailtrendQuality(valid(),'2026-11-09',{persisted:true}),true));
for(const [label,mutate] of Object.entries({date:s=>s.dataAsOf='2026-11-06',calendar:s=>delete s.eventCalendar,coverage:s=>s.eventCalendar.coveredSymbols=[],stale:s=>s.records[0].dataStatus='CACHED',missing:s=>s.records.pop(),duplicate:s=>s.records[1]=s.records[0],errors:s=>s.health.errors=['failed'],status:s=>s.status='MISSING'}))test(`reject ${label}`,()=>{const s=valid();mutate(s);assert.throws(()=>assertTailtrendQuality(s,'2026-11-09',{persisted:true}));});
test('history may append, not mutate or delete',()=>{assert.equal(assertHistoryUnchanged({a:'x'},{a:'x',b:'y'}),true);assert.throws(()=>assertHistoryUnchanged({a:'x'},{a:'y'}));assert.throws(()=>assertHistoryUnchanged({a:'x'},{}));});

import {validatedCalendarEvents} from './publication-quality.mjs';
const calEvent={counter_id:'ST/US/MSFT',ext:{local_date:'2026.11.10'}};
const range={from:'2026-11-09',through:'2026-12-31'};
test('calendar explicitly empty and valid events accepted',()=>{assert.deepEqual(validatedCalendarEvents({list:[]},['MSFT.US'],range),[]);assert.equal(validatedCalendarEvents({list:[{infos:[calEvent]}]},['MSFT.US'],range)[0].date,'2026-11-10');});
for(const [name,data] of Object.entries({missing:{},group:{list:[{}]},event:{list:[{infos:[{}]}]},invalidDate:{list:[{infos:[{...calEvent,ext:{local_date:'2026.11.31'}}]}]},outsideRange:{list:[{infos:[{...calEvent,ext:{local_date:'2020.01.01'}}]}]},wrongSymbol:{list:[{infos:[{...calEvent,counter_id:'ST/US/OTHER'}]}]},page:{list:[],has_more:true},total:{list:[],total:10}}))test(`calendar rejects ${name}`,()=>assert.throws(()=>validatedCalendarEvents(data,['MSFT.US'],range)));

test('provider next-event results may extend beyond query window; valid future events retained for caller horizon selection',()=>{
 const r={list:[{infos:[{counter_id:'ST/US/NVDA',ext:{local_date:'2026-11-17'}},{counter_id:'ST/US/AVGO',ext:{local_date:'2026-12-09'}}]}],next_date:''};
 const events=validatedCalendarEvents(r,['NVDA.US','AVGO.US'],{from:'2026-11-09',through:'2026-11-30'});
 assert.deepEqual(events.map(e=>e.symbol),['NVDA.US','AVGO.US']);
 assert.throws(()=>validatedCalendarEvents({...r,next_date:'2026-12-01'},['NVDA.US','AVGO.US'],{from:'2026-11-09',through:'2026-11-30'}));
});
test('calendar truncation counted before future event filtering',()=>{
 const response={list:[{infos:[{counter_id:'ST/US/MSFT',ext:{local_date:'2027-01-28'}}]}]};
 assert.throws(()=>validatedCalendarEvents(response,['MSFT.US'],{from:'2026-11-09',through:'2026-11-30',limit:1}));
 assert.equal(validatedCalendarEvents(response,['MSFT.US'],{from:'2026-11-09',through:'2026-11-30',limit:100}).length,1);
});

import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {persistResearchRevision, assertNoRevisionDowngrade} from './research-revision.mjs';
async function revisionFixture(t) {
 const dir=await mkdtemp(join(tmpdir(),'tail-revision-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'snapshots'));
 const original={...valid(),runAt:'2026-11-10T03:15:09.840Z',engineSourceHash:'a'.repeat(64)};
 for(const [name,value] of Object.entries({'snapshots/2026-11-09.json':original,'snapshots/2026-08-12.json':{old:true},'index.json':{entries:[original]},'tailtrend-audit.json':{entries:[{old:true}]},'run-history.json':{old:true},'latest.json':original,'tailtrend-snapshot.json':original}))await writeFile(join(dir,name),JSON.stringify(value));
 const snapshot={...valid(),runAt:'2026-11-10T06:00:00.000Z',engineSourceHash:'b'.repeat(64),records:valid().records.map(r=>({...r,change:{changed:true}})),transitions:[{changed:true}]};
 return {dir,snapshot};
}
test('explicit research revision changes only aliases and adds separate immutable evidence',async t=>{
 const {dir,snapshot}=await revisionFixture(t);
 const names=['snapshots/2026-11-09.json','snapshots/2026-08-12.json','index.json','tailtrend-audit.json','run-history.json'];
 const before=await Promise.all(names.map(n=>readFile(join(dir,n),'utf8')));
 const result=await persistResearchRevision({dataDir:dir,snapshot,expectedDate:'2026-11-09'});
 assert.equal(result.revision.revision.originalRunAt,'2026-11-10T03:15:09.840Z');
 assert.match(result.revision.revision.originalSnapshotSha256,/^[a-f0-9]{64}$/);
 assert.equal(result.revision.runAt,snapshot.runAt);
 assert.equal(result.revision.dataAsOf,'2026-11-09');
 assert.deepEqual(result.revision.transitions,[]);
 assert.equal(result.revision.records[0].change,null);
 assert.equal(result.revision.revision.label,'事后新版研究重算，非当时信号');
 const bytes=await readFile(join(dir,result.file),'utf8');
 assert.equal(await readFile(join(dir,'latest.json'),'utf8'),bytes);
 assert.equal(await readFile(join(dir,'tailtrend-snapshot.json'),'utf8'),bytes);
 assert.deepEqual(await Promise.all(names.map(n=>readFile(join(dir,n),'utf8'))),before);
 await assert.rejects(persistResearchRevision({dataDir:dir,snapshot:{...snapshot,runAt:'2026-11-10T07:00:00Z'},expectedDate:'2026-11-09'}),/EEXIST/);
 assert.equal(await readFile(join(dir,result.file),'utf8'),bytes);
});
for(const [label,change] of Object.entries({stale:s=>s.records[0].dataStatus='CACHED',sameEngine:s=>s.engineSourceHash='a'.repeat(64),badHash:s=>s.engineSourceHash='../bad',oldRun:s=>s.runAt='2026-11-09T01:00:00Z',calendar:s=>delete s.eventCalendar}))test(`revision rejects ${label} before alias changes`,async t=>{
 const {dir,snapshot}=await revisionFixture(t);const before=await readFile(join(dir,'latest.json'),'utf8');change(snapshot);
 await assert.rejects(persistResearchRevision({dataDir:dir,snapshot,expectedDate:'2026-11-09'}));
 assert.equal(await readFile(join(dir,'latest.json'),'utf8'),before);
});
test('revision cannot create a previously missing official session',async t=>{
 const {dir,snapshot}=await revisionFixture(t);await writeFile(join(dir,'snapshots/2026-11-09.json'),JSON.stringify({dataAsOf:'2026-11-09',status:'MISSING'}));
 await assert.rejects(persistResearchRevision({dataDir:dir,snapshot,expectedDate:'2026-11-09'}),/original COMPLETE/);
});

test('ordinary same-day refresh cannot replace a revision with the old official snapshot',()=>{
 const latest={dataAsOf:'2026-11-09',revision:{}};
 assert.throws(()=>assertNoRevisionDowngrade(latest,'2026-11-09'),/must not be downgraded/);
 assert.throws(()=>assertNoRevisionDowngrade(latest,'2026-11-06'),/must not be downgraded/);
 assert.doesNotThrow(()=>assertNoRevisionDowngrade(latest,'2026-11-10'));
 assert.doesNotThrow(()=>assertNoRevisionDowngrade({dataAsOf:'2026-11-09'},'2026-11-09'));
});
