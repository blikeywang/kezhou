#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "../..");
const outputPath = resolve(projectDir, "portal/vendor/incomeos/data/incomeos-full.json");

const originalUniverse = [
  ["SPY.US", "SPDR S&P 500 ETF", "ETF", "core", "Broad Market"],
  ["QQQ.US", "Invesco QQQ", "ETF", "growth", "Technology"],
  ["IWM.US", "iShares Russell 2000 ETF", "ETF", "core", "Small Cap"],
  ["DIA.US", "SPDR Dow Jones ETF", "ETF", "core", "Broad Market"],
  ["SCHD.US", "Schwab US Dividend Equity ETF", "ETF", "dividend", "Dividend ETF"],
  ["VIG.US", "Vanguard Dividend Appreciation ETF", "ETF", "dividend", "Dividend ETF"],
  ["JEPI.US", "JPMorgan Equity Premium Income ETF", "Benchmark", "benchmark", "Covered Call ETF"],
  ["JEPQ.US", "JPMorgan Nasdaq Equity Premium Income ETF", "Benchmark", "benchmark", "Covered Call ETF"],
  ["QQQI.US", "NEOS Nasdaq-100 High Income ETF", "Benchmark", "benchmark", "Covered Call ETF"],
  ["SPYI.US", "NEOS S&P 500 High Income ETF", "Benchmark", "benchmark", "Covered Call ETF"],
  ["DIVO.US", "Amplify CWP Enhanced Dividend Income ETF", "Benchmark", "benchmark", "Covered Call ETF"],
  ["DGRO.US", "iShares Core Dividend Growth ETF", "ETF", "dividend", "Dividend ETF"],
  ["VYM.US", "Vanguard High Dividend Yield ETF", "ETF", "dividend", "Dividend ETF"],
  ["TLT.US", "iShares 20+ Year Treasury Bond ETF", "ETF", "reserve", "Fixed Income"],
  ["SGOV.US", "iShares 0-3 Month Treasury Bond ETF", "ETF", "reserve", "Cash / T-Bill"],
  ["KO.US", "Coca-Cola", "Stock", "dividend", "Consumer Staples"],
  ["PEP.US", "PepsiCo", "Stock", "dividend", "Consumer Staples"],
  ["PG.US", "Procter & Gamble", "Stock", "dividend", "Consumer Staples"],
  ["JNJ.US", "Johnson & Johnson", "Stock", "dividend", "Healthcare"],
  ["ABBV.US", "AbbVie", "Stock", "dividend", "Healthcare"],
  ["MRK.US", "Merck", "Stock", "dividend", "Healthcare"],
  ["PFE.US", "Pfizer", "Stock", "income", "Healthcare"],
  ["XOM.US", "Exxon Mobil", "Stock", "income", "Energy"],
  ["CVX.US", "Chevron", "Stock", "income", "Energy"],
  ["O.US", "Realty Income", "Stock", "income", "REIT"],
  ["VZ.US", "Verizon", "Stock", "income", "Communication"],
  ["T.US", "AT&T", "Stock", "income", "Communication"],
  ["MO.US", "Altria", "Stock", "income", "Consumer Staples"],
  ["PM.US", "Philip Morris", "Stock", "dividend", "Consumer Staples"],
  ["HD.US", "Home Depot", "Stock", "dividend", "Consumer Discretionary"],
  ["LOW.US", "Lowe's", "Stock", "dividend", "Consumer Discretionary"],
  ["JPM.US", "JPMorgan Chase", "Stock", "income", "Financials"],
  ["BAC.US", "Bank of America", "Stock", "income", "Financials"],
  ["MCD.US", "McDonald's", "Stock", "dividend", "Consumer Discretionary"],
  ["NEE.US", "NextEra Energy", "Stock", "dividend", "Utilities"],
  ["AAPL.US", "Apple", "Stock", "growth", "Technology"],
  ["MSFT.US", "Microsoft", "Stock", "growth", "Technology"],
  ["NVDA.US", "NVIDIA", "Stock", "growth", "Technology"],
  ["GOOGL.US", "Alphabet", "Stock", "growth", "Communication"],
  ["META.US", "Meta Platforms", "Stock", "growth", "Communication"],
  ["AMZN.US", "Amazon", "Stock", "growth", "Consumer Discretionary"],
  ["AVGO.US", "Broadcom", "Stock", "growth", "Technology"],
  ["AMD.US", "Advanced Micro Devices", "Stock", "growth", "Technology"],
  ["TSLA.US", "Tesla", "Stock", "growth", "Consumer Discretionary"],
  ["NFLX.US", "Netflix", "Stock", "growth", "Communication"],
  ["COST.US", "Costco", "Stock", "growth", "Consumer Staples"],
  ["ORCL.US", "Oracle", "Stock", "growth", "Technology"],
  ["CRM.US", "Salesforce", "Stock", "growth", "Technology"],
  ["MU.US", "Micron", "Stock", "growth", "Technology"],
  ["COIN.US", "Coinbase", "Stock", "growth", "Financials"],
];

