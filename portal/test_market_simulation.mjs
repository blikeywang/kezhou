import test from 'node:test';
import assert from 'node:assert/strict';
import {quote,chartBars,planState,currentGate,lastCheck,legTargets,conditionalPrices,escape,estimatedNet,tradeHorizonOf} from './vendor/market-simulation/model.mjs';

test('legacy hourly trades retain their original horizon after the ten-minute migration',()=>{
  assert.equal(tradeHorizonOf({version:'rules-1.0',executionIntervalMs:300000}),'1H');
  assert.equal(tradeHorizonOf({version:'rules-2.1.1-cost-10m'}),'10M');
  assert.equal(tradeHorizonOf({horizon:'4H'}),'4H');
});

test('a recent fetch cannot disguise an old market bar',()=>{
  const q=quote({fetched:9e6,executionBars:[{time:0,open:100,high:110,low:90,close:101},{time:9e6,open:200,high:210,low:190,close:201}]},9e6);
  assert.equal(q.price,101);
  assert.equal(q.through,300000);
  assert.equal(q.stale,true);
});
test('four-hour charts exclude incomplete or gapped groups',()=>{
  const bars=[0,1,2,3,4,5,7].map(h=>({time:h*3600000,open:100+h,high:110+h,low:90+h,close:105+h,volume:1}));
  const result=chartBars({contextBars:bars},'4H',8*3600000);
  assert.equal(result.length,1);
  assert.equal(result[0].close,108);
});
test('crypto weekly charts use seven completed days and discard the unfinished week',()=>{
  const day=86400000,monday=4*day;
  const dailyBars=Array.from({length:10},(_,i)=>({time:monday+i*day,open:100,high:110,low:90,close:101+i,volume:1}));
  const result=chartBars({symbol:'BTC',dailyBars},'1W',monday+10*day);
  assert.equal(result.length,1);
  assert.equal(result[0].time,monday);
  assert.equal(result[0].close,107);
});
test('a gate only suspends its own book, instrument and horizon',()=>{
  const gates=[{book:'single',key:'BTC',horizon:'10M',verdict:'suspended',published:2},{book:'pair',key:'ETH-BTC',horizon:'10M',verdict:'green',published:3}];
  assert.equal(currentGate(gates,'single','BTC','1H'),null);
  assert.equal(planState({plan:{side:1,expires:99}},currentGate(gates,'single','BTC'),5).label,'新入场挂起');
  assert.equal(planState({plan:{side:1,expires:4}},null,5).label,'计划已到期');
});
test('green marks require an actual matching review',()=>{
  const reviews=[{published:1,checks:[{book:'pair',id:'a',verdict:'green'}]},{published:2,checks:[{book:'pair',id:'a',verdict:'suspended'}]}];
  assert.equal(lastCheck(reviews,'pair','a').verdict,'suspended');
  assert.equal(lastCheck(reviews,'single','a'),null);
});
test('structure targets exclude unknown future pivots and label projections',()=>{
  const leg={symbol:'CL',price:80,atr:1,through:100,levels:[{price:80.5,knownAt:200,label:'future'},{price:82,knownAt:80,label:'prior high',kind:'swing'}]};
  const levels=legTargets(leg,1);
  assert.equal(levels.targets[0].price,82);
  assert.equal(levels.targets[1].kind,'projection');
  assert.ok(levels.invalidation.price<80);
});
test('ratio targets are conditional, never a unique pair of simultaneous prices',()=>{
  assert.deepEqual(conditionalPrices([4000,80],55),[4400,4000/55]);
  assert.equal(conditionalPrices([null,80],55),null);
});
test('missing quotes are never priced as zero, net estimates charge both legs',()=>{
  const t={legs:[{symbol:'CL',side:-1,quantity:1,entry:80,entryFee:1.25}]};
  assert.equal(estimatedNet(t,{}),null);
  assert.ok(estimatedNet(t,{CL:79})<100-2.5);
});
test('untrusted rationale text is escaped before HTML rendering',()=>{
  assert.equal(escape('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});
