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
const requestedAt = new Date().toISOString();
const definitions = [
  { symbol: "SPYM.US", ticker: "SPYM", name: "State Street SPDR Portfolio S&P 500 ETF", proxyFor: "SPY", role: "宽基核心整股代理" },
];

const numeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const { stdout } = await execFileAsync("longbridge", ["quote", ...definitions.map((item) => item.symbol), "--format", "json"], {
  cwd: "/private/tmp",
  timeout: 60_000,
  maxBuffer: 4 * 1024 * 1024,
});
const rows = JSON.parse(stdout);
const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
const executionAssets = definitions.map((item) => {
  const quote = bySymbol.get(item.symbol) ?? {};
  const price = numeric(quote.last ?? quote.last_done);
  if (!price) throw new Error(`${item.symbol}: missing executable quote`);
  return {
    ...item,
    price,
    dayChange: numeric(quote.change_percentage),
    dollarVolume: numeric(quote.turnover),
    quoteTimestamp: requestedAt,
    source: "Longbridge Securities",
  };
});

const data = JSON.parse(await readFile(dataPath, "utf8"));
data.executionAssets = executionAssets;
data.executionAsOf = requestedAt;
await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`IncomeOS whole-share execution: ${executionAssets.map((item) => `${item.ticker} $${item.price}`).join(", ")}`);
