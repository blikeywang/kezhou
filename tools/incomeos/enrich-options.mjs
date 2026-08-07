#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "../..");
const dataPath = resolve(projectDir, "portal/vendor/incomeos/data/incomeos-full.json");
const data = JSON.parse(await readFile(dataPath, "utf8"));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const numeric = (value) => {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const parsed = Number(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const asMap = (rows) => new Map((Array.isArray(rows) ? rows : []).map((row) => [row.symbol, row]));

async function longbridge(args, timeout = 75_000) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("longbridge", [...args, "--format", "json"], {
        cwd: "/private/tmp",
        timeout,
        maxBuffer: 64 * 1024 * 1024,
      });
      return stdout.trim() ? JSON.parse(stdout) : null;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000));
    }
  }
  throw lastError;
}

async function pooled(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  let finished = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { symbol: items[index].symbol, error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
      }
      finished += 1;
      console.log(`options: ${finished}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const coefficients = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const erf = 1 - (((((coefficients[4] * t + coefficients[3]) * t) + coefficients[2]) * t + coefficients[1]) * t + coefficients[0]) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function theoreticalDelta(spot, strike, iv, dte, dividendYield, side) {
  const time = dte / 365;
  if (!spot || !strike || !iv || time <= 0) return null;
  const rate = 0.04;
  const dividend = Math.max(0, (dividendYield ?? 0) / 100);
  const d1 = (Math.log(spot / strike) + (rate - dividend + (iv ** 2) / 2) * time) / (iv * Math.sqrt(time));
  const call = Math.exp(-dividend * time) * normalCdf(d1);
  return side === "call" ? call : call - Math.exp(-dividend * time);
}

function contractSymbol(asset, expiry, strike, side) {
  const date = expiry.slice(2).replaceAll("-", "");
  const strikeCode = String(Math.round(strike * 1_000));
  return `${asset.ticker}${date}${side === "call" ? "C" : "P"}${strikeCode}.US`;
}

function bestCandidate(candidates, greeks, quotes, target) {
  return candidates.map((candidate) => {
    const greek = greeks.get(candidate.contract) ?? {};
    const quote = quotes.get(candidate.contract) ?? {};
    const delta = numeric(greek.delta) ?? candidate.estimatedDelta;
    const oi = numeric(greek.oi ?? quote.open_interest);
    const volume = numeric(quote.volume ?? candidate.volume);
    const cost = Math.abs((delta ?? 9) - target) + (oi !== null && oi >= 500 ? 0 : oi !== null && oi >= 100 ? 0.025 : 0.15) + (volume !== null && volume >= 10 ? 0 : 0.03);
    return { ...candidate, greek, quote, delta, oi, volume, cost };
  }).sort((left, right) => left.cost - right.cost)[0];
}

function optionResult(asset, selected, depth, side, expiry, dte, targetDelta, earningsDate) {
  if (!selected) return null;
  const bid = numeric(depth?.bids?.[0]?.price);
  const ask = numeric(depth?.asks?.[0]?.price);
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  const spreadPct = mid ? ((ask - bid) / mid) * 100 : null;
  const last = numeric(selected.quote.last ?? selected.greek.last_done ?? selected.last);
  const iv = numeric(selected.greek.iv) ?? (numeric(selected.quote.implied_volatility) !== null ? numeric(selected.quote.implied_volatility) * 100 : null);
  const hv = numeric(selected.quote.historical_volatility) !== null ? numeric(selected.quote.historical_volatility) * 100 : null;
  const premiumReference = bid ?? mid ?? last;
  const cashRequired = side === "put" ? selected.strike * 100 : null;
  const annualizedPremium = premiumReference && dte > 0
    ? (premiumReference / (side === "put" ? selected.strike : asset.price)) * (365 / dte) * 100
    : null;
  const breakevenDiscount = side === "put" && premiumReference
    ? ((asset.price - (selected.strike - premiumReference)) / asset.price) * 100
    : null;
  const earningsBeforeExpiry = earningsDate ? earningsDate <= expiry : false;
  const gates = [];
  if (earningsBeforeExpiry) gates.push("财报日在到期日前");
  if (asset.status === "VALUATION_WAIT" && side === "put") gates.push("底层估值处于等待区");
  if (selected.oi === null || selected.oi < 100) gates.push("OI 低于 100");
  if (bid === null || ask === null) gates.push("缺少 bid/ask");
  else if (spreadPct > 15) gates.push(`价差 ${spreadPct.toFixed(1)}% 超过 15%`);
  if (iv !== null && hv !== null && iv / hv < 0.95) gates.push("IV/HV 低于 0.95");
  let action = side === "call" ? "REVIEW_100_SHARES" : "REVIEW_CASH";
  if (gates.length) action = gates.some((gate) => gate.includes("估值")) ? "WAIT_VALUATION" : gates.some((gate) => gate.includes("财报")) ? "WAIT_EARNINGS" : "WAIT_MARKET";
  return {
    side,
    contract: selected.contract,
    expiry,
    dte,
    strike: selected.strike,
    delta: round(selected.delta, 3),
    targetDelta,
    iv: round(iv),
    hv: round(hv),
    ivHv: iv && hv ? round(iv / hv) : null,
    oi: selected.oi,
    volume: selected.volume,
    last: round(last),
    bid: round(bid),
    ask: round(ask),
    mid: round(mid),
    spreadPct: round(spreadPct),
    annualizedPremium: round(annualizedPremium),
    cashRequired: round(cashRequired, 0),
    breakevenDiscount: round(breakevenDiscount),
    earningsDate,
    earningsBeforeExpiry,
    action,
    gates,
    quoteTimestamp: selected.quote.timestamp ?? null,
  };
}

const topQualifiedStocks = data.assets.filter((asset) => asset.kind === "Stock" && asset.rank && asset.status !== "VALUATION_WAIT").slice(0, 12);
const forcedTickers = new Set(["JPM", "GS", "BAC", "SPY", "QQQ", "SCHD"]);
const targets = [];
for (const asset of data.assets) {
  if (topQualifiedStocks.some((candidate) => candidate.symbol === asset.symbol) || forcedTickers.has(asset.ticker)) targets.push(asset);
}

const calendarBySymbol = new Map();
for (let index = 0; index < targets.length; index += 10) {
  const group = targets.slice(index, index + 10);
  const args = ["finance-calendar", "report", ...group.flatMap((asset) => ["--symbol", asset.symbol]), "--start", data.tradingDate, "--end", "2027-01-31", "--count", "100"];
  try {
    const response = await longbridge(args, 75_000);
    for (const dateGroup of response?.list ?? []) {
      for (const info of dateGroup.infos ?? []) {
        const symbol = String(info.counter_id ?? "").split("/").at(-1);
        const date = info.ext?.local_date ?? dateGroup.date;
        if (!symbol || !date || date < data.tradingDate) continue;
        const current = calendarBySymbol.get(symbol);
        if (!current || date < current) calendarBySymbol.set(symbol, date);
      }
    }
  } catch {
    // Calendar gaps are surfaced in the per-contract data rather than aborting the option scan.
  }
}

const asOfDate = new Date(data.asOf);
const optionRows = await pooled(targets, 3, async (asset) => {
  const expiries = await longbridge(["option", "chain", asset.symbol], 60_000);
  const expiryCandidates = (expiries ?? []).map((row) => {
    const expiry = row.expiry_date;
    const dte = Math.ceil((new Date(`${expiry}T20:00:00Z`) - asOfDate) / 86_400_000);
    return { expiry, dte };
  }).filter((row) => row.dte >= 28 && row.dte <= 49).sort((left, right) => Math.abs(left.dte - 42) - Math.abs(right.dte - 42));
  let chosen = null;
  let chain = [];
  for (const candidate of expiryCandidates) {
    const rows = await longbridge(["option", "chain", asset.symbol, "--date", candidate.expiry], 75_000);
    const hasModelInputs = (rows ?? []).some((row) => (numeric(row.call_iv) ?? 0) > 0 || (numeric(row.put_iv) ?? 0) > 0);
    if (hasModelInputs) {
      chosen = candidate;
      chain = rows;
      break;
    }
  }
  if (!chosen) throw new Error("no usable 28-49 DTE option surface");
  const callTarget = (asset.momentum6m ?? 0) >= 15 ? 0.12 : (asset.momentum6m ?? 0) < 0 ? 0.25 : 0.18;
  const putTarget = -0.20;
  const rows = (chain ?? []).filter((row) => String(row.standard) === "true");
  const candidatesFor = (side) => rows.map((row) => {
    const strike = numeric(row.strike);
    const iv = numeric(side === "call" ? row.call_iv : row.put_iv);
    const estimatedDelta = strike && iv ? theoreticalDelta(asset.price, strike, iv, chosen.dte, asset.dividendYield, side) : null;
    return {
      strike,
      iv,
      estimatedDelta,
      last: numeric(side === "call" ? row.call_last : row.put_last),
      volume: numeric(side === "call" ? row.call_vol : row.put_vol),
      contract: strike ? contractSymbol(asset, chosen.expiry, strike, side) : null,
    };
  }).filter((row) => row.strike && row.iv && row.estimatedDelta !== null && (side === "call" ? row.strike > asset.price * 1.005 : row.strike < asset.price * 0.995))
    .sort((left, right) => Math.abs(left.estimatedDelta - (side === "call" ? callTarget : putTarget)) - Math.abs(right.estimatedDelta - (side === "call" ? callTarget : putTarget))).slice(0, 8);
  const callCandidates = candidatesFor("call");
  const putCandidates = candidatesFor("put");
  const contracts = [...callCandidates, ...putCandidates].map((row) => row.contract);
  if (!contracts.length) throw new Error("no usable option contracts");
  const [greekRows, quoteRows] = await Promise.all([
    longbridge(["calc-index", ...contracts, "--fields", "last_done,iv,delta,gamma,theta,vega,oi,exp,strike"], 75_000),
    longbridge(["option", "quote", ...contracts], 75_000),
  ]);
  const greeks = asMap(greekRows);
  const quotes = asMap(quoteRows);
  const bestCall = bestCandidate(callCandidates, greeks, quotes, callTarget);
  const bestPut = bestCandidate(putCandidates, greeks, quotes, putTarget);
  const [callDepth, putDepth] = await Promise.all([
    bestCall ? longbridge(["depth", bestCall.contract], 45_000) : null,
    bestPut ? longbridge(["depth", bestPut.contract], 45_000) : null,
  ]);
  const earningsDate = calendarBySymbol.get(asset.ticker) ?? null;
  return {
    symbol: asset.symbol,
    ticker: asset.ticker,
    name: asset.name,
    rank: asset.rank,
    underlyingScore: asset.scores.total,
    underlyingStatus: asset.status,
    price: asset.price,
    momentum6m: asset.momentum6m,
    earningsDate,
    call: optionResult(asset, bestCall, callDepth, "call", chosen.expiry, chosen.dte, callTarget, earningsDate),
    put: optionResult(asset, bestPut, putDepth, "put", chosen.expiry, chosen.dte, putTarget, earningsDate),
  };
});

const validRows = optionRows.filter((row) => !row.error);
data.options = validRows.sort((left, right) => (left.rank ?? 999) - (right.rank ?? 999));
data.optionDataQuality = {
  scanned: targets.length,
  usable: validRows.length,
  callsWithMarket: validRows.filter((row) => row.call?.bid !== null && row.call?.ask !== null).length,
  putsWithMarket: validRows.filter((row) => row.put?.bid !== null && row.put?.ask !== null).length,
  errors: optionRows.filter((row) => row.error).map((row) => `${row.symbol}: ${row.error}`),
};
const optionLimitation = "期权快照是单一时点的 28–49 DTE 横截面；没有完整历史期权面，因此不能把当前权利金年化代理当作长期已实现收益。";
if (!data.limitations.includes(optionLimitation)) data.limitations.push(optionLimitation);
await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`wrote ${dataPath}`);
console.log(`put review: ${validRows.map((row) => `${row.ticker}:${row.put?.action ?? "DATA"}`).join(", ")}`);
