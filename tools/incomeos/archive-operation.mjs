#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "../..");
const snapshotPath = resolve(projectDir, "portal/vendor/incomeos/data/incomeos-full.json");
const historyPath = resolve(projectDir, "portal/vendor/incomeos/data/operation-history.json");

function newYorkParts(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

async function loadHistory() {
  try {
    return JSON.parse(await readFile(historyPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { schema: "traderhome_incomeos_operation_history_v1", version: 1, records: [] };
  }
}

const data = JSON.parse(await readFile(snapshotPath, "utf8"));
const history = await loadHistory();
const clock = newYorkParts(data.asOf);
const actionDate = `${clock.year}-${clock.month}-${clock.day}`;
const weekday = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
}).format(new Date(data.asOf));
const scheduledFriday = weekday === "Fri";
const recordKind = scheduledFriday ? "friday" : "special";
const recordLabel = scheduledFriday ? "周五操作单" : "临时更新操作单";
const structuralPuts = (data.options ?? []).filter((row) => String(row.put?.action ?? "").startsWith("REVIEW"));
const primaryPut = structuralPuts[0] ?? null;
const allocation = (data.portfolio?.weights ?? []).map((item) => ({
  ticker: item.ticker,
  role: item.role,
  weight: item.weight,
}));
const leaders = (data.assets ?? []).filter((asset) => asset.rank && asset.rank <= 5).map((asset) => ({
  ticker: asset.ticker,
  rank: asset.rank,
  score: asset.scores?.total ?? null,
  status: asset.status,
}));

const record = {
  id: `${recordKind}-${actionDate}`,
  kind: recordKind,
  label: recordLabel,
  actionDate,
  month: actionDate.slice(0, 7),
  generatedAt: data.asOf,
  generatedTimeEt: `${clock.hour}:${clock.minute} ET`,
  snapshotTradingDate: data.tradingDate,
  source: data.source,
  market: {
    temperature: data.market?.temperature ?? null,
    valuation: data.market?.valuation ?? null,
    sentiment: data.market?.sentiment ?? null,
  },
  allocation,
  leaders,
  optionDecision: primaryPut ? {
    status: "STRUCTURE_REVIEW",
    headline: `${primaryPut.ticker} Put 仅通过市场结构，等待账户复核`,
    ticker: primaryPut.ticker,
    contract: primaryPut.put.contract,
    cashRequired: primaryPut.put.cashRequired,
    action: primaryPut.put.action,
  } : {
    status: "NO_TRADE",
    headline: "本周没有 Put 通过结构闸门",
    ticker: null,
    contract: null,
    cashRequired: null,
    action: "WAIT",
  },
  notes: [
    `这是${recordLabel}快照，不代表 IBKR 已实际成交。`,
    "历史记录保存当周模型目标比例；实际美元金额取决于当周输入和账户阶段。",
  ],
};

history.schema = "traderhome_incomeos_operation_history_v1";
history.version = 1;
history.updatedAt = new Date().toISOString();
history.records = [record, ...(history.records ?? []).filter((item) => item.actionDate !== record.actionDate)]
  .sort((left, right) => right.actionDate.localeCompare(left.actionDate));

await mkdir(dirname(historyPath), { recursive: true });
await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
console.log(`archived ${record.id} -> ${historyPath}`);
