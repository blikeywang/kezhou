#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  TAILTREND_CONFIG,
  analyzeBars,
  normalizeBars,
  summarizeSnapshot,
  updateAuditLedger,
  volatilityMultiplier,
} from "../../portal/vendor/tailtrend/tailtrend-engine.mjs";
import {
  persistDailySnapshots,
  readJson,
  sha256Json,
} from "./snapshot-store.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "../..");
const dataDir = resolve(projectDir, "portal/vendor/tailtrend/data");
const snapshotPath = resolve(dataDir, "tailtrend-snapshot.json");
const latestPath = resolve(dataDir, "latest.json");
const indexPath = resolve(dataDir, "index.json");
const historyPath = resolve(dataDir, "run-history.json");
const auditPath = resolve(dataDir, "tailtrend-audit.json");
const universePath = resolve(scriptDir, "universe.json");

function dateInZone(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function errorText(error) {
  const source = error?.stderr || error?.stdout || error?.message || String(error);
  return String(source).split("\n").find((line) => line.trim().startsWith("Error:"))
    ?? String(source).split("\n").find(Boolean)
    ?? "unknown Longbridge error";
}

async function buildMetadata(universe) {
  const enginePath = resolve(projectDir, "portal/vendor/tailtrend/tailtrend-engine.mjs");
  const engineSource = await readFile(enginePath, "utf8");
  let gitCommit = "UNKNOWN";
  let engineDirty = true;
  try {
    const commit = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectDir });
    const status = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: projectDir });
    gitCommit = commit.stdout.trim();
    engineDirty = Boolean(status.stdout.trim());
  } catch (error) {
    console.warn(`git metadata unavailable: ${errorText(error)}`);
  }
  return {
    engineVersion: gitCommit,
    engineDirty,
    engineSourceHash: sha256Json(engineSource),
    paramsHash: sha256Json({ config: TAILTREND_CONFIG, universe }),
  };
}

function weeklyRiskMultiplier(module, weekly) {
  if (module === "pure_trend" && weekly !== "UP") return 0;
  if (module === "tail_core" && weekly === "DOWN") return 0.5;
  if (module === "us_short" && weekly === "UP") return 0.5;
  return 1;
}

function publicRiskFactors(record) {
  const module = record.candidateModule ?? record.riskModule;
  const mHv = volatilityMultiplier(record.hvPercentile);
  const mWeekly = weeklyRiskMultiplier(module, record.weeklyRegime);
  return {
    mDrawdown: null,
    mHv,
    mWeekly,
    groupAWithoutAccount: Math.min(mHv, mWeekly),
    headroomPortfolioPct: null,
    headroomClusterPct: null,
    headroomLiquidityPct: null,
    circuitBreaker: null,
    finalRiskPct: null,
    bindingConstraint: "ACCOUNT_INPUT_REQUIRED",
  };
}

async function longbridge(args, timeout = 75_000) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("longbridge", [...args, "--format", "json"], {
        cwd: "/private/tmp",
        timeout,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          LONGBRIDGE_LOG_PATH: "/private/tmp/traderhome-tailtrend-longbridge-logs",
        },
      });
      const raw = stdout.trim();
      if (!raw) throw new Error("Longbridge returned an empty response");
      return JSON.parse(raw);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000));
    }
  }
  throw lastError;
}