const challengers = [
  ["GS.US", "Goldman Sachs", "Stock", "growth-income", "Financials"],
  ["BRK.B.US", "Berkshire Hathaway", "Stock", "compounder", "Financials"],
  ["V.US", "Visa", "Stock", "compounder", "Financials"],
  ["MA.US", "Mastercard", "Stock", "compounder", "Financials"],
  ["BLK.US", "BlackRock", "Stock", "growth-income", "Financials"],
  ["CME.US", "CME Group", "Stock", "growth-income", "Financials"],
  ["MS.US", "Morgan Stanley", "Stock", "growth-income", "Financials"],
  ["WFC.US", "Wells Fargo", "Stock", "growth-income", "Financials"],
  ["LLY.US", "Eli Lilly", "Stock", "compounder", "Healthcare"],
  ["UNH.US", "UnitedHealth Group", "Stock", "compounder", "Healthcare"],
  ["AMGN.US", "Amgen", "Stock", "growth-income", "Healthcare"],
  ["WMT.US", "Walmart", "Stock", "compounder", "Consumer Staples"],
  ["LIN.US", "Linde", "Stock", "compounder", "Industrials"],
  ["CAT.US", "Caterpillar", "Stock", "growth-income", "Industrials"],
  ["ETN.US", "Eaton", "Stock", "compounder", "Industrials"],
  ["ADP.US", "Automatic Data Processing", "Stock", "growth-income", "Industrials"],
  ["TXN.US", "Texas Instruments", "Stock", "growth-income", "Technology"],
  ["QCOM.US", "Qualcomm", "Stock", "growth-income", "Technology"],
  ["ACN.US", "Accenture", "Stock", "compounder", "Technology"],
  ["COP.US", "ConocoPhillips", "Stock", "growth-income", "Energy"],
  ["PGR.US", "Progressive", "Stock", "compounder", "Financials"],
];

