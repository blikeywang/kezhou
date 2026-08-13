import assert from "node:assert/strict";
import test from "node:test";

import {
  TAILTREND_CONFIG,
  analyzeBars,
  calculateRiskPlan,
  drawdownMultiplier,
  normalizeBars,
  summarizeSnapshot,
  updateAuditLedger,
  volatilityMultiplier,
  wilderAtrSeries,
} from "./vendor/tailtrend/tailtrend-engine.mjs";

function dateAt(index) {
  const date = new Date(Date.UTC(2025, 0, 2 + index));
  return date.toISOString().slice(0, 10);
}

function rangeHistory(count = 320) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const wave = 100 + Math.sin(index / 7) * 16;
    const close = index >= count - 8 ? 87 + (index % 2) * 0.5 : wave;
    rows.push({
      time: dateAt(index),
      open: close - 0.3,
      high: close + 2,
      low: close - 2,
      close,
      volume: 2_000_000 + index * 100,
      turnover: 120_000_000,
    });
  }
  return rows;
}

function withLast(base, values) {
  return [...base, ...values.map((value, offset) => ({
    time: dateAt(base.length + offset),
    volume: 3_000_000,
    turnover: 180_000_000,
    ...value,
  }))];
}

test("bar normalization drops malformed rows, deduplicates dates, and sorts chronologically", () => {
  const bars = normalizeBars([
    { time: "2026-01-03", open: 10, high: 12, low: 9, close: 11 },
    { time: "bad", open: 10, high: 12, low: 9, close: 11 },
    { time: "2026-01-02", open: 9, high: 10, low: 8, close: 9.5 },
    { time: "2026-01-03", open: 11, high: 13, low: 10, close: 12 },
  ]);
  assert.deepEqual(bars.map((row) => [row.date, row.close]), [["2026-01-02", 9.5], ["2026-01-03", 12]]);
});

test("Wilder ATR uses true range and produces a stable value on constant ranges", () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    time: dateAt(index), open: 100, high: 102, low: 98, close: 100,
  }));
  const atr = wilderAtrSeries(rows, 20);
  assert.equal(atr[19], null);
  assert.equal(atr[20], 4);
  assert.equal(atr.at(-1), 4);
});

test("a lower-tail touch is not a signal until the daily close reclaims the boundary", () => {
  const history = rangeHistory();
  const falling = analyzeBars(withLast(history, [{ open: 86.8, high: 88, low: 84, close: 86.5 }]), { symbol: "TEST.US" });
  const reclaimed = analyzeBars(withLast(history, [{ open: 86.5, high: 91, low: 84, close: 90 }]), { symbol: "TEST.US" });
  assert.equal(falling.state, "LOWER_TAIL_FALLING");
  assert.equal(falling.newPositionAllowed, false);
  assert.equal(reclaimed.state, "LOWER_TAIL_RECLAIMED");
  assert.equal(reclaimed.newPositionAllowed, true);
  assert.equal(reclaimed.riskModule, "tail_core");
  assert.ok(reclaimed.management.hardStop < reclaimed.tailMap.rangeLow);
});

test("breakout candidate, acceptance, and failure are separate daily-close states", () => {
  const history = rangeHistory();
  history.splice(-8, 8, ...Array.from({ length: 8 }, (_, index) => ({
    time: dateAt(history.length - 8 + index), open: 111, high: 117.5, low: 110, close: 115,
    volume: 2_000_000, turnover: 150_000_000,
  })));
  const candidateRows = withLast(history, [{ open: 116, high: 122, low: 115, close: 121 }]);
  const candidate = analyzeBars(candidateRows, { symbol: "TREND.US" });
  const accepted = analyzeBars(withLast(candidateRows, [{ open: 121, high: 123, low: 120, close: 122 }]), { symbol: "TREND.US" });
  const failed = analyzeBars(withLast(candidateRows, [{ open: 120, high: 120.5, low: 114, close: 115 }]), { symbol: "TREND.US" });
  assert.equal(candidate.state, "BREAKOUT_CANDIDATE");
  assert.equal(candidate.bucket, "BREAKOUT_CANDIDATE_WATCH");
  assert.equal(candidate.newPositionAllowed, false);
  assert.equal(candidate.candidateModule, "pure_trend");
  assert.equal(candidate.nextCondition.targetState, "TREND_ACCEPTED");
  assert.equal(candidate.priority, Math.round(candidate.priorityBreakdown.reduce((sum, item) => sum + item.points, 0)));
  assert.equal(accepted.state, "TREND_ACCEPTED");
  assert.equal(accepted.bucket, "TREND_ACCEPTED_WATCH");
  assert.ok(accepted.breakout.holdCloses >= TAILTREND_CONFIG.breakoutHoldCloses);
  assert.equal(failed.state, "BREAKOUT_FAILED");
});