async function pooled(items, concurrency, worker) {
  const output = Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

function batch(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function symbolFromCounter(counterId) {
  const parts = String(counterId ?? "").split("/");
  if (parts.length < 3) return null;
  return `${parts.at(-1)}.${parts.at(-2)}`.toUpperCase();
}

function calendarEvents(response) {
  const events = [];
  for (const group of response?.list ?? []) {
    for (const info of group?.infos ?? []) {
      const symbol = symbolFromCounter(info.counter_id);
      const date = info.ext?.local_date ?? String(info.date ?? "").match(/\d{4}[-.]\d{2}[-.]\d{2}/)?.[0]?.replaceAll(".", "-");
      if (symbol && date) events.push({
        symbol,
        date,
        timing: info.ext?.financial_report?.market_time ?? info.date_type ?? null,
        label: info.content ?? "业绩披露",
      });
    }
  }
  return events;
}

function nearestUpcoming(events, symbol, fromDate, endDate) {
  return events
    .filter((event) => event.symbol === symbol && event.date >= fromDate && event.date <= endDate)
    .sort((left, right) => left.date.localeCompare(right.date))[0] ?? null;
}

function staleRecord(previous, error, today) {
  if (!previous) return null;
  const priorDate = new Date(`${previous.tradingDate}T00:00:00Z`);
  const currentDate = new Date(`${today}T00:00:00Z`);
  const ageDays = Number.isNaN(priorDate.getTime()) ? 999 : Math.floor((currentDate - priorDate) / 86_400_000);
  return {
    ...previous,
    dataStatus: ageDays <= 2 ? "CACHED" : "STALE",
    newPositionAllowed: false,
    riskModule: null,
    priority: 0,
    blockers: [...new Set([...(previous.blockers ?? []), "本次刷新失败，缓存记录不得触发新仓"])],
    refreshError: error,
  };
}

const universe = await readJson(universePath, null);
if (!universe?.symbols?.length) throw new Error("TailTrend universe is empty");
const legacyPrevious = await readJson(snapshotPath, { records: [] });
const previous = await readJson(latestPath, legacyPrevious);
const snapshotIndex = await readJson(indexPath, { schema: "traderhome_tailtrend_snapshot_index_v1", entries: [] });
const previousBySymbol = new Map((previous.records ?? []).map((row) => [row.symbol, row]));
const build = await buildMetadata(universe);
const runAt = new Date().toISOString();
const todayEt = dateInZone("America/New_York");
const calendarEnd = addDays(todayEt, 21);
const symbols = universe.symbols.map((item) => item.symbol);

console.log(`TailTrend daily-close scan: ${symbols.length} symbols engine=${build.engineVersion.slice(0, 12)} dirty=${build.engineDirty}`);

let staticRows = [];
try {
  staticRows = await longbridge(["static", ...symbols], 90_000);
} catch (error) {
  console.warn(`static metadata unavailable: ${errorText(error)}`);
}
const staticBySymbol = new Map((Array.isArray(staticRows) ? staticRows : []).map((row) => [row.symbol, row]));

const eventResponses = await pooled(batch(symbols, 10), 2, async (group) => {
  try {
    return await longbridge([
      "finance-calendar", "report",
      ...group.flatMap((symbol) => ["--symbol", symbol]),
      "--start", todayEt,
      "--end", calendarEnd,
      "--count", "100",
    ], 90_000);
  } catch (error) {
    console.warn(`earnings calendar unavailable for ${group.join(",")}: ${errorText(error)}`);
    return null;
  }
});
const events = eventResponses.flatMap(calendarEvents);

let completed = 0;
const outcomes = await pooled(universe.symbols, 4, async (item) => {
  try {
    const rows = await longbridge([
      "kline", item.symbol,
      "--period", "day",
      "--count", "360",
      "--adjust", "forward",
      "--session", "intraday",
    ], 90_000);
    const normalized = normalizeBars(rows);
    const lastDate = normalized.at(-1)?.date ?? todayEt;
    const event = nearestUpcoming(events, item.symbol, lastDate, calendarEnd);
    const metadata = staticBySymbol.get(item.symbol) ?? {};
    const previousState = previousBySymbol.get(item.symbol);
    const record = analyzeBars(rows, {
      ...item,
      name: metadata.name_cn ?? metadata.name_en ?? metadata.name ?? item.name,
      eventDate: event?.date ?? null,
      dataStatus: "FRESH",
      previousState: previousState?.tradingDate < lastDate ? previousState : null,
    });
    completed += 1;
    console.log(`${String(completed).padStart(2, "0")}/${symbols.length} ${item.symbol} ${record.state}`);
    return {
      record: {
        ...record,
        role: item.role ?? "research",
        event: event ? { date: event.date, timing: event.timing, label: event.label } : null,
        refreshedAt: runAt,
        source: "Longbridge Securities",
      },
      auditBars: normalized.slice(-20),
      calendarDates: normalized.map((bar) => bar.date),
      error: null,
    };
  } catch (error) {
    const message = errorText(error);
    completed += 1;
    console.warn(`${String(completed).padStart(2, "0")}/${symbols.length} ${item.symbol} ERROR ${message}`);
    return {
      record: staleRecord(previousBySymbol.get(item.symbol), message, todayEt),
      auditBars: [],
      calendarDates: [],
      error: `${item.symbol}: ${message}`,
    };
  }
});

let records = outcomes.map((item) => item.record).filter(Boolean);
const errors = outcomes.map((item) => item.error).filter(Boolean);
const order = [
  "TAIL_RECLAIM_WATCH",
  "TREND_ACCEPTED_WATCH",
  "BREAKOUT_CANDIDATE_WATCH",
  "BREAKOUT_FAILURE_WATCH",
  "BREAKDOWN_RISK",
  "EVENT_QUARANTINE",
  "EDGE_OBSERVE",
  "NO_TRADE_MIDDLE",
];
records.sort((left, right) => order.indexOf(left.bucket) - order.indexOf(right.bucket)
  || right.priority - left.priority || left.symbol.localeCompare(right.symbol));

const tradingDate = records.map((row) => row.tradingDate).filter(Boolean).sort().at(-1) ?? todayEt;
const priorEntry = (snapshotIndex.entries ?? [])
  .filter((item) => item.status === "COMPLETE" && item.dataAsOf < tradingDate)
  .sort((left, right) => right.dataAsOf.localeCompare(left.dataAsOf))[0] ?? null;
const priorSnapshot = priorEntry
  ? await readJson(resolve(dataDir, priorEntry.file), null)
  : previous.tradingDate && previous.tradingDate < tradingDate ? previous : null;
const comparisonRows = priorSnapshot?.records ?? [];
const comparisonDate = priorSnapshot?.dataAsOf ?? priorSnapshot?.tradingDate ?? null;
const comparisonBySymbol = new Map(comparisonRows.map((row) => [row.symbol, row]));
records = records.map((record) => {
  const prior = comparisonBySymbol.get(record.symbol);
  const transitionReason = [...(record.stateReason ?? [])];
  const isCurrent = record.tradingDate === tradingDate;
  const blockers = isCurrent ? record.blockers : [...new Set([...(record.blockers ?? []), `该标的最近完整日线为 ${record.tradingDate}`])];
  return {
    ...record,
    dataStatus: isCurrent ? record.dataStatus : "STALE",
    newPositionAllowed: isCurrent ? record.newPositionAllowed : false,
    riskModule: isCurrent ? record.riskModule : null,
    blockers,
    prevState: prior?.state ?? null,
    previousObservationDate: comparisonDate,
    transitionReason,
    riskFactors: publicRiskFactors(record),
    change: {
      comparisonDate,
      from: prior?.state ?? null,
      to: record.state,
      changed: Boolean(prior && prior.state !== record.state),
      reason: transitionReason.join("；") || record.action,
    },
  };
});
const transitions = records.flatMap((record) => record.change.changed ? [{
  symbol: record.symbol,
  from: record.change.from,
  to: record.state,
  at: record.tradingDate,
  reason: record.change.reason,
}] : []);
const summary = summarizeSnapshot(records);
const missingSymbols = symbols.filter((symbol) => !records.some((record) => record.symbol === symbol));
const health = {
  fresh: records.filter((row) => row.dataStatus === "FRESH").length,
  cached: records.filter((row) => row.dataStatus === "CACHED").length,
  stale: records.filter((row) => row.dataStatus === "STALE").length,
  error: errors.length,
  missing: missingSymbols,
  errors,
};
const snapshot = {
  schema: TAILTREND_CONFIG.schema,
  version: 3,
  frameworkVersion: TAILTREND_CONFIG.version,
  dataAsOf: tradingDate,
  tradingDate,
  runAt,
  asOf: runAt,
  engineVersion: build.engineVersion,
  engineDirty: build.engineDirty,
  engineSourceHash: build.engineSourceHash,
  paramsHash: build.paramsHash,
  mode: errors.length || records.length !== symbols.length ? "partial" : "complete",
  source: "Longbridge Securities",
  sourceMethod: "daily OHLCV · forward adjusted · regular session · 360 bars",
  signalTimeframe: "daily_close",
  universe: {
    version: universe.version,
    description: universe.description,
    requested: symbols.length,
    published: records.length,
    symbols,
  },
  summary,
  transitions,
  health,
  dataQuality: {
    fresh: health.fresh,
    cached: health.cached,
    stale: health.stale,
    missing: health.missing.length,
    errors,
  },
  privacy: {
    rawBarsPublished: false,
    accountDataPublished: false,
    brokerCredentialsPublished: false,
    automaticOrders: false,
  },
  researchStatus: "shadow_test_not_validated",
  records,
  disclaimer: "研究影子运行，不是投资建议，不自动下单。状态与参数尚未完成样本外验证。",
};

const calendarDates = [...new Set(outcomes.flatMap((item) => item.calendarDates ?? []))].sort();
const stored = await persistDailySnapshots({ dataDir, snapshot, calendarDates });
const officialRecords = stored.persistedSnapshot?.status === "COMPLETE" ? stored.persistedSnapshot.records ?? [] : [];
const runHistory = {
  schema: "traderhome_tailtrend_run_history_v3",
  version: 3,
  frameworkVersion: TAILTREND_CONFIG.version,
  records: stored.index.entries.map((entry) => ({
    asOf: entry.runAt,
    tradingDate: entry.dataAsOf,
    mode: entry.status.toLowerCase(),
    summary: entry.summary,
    dataQuality: entry.health,
    transitions: entry.transitions,
  })),
};

const previousAudit = await readJson(auditPath, { schema: "traderhome_tailtrend_audit_v1", entries: [] });
const auditBars = new Map(outcomes
  .filter((item) => item.record?.symbol && item.auditBars?.length)
  .map((item) => [item.record.symbol, item.auditBars]));
const auditLedger = updateAuditLedger(previousAudit, officialRecords, auditBars, {
  updatedAt: runAt,
  epochId: `${TAILTREND_CONFIG.version}:${build.engineSourceHash.slice(0, 12)}:${build.paramsHash.slice(0, 12)}`,
});

await mkdir(dataDir, { recursive: true });
await writeFile(historyPath, `${JSON.stringify(runHistory, null, 2)}\n`, "utf8");
await writeFile(auditPath, `${JSON.stringify(auditLedger, null, 2)}\n`, "utf8");
console.log(`${stored.created ? "froze" : "kept"} snapshots/${tradingDate}.json status=${stored.persistedSnapshot.status}`);
if (stored.generatedMissing.length) console.log(`recorded missing sessions=${stored.generatedMissing.join(",")}`);
console.log(`auditDays=${auditLedger.daysCollected} auditEntries=${auditLedger.entries.length}`);
console.log(`fresh=${health.fresh} cached=${health.cached} stale=${health.stale} errors=${errors.length}`);
console.log(`buckets=${JSON.stringify(summary.bucketCounts)}`);