const universe = [...originalUniverse, ...challengers].map((row, index) => ({
  symbol: row[0],
  ticker: row[0].replace(".US", ""),
  name: row[1],
  kind: row[2],
  sleeve: row[3],
  sector: row[4],
  pool: index < originalUniverse.length ? "original" : "challenger",
}));

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round = (value, digits = 1) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const numeric = (value) => {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const parsed = Number(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const average = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};

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

async function pooled(items, concurrency, worker, label) {
  const results = new Array(items.length);
  let cursor = 0;
  let finished = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
      }
      finished += 1;
      if (finished % 10 === 0 || finished === items.length) console.log(`${label}: ${finished}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function mapBySymbol(rows) {
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.symbol, row]));
}

function historyMetrics(points) {
  if (points.length < 3) return null;
  const latest = points.at(-1);
  const first = points[0];
  const pointAtOrAfter = (date) => points.find((point) => point.date >= date) ?? null;
  const pointAtOrBefore = (date) => [...points].reverse().find((point) => point.date <= date) ?? null;
  const cagrBetween = (start, end) => {
    if (!start || !end || start.close <= 0 || end.close <= 0 || end.date <= start.date) return null;
    const years = (new Date(`${end.date}T00:00:00Z`) - new Date(`${start.date}T00:00:00Z`)) / (365.25 * 86_400_000);
    return years >= 0.45 ? (Math.pow(end.close / start.close, 1 / years) - 1) * 100 : null;
  };
  const trailing = (years) => {
    const date = new Date(`${latest.date}T00:00:00Z`);
    date.setUTCFullYear(date.getUTCFullYear() - years);
    const target = date.toISOString().slice(0, 10);
    const start = pointAtOrAfter(target);
    if (!start) return null;
    const actualYears = (new Date(`${latest.date}T00:00:00Z`) - new Date(`${start.date}T00:00:00Z`)) / (365.25 * 86_400_000);
    return actualYears >= years * 0.82 ? cagrBetween(start, latest) : null;
  };
  const cycle = (startDate, endDate) => cagrBetween(pointAtOrAfter(startDate), pointAtOrBefore(endDate));
  const returns = [];
  for (let index = 1; index < points.length; index += 1) returns.push(points[index].close / points[index - 1].close - 1);
  const mean = average(returns) ?? 0;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  let peak = first.close;
  let maxDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.close);
    maxDrawdown = Math.min(maxDrawdown, point.close / peak - 1);
  }
  const byYear = new Map();
  for (const point of points) {
    const year = point.date.slice(0, 4);
    const values = byYear.get(year) ?? [];
    values.push(point.close);
    byYear.set(year, values);
  }
  const yearlyReturns = [...byYear.entries()].filter(([, values]) => values.length >= 2).map(([year, values]) => ({
    year: Number(year),
    return: (values.at(-1) / values[0] - 1) * 100,
  }));
  const positiveYears = yearlyReturns.filter((item) => item.return > 0).length;
  return {
    from: first.date,
    to: latest.date,
    months: points.length,
    cagr10: round(trailing(10)),
    cagr5: round(trailing(5)),
    cagr3: round(trailing(3)),
    cycle2016_2019: round(cycle("2016-01-01", "2019-12-31")),
    cycle2020_2022: round(cycle("2020-01-01", "2022-12-31")),
    cycle2023_now: round(cycle("2023-01-01", latest.date)),
    annualizedVol: round(Math.sqrt(variance) * Math.sqrt(12) * 100),
    maxDrawdown: round(maxDrawdown * 100),
    positiveYearRate: yearlyReturns.length ? round((positiveYears / yearlyReturns.length) * 100) : null,
    worstYear: yearlyReturns.length ? round(Math.min(...yearlyReturns.map((item) => item.return))) : null,
  };
}

function parseLatestReport(response) {
  if (!response || response.error) return null;
  const fields = new Map((response.indicators ?? []).map((item) => [item.field_name, item]));
  const value = (key, field = "indicator_value") => numeric(fields.get(key)?.[field]);
  return {
    report: response.report ?? null,
    revenueYoy: round((value("operating_revenue", "yoy") ?? 0) * 100),
    netProfitYoy: round((value("net_profit", "yoy") ?? 0) * 100),
    epsYoy: round((value("eps", "yoy") ?? 0) * 100),
    roe: round(value("roe")),
    netMargin: round(value("net_profit_margin")),
  };
}

function parseForecast(response) {
  if (!response || response.error) return null;
  const items = (response.items ?? []).filter((item) => numeric(item.forecast_eps_mean) !== null);
  if (!items.length) return null;
  const earliest = items[0];
  const latest = items.at(-1);
  const first = numeric(earliest.forecast_eps_mean);
  const last = numeric(latest.forecast_eps_mean);
  return {
    earliestDate: new Date(Number(earliest.forecast_start_date) * 1_000).toISOString().slice(0, 10),
    latestDate: new Date(Number(latest.forecast_start_date) * 1_000).toISOString().slice(0, 10),
    earliestMean: round(first, 2),
    latestMean: round(last, 2),
    revision: first && last ? round((last / first - 1) * 100) : null,
  };
}

function parseConsensus(response) {
  if (!response || response.error) return null;
  const released = (response.list ?? []).filter((period) => period.details?.some((detail) => detail.is_released)).slice(0, 8);
  const rateFor = (key) => {
    const values = released.map((period) => period.details.find((detail) => detail.key === key)).filter(Boolean);
    return values.length ? round((values.filter((detail) => detail.comp === "beat_est").length / values.length) * 100) : null;
  };
  const next = (response.list ?? []).find((period) => !period.details?.some((detail) => detail.is_released));
  return {
    releasedQuarters: released.length,
    epsBeatRate: rateFor("eps"),
    revenueBeatRate: rateFor("revenue"),
    nextPeriod: next?.period_text ?? null,
    nextEpsEstimate: round(numeric(next?.details?.find((detail) => detail.key === "eps")?.estimate), 2),
  };
}

function parseValuation(response, indicator, current) {
  if (!response || response.error || !Number.isFinite(current) || current <= 0) return null;
  const metric = response.metrics?.[indicator] ?? response.history?.metrics?.[indicator];
  const values = (metric?.list ?? []).map((item) => numeric(item.value)).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 20) return null;
  const atOrBelow = values.filter((value) => value <= current).length;
  return {
    indicator,
    rangeYears: response.range ?? response.history?.range ?? 5,
    current: round(current, 2),
    low: round(numeric(metric.low), 2),
    median: round(numeric(metric.median), 2),
    high: round(numeric(metric.high), 2),
    historicalPercentile: round((atOrBelow / values.length) * 100),
    observations: values.length,
  };
}

function percentRank(value, values, lowerIsBetter = false) {
  if (!Number.isFinite(value)) return null;
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length < 2) return 50;
  const below = valid.filter((item) => item <= value).length - 1;
  const rank = (below / (valid.length - 1)) * 100;
  return lowerIsBetter ? 100 - rank : rank;
}

function scoreAssets(assets) {
  const sectorPeers = new Map();
  for (const asset of assets.filter((item) => item.kind === "Stock")) {
    const peers = sectorPeers.get(asset.sector) ?? [];
    peers.push(asset);
    sectorPeers.set(asset.sector, peers);
  }
  for (const asset of assets) {
    const history = asset.history;
    const forward = asset.expectations;
    const financial = asset.fundamentals;
    const cagrBlend = average([history?.cagr10, history?.cagr5, history?.cagr3]);
    const cycleFloor = Math.min(...[history?.cycle2016_2019, history?.cycle2020_2022, history?.cycle2023_now].filter(Number.isFinite));
    const compound = clamp(48 + (cagrBlend ?? 5) * 2 + ((history?.positiveYearRate ?? 50) - 60) * 0.35 + Math.max(-20, cycleFloor || 0) * 0.35);
    const actualGrowth = average([financial?.revenueYoy, financial?.netProfitYoy, financial?.epsYoy]);
    const forwardScore = clamp(50 + (forward?.revision ?? 0) * 2 + (actualGrowth ?? 0) * 0.6 + ((asset.expectations?.epsBeatRate ?? 50) - 50) * 0.25);
    const quality = clamp(35 + (financial?.roe ?? 10) * 1.7 + (financial?.netMargin ?? 8) * 0.5 + ((asset.expectations?.epsBeatRate ?? 50) - 50) * 0.25);
    const peers = sectorPeers.get(asset.sector) ?? [];
    const valuationMetric = asset.sector === "Financials" && Number.isFinite(asset.pb) && asset.pb > 0 ? asset.pb : asset.pe;
    const peerValues = peers.map((peer) => peer.sector === "Financials" && Number.isFinite(peer.pb) && peer.pb > 0 ? peer.pb : peer.pe).filter((value) => Number.isFinite(value) && value > 0);
    const historicalValuationScore = Number.isFinite(asset.valuation?.historicalPercentile)
      ? 100 - asset.valuation.historicalPercentile
      : null;
    const valuation = Number.isFinite(valuationMetric) && valuationMetric > 0
      ? clamp((historicalValuationScore ?? percentRank(valuationMetric, peerValues, true) ?? 50) * 0.75 + clamp(50 + (cagrBlend ?? 0) - valuationMetric * 0.6) * 0.25)
      : 35;
    const safety = clamp(95 - Math.abs(history?.maxDrawdown ?? -35) * 1.15 - Math.max(0, (history?.annualizedVol ?? 25) - 12) * 1.2 + (history?.positiveYearRate ?? 50) * 0.25);
    const yieldPct = asset.dividendYield ?? 0;
    const income = yieldPct <= 6 ? clamp(20 + yieldPct * 12) : clamp(92 - (yieldPct - 6) * 10, 20, 92);
    const liquidity = Number.isFinite(asset.dollarVolume) ? clamp((Math.log10(Math.max(1, asset.dollarVolume)) - 6) * 28) : 25;
    let total;
    if (asset.kind === "Stock") total = compound * 0.28 + forwardScore * 0.2 + quality * 0.15 + valuation * 0.12 + safety * 0.15 + income * 0.05 + liquidity * 0.05;
    else total = compound * 0.45 + safety * 0.25 + income * 0.15 + liquidity * 0.15;
    const coverage = [asset.price, history?.cagr5, history?.maxDrawdown, asset.dividendYield, asset.kind === "Stock" ? financial?.epsYoy : 1, asset.kind === "Stock" ? forward?.revision : 1, asset.kind === "Stock" ? asset.pe : 1];
    asset.scores = {
      total: Math.round(total),
      compound: Math.round(compound),
      forward: Math.round(forwardScore),
      quality: Math.round(quality),
      valuation: Math.round(valuation),
      safety: Math.round(safety),
      income: Math.round(income),
      liquidity: Math.round(liquidity),
    };
    asset.confidence = Math.round((coverage.filter(Number.isFinite).length / coverage.length) * 100);
  }
  const investable = assets.filter((asset) => asset.kind !== "Benchmark").sort((a, b) => b.scores.total - a.scores.total);
  investable.forEach((asset, index) => {
    asset.rank = index + 1;
    asset.selectedTop50 = index < 50;
    const stretched = (asset.valuation?.historicalPercentile ?? 0) >= 80 || asset.scores.valuation < 25;
    const weakCycle = (asset.history?.cycle2020_2022 ?? 0) < -8;
    asset.status = stretched ? "VALUATION_WAIT" : weakCycle ? "CYCLE_WATCH" : asset.scores.total >= 72 ? "COMPOUNDER" : asset.scores.total >= 60 ? "QUALIFIED" : "WATCH";
  });
  assets.filter((asset) => asset.kind === "Benchmark").forEach((asset) => {
    asset.rank = null;
    asset.selectedTop50 = false;
    asset.status = "BENCHMARK";
  });
  return investable;
}

function monthlyReturnMap(points, startDate) {
  const map = new Map();
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].date < startDate) continue;
    map.set(points[index].date.slice(0, 7), points[index].close / points[index - 1].close - 1);
  }
  return map;
}

function portfolioBacktest(label, weights, histories, years = 5) {
  const latestDate = [...histories.values()].flat().map((point) => point.date).sort().at(-1);
  const start = new Date(`${latestDate}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  const startDate = start.toISOString().slice(0, 10);
  const maps = weights.map((item) => ({ ...item, returns: monthlyReturnMap(histories.get(item.symbol) ?? [], startDate) }));
  const months = [...new Set(maps.flatMap((item) => [...item.returns.keys()]))].sort().filter((month) => maps.every((item) => item.returns.has(month)));
  const returns = months.map((month) => maps.reduce((sum, item) => sum + item.weight * item.returns.get(month), 0));
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
  }
  const mean = average(returns) ?? 0;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const annualizedVol = Math.sqrt(variance) * Math.sqrt(12);
  const annualizedReturn = returns.length ? Math.pow(equity, 12 / returns.length) - 1 : null;
  return {
    label,
    from: months[0] ? `${months[0]}-01` : null,
    to: months.at(-1) ? `${months.at(-1)}-01` : null,
    months: months.length,
    cagr: round((annualizedReturn ?? 0) * 100),
    annualizedVol: round(annualizedVol * 100),
    maxDrawdown: round(maxDrawdown * 100),
    sharpeProxy: annualizedVol ? round(annualizedReturn / annualizedVol, 2) : null,
    totalReturn: round((equity - 1) * 100),
  };
}

