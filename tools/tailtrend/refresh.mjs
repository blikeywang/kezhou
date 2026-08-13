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
} from "../../portal/vendor/tailtrend/tailtrend-engine.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "../..");
const dataDir = resolve(projectDir, "portal/vendor/tailtrend/data");
const snapshotPath = resolve(dataDir, "tailtrend-snapshot.json");
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

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function errorText(error) {
  const source = error?.stderr || error?.stdout || error?.message || String(error);
  return String(source).split("\n").find((line) => line.trim().startsWith("Error:"))
    ?? String(source).split("\n").find(Boolean)
    ?? "unknown Longbridge error";
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
const previous = await readJson(snapshotPath, { records: [] });
const previousBySymbol = new Map((previous.records ?? []).map((row) => [row.symbol, row]));
const todayEt = dateInZone("America/New_York");
const calendarEnd = addDays(todayEt, 21);
const symbols = universe.symbols.map((item) => item.symbol);

console.log(`TailTrend daily-close scan: ${symbols.length} symbols`);

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
    const lastDate = Array.isArray(rows) && rows.length ? String(rows.at(-1).time).slice(0, 10) : todayEt;
    const event = nearestUpcoming(events, item.symbol, lastDate, calendarEnd);
    const metadata = staticBySymbol.get(item.symbol) ?? {};
    const record = analyzeBars(rows, {
      ...item,
      name: metadata.name_cn ?? metadata.name_en ?? metadata.name ?? item.name,
      eventDate: event?.date ?? null,
      dataStatus: "FRESH",
    });
    completed += 1;
    console.log(`${String(completed).padStart(2, "0")}/${symbols.length} ${item.symbol} ${record.state}`);
    return {
      record: {
        ...record,
        role: item.role ?? "research",
        event: event ? { date: event.date, timing: event.timing, label: event.label } : null,
        refreshedAt: new Date().toISOString(),
        source: "Longbridge Securities",
      },
      auditBars: normalizeBars(rows).slice(-20),
      error: null,
    };
  } catch (error) {
    const message = errorText(error);
    completed += 1;
    console.warn(`${String(completed).padStart(2, "0")}/${symbols.length} ${item.symbol} ERROR ${message}`);
    return { record: staleRecord(previousBySymbol.get(item.symbol), message, todayEt), auditBars: [], error: `${item.symbol}: ${message}` };
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
const runHistory = await readJson(historyPath, { schema: "traderhome_tailtrend_run_history_v2", records: [] });
const priorRun = (runHistory.records ?? [])
  .filter((item) => item.tradingDate < tradingDate && Array.isArray(item.symbols))
  .sort((left, right) => right.tradingDate.localeCompare(left.tradingDate))[0] ?? null;
const comparisonRows = priorRun?.symbols
  ?? (previous.tradingDate && previous.tradingDate < tradingDate ? previous.records ?? [] : []);
const comparisonDate = priorRun?.tradingDate
  ?? (previous.tradingDate && previous.tradingDate < tradingDate ? previous.tradingDate : null);
const comparisonBySymbol = new Map(comparisonRows.map((row) => [row.symbol, row]));
records = records.map((record) => {
  const prior = comparisonBySymbol.get(record.symbol);
  return {
    ...record,
    change: {
      comparisonDate,
      from: prior?.state ?? null,
      to: record.state,
      changed: Boolean(prior && prior.state !== record.state),
      reason: (record.stateReason ?? []).join("；") || record.action,
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
const snapshot = {
  schema: TAILTREND_CONFIG.schema,
  version: 2,
  frameworkVersion: TAILTREND_CONFIG.version,
  asOf: new Date().toISOString(),
  tradingDate,
  mode: errors.length ? "partial" : "complete",
  source: "Longbridge Securities",
  sourceMethod: "daily OHLCV · forward adjusted · regular session · 360 bars",
  signalTimeframe: "daily_close",
  universe: {
    version: universe.version,
    description: universe.description,
    requested: symbols.length,
    published: records.length,
  },
  summary,
  transitions,
  dataQuality: {
    fresh: records.filter((row) => row.dataStatus === "FRESH").length,
    cached: records.filter((row) => row.dataStatus === "CACHED").length,
    stale: records.filter((row) => row.dataStatus === "STALE").length,
    missing: symbols.length - records.length,
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

runHistory.schema = "traderhome_tailtrend_run_history_v2";
runHistory.version = 2;
runHistory.frameworkVersion = TAILTREND_CONFIG.version;
runHistory.records = [
  {
    asOf: snapshot.asOf,
    tradingDate,
    mode: snapshot.mode,
    summary,
    dataQuality: snapshot.dataQuality,
    transitions,
    symbols: records.map((record) => ({
      symbol: record.symbol,
      state: record.state,
      bucket: record.bucket,
      priority: record.priority,
      priorityBreakdown: record.priorityBreakdown,
      dataStatus: record.dataStatus,
      newPositionAllowed: record.newPositionAllowed,
      stateReason: record.stateReason,
      nextCondition: record.nextCondition,
      blockers: record.blockers,
    })),
  },
  ...(runHistory.records ?? []).filter((item) => item.tradingDate !== tradingDate),
].slice(0, 90);

const previousAudit = await readJson(auditPath, { schema: "traderhome_tailtrend_audit_v1", entries: [] });
const auditBars = new Map(outcomes
  .filter((item) => item.record?.symbol && item.auditBars?.length)
  .map((item) => [item.record.symbol, item.auditBars]));
const auditLedger = updateAuditLedger(previousAudit, records, auditBars, {
  retentionDays: 30,
  updatedAt: snapshot.asOf,
});

await mkdir(dataDir, { recursive: true });
await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
await writeFile(historyPath, `${JSON.stringify(runHistory, null, 2)}\n`, "utf8");
await writeFile(auditPath, `${JSON.stringify(auditLedger, null, 2)}\n`, "utf8");
console.log(`wrote ${snapshotPath}`);
console.log(`auditDays=${auditLedger.daysCollected} auditEntries=${auditLedger.entries.length}`);
console.log(`fresh=${snapshot.dataQuality.fresh} cached=${snapshot.dataQuality.cached} stale=${snapshot.dataQuality.stale} errors=${errors.length}`);
console.log(`buckets=${JSON.stringify(summary.bucketCounts)}`);