test("an outsized opening gap overrides ordinary tail and trend states", () => {
  const history = rangeHistory();
  const result = analyzeBars(withLast(history, [{ open: 125, high: 127, low: 123, close: 126 }]), { symbol: "GAP.US" });
  assert.equal(result.state, "EVENT_QUARANTINE");
  assert.equal(result.newPositionAllowed, false);
  assert.ok(result.gapAtr > TAILTREND_CONFIG.gapQuarantineAtr);
});

test("A/H/SG rejection states never become opening-short candidates", () => {
  const history = rangeHistory();
  history.splice(-8, 8, ...Array.from({ length: 8 }, (_, index) => ({
    time: dateAt(history.length - 8 + index), open: 113, high: 118, low: 112, close: 116,
    volume: 2_000_000, turnover: 150_000_000,
  })));
  const rows = withLast(history, [{ open: 116, high: 119, low: 108, close: 110 }]);
  const us = analyzeBars(rows, { symbol: "REJECT.US" });
  const hk = analyzeBars(rows, { symbol: "700.HK" });
  assert.equal(us.state, "UPPER_TAIL_REJECTED");
  assert.equal(us.candidateModule, "us_short");
  assert.equal(us.newPositionAllowed, false);
  assert.ok(us.blockers.some((item) => item.includes("借券")));
  assert.equal(hk.state, "UPPER_TAIL_REJECTED");
  assert.equal(hk.newPositionAllowed, false);
  assert.equal(hk.riskModule, null);
  assert.ok(hk.blockers.some((item) => item.includes("不输出做空")));
});

test("risk throttles are monotonic and stop all new risk at ten percent drawdown", () => {
  assert.deepEqual([0, 4.9, 5, 8, 10].map(drawdownMultiplier), [1, 1, 0.5, 0.25, 0]);
  assert.deepEqual([20, 75, 76, 91].map(volatilityMultiplier), [1, 0.75, 0.75, 0.5]);
});

test("tail-core sizing shares one idea budget with its trend reserve", () => {
  const plan = calculateRiskPlan({
    module: "tail_core",
    equity: 1_000_000,
    entry: 100,
    stop: 95,
    gapReserve: 1,
    slippageReserve: 0.5,
    drawdownPct: 0,
    hvPercentile: 50,
    weeklyRegime: "UP",
    existingPortfolioHeatPct: 0,
    clusterHeatPct: 0,
    averageTurnover20: 100_000_000,
  });
  assert.equal(plan.allowed, true);
  assert.equal(plan.ideaRiskPct, 0.4);
  assert.equal(plan.tradeRiskPct, 0.24);
  assert.equal(plan.reservedRiskPct, 0.16);
  assert.equal(plan.stressPerShare, 6.5);
  assert.equal(plan.shares, Math.floor(2_400 / 6.5));
});

test("portfolio heat, circuit breakers, and weekly alignment can veto an otherwise valid setup", () => {
  const plan = calculateRiskPlan({
    module: "pure_trend",
    equity: 500_000,
    entry: 100,
    stop: 96,
    hvPercentile: 60,
    weeklyRegime: "RANGE",
    existingPortfolioHeatPct: 1.4,
    clusterHeatPct: 0.7,
    fullStopsToday: 2,
  });
  assert.equal(plan.allowed, false);
  assert.equal(plan.shares, 0);
  assert.ok(plan.blockers.some((item) => item.includes("周线")));
  assert.ok(plan.blockers.some((item) => item.includes("两个完整止损")));
});

test("missing stop never becomes a zero-price stress calculation", () => {
  const plan = calculateRiskPlan({
    module: "tail_core",
    equity: 100_000,
    entry: 100,
    stop: null,
    hvPercentile: 50,
    weeklyRegime: "UP",
  });
  assert.equal(plan.allowed, false);
  assert.equal(plan.stressPerShare, null);
  assert.equal(plan.shares, 0);
  assert.ok(plan.blockers.some((item) => item.includes("硬止损")));
});