function choosePortfolio(investable, histories) {
  const stocks = investable.filter((asset) => asset.kind === "Stock" && asset.selectedTop50 && asset.confidence >= 80 && asset.status !== "VALUATION_WAIT");
  const picks = [];
  const take = (filter) => {
    const candidate = stocks.find((asset) => !picks.includes(asset) && filter(asset));
    if (candidate) picks.push(candidate);
  };
  take((asset) => asset.sector === "Financials");
  take((asset) => asset.sector === "Healthcare");
  take((asset) => ["Industrials", "Consumer Staples", "Utilities"].includes(asset.sector));
  take((asset) => asset.sector === "Technology");
  take((asset) => picks.filter((pick) => pick.sector === asset.sector).length < 2);
  for (const candidate of stocks) {
    if (picks.length >= 5) break;
    if (!picks.includes(candidate) && picks.filter((pick) => pick.sector === candidate.sector).length < 2) picks.push(candidate);
  }
  const weights = [
    { symbol: "SPY.US", weight: 0.32, role: "宽基核心" },
    { symbol: "SCHD.US", weight: 0.13, role: "股息质量" },
    { symbol: "QQQ.US", weight: 0.08, role: "成长宽基" },
    { symbol: "SGOV.US", weight: 0.12, role: "现金/期权准备" },
    ...picks.map((asset) => ({ symbol: asset.symbol, weight: 0.07, role: `${asset.sector} 复利卫星` })),
  ];
  const comparisons = [
    portfolioBacktest("IncomeOS 当前均衡模型", weights, histories, 5),
    portfolioBacktest("SPY", [{ symbol: "SPY.US", weight: 1 }], histories, 5),
    portfolioBacktest("SCHD", [{ symbol: "SCHD.US", weight: 1 }], histories, 5),
    portfolioBacktest("QQQI", [{ symbol: "QQQI.US", weight: 1 }], histories, 5),
    portfolioBacktest("JEPI", [{ symbol: "JEPI.US", weight: 1 }], histories, 5),
    portfolioBacktest("JEPQ", [{ symbol: "JEPQ.US", weight: 1 }], histories, 5),
    portfolioBacktest("SPYI", [{ symbol: "SPYI.US", weight: 1 }], histories, 5),
  ];
  return {
    method: "32% SPY + 13% SCHD + 8% QQQ + 12% SGOV；其余 35% 从当期 Top 50 中按金融、医疗、防御/工业、科技和跨行业约束各取 7%。",
    weights: weights.map((item) => {
      const asset = investable.find((candidate) => candidate.symbol === item.symbol);
      return { ...item, ticker: item.symbol.replace(".US", ""), name: asset?.name ?? item.symbol, score: asset?.scores.total ?? null, sector: asset?.sector ?? null };
    }),
    comparisons,
    guardrails: ["单一公司 7%，硬上限 12%", "单一行业卫星仓不超过 14%", "ETF 核心至少 53%", "SGOV/现金至少 12%", "期权指派后也必须重新检查上述集中度"],
    limitation: "回测使用 Longbridge 前复权月线价格代理，不含税费、滑点和完整历史期权收益；当前选股使用了全样本信息，不是样本外业绩证明。",
  };
}

