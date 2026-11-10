import test from 'node:test';
import assert from 'node:assert/strict';
import {createLongbridgeClient,attachRetrieval} from './request-diagnostics.mjs';
import {sourceTime,attachStructuredQuality} from './data-quality.mjs';
test('bounded retry has exponential delays and sanitized diagnostics',async()=>{
 let calls=0;const delays=[];const c=createLongbridgeClient({run:async()=>{if(++calls<3)throw new Error('429 token=do-not-leak');return {stdout:'[]'};},sleep:async ms=>delays.push(ms),random:()=>0});
 assert.deepEqual(await c.request(['consensus','MSFT.US']),[]);assert.deepEqual(delays,[2000,4000]);assert.equal(c.requests[0].attempts,3);assert.equal(c.requests[0].status,'succeeded');assert.ok(!JSON.stringify(c.requests).includes('do-not-leak'));
});
test('authorization and malformed JSON fail without retry',async()=>{
 for(const run of [async()=>{throw new Error('403 private details');},async()=>({stdout:'invalid-json'})]){const c=createLongbridgeClient({run,sleep:()=>assert.fail('no retry')});await assert.rejects(c.request(['quote','SPY.US']));assert.equal(c.requests[0].attempts,1);assert.equal(c.requests[0].status,'failed');assert.ok(c.requests[0].finishedAt);}
});
test('maximum three attempts and no more than three concurrent processes',async()=>{
 let active=0,peak=0;const c=createLongbridgeClient({run:async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,3));active--;throw new Error('timeout');},sleep:async()=>{}});
 await Promise.allSettled(Array.from({length:7},()=>c.request(['consensus','SPY.US'])));assert.equal(peak,3);assert.ok(c.requests.every(r=>r.attempts===3&&r.status==='failed'));
});
test('retrieval window remains distinct from source timestamp',()=>{
 const d={retrievalStartedAt:'2026-11-10T00:00:00Z'};attachRetrieval(d,'options','2026-11-10T00:02:00Z',[],'2026-11-10T00:03:00Z');assert.equal(d.retrievedAt,'2026-11-10T00:03:00Z');assert.equal(d.retrievalStartedAt,'2026-11-10T00:00:00Z');assert.equal(sourceTime({retrievedAt:d.retrievedAt}),null);assert.equal(sourceTime({timestamp:'1700000000'}),'2023-11-14T22:13:20.000Z');
});
test('deduplicated structured issues preserve legacy and distinguish option legs',()=>{
 const s='source timestamp unavailable; freshness unverified';const d={dataQuality:{errors:[`SPY: quote: ${s}`],publicationErrors:[`SPY.US: ${s}`,`SPY.US call depth: ${s}`]},executionAssets:[{symbol:'SPYM.US',quoteTimestamp:null}]};const before=JSON.stringify(d.dataQuality.errors);attachStructuredQuality(d);assert.equal(JSON.stringify(d.dataQuality.errors),before);assert.equal(d.dataQuality.issues.length,3);assert.deepEqual(d.dataQuality.issues[0].scopes,['research','publication']);assert.equal(d.dataQuality.issues[1].field,'call.depth');assert.ok(d.dataQuality.issues.every(i=>i.code==='SOURCE_TIME_MISSING'));
});
