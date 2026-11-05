(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HistoryReplayModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const positive = value => Number.isFinite(value) && value > 0;
  function candleValid(row) {
    return row.slice(1, 5).every(positive) &&
      row[3] <= Math.min(row[1], row[4]) && Math.max(row[1], row[4]) <= row[2];
  }
  function validate(data, symbol, asof) {
    if (!data || data.version !== 1 || data.symbol !== symbol ||
        !['4h', '1d'].includes(data.interval) || data.asof !== asof) {
      throw new Error('Snapshot identity mismatch');
    }
    new Intl.DateTimeFormat('en', {timeZone: data.timeZone}).format();
    function segment(s) {
      if (!s || !Array.isArray(s.bars) || !s.bars.length ||
          !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 ||
          s.end >= s.bars.length || s.end - s.start + 1 !== data.window) {
        throw new Error('Invalid matching window');
      }
      let previous = -Infinity;
      for (const row of s.bars) {
        if (!Array.isArray(row) || row.length !== 6 || !Number.isInteger(row[0]) ||
            row[0] <= previous || row[0] > data.asof || !positive(row[4]) ||
            row.slice(1).some(v => v !== null && !Number.isFinite(v))) {
          throw new Error('Invalid historical bar');
        }
        previous = row[0];
      }
      if (s.startTime !== s.bars[s.start][0] || s.endTime !== s.bars[s.end][0]) {
        throw new Error('Matching timestamps differ');
      }
    }
    segment(data.current);
    if (data.current.end !== data.current.bars.length - 1 || data.current.endTime !== data.asof) {
      throw new Error('Current snapshot contains future bars');
    }
    for (const method of ['corr', 'dtw']) {
      const cases = data.cases && data.cases[method];
      if (!Array.isArray(cases) || !cases.length || cases.length > 6) throw new Error('No matched cases');
      const ids = new Set();
      cases.forEach(s => {
        segment(s);
        if (s.endTime >= data.current.startTime || !Number.isFinite(s.score) || ids.has(s.id)) {
          throw new Error('Invalid historical match');
        }
        ids.add(s.id);
      });
    }
    for (const [year, cases] of Object.entries(data.annualCases || {})) {
      if (!/^\d{4}$/.test(year) || !Array.isArray(cases) || !cases.length || cases.length > 3) {
        throw new Error('Invalid annual cases');
      }
      const ids = new Set();
      cases.forEach(s => {
        segment(s);
        if (s.endTime >= data.current.startTime || !Number.isFinite(s.score) || ids.has(s.id) ||
            [s.startTime,s.endTime].some(t => String(new Date(t*1000).getUTCFullYear()) !== year)) {
          throw new Error('Invalid annual match');
        }
        ids.add(s.id);
      });
    }
    return data;
  }
  function caseList(data, method, year) {
    return method === 'year' ? (data.annualCases?.[year] || []) : (data.cases?.[method] || []);
  }
  const futureCount = s => s.bars.length - s.end - 1;
  const clampReveal = (s, n) => Math.min(futureCount(s), Math.max(0, Math.trunc(Number(n) || 0)));
  function visibleRows(s, reveal) {
    return s.bars.slice(0, s.end + clampReveal(s, reveal) + 1);
  }
  function seriesData(s, reveal, indexed) {
    const rows = visibleRows(s, reveal);
    const factor = indexed ? 100 / s.bars[s.start][4] : 1;
    // Never repair a settlement/out-of-range candle. Preserve its close as a line.
    const candles = s.bars.every(candleValid);
    return {
      candles,
      price: rows.map(r => candles
        ? {time: r[0], open: r[1] * factor, high: r[2] * factor, low: r[3] * factor, close: r[4] * factor}
        : {time: r[0], value: r[4] * factor}),
      volume: rows.filter(r => r[5] !== null && r[5] >= 0).map(r => ({
        time: r[0], value: r[5], color: r[4] >= (r[1] || r[4]) ? '#29987b66' : '#d15f7066',
      })),
    };
  }
  function linkedRange(range, from, to) {
    const offset = to.start - from.start;
    return {from: range.from + offset, to: range.to + offset};
  }
  function bandCoordinates(scale, s) {
    // LWC 5.2 accepts only integer logical indices; interpolate the half-bar edges.
    const start = scale.logicalToCoordinate(s.start);
    const next = scale.logicalToCoordinate(s.start + 1);
    const end = scale.logicalToCoordinate(s.end);
    if ([start,next,end].some(v => v === null)) return null;
    const half = Math.abs(next - start) / 2;
    return {left:start-half, right:end+half};
  }
  function viewRange(s, reveal, mode) {
    const last = s.end + clampReveal(s, reveal);
    return mode === 'match' ? {from: s.start - 3, to: s.end + 4}
      : {from: Math.max(-1, s.start - 2 * (s.end - s.start + 1)) - 1, to: last + 4};
  }
  function forwardReturn(s, reveal) {
    const n = clampReveal(s, reveal);
    return n ? s.bars[s.end + n][4] / s.bars[s.end][4] - 1 : null;
  }
  function axisLabel(time, kind, timeZone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
    }).formatToParts(new Date(time*1000)).map(p => [p.type,p.value]));
    if (kind === 'year') return parts.year;
    if (kind === 'month') return parts.year + '/' + parts.month;
    if (kind === 'time') return parts.hour + ':' + parts.minute;
    return parts.month + '/' + parts.day;
  }
  return {validate, caseList, candleValid, futureCount, clampReveal, visibleRows, seriesData, linkedRange, bandCoordinates, viewRange, forwardReturn, axisLabel};
});