console.log(`IncomeOS candidate scan: ${universe.length} assets`);
const symbols = universe.map((asset) => asset.symbol);
const [quoteRows, indexRows, marketRows] = await Promise.all([
  longbridge(["quote", ...symbols], 90_000),
  longbridge(["calc-index", ...symbols, "--fields", "last_done,ytd_change_rate,half_year_change_rate,mktcap,pe,pb,dps_rate,turnover_rate"], 90_000),
  longbridge(["market-temp", "US"], 60_000),
]);
const quotes = mapBySymbol(quoteRows);
const indexes = mapBySymbol(indexRows);

const historyRows = await pooled(universe, 4, async (asset) => {
  const rows = await longbridge(["kline", "history", asset.symbol, "--start", "2016-01-01", "--end", "2026-08-06", "--period", "month", "--adjust", "forward"], 90_000);
  return (Array.isArray(rows) ? rows : []).map((row) => ({ date: String(row.time).slice(0, 10), close: numeric(row.close) })).filter((row) => row.close > 0);
}, "history");
const histories = new Map(universe.map((asset, index) => [asset.symbol, Array.isArray(historyRows[index]) ? historyRows[index] : []]));

const stocks = universe.filter((asset) => asset.kind === "Stock");
const researchRows = await pooled(stocks, 4, async (asset) => {
  const bookValued = new Set(["JPM.US", "BAC.US", "WFC.US", "GS.US", "MS.US", "BRK.B.US"]);
  const valuationIndicator = bookValued.has(asset.symbol) ? "pb" : "pe";
  const [financial, forecast, consensus, valuation] = await Promise.all([
    longbridge(["financial-report", asset.symbol, "--latest"], 75_000),
    longbridge(["forecast-eps", asset.symbol], 75_000),
    longbridge(["consensus", asset.symbol], 75_000),
    longbridge(["valuation", asset.symbol, "--history", "--indicator", valuationIndicator, "--range", "5"], 75_000),
  ]);
  return { financial, forecast, consensus, valuation, valuationIndicator };
}, "fundamentals");
const research = new Map(stocks.map((asset, index) => [asset.symbol, researchRows[index]]));

