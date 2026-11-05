import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import M from '../prototype/history-replay-model.js';

const html = readFileSync(new URL('../prototype/app.html', import.meta.url), 'utf8');
const data = JSON.parse(html.match(/<script id="APPDATA"[^>]*>(.*?)<\/script>/s)[1]);
const asset = data.assets.NQ;
const replay = asset.replay;

test('all 48 snapshots validate identity, ordering and original matching windows', () => {
  assert.equal(Object.keys(data.assets).length, 48);
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
  const s = replay.cases.dtw[0];
  const normalized = M.seriesData(s,10,true);
  assert.ok(normalized.candles);
  assert.ok(Math.abs(normalized.price[s.start].close-100) < 1e-10);
  assert.ok(Math.abs(normalized.price[s.start].open-s.bars[s.start][1]/s.bars[s.start][4]*100) < 1e-10);
  assert.deepEqual(normalized.volume,M.seriesData(s,10,false).volume);
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
