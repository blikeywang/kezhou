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