test("signal-state, freshness, and locked-module gates override an otherwise valid share calculation", () => {
  const candidate = calculateRiskPlan({
    module: "pure_trend",
    equity: 100_000,
    entry: 100,
    stop: 95,
    hvPercentile: 50,
    weeklyRegime: "UP",
    signalGate: {
      expectedModule: "pure_trend",
      newPositionAllowed: false,
      state: "BREAKOUT_CANDIDATE",
      stateLabel: "突破候选",
      dataStatus: "FRESH",
      eventClear: true,
      blockers: ["日线接受尚未完成"],
    },
  });
  assert.equal(candidate.allowed, false);
  assert.equal(candidate.shares, 0);
  assert.ok(candidate.blockers.some((item) => item.includes("状态机禁止新仓")));
  assert.ok(candidate.blockers.some((item) => item.includes("日线接受尚未完成")));

  const bypass = calculateRiskPlan({
    module: "tail_core",
    equity: 100_000,
    entry: 100,
    stop: 95,
    hvPercentile: 50,
    weeklyRegime: "UP",
    signalGate: {
      expectedModule: "us_short",
      newPositionAllowed: true,
      state: "UPPER_TAIL_REJECTED",
      stateLabel: "上沿拒绝",
      dataStatus: "STALE",
      eventClear: true,
      shortQualified: false,
    },
  });
  assert.equal(bypass.allowed, false);
  assert.equal(bypass.shares, 0);
  assert.ok(bypass.blockers.some((item) => item.includes("手动绕开")));
  assert.ok(bypass.blockers.some((item) => item.includes("STALE")));

  const unqualifiedShort = calculateRiskPlan({
    module: "us_short",
    equity: 100_000,
    entry: 100,
    stop: 105,
    hvPercentile: 50,
    weeklyRegime: "DOWN",
    signalGate: {
      expectedModule: "us_short",
      newPositionAllowed: true,
      state: "UPPER_TAIL_REJECTED",
      stateLabel: "上沿拒绝",
      dataStatus: "FRESH",
      eventClear: true,
      shortQualified: false,
    },
  });
  assert.equal(unqualifiedShort.allowed, false);
  assert.equal(unqualifiedShort.shares, 0);
  assert.ok(unqualifiedShort.blockers.some((item) => item.includes("做空资格")));
});

test("audit ledger records only real future sessions and does not double count same-day refreshes", () => {
  const record = {
    symbol: "TEST.US",
    tradingDate: "2026-01-02",
    state: "LOWER_TAIL_RECLAIMED",
    bucket: "TAIL_RECLAIM_WATCH",
    priority: 72,
    signalDirection: "LONG",
    newPositionAllowed: true,
    dataStatus: "FRESH",
    stateReason: ["下沿收复"],
    blockers: [],
    management: { entryReference: 100 },
  };
  const baseline = updateAuditLedger(null, [record], new Map([["TEST.US", {
    date: "2026-01-02", open: 99, high: 102, low: 98, close: 101,
  }]]), { updatedAt: "2026-01-02T22:00:00Z" });
  assert.equal(baseline.daysCollected, 1);
  assert.equal(baseline.entries[0].forward.sessions, 0);
  assert.equal(baseline.entries[0].forward.horizons["1"], null);

  const nextDay = updateAuditLedger(baseline, [], new Map([["TEST.US", {
    date: "2026-01-05", open: 101, high: 106, low: 97, close: 104,
  }]]), { updatedAt: "2026-01-05T22:00:00Z" });
  assert.equal(nextDay.entries[0].forward.sessions, 1);
  assert.equal(nextDay.entries[0].execution.nextTradableReference, 101);
  assert.equal(nextDay.entries[0].execution.slippagePct, 1);
  assert.equal(nextDay.entries[0].forward.horizons["1"].mfePct, 6);
  assert.equal(nextDay.entries[0].forward.horizons["1"].maePct, -3);

  const sameDayRerun = updateAuditLedger(nextDay, [], new Map([["TEST.US", {
    date: "2026-01-05", open: 102, high: 108, low: 96, close: 105,
  }]]), { updatedAt: "2026-01-05T23:00:00Z" });
  assert.equal(sameDayRerun.entries[0].forward.sessions, 1);
  assert.equal(sameDayRerun.entries[0].forward.horizons["1"].mfePct, 6);

  const catchUp = updateAuditLedger(sameDayRerun, [], new Map([["TEST.US", [
    { date: "2026-01-05", open: 101, high: 106, low: 97, close: 104 },
    { date: "2026-01-06", open: 104, high: 107, low: 102, close: 106 },
    { date: "2026-01-07", open: 106, high: 109, low: 103, close: 108 },
  ]]]), { updatedAt: "2026-01-07T22:00:00Z" });
  assert.equal(catchUp.entries[0].forward.sessions, 3);
  assert.equal(catchUp.entries[0].forward.horizons["3"].asOf, "2026-01-07");
  assert.equal(catchUp.entries[0].forward.horizons["3"].mfePct, 9);
});

test("snapshot summary preserves separate state buckets instead of a mixed score", () => {
  const summary = summarizeSnapshot([
    { state: "LOWER_TAIL_RECLAIMED", bucket: "TAIL_RECLAIM_WATCH", newPositionAllowed: true, blockers: [] },
    { state: "RANGE_MIDDLE", bucket: "NO_TRADE_MIDDLE", newPositionAllowed: false, blockers: [] },
    { state: "EVENT_QUARANTINE", bucket: "EVENT_QUARANTINE", newPositionAllowed: false, blockers: ["event"] },
  ]);
  assert.equal(summary.records, 3);
  assert.equal(summary.actionable, 1);
  assert.deepEqual(summary.bucketCounts, {
    TAIL_RECLAIM_WATCH: 1,
    NO_TRADE_MIDDLE: 1,
    EVENT_QUARANTINE: 1,
  });
});
