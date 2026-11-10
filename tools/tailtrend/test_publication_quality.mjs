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
