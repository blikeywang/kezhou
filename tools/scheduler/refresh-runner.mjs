#!/usr/bin/env node
/**
 * TraderHome scheduled data refresh for the owner's Mac (launchd).
 *
 * IncomeOS and TailTrend read private Longbridge data through the local
 * `longbridge` CLI session, and the daily reports come from the owner's local
 * workflow folder, so none of them can run in GitHub Actions without putting
 * private data or credentials in GitHub. This runner keeps both on the Mac and
 * does the same steps the READMEs describe, unattended:
 *
 *   1. decide whether a new run is due (America/New_York market clock, or for
 *      daily-trade: the report folder changed), so hourly scheduling is safe;
 *   2. reset a dedicated clone to origin/main (never the working copy);
 *   3. check the data source, run the refresh/export and the tests;
 *   4. commit only the product's data folder and push to main.
 *
 * Usage: node refresh-runner.mjs <tailtrend|incomeos-research|incomeos-friday|daily-trade> [--force]
 * Status: ~/.traderhome/logs/refresh-status.json; failures raise a macOS notification.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HOME = homedir();
const BASE = join(HOME, ".traderhome");
const CLONE = process.env.TRADERHOME_REFRESH_REPO || join(BASE, "refresh-repo");
const LOG_DIR = join(BASE, "logs");
const STATUS_PATH = join(LOG_DIR, "refresh-status.json");
const LOCK = join(BASE, "refresh.lock");
const MARKER = join(CLONE, ".git", "traderhome-refresh-clone");
const DAILY_SOURCE = process.env.TRADERHOME_DAILY_SOURCE || join(HOME, "Documents", "猴认知分析");
const DAILY_EXPORTER = "tools/daily-trade/export-public.mjs";

const JOBS = {
  tailtrend: {
    label: "TailTrend 日线快照",
    dataDir: "portal/vendor/tailtrend/data",
    stampFile: "portal/vendor/tailtrend/data/latest.json",
    stamp: (data) => data?.dataAsOf ?? data?.tradingDate ?? null,
    refresh: ["tools/tailtrend/refresh.mjs"],
    tests: [["node", ["--test", "portal/test_tailtrend_engine.mjs"]]],
    due: "afterClose",
  },
  "incomeos-research": {
    label: "IncomeOS 研究快照",
    dataDir: "portal/vendor/incomeos/data",
    stampFile: "portal/vendor/incomeos/data/incomeos-full.json",
    stamp: (data) => data?.tradingDate ?? null,
    refresh: ["tools/incomeos/refresh.mjs", "--no-archive"],
    tests: [["node", ["--test", "portal/test_incomeos_engine.mjs"]]],
    due: "afterClose",
  },
  "incomeos-friday": {
    label: "IncomeOS 周五操作单",
    dataDir: "portal/vendor/incomeos/data",
    stampFile: "portal/vendor/incomeos/data/operation-history.json",
    stamp: (data) => (data?.records ?? []).find((r) => String(r.id ?? "").startsWith("friday-"))?.actionDate ?? null,
    refresh: ["tools/incomeos/refresh.mjs"],
    tests: [["node", ["--test", "portal/test_incomeos_engine.mjs"]]],
    due: "fridayWindow",
  },
  "daily-trade": {
    label: "早晚报",
    dataDir: "portal/vendor/daily-trade/data",
    stampFile: "portal/vendor/daily-trade/data/index.json",
    stamp: (data) => data?.sourceStamp ?? null,
    refresh: [DAILY_EXPORTER, "--source", DAILY_SOURCE],
    tests: [["node", ["--test", "tools/daily-trade/test_export_public.mjs"]]],
    due: "sourceChanged",
    longbridge: false,
  },
};

/* ---------- Market clock (America/New_York) ---------- */
function nyParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { date: `${v.year}-${v.month}-${v.day}`, weekday: v.weekday, minutes: Number(v.hour) * 60 + Number(v.minute) };
}
function previousWeekday(dateText) {
  const d = new Date(`${dateText}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
/** Latest regular session whose daily close should exist (holidays are handled by "no new data"). */
export function expectedSession(now = new Date()) {
  const ny = nyParts(now);
  const weekend = ny.weekday === "Sat" || ny.weekday === "Sun";
  if (!weekend && ny.minutes >= 16 * 60 + 20) return ny.date;
  return previousWeekday(ny.date);
}
export function inFridayWindow(now = new Date()) {
  const ny = nyParts(now);
  return ny.weekday === "Fri" && ny.minutes >= 10 * 60 && ny.minutes < 15 * 60 + 30 ? ny.date : null;
}

/* ---------- Helpers ---------- */
function log(message) { console.log(`[${new Date().toISOString()}] ${message}`); }
function readJson(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function stampOf(job) { return job.stamp(readJson(join(CLONE, job.stampFile))); }
async function sh(cmd, args, options = {}) {
  const { stdout } = await run(cmd, args, { cwd: CLONE, maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60_000, ...options });
  return stdout.trim();
}
async function notify(title, message) {
  if (process.platform !== "darwin") return;
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  await run("osascript", ["-e", `display notification "${esc(message)}" with title "${esc(title)}"`]).catch(() => {});
}
function writeStatus(name, entry) {
  mkdirSync(LOG_DIR, { recursive: true });
  const status = readJson(STATUS_PATH) ?? { schema: "traderhome_refresh_status_v1", jobs: {} };
  const previous = status.jobs[name] ?? {};
  status.jobs[name] = { ...previous, ...entry, lastSuccessAt: entry.ok ? entry.finishedAt : previous.lastSuccessAt ?? null };
  writeFileSync(STATUS_PATH, `${JSON.stringify(status, null, 2)}\n`);
}
/** Readable source folder, else a message that says how to fix macOS privacy / iCloud. */
function checkDailySource() {
  try { readdirSync(join(DAILY_SOURCE, "reports", "morning")); } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      throw new Error(`macOS 不允许后台的 node 读取 ${DAILY_SOURCE}：系统设置 → 隐私与安全性 → 完全磁盘访问权限，加入 ${process.execPath}`);
    }
    if (error?.code === "EDEADLK") throw new Error(`${DAILY_SOURCE} 里的文件只在 iCloud 上：在访达里右键该文件夹 → 保持下载`);
    throw new Error(`找不到早晚报文件夹 ${DAILY_SOURCE}（可用环境变量 TRADERHOME_DAILY_SOURCE 指定）`);
  }
}
async function dailyTarget() {
  checkDailySource();
  if (!existsSync(join(CLONE, DAILY_EXPORTER))) return "unknown";
  return sh("node", [DAILY_EXPORTER, "--stamp", "--source", DAILY_SOURCE], { timeout: 120_000 });
}
export const isDue = (job, stamp, target) => (job.due === "sourceChanged" ? stamp !== target : (stamp ?? "") < target);

function acquireLock() {
  mkdirSync(BASE, { recursive: true });
  if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs > 3 * 3600_000) rmSync(LOCK, { recursive: true, force: true });
  try { mkdirSync(LOCK); return true; } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

async function resetClone() {
  if (!existsSync(MARKER)) throw new Error(`${CLONE} 不是安装脚本创建的专用副本，拒绝重置`);
  await sh("git", ["fetch", "--quiet", "--depth", "30", "origin", "main"]);
  await sh("git", ["checkout", "--quiet", "-B", "main", "origin/main"]);
  await sh("git", ["reset", "--quiet", "--hard", "origin/main"]);
  await sh("git", ["clean", "-fdq"]);
}
async function pushWithRetry() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { await sh("git", ["push", "--quiet", "origin", "HEAD:main"], { timeout: 120_000 }); return; } catch (error) {
      if (attempt === 3) throw error;
      await sh("git", ["pull", "--quiet", "--rebase", "--depth", "30", "origin", "main"]);
      await new Promise((r) => setTimeout(r, attempt * 10_000));
    }
  }
}

/** One readable line: our own messages, else the first "Error:" line of the child output. */
function errorSummary(error) {
  if (!error?.stderr && error?.message && !error.cmd) return String(error.message).slice(0, 400);
  const lines = `${error?.stderr ?? ""}\n${error?.stdout ?? ""}\n${error?.message ?? error}`.split("\n").map((l) => l.trim()).filter(Boolean);
  const cause = lines.find((l) => /^(\w*Error|Error):/.test(l) && !/exited with/.test(l)) ?? lines.find((l) => /Error/.test(l)) ?? lines.at(-1) ?? "unknown error";
  const step = Array.isArray(error?.cmd) ? error.cmd.join(" ") : String(error?.cmd ?? "").split(" ").slice(0, 3).join(" ");
  return `${step ? `${step} 失败：` : ""}${cause}`.slice(0, 400);
}

/* ---------- Main ---------- */
async function main() {
  const name = process.argv[2];
  const force = process.argv.includes("--force");
  const job = JOBS[name];
  if (!job) { console.error(`Unknown job. Use one of: ${Object.keys(JOBS).join(", ")}`); process.exit(64); }

  let target;
  try {
    target = job.due === "fridayWindow" ? inFridayWindow() : job.due === "sourceChanged" ? await dailyTarget() : expectedSession();
  } catch (error) {
    const message = errorSummary(error);
    writeStatus(name, { ok: false, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), message });
    await notify(`TraderHome · ${job.label}更新失败`, message);
    console.error(message);
    process.exitCode = 1;
    return;
  }
  if (!force) {
    if (!target) { log(`${name}: outside the Friday 10:00–15:30 ET window, skipped`); return; }
    if (!isDue(job, stampOf(job), target)) { log(`${name}: already has ${target}, skipped`); return; }
  }
  if (!acquireLock()) { log(`${name}: another refresh is running, skipped`); return; }
  const startedAt = new Date().toISOString();
  try {
    await resetClone();
    const before = stampOf(job);
    if (job.due === "sourceChanged") target = await dailyTarget();
    if (!force && target && !isDue(job, before, target)) { log(`${name}: origin/main already has ${target}`); return; }

    if (job.longbridge !== false) {
      try { await sh("longbridge", ["quote", "SPY.US", "--format", "json"], { timeout: 60_000, cwd: "/tmp" }); } catch {
        throw new Error("Longbridge 无法访问或登录已过期：在终端运行 longbridge login 后会在下一个整点自动重试");
      }
    }

    log(`${name}: refreshing (expected ${target ?? "forced"})`);
    await sh("node", job.refresh, { timeout: 30 * 60_000 });
    const after = stampOf(job);
    if (job.due === "afterClose" && !force && (after ?? "") <= (before ?? "")) {
      // Market holiday or Longbridge has no new close yet: discard churn, retry next hour.
      await sh("git", ["checkout", "--quiet", "--", job.dataDir]);
      await sh("git", ["clean", "-fdq", "--", job.dataDir]);
      writeStatus(name, { ok: true, startedAt, finishedAt: new Date().toISOString(), stamp: after, message: "暂无新的收盘数据（可能是休市日）" });
      log(`${name}: no new session after refresh (${after}); nothing committed`);
      return;
    }

    for (const [cmd, args] of job.tests) await sh(cmd, args);
    await sh("python3", ["-m", "unittest", "portal.test_portal"], { timeout: 15 * 60_000 });

    await sh("git", ["add", "-A", "--", job.dataDir]);
    const staged = await sh("git", ["diff", "--cached", "--name-only"]);
    if (!staged) {
      writeStatus(name, { ok: true, startedAt, finishedAt: new Date().toISOString(), stamp: after, message: "数据无变化" });
      return;
    }
    await sh("git", ["commit", "--quiet", "-m", `chore(data): ${name} refresh ${after ?? target} [scheduled]`]);
    await pushWithRetry();
    writeStatus(name, { ok: true, startedAt, finishedAt: new Date().toISOString(), stamp: after, message: `已发布 ${after}` });
    log(`${name}: published ${after}`);
  } catch (error) {
    const message = errorSummary(error);
    writeStatus(name, { ok: false, startedAt, finishedAt: new Date().toISOString(), message });
    await notify(`TraderHome · ${job.label}更新失败`, message);
    console.error(message);
    process.exitCode = 1;
    await sh("git", ["reset", "--quiet", "--hard", "origin/main"]).catch(() => {});
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