const assets = universe.map((asset) => {
  const quote = quotes.get(asset.symbol) ?? {};
  const index = indexes.get(asset.symbol) ?? {};
  const details = research.get(asset.symbol) ?? {};
  const fundamentals = parseLatestReport(details.financial);
  const forecast = parseForecast(details.forecast);
  const consensus = parseConsensus(details.consensus);
  const pe = round(numeric(index.pe), 2);
  const pb = round(numeric(index.pb), 2);
  const valuationCurrent = details.valuationIndicator === "pb" ? pb : pe;
  return {
    ...asset,
    price: round(numeric(quote.last ?? index.last_done), 3),
    dayChange: round(numeric(quote.change_percentage)),
    dollarVolume: round(numeric(quote.turnover), 0),
    marketCap: round(numeric(index.mktcap), 0),
    pe,
    pb,
    dividendYield: round(numeric(index.dps_rate), 2),
    ytdReturn: round(numeric(index.ytd_change_rate)),
    momentum6m: round(numeric(index.half_year_change_rate)),
    history: historyMetrics(histories.get(asset.symbol) ?? []),
    fundamentals,
    expectations: forecast || consensus ? { ...forecast, ...consensus } : null,
    valuation: parseValuation(details.valuation, details.valuationIndicator, valuationCurrent),
    dataErrors: [details.financial?.error, details.forecast?.error, details.consensus?.error, details.valuation?.error].filter(Boolean),
  };
});

