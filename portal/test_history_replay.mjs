import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import M from '../prototype/history-replay-model.js';

const html = readFileSync(new URL('../prototype/app.html', import.meta.url), 'utf8');
const data = JSON.parse(html.match(/<script id="APPDATA"[^>]*>(.*?)<\/script>/s)[1]);
const asset = data.assets.NQ;
const replay = asset.replay;

test('all 78 snapshots validate identity, ordering and original matching windows', () => {
  assert.equal(Object.keys(data.assets).length, 78);
  for (const [symbol, a] of Object.entries(data.assets)) {
    const r = M.validate(a.replay, symbol, a.health.asofTimestamp);
    const current = r.current;
    assert.equal(M.futureCount(current), 0, symbol);
    assert.equal(r.cases.corr.length, a.matches.length, symbol);
    r.cases.corr.forEach((s, index) => {
      assert.equal(new Date(s.endTime*1000).toISOString().slice(0,10), a.matches[index][0], symbol);
      assert.ok(Math.abs(s.score-a.matches[index][1]) < .0051, symbol);
      const horizons = a.grp === 'crypto' ? [6,60,180] : [21,63];
      horizons.forEach((h, j) => assert.ok(
        Math.abs(M.forwardReturn(s,h)*100-a.matches[index][j+2]) < .061, symbol));
      assert.ok(s.bars.length <= (a.grp === 'crypto' ? 540 : 246), symbol);
    });
    current.bars.slice(current.start, current.end+1).forEach((bar, i) => {
      assert.ok(Math.abs(bar[4]/current.bars[current.start][4]*100-a.nc[i]) < .061, symbol);
    });
  }
});

test('future OHLC and volume are completely omitted until revealed', () => {
  const s = replay.cases.corr[0];
  const hidden = M.seriesData(s,0,false);
  assert.equal(hidden.price.length,s.end+1);
  assert.equal(hidden.price.at(-1).time,s.endTime);
  assert.ok(hidden.volume.every(row => row.time <= s.endTime));
  assert.equal(M.forwardReturn(s,0),null);
  const step = M.seriesData(s,1,false);
  assert.equal(step.price.at(-1).time,s.bars[s.end+1][0]);
  assert.equal(M.visibleRows(s,Infinity).length,s.bars.length);
  assert.equal(M.visibleRows(s,-10).length,s.end+1);
  assert.equal(M.visibleRows(s,'invalid').length,s.end+1);
});

test('normalization uses the same match-start close for every OHLC field', () => {
  const s = {start:1,end:2,bars:[
    [1000,98,102,97,100,7], [2000,100,105,99,104,8],
    [3000,104,108,103,107,9], [4000,107,110,106,108,10],
  ]};
  const normalized = M.seriesData(s,10,true);
  assert.ok(normalized.candles);
  assert.ok(Math.abs(normalized.price[s.start].close-100) < 1e-10);
  assert.ok(Math.abs(normalized.price[s.start].open-s.bars[s.start][1]/s.bars[s.start][4]*100) < 1e-10);
  assert.deepEqual(normalized.volume,M.seriesData(s,10,false).volume);
  s.bars[2][1] = null;
  const line = M.seriesData(s,10,true);
  assert.equal(line.candles,false);
  assert.ok(Math.abs(line.price[s.start].value-100) < 1e-10);
});

test('invalid candles fall back to true closes and never get clamped or fabricated', () => {
  const s = structuredClone(replay.cases.corr[0]);
  s.bars[s.end][3] = s.bars[s.end][4]+10;
  const result = M.seriesData(s,0,false);
  assert.equal(result.candles,false);
  assert.equal(result.price.at(-1).value,s.bars[s.end][4]);
  assert.equal('open' in result.price.at(-1),false);
  assert.equal(s.bars[s.end][3],s.bars[s.end][4]+10);
});

test('cross-chart ranges align matching bars instead of unrelated calendar dates', () => {
  const a = replay.current, b = replay.cases.corr[0];
  const range = {from:a.start-15,to:a.end+5};
  assert.deepEqual(M.linkedRange(range,a,b),{from:b.start-15,to:b.end+5});
  assert.deepEqual(M.linkedRange(M.linkedRange(range,a,b),b,a),range);
});

test('match shading interpolates half-bar boundaries using supported integer coordinates', () => {
  const calls = [];
  const scale = {logicalToCoordinate:n => {calls.push(n); return Number.isInteger(n) ? n*10 : 0;}};
  assert.deepEqual(M.bandCoordinates(scale,{start:10,end:49}),{left:95,right:495});
  assert.ok(calls.every(Number.isInteger));
  assert.equal(M.bandCoordinates({logicalToCoordinate:()=>null},{start:0,end:39}),null);
});

