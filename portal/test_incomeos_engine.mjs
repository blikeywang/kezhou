import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  allocationFor,
  contributionPlan,
  evaluatePut,
  growthCycleScore,
} from "./vendor/incomeos/incomeos-engine.mjs";

const snapshot = JSON.parse(await readFile(new URL("./vendor/incomeos/data/research-snapshot.json", import.meta.url), "utf8"));

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