const investable = scoreAssets(assets);
const portfolio = choosePortfolio(investable, histories);
const market = Array.isArray(marketRows) ? marketRows : [];
const marketFields = new Map(market.map((row) => [String(row?.field ?? "").toLowerCase(), row?.value]));
const errors = assets.flatMap((asset) => asset.dataErrors.map((error) => `${asset.ticker}: ${error}`));
const selected = investable.filter((asset) => asset.selectedTop50);
const output = {
  version: 2,
  asOf: new Date().toISOString(),
  tradingDate: "2026-08-06",
  source: "Longbridge Securities",
  mode: errors.length ? "partial" : "live",
  market: {
    temperature: numeric(marketFields.get("temperature")),
    valuation: numeric(marketFields.get("valuation")),
    sentiment: numeric(marketFields.get("sentiment")),
    description: marketFields.get("description") ?? null,
  },
  universe: {
    candidateCount: universe.length,
    originalCount: originalUniverse.length,
    challengerCount: challengers.length,
    investableCount: investable.length,
    top50Count: selected.length,
    benchmarkCount: assets.filter((asset) => asset.kind === "Benchmark").length,
    methodology: "候选池每周统一计算长期复利、盈利与预期、质量、估值、风险、股息和流动性；覆盖式收益 ETF 仅作为基准，不占 Top 50 投资席位。",
  },
  scoreWeights: {
    stock: { compound: 28, forward: 20, quality: 15, valuation: 12, safety: 15, income: 5, liquidity: 5 },
    etf: { compound: 45, safety: 25, income: 15, liquidity: 15 },
  },
  assets: assets.sort((left, right) => (left.rank ?? 999) - (right.rank ?? 999)),
  portfolio,
  dataQuality: {
    priced: assets.filter((asset) => asset.price !== null).length,
    historical: assets.filter((asset) => asset.history?.months >= 36).length,
    fundamentals: assets.filter((asset) => asset.kind !== "Stock" || asset.fundamentals).length,
    expectations: assets.filter((asset) => asset.kind !== "Stock" || asset.expectations).length,
    errors,
  },
  limitations: [
    "前复权月线是价格/公司行动代理，不等于含税、含滑点的可交易总回报。",
    "分析师预期修正只反映 Longbridge 当前可得序列，不能替代完整 Point-in-Time 数据库。",
    "Covered Call 与 Cash-Secured Put 必须另过 bid/ask、OI、财报、除息、仓位和现金闸门；底层高分不等于今天下期权单。",
  ],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`wrote ${outputPath}`);
console.log(`Top 10: ${selected.slice(0, 10).map((asset) => `${asset.ticker} ${asset.scores.total}`).join(", ")}`);
console.log(`Portfolio: ${portfolio.weights.map((item) => `${item.ticker} ${(item.weight * 100).toFixed(0)}%`).join(", ")}`);
