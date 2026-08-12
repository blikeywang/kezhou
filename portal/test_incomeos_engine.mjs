import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  allocationFor,
  allocateDollarOrders,
  contributionPlan,
  dynamicPortfolioWeights,
  evaluateLivePut,
  evaluatePut,
  growthCycleScore,
  portfolioContributionPlan,
} from "./vendor/incomeos/incomeos-engine.mjs";

const snapshot = JSON.parse(await readFile(new URL("./vendor/incomeos/data/research-snapshot.json", import.meta.url), "utf8"));
const fullSnapshot = JSON.parse(await readFile(new URL("./vendor/incomeos/data/incomeos-full.json", import.meta.url), "utf8"));
const operationHistory = JSON.parse(await readFile(new URL("./vendor/incomeos/data/operation-history.json", import.meta.url), "utf8"));

test("allocation changes continuously with account size and always sums to one", () => {
  const early = allocationFor(0);
  const middle = allocationFor(40_000);
  const mature = allocationFor(300_000);
  for (const split of [early, middle, mature]) {
    const total = split.core + split.dividend + split.growth + split.option + split.reserve;
    assert.ok(Math.abs(total - 1) < 1e-9);
  }
  assert.equal(early.option, 0);
  assert.ok(middle.option > early.option);
  assert.ok(mature.core > middle.core);
});

test("a new account gets an immediately executable dollar plan", () => {
  const plan = contributionPlan({
    accountValue: 0,
    weeklyContribution: 1_000,
    optionReserve: 0,
    currentGrowthValue: 0,
  }, snapshot);
  assert.equal(plan.stage.id, "accumulate");
  assert.equal(Math.round(plan.amounts.core), 548);
  assert.equal(Math.round(plan.amounts.dividend), 150);
  assert.equal(Math.round(plan.amounts.growth), 103);
  assert.equal(Math.round(plan.amounts.option), 3);
  assert.equal(Math.round(plan.amounts.reserve), 198);
  assert.equal(plan.executablePut, null);
});

test("growth single-stock cap redirects new money to the broad-market core", () => {
  const uncapped = contributionPlan({ accountValue: 100_000, weeklyContribution: 1_000, optionReserve: 0, currentGrowthValue: 0 }, snapshot);
  const capped = contributionPlan({ accountValue: 100_000, weeklyContribution: 1_000, optionReserve: 0, currentGrowthValue: 20_000 }, snapshot);
  assert.equal(capped.amounts.growth, 0);
  assert.ok(capped.amounts.core > uncapped.amounts.core);
});

test("JPM put cannot pass solely because the account can fund it", () => {
  const jpm = snapshot.puts.find((candidate) => candidate.symbol === "JPM");
  const small = evaluatePut(jpm, 100_000, 34_000);
  assert.equal(small.eligible, false);
  assert.ok(small.reasons.some((reason) => reason.includes("12%")));
  const large = evaluatePut(jpm, 400_000, 34_000);
  assert.equal(large.eligible, false);
  assert.ok(large.reasons.some((reason) => reason.includes("估值")));
  assert.ok(large.reasons.some((reason) => reason.includes("bid/ask")));
});

test("a fully verified SCHD put can pass after account and cash gates", () => {
  const schd = snapshot.puts.find((candidate) => candidate.symbol === "SCHD");
  const verified = { ...schd, hasBidAsk: true };
  assert.equal(evaluatePut(verified, 20_000, 3_300).eligible, true);
});

test("growth-cycle engine finds JPM and GS materially stronger than BAC on this snapshot", () => {
  const scores = Object.fromEntries(snapshot.banks.map((asset) => [asset.symbol, growthCycleScore(asset).total]));
  assert.ok(scores.JPM > scores.BAC);
  assert.ok(scores.GS > scores.BAC);
  assert.ok(scores.JPM >= 50 && scores.JPM <= 90);
});

