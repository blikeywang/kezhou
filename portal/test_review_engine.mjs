import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeTrades,
  attachMarketData,
  createExportReport,
  normalizeBarRecords,
  normalizeTradeRecords,
  parseDelimited,
  parseRecords,
  reviewTrade,
} from "./vendor/review/review-engine.mjs";

test("CSV parser preserves quoted commas and escaped quotes", () => {
  const rows = parseDelimited('id,symbol,notes\n1,BTCUSDT,"breakout, retest"\n2,NQ,"said ""wait"""\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].notes, "breakout, retest");
  assert.equal(rows[1].notes, 'said "wait"');
});

test("JSON parser accepts a trades envelope", () => {
  const rows = parseRecords('{"trades":[{"id":"A"}]}', "trades.json");
  assert.deepEqual(rows, [{ id: "A" }]);
  const nested = parseRecords('{"data":{"closed_trades":[{"id":"B"}]}}', "nested.json");
  assert.deepEqual(nested, [{ id: "B" }]);
});

test("trade normalization maps Chinese fields, removes duplicates, and reports invalid rows", () => {
  const result = normalizeTradeRecords([
    { 交易编号: "A", 品种: "BTCUSDT", 方向: "做多", 开仓时间: "2026-01-01T10:00:00Z", 平仓时间: "2026-01-01T10:03:00Z", 入场价: 100, 出场价: 102, 数量: 1, 止损: 98, 止盈: 104, 手续费: 0.5 },
    { 交易编号: "A", 品种: "BTCUSDT", 方向: "做多", 开仓时间: "2026-01-01T10:00:00Z", 平仓时间: "2026-01-01T10:03:00Z", 入场价: 100, 出场价: 102, 数量: 1, 止损: 98, 止盈: 104, 手续费: 0.5 },
    { 交易编号: "B", 品种: "BTCUSDT", 方向: "做空", 开仓时间: "2026-01-01T11:00:00Z", 平仓时间: "2026-01-01T11:05:00Z", 净盈亏: -4, 风险金额: 2 },
    { 交易编号: "C", 品种: "", 方向: "旁观", 开仓时间: "bad", 净盈亏: 1 },
  ]);

  assert.equal(result.trades.length, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.trades[0].netPnl, 1.5);
  assert.equal(result.trades[0].rMultiple, 0.75);
  assert.equal(result.trades[0].plannedRR, 2);
  assert.deepEqual(result.invalid[0].reasons, ["缺少标的", "方向无法识别", "缺少或无法解析开仓时间"]);
});

test("market bars calculate real excursion and provide bounded trade review", () => {
  const normalized = normalizeTradeRecords([
    { id: "A", symbol: "BTCUSDT", side: "long", entry_time: "2026-01-01T10:00:00Z", exit_time: "2026-01-01T10:03:00Z", entry_price: 100, exit_price: 102, quantity: 1, stop: 98, target: 104 },
  ]);
  const barResult = normalizeBarRecords([
    { symbol: "BTCUSDT", time: "2026-01-01T09:58:00Z", open: 99, high: 100, low: 98.5, close: 99.5 },
    { symbol: "BTCUSDT", time: "2026-01-01T09:59:00Z", open: 99.5, high: 100.2, low: 99.2, close: 100 },
    { symbol: "BTCUSDT", time: "2026-01-01T10:00:00Z", open: 100, high: 101, low: 99, close: 100.5 },
    { symbol: "BTCUSDT", time: "2026-01-01T10:01:00Z", open: 100.5, high: 103, low: 100, close: 102.5 },
    { symbol: "BTCUSDT", time: "2026-01-01T10:02:00Z", open: 102.5, high: 102.8, low: 101, close: 101.5 },
    { symbol: "BTCUSDT", time: "2026-01-01T10:03:00Z", open: 101.5, high: 102.2, low: 101.2, close: 102 },
  ]);
  const trades = attachMarketData(normalized.trades, barResult.bars);
  const analysis = analyzeTrades(trades);
  const review = reviewTrade(trades[0], analysis);

  assert.equal(trades[0].marketCoverage, true);
  assert.equal(trades[0].mfeR, 1.5);
  assert.equal(trades[0].maeR, 0.5);
  assert.match(review.management, /1\.5R/);
  assert.match(review.structure, /已匹配持仓期K线/);
  assert.match(review.expertLenses[0].text, /暂停/);
  assert.ok(review.cannotSay.some(item => item.includes("一定")));
});

test("symbol-tagged bars never attach to a different instrument", () => {
  const { trades } = normalizeTradeRecords([
    { id: "ES-1", symbol: "ES", side: "long", entry_time: "2026-01-01T10:00:00Z", exit_time: "2026-01-01T10:02:00Z", entry_price: 100, exit_price: 101, stop: 99, target: 102, net_pnl: 1 },
  ]);
  const bars = normalizeBarRecords([
    { symbol: "NQ", time: "2026-01-01T10:00:00Z", open: 100, high: 101, low: 99, close: 100.5 },
    { symbol: "NQ", time: "2026-01-01T10:01:00Z", open: 100.5, high: 102, low: 100, close: 101 },
  ]).bars;
  const attached = attachMarketData(trades, bars);

  assert.equal(attached[0].marketCoverage, false);
  assert.deepEqual(attached[0].marketBars, []);
});

test("expert lenses provide conditional prices only with enough pre-entry bars", () => {
  const { trades } = normalizeTradeRecords([
    { id: "LENS", symbol: "NQ", side: "long", entry_time: "2026-01-01T10:00:00Z", exit_time: "2026-01-01T10:02:00Z", entry_price: 109, exit_price: 110, stop: 106, target: 115, net_pnl: 1 },
  ]);
  const bars = normalizeBarRecords(Array.from({ length: 12 }, (_item, index) => ({
    symbol: "NQ",
    time: new Date(Date.parse("2026-01-01T09:50:00Z") + index * 60000).toISOString(),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
  }))).bars;
  const attached = attachMarketData(trades, bars);
  const review = reviewTrade(attached[0], analyzeTrades(attached));

  assert.match(review.structure, /整体上行/);
  assert.equal(review.expertLenses.length, 3);
  assert.match(review.expertLenses[0].text, /方向与入场前趋势一致/);
  assert.match(review.expertLenses[2].label, /Paul Wei/);
  assert.match(review.expertLenses[2].text, /不伪造动作概率/);
  assert.equal(review.betterPlan.steps.length, 5);
  assert.match(review.betterPlan.steps[2].action, /全仓最坏损失仍不得超过1R/);
  assert.deepEqual(review.coachReplay.map(coach => coach.id), ["paul-wei", "brooks-pa", "risk-probability"]);
  assert.match(review.coachReplay[0].limitation, /不提供伪精确胜率/);
  assert.match(review.coachReplay[1].entry, /二次|回踩/);
  assert.match(review.coachReplay[2].add, /全仓最坏损失仍不得超过1R/);
});

test("bundled teaching case turns a profit giveback into an actionable plan", () => {
  const tradeRows = parseRecords(readFileSync(new URL("./vendor/review/sample-trades.csv", import.meta.url), "utf8"), "sample-trades.csv");
  const barRows = parseRecords(readFileSync(new URL("./vendor/review/sample-bars.csv", import.meta.url), "utf8"), "sample-bars.csv");
  const normalized = normalizeTradeRecords(tradeRows);
  const bars = normalizeBarRecords(barRows);
  const trades = attachMarketData(normalized.trades, bars.bars);
  const analysis = analyzeTrades(trades);
  const trade = trades.find(item => item.id === "DEMO-014");
  const review = reviewTrade(trade, analysis);

  assert.equal(bars.bars.length, 161);
  assert.ok(trade.mfeR > 1.4 && trade.mfeR < 1.5);
  assert.equal(trade.rMultiple, -0.6);
  assert.match(review.betterPlan.headline, /方向一度兑现/);
  assert.match(review.betterPlan.steps[0].action, /不在窗口极端直接追/);
  assert.match(review.betterPlan.steps[3].action, /97300/);
  assert.match(review.betterPlan.limitation, /不能保证/);
});

test("analysis reconciles metrics and chooses one repeatable prescription", () => {
  const records = [
    ["T1", "2026-01-01T09:00:00Z", "2026-01-01T09:10:00Z", 100, 102, 98, 101, 2],
    ["T2", "2026-01-01T10:00:00Z", "2026-01-01T10:10:00Z", 100, 97, 98, 101, -3],
    ["T3", "2026-01-02T09:00:00Z", "2026-01-02T09:10:00Z", 100, 101, 98, 101, 1],
    ["T4", "2026-01-02T10:00:00Z", "2026-01-02T10:10:00Z", 100, 97, 98, 101, -3],
    ["T5", "2026-01-03T09:00:00Z", "2026-01-03T09:10:00Z", 100, 102, 98, 104, 2],
    ["T6", "2026-01-03T10:00:00Z", "2026-01-03T10:10:00Z", 100, 101, 98, 104, 1],
  ].map(([id, entry_time, exit_time, entry_price, exit_price, stop, target, net_pnl]) => ({
    id, symbol: "NQ", side: "long", entry_time, exit_time, entry_price, exit_price,
    stop, target, net_pnl, risk_amount: 2, strategy: "opening range",
  }));
  const { trades } = normalizeTradeRecords(records);
  const analysis = analyzeTrades(trades, { accountSize: 1000, riskPercent: 1 });

  assert.equal(analysis.summary.count, 6);
  assert.equal(analysis.summary.netPnl, 0);
  assert.equal(analysis.summary.winRate, 66.66666666666667);
  assert.equal(analysis.summary.profitFactor, 1);
  assert.equal(analysis.summary.maxDrawdown, 5);
  assert.equal(analysis.sampleStatus, "early");
  assert.equal(analysis.primary?.id, "low_planned_rr");
  assert.equal(analysis.prescription.title, "计划赔率低于1.5");
});

test("invalid plan sides are excluded and session days honor the selected timezone", () => {
  const invalid = normalizeTradeRecords([
    { id: "BAD", symbol: "NQ", side: "long", entry_time: "2026-01-01T10:00:00Z", exit_time: "2026-01-01T10:05:00Z", entry_price: 100, exit_price: 101, stop: 102, target: 99, net_pnl: 1 },
  ]).trades[0];
  const invalidAnalysis = analyzeTrades([invalid]);
  assert.equal(invalid.plannedRR, null);
  assert.equal(invalid.stopSideValid, false);
  assert.ok(invalidAnalysis.qualityIssues.some(issue => issue.label.includes("止损位于方向错误")));
  assert.match(reviewTrade(invalid, invalidAnalysis).plan, /不能被当成有效计划/);

  const { trades } = normalizeTradeRecords([
    { id: "TZ-1", symbol: "NQ", side: "long", entry_time: "2026-01-01T23:30:00Z", exit_time: "2026-01-01T23:40:00Z", net_pnl: -1 },
    { id: "TZ-2", symbol: "NQ", side: "long", entry_time: "2026-01-02T00:30:00Z", exit_time: "2026-01-02T00:40:00Z", net_pnl: 1 },
  ]);
  const utc = analyzeTrades(trades, { maxDailyTrades: 1, timezone: "UTC" });
  const newYork = analyzeTrades(trades, { maxDailyTrades: 1, timezone: "America/New_York" });
  assert.equal(utc.behaviors.some(behavior => behavior.id === "overtrading"), false);
  assert.equal(newYork.behaviors.find(behavior => behavior.id === "overtrading")?.occurrence, 1);
});

test("mixed currencies block monetary behavior aggregation", () => {
  const { trades } = normalizeTradeRecords([
    { id: "USD-1", symbol: "NQ", side: "long", entry_time: "2026-01-01T10:00:00Z", exit_time: "2026-01-01T10:05:00Z", entry_price: 100, stop: 98, target: 102, net_pnl: -100, currency: "USD" },
    { id: "EUR-1", symbol: "DAX", side: "long", entry_time: "2026-01-02T10:00:00Z", exit_time: "2026-01-02T10:05:00Z", entry_price: 100, stop: 98, target: 102, net_pnl: -100, currency: "EUR" },
  ]);
  const analysis = analyzeTrades(trades);
  assert.deepEqual(analysis.currencies, ["EUR", "USD"]);
  assert.equal(analysis.behaviors.find(behavior => behavior.id === "low_planned_rr")?.associatedLoss, null);
  assert.ok(analysis.qualityIssues.some(issue => issue.label.includes("混合盈亏币种")));
});

test("export contains aggregate evidence but no raw trade notes", () => {
  const { trades } = normalizeTradeRecords([
    { id: "PRIVATE-1", symbol: "ES", side: "long", entry_time: "2026-01-01T10:00:00Z", exit_time: "2026-01-01T10:05:00Z", net_pnl: 20, notes: "private journal text" },
  ]);
  const report = createExportReport(analyzeTrades(trades), { sourceName: "private.csv" });
  const serialized = JSON.stringify(report);

  assert.equal(report.schema, "traderhome_review_report_v1");
  assert.ok(!("trades" in report));
  assert.doesNotMatch(serialized, /private journal text/);
  assert.doesNotMatch(serialized, /2026-01-01T10:00:00/);
  assert.ok(report.summary.curve.every(point => Object.keys(point).sort().join(",") === "index,value"));
  assert.match(report.privacy, /没有接收或保存/);
});
