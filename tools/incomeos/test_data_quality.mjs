import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceTime, closedSessionDate, assetDataErrors} from './data-quality.mjs';
const valid = {kind:'Stock', details:{}, historyResult:[1,2,3], price:10, fundamentals:{}, expectations:{}, quoteTime:'2026-11-09T21:00:00Z'};
test('whole research and history failures cannot disappear', () => {
 const e=assetDataErrors({...valid,details:{error:'research failed'},historyResult:{error:'history failed'},fundamentals:null,expectations:null});
 for(const text of ['research failed','history failed','missing fundamentals','missing forecast']) assert.ok(e.some(x=>x.includes(text)));
});
test('component failures preserve successful independent inputs',()=>{assert.deepEqual(assetDataErrors({...valid,details:{valuation:{error:'unavailable'}}}),['valuation: unavailable']);});
test('absent source time is not replaced by local clock',()=>{assert.equal(sourceTime({last:'10'}),null);assert.ok(assetDataErrors({...valid,quoteTime:null})[0].includes('freshness unverified'));});
test('timestamps parse and invalid timestamps stay unknown',()=>{assert.equal(sourceTime({time:'2026-11-09T21:00:00Z'}),'2026-11-09T21:00:00.000Z');assert.equal(sourceTime({timestamp:'bad'}),null);});
test('session date comes from completed source bars not weekend run date',()=>{const rows=[{time:'2026-11-06T14:30:00Z'}];assert.equal(closedSessionDate(rows,new Date('2026-11-08T22:00:00Z')),'2026-11-06');assert.equal(closedSessionDate([],new Date()),null);});
test('forming current daily bar excluded before regular close',()=>{const rows=[{time:'2026-11-06T14:30:00Z'},{time:'2026-11-09T14:30:00Z'}];assert.equal(closedSessionDate(rows,new Date('2026-11-09T19:00:00Z')),'2026-11-06');assert.equal(closedSessionDate(rows,new Date('2026-11-10T02:00:00Z')),'2026-11-09');});
test('ETF does not require stock fundamentals',()=>{assert.deepEqual(assetDataErrors({...valid,kind:'ETF',fundamentals:null,expectations:null}),[]);});

import {timestampErrors, finalPublicationErrors, applyFinalPublicationQuality} from './data-quality.mjs';
const now=new Date('2026-11-10T02:00:00Z'), date='2026-11-09', stamp='2026-11-09T21:00:00Z';
function complete(){const side={bid:1,ask:1.1,quoteTimestamp:stamp,depthTimestamp:stamp};return {tradingDate:date,universe:{candidateCount:1},assets:[{symbol:'SPY.US',sourceTimestamp:stamp}],dataQuality:{errors:[]},options:[{symbol:'SPY.US',call:{...side},put:{...side}}],optionDataQuality:{scanned:1,usable:1,errors:[],eventCalendar:{status:'VERIFIED',coveredSymbols:['SPY.US'],errors:[]}}};}
test('source freshness rejects old and future but accepts latest session',()=>{assert.deepEqual(timestampErrors(stamp,date,now),[]);assert.ok(timestampErrors('2020-01-01T21:00:00Z',date,now).length);assert.ok(timestampErrors('2099-01-01T21:00:00Z',date,now).length);});
test('closed bar selection excludes holidays and supports early close grace',()=>{const rows=[{time:'2026-11-25'},{time:'2026-11-26'},{time:'2026-11-27'}];assert.equal(closedSessionDate(rows,new Date('2026-11-27T18:10:00Z')),'2026-11-25');assert.equal(closedSessionDate(rows,new Date('2026-11-27T18:20:00Z')),'2026-11-27');});
test('fully evidenced final snapshot passes',()=>{assert.deepEqual(finalPublicationErrors(complete(),date,now),[]);});
for(const [name,change] of Object.entries({oldSession:d=>d.tradingDate='2020-01-02',futureQuote:d=>d.assets[0].sourceTimestamp='2099-01-01',staleDepth:d=>d.options[0].call.depthTimestamp='2020-01-01',missingDepth:d=>delete d.options[0].put.depthTimestamp,missingOptions:d=>d.options=[],optionFailure:d=>d.optionDataQuality.errors.push('failed'),unknownCalendar:d=>d.optionDataQuality.eventCalendar.status='UNKNOWN',uncovered:d=>d.optionDataQuality.eventCalendar.coveredSymbols=[],crossed:d=>d.options[0].call.ask=0.5}))test(`final gate rejects ${name}`,()=>{const d=complete();change(d);applyFinalPublicationQuality(d,date,now);assert.equal(d.mode,'partial');assert.equal(d.dataQuality.publicationReady,false);assert.ok(d.dataQuality.publicationErrors.length);});