test("expanded candidate scan selects exactly 50 investable assets from more than 50 candidates", () => {
  assert.equal(fullSnapshot.universe.candidateCount, 71);
  assert.equal(fullSnapshot.assets.filter((asset) => asset.selectedTop50).length, 50);
  assert.ok(fullSnapshot.universe.challengerCount >= 20);
  assert.equal(fullSnapshot.assets.filter((asset) => asset.kind === "Benchmark" && asset.selectedTop50).length, 0);
});

test("historical valuation gate keeps JPM quality visible without treating it as a current add", () => {
  const jpm = fullSnapshot.assets.find((asset) => asset.ticker === "JPM");
  assert.ok(jpm.scores.total >= 70);
  assert.equal(jpm.status, "VALUATION_WAIT");
  assert.ok(jpm.valuation.historicalPercentile >= 95);
  assert.equal(fullSnapshot.portfolio.weights.some((item) => item.ticker === "JPM"), false);
});

test("dynamic portfolio shifts from foundation ETFs toward diversified satellites as account grows", () => {
  const early = dynamicPortfolioWeights(fullSnapshot.portfolio, 1_000);
  const mature = dynamicPortfolioWeights(fullSnapshot.portfolio, 300_000);
  const sum = (rows) => rows.reduce((total, row) => total + row.weight, 0);
  const satellite = (rows) => rows.filter((row) => !["SPY", "SCHD", "QQQ", "SGOV"].includes(row.ticker)).reduce((total, row) => total + row.weight, 0);
  assert.ok(Math.abs(sum(early) - 1) < 1e-9);
  assert.ok(Math.abs(sum(mature) - 1) < 1e-9);
  assert.ok(satellite(mature) > satellite(early));
  assert.ok(early.find((row) => row.ticker === "SPY").weight > mature.find((row) => row.ticker === "SPY").weight);
});

test("weekly dollar routing preserves the exact user-entered amount down to cents", () => {
  const weights = dynamicPortfolioWeights(fullSnapshot.portfolio, 83_000);
  const orders = allocateDollarOrders(1_000.01, weights);
  assert.equal(Math.round(orders.reduce((sum, order) => sum + order.amount, 0) * 100), 100_001);
  const plan = portfolioContributionPlan({ accountValue: 82_000, weeklyContribution: 1_000.01, optionReserve: 0 }, fullSnapshot);
  assert.equal(Math.round(plan.orders.reduce((sum, order) => sum + order.amount, 0) * 100), 100_001);
});

test("current option structure does not become an order until account cash and concentration also pass", () => {
  const defaultPlan = portfolioContributionPlan({ accountValue: 0, weeklyContribution: 1_000, optionReserve: 0 }, fullSnapshot);
  assert.equal(defaultPlan.executablePut, null);
  const fundedPlan = portfolioContributionPlan({ accountValue: 200_000, weeklyContribution: 0, optionReserve: 74_000 }, fullSnapshot);
  assert.equal(fundedPlan.executablePut?.ticker, "SPY");
  const jpm = fullSnapshot.options.find((row) => row.ticker === "JPM");
  const jpmEvaluation = evaluateLivePut(jpm, fullSnapshot.assets, 400_000, 100_000);
  assert.equal(jpmEvaluation.eligible, false);
  assert.ok(jpmEvaluation.reasons.some((reason) => reason.includes("估值")));
});

test("Friday operation snapshots are date-addressable model records, not broker execution claims", () => {
  assert.equal(operationHistory.schema, "traderhome_incomeos_operation_history_v1");
  assert.ok(operationHistory.records.length >= 1);
  const latest = operationHistory.records[0];
  assert.match(latest.id, /^(friday|special)-\d{4}-\d{2}-\d{2}$/);
  assert.ok(["friday", "special"].includes(latest.kind ?? "friday"));
  assert.match(latest.label ?? "周五操作单", /操作单$/);
  assert.equal(latest.month, latest.actionDate.slice(0, 7));
  assert.ok(Math.abs(latest.allocation.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-9);
  assert.ok(latest.notes.some((note) => note.includes("不代表 IBKR 已实际成交")));
});
