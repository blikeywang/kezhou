import test from 'node:test';
import assert from 'node:assert/strict';
import {performance,groups,modelTime} from './vendor/market-simulation/performance.mjs';
import {reviewSections,reviewTarget,reviewFresh,renderReviewCards} from './vendor/market-simulation/reviews.mjs';
import {quote,chartBars,planState,currentGate,lastCheck,legTargets,conditionalPrices,escape,estimatedNet,tradeHorizonOf} from './vendor/market-simulation/model.mjs';

test('legacy hourly trades retain their original horizon after the ten-minute migration',()=>{
  assert.equal(tradeHorizonOf({version:'rules-1.0',executionIntervalMs:300000}),'1H');
  assert.equal(tradeHorizonOf({version:'rules-2.1.1-cost-10m'}),'10M');
  assert.equal(tradeHorizonOf({horizon:'4H'}),'4H');
});

test('strategy statistics use settled net profit without charging fees twice',()=>{
 const rows=[{opened:1,closed:2,pnl:90,entryFee:5,exitFee:5},{opened:3,closed:4,pnl:-110,entryFee:5,exitFee:5},{opened:5,pnl:1000}];
 const s=performance(rows,1,86400001);assert.equal(s.closed,2);assert.equal(s.winRate,.5);assert.equal(s.net,-20);assert.equal(s.expectancy,-10);assert.equal(s.costs,20);assert.equal(s.entriesPerDay,3);
 assert.equal(performance([],1,2).winRate,null);assert.equal(performance([{opened:1,closed:10,pnl:90}],1,9).closed,0);
 assert.equal(groups(rows,t=>t.closed?'closed':'open',1,86400001).length,2);
});
test('model time survives the limited recent report window and excludes rules',()=>{
 assert.equal(modelTime({model:{published:10},reports:[{published:99,version:'rules'}]}),10);
 assert.equal(modelTime({reports:[{origin:'model',published:9},{published:99}]}),9);
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


// Crypto evidence must age with the observation, independently of page publication.
import {flowFresh,renderFlow,compareFlowPoints} from './vendor/market-simulation/flow.mjs';
test('a recently published flow panel cannot mark stale or future observations as current',()=>{
  assert.equal(flowFresh({status:'ok',through:1000},1300000),false);
  assert.equal(flowFresh({status:'ok',through:2000},1000),false);
  assert.equal(flowFresh({status:'unavailable',through:1000},2000),false);
  assert.equal(flowFresh({status:'ok',through:1000},2000),true);
});
test('the flow panel survives an unavailable exchange without inventing a value',()=>{
  const ui={E:escape,fmt:String,dt:String,badge:s=>s,empty:s=>s,lineChart:()=>{throw Error('Missing source must not be charted');}};
  const html=renderFlow({assets:[{symbol:'BTC',spot:{status:'unavailable'},perpetual:{status:'unavailable'}}]},ui);
  assert.ok(html.includes('本轮未取得连续 1H 历史'));
  assert.ok(!html.includes('NaN'));
});


test('hourly price-point comparisons span days and sample OI at A and B',()=>{
  const a={time:3600000,low:90,high:100,cvd:100,oi:1000,cvdAnchor:0};
  const b={time:73*3600000,low:95,high:105,cvd:-50,oi:1100,cvdAnchor:0};
  const r=compareFlowPoints(a,b,'low');
  assert.equal(r.signal,'bullish_absorption');assert.equal(r.cvdChange,-150);
  assert.equal(r.elapsedHours,72);assert.equal(r.oiChange,100);
  assert.equal(compareFlowPoints(a,{...b,cvdAnchor:3600000},'low').comparable,false);
  assert.equal(compareFlowPoints(a,{...b,oi:null},'low').oiChange,null);
});
test('hourly evidence freshness follows the latest complete hourly bar',()=>{
  assert.equal(flowFresh({status:'ok',intervalMs:3600000,through:3600000},7200000),true);
  assert.equal(flowFresh({status:'ok',intervalMs:3600000,through:3600000},9000000),false);
});

test('review boxes retain evidence and separate only explicit topic boundaries',()=>{
  assert.deepEqual(reviewSections('说明。BTC：低点 A。ETH：低点 B。'),[
    {title:'复核总览',text:'说明。'},{title:'BTC',text:'低点 A。'},{title:'ETH',text:'低点 B。'}]);
  assert.deepEqual(reviewSections('【结论】挂起。【依据】BTC和ETH数据冲突。【下一步】等待新柱。'),[
    {title:'结论',text:'挂起。'},{title:'依据',text:'BTC和ETH数据冲突。'},{title:'下一步',text:'等待新柱。'}]);
  assert.equal(reviewSections('BTC 与 ETH 比较中的 OI 值不能代替方向判断。').length,1);
});
test('review targets remain identifiable after a plan has left the current snapshot',()=>{
  assert.equal(reviewTarget({book:'pair',id:'pair:pairs-1.0:ETH-BTC:100'},{pairs:{}}).name,'ETH / BTC');
  assert.equal(reviewTarget({book:'single',id:'plan:BTC:4H:100'},{}).horizon,'4H');
});
test('a fresh publication cannot turn an expired review into current approval',()=>{
  const ui={dt:String,badge:(s,t)=>'<mark class="'+(t??'')+'">'+s+'</mark>',empty:String,now:6_000_000};
  const data={publishedAt:ui.now,review:{history:[{id:'old',published:1,snapshotRun:1,summary:'【BTC】<script>bad</script>',checks:[{id:'plan:BTC:1H:1',book:'single',kind:'plan',verdict:'green',reason:'<img src=x>'}]}]}};
  const html=renderReviewCards(data,ui);
  assert.equal(reviewFresh(data.review.history[0],ui.now),false);
  assert.equal(reviewFresh({published:ui.now+1},ui.now),false);
  assert.match(html,/旧绿标不代表当前/);
  assert.match(html,/✓ 合理 · 当时结论/);
  assert.ok(!html.includes('class="good"'));
  assert.ok(!html.includes('<script>bad</script>'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
});