test('mismatched symbol, stale descriptor and malformed bars are rejected', () => {
  assert.throws(() => M.validate(replay,'ES',replay.asof));
  assert.throws(() => M.validate(replay,'NQ',replay.asof+1));
  const wrong = structuredClone(replay);
  wrong.current.bars.push([replay.asof+1,1,2,1,2,0]);
  assert.throws(() => M.validate(wrong,'NQ',replay.asof));
  const duplicate = structuredClone(replay);
  duplicate.current.bars[1][0] = duplicate.current.bars[0][0];
  assert.throws(() => M.validate(duplicate,'NQ',replay.asof));
});

test('crypto cases preserve four-hour timestamps rather than resolving by date', () => {
  const r = data.assets.BTC.replay;
  assert.equal(r.interval,'4h');
  for (const s of r.cases.corr) {
    assert.equal(s.endTime,s.bars[s.end][0]);
    assert.equal(s.bars[s.end][0]-s.bars[s.end-1][0],14400);
    assert.equal(s.end-s.start+1,60);
  }
});

test('BTC and ETH include 2018 and 2023 with independent annual correlation cases', () => {
  for (const symbol of ['BTC','ETH']) {
    const a = data.assets[symbol], r = a.replay;
    assert.equal(a.health.historyStart,'2017-08-17');
    assert.equal(a.health.requestedStart,'2017-01-01');
    assert.ok(a.health.bars>12000);
    for (const year of ['2018','2023']) {
      assert.ok(a.seasyears.some(row=>String(row[0])===year));
      const cases = M.caseList(r,'year',year);
      assert.equal(cases.length,3);
      for (const s of cases) {
        assert.equal(String(new Date(s.startTime*1000).getUTCFullYear()),year);
        assert.equal(String(new Date(s.endTime*1000).getUTCFullYear()),year);
        assert.ok(s.endTime<r.current.startTime);
        assert.equal(M.seriesData(s,0,false).price.at(-1).time,s.endTime);
        const span = s.bars.slice(s.start,s.end+181);
        assert.ok(span.every((bar,i)=>!i||bar[0]-span[i-1][0]===14400));
      }
    }
    assert.equal(M.caseList(r,'corr','2018'),r.cases.corr);
    assert.equal(M.caseList(r,'dtw','2023'),r.cases.dtw);
    assert.deepEqual(M.caseList(r,'year','1998'),[]);
  }
});

test('annual snapshots reject mislabeled years and keep legacy snapshots usable', () => {
  const wrong = structuredClone(data.assets.BTC.replay);
  wrong.annualCases['1998'] = wrong.annualCases['2018'];
  assert.throws(()=>M.validate(wrong,'BTC',wrong.asof));
  delete wrong.annualCases;
  assert.equal(M.validate(wrong,'BTC',wrong.asof),wrong);
});

test('axis labels stay compact and use the source exchange timezone', () => {
  const time = Date.parse('2026-11-05T00:00:00Z')/1000;
  assert.equal(M.axisLabel(time,'year','UTC'),'2026');
  assert.equal(M.axisLabel(time,'month','UTC'),'2026/11');
  assert.equal(M.axisLabel(time,'day','America/New_York'),'11/04');
  assert.equal(M.axisLabel(time,'time','UTC'),'00:00');
  for (const kind of ['year','month','day','time']) assert.ok(M.axisLabel(time,kind,'UTC').length<=7);
});

test('long daily coverage is real and does not backfill pre-launch futures or newer ETFs', () => {
  for (const symbol of ['NDX','SPX','SPY','AAPL']) {
    const a = data.assets[symbol];
    assert.equal(a.health.requestedStart,'1998-01-01');
    assert.equal(a.health.historyStart,'1998-01-02');
    assert.ok(a.health.bars > 7000,symbol);
    assert.ok(a.seasyears.some(row=>row[0]===1998),symbol);
  }
  assert.ok(data.assets.NQ.health.historyStart>='1999-06-21');
  assert.ok(data.assets.ES.health.historyStart>='1998-01-01');
  assert.ok(data.assets.QQQ.health.historyStart>='1999-03-10');
  for (const a of Object.values(data.assets)) {
    const start = Date.parse(a.health.historyStart)/1000;
    for (const method of ['corr','dtw']) for (const s of a.replay.cases[method]) {
      assert.ok(s.bars.every(row=>row[0]>=start),a.k);
    }
  }
});
