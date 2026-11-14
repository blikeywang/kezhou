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
    due: "weeklyClose",
  },
  "incomeos-research": {
    label: "IncomeOS 研究快照",
    dataDir: "portal/vendor/incomeos/data",
    stampFile: "portal/vendor/incomeos/data/incomeos-full.json",
    stamp: (data) => data?.tradingDate ?? null,
    refresh: ["tools/incomeos/refresh.mjs", "--no-archive"],
    tests: [["node", ["--test", "portal/test_incomeos_engine.mjs"]]],
    due: "weeklyClose",
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
// NYSE full-day closures and 1:00 p.m. early closes, from NYSE Group's 2026–2028 calendar
// (announced 2025-12-23). Extend this list before 2028; after it runs out, holidays fall back
// to a fail-closed calendar error.
const NYSE_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const NYSE_EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);
export function isTradingDay(dateText) {
  if (!/^202[67]-\d{2}-\d{2}$/.test(dateText) || new Date(`${dateText}T12:00:00Z`).toISOString().slice(0,10)!==dateText) throw new Error("Market calendar unavailable for date: "+dateText);
  return ![0,6].includes(new Date(`${dateText}T12:00:00Z`).getUTCDay()) && !NYSE_HOLIDAYS.has(dateText);
}
/** Minutes after New York midnight when that day's daily close should be available (close + 20 min). */
export const closeReadyMinutes = (dateText) => (NYSE_EARLY_CLOSE.has(dateText) ? 13 * 60 : 16 * 60) + 20;
function previousTradingDay(dateText) {
  const d = new Date(`${dateText}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while (!isTradingDay(d.toISOString().slice(0, 10)));
  return d.toISOString().slice(0, 10);
}
/** Latest regular session whose daily close should exist. */
export function expectedSession(now = new Date()) {
  const ny = nyParts(now);
  if (isTradingDay(ny.date) && ny.minutes >= closeReadyMinutes(ny.date)) return ny.date;
  return previousTradingDay(ny.date);
}
/** Hours since the expected session's close became available (for telling "not yet" from "failed"). */
export function hoursSinceClose(session, now = new Date()) {
  const ny = nyParts(now);
  const dayDiff = Math.round((Date.parse(`${ny.date}T00:00:00Z`) - Date.parse(`${session}T00:00:00Z`)) / 86_400_000);
  return (dayDiff * 1440 + ny.minutes - closeReadyMinutes(session)) / 60;
}
/** Only release a weekly target while that week's last session is the latest
 * completed session. Late weekday catch-up requires an explicit manual run;
 * never silently publish Monday prices labelled as Friday. */
export function weeklyCloseTarget(now = new Date()) {
  const ny = nyParts(now);
  const friday = new Date(`${ny.date}T12:00:00Z`);
  friday.setUTCDate(friday.getUTCDate() + 5 - (friday.getUTCDay() || 7));
  let target = friday.toISOString().slice(0, 10);
  if (!isTradingDay(target)) target = previousTradingDay(target);
  if (ny.date < target || (ny.date === target && ny.minutes < closeReadyMinutes(target))) return null;
  return expectedSession(now) === target ? target : null;
}
export function inFridayWindow(now = new Date()) {
  const ny = nyParts(now);
  return isTradingDay(ny.date) && ny.weekday === "Fri" && ny.minutes >= 10 * 60 && ny.minutes < 15 * 60 + 30 ? ny.date : null;
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
    target = job.due === "fridayWindow" ? inFridayWindow() : job.due === "sourceChanged" ? await dailyTarget() : job.due === "weeklyClose" ? weeklyCloseTarget() : expectedSession();
  } catch (error) {
    const message = errorSummary(error);
    writeStatus(name, { ok: false, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), message });
    await notify(`TraderHome · ${job.label}更新失败`, message);
    console.error(message);
    process.exitCode = 1;
    return;
  }
  if (!force) {
    if (!target) { log(`${name}: outside the configured release window, skipped`); return; }
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
    const quality = name === "tailtrend" ? await import(pathToFileURL(join(CLONE, "tools/tailtrend/publication-quality.mjs")).href) : null;
    const beforeHashes = quality ? await quality.snapshotHashes(join(CLONE, job.dataDir, "snapshots")) : null;
    await sh("node", job.refresh, { timeout: 30 * 60_000 });
    const after = stampOf(job);
    if (["afterClose", "weeklyClose"].includes(job.due) && !force && (after ?? "") <= (before ?? "")) {
      // Holidays never reach here (the calendar skips them), so a missing close on a trading day
      // is either "not published yet" or a real data failure. Discard the churn either way, but
      // after three hours call it a failure instead of reporting success.
      await sh("git", ["checkout", "--quiet", "--", job.dataDir]);
      await sh("git", ["clean", "-fdq", "--", job.dataDir]);
      const late = hoursSinceClose(target) >= 3;
      const message = late
        ? `${target} 是交易日，收盘超过 3 小时仍没拿到这一天的日线（数据停在 ${after ?? "—"}）：检查 Longbridge 行情权限或刷新日志`
        : `${target} 的收盘数据还没出来，下一个整点重试`;
      writeStatus(name, { ok: !late, startedAt, finishedAt: new Date().toISOString(), stamp: after, message });
      if (late) { await notify(`TraderHome · ${job.label}没有新数据`, message); process.exitCode = 1; }
      log(`${name}: no new session after refresh (${after}); nothing committed`);
      return;
    }

    if (quality) {
      quality.assertHistoryUnchanged(beforeHashes, await quality.snapshotHashes(join(CLONE, job.dataDir, "snapshots")));
      quality.assertTailtrendQuality(readJson(join(CLONE, job.stampFile)), expectedSession(), { persisted: true });
    }
    if (name.startsWith("incomeos")) {
      const research = readJson(join(CLONE, "portal/vendor/incomeos/data/incomeos-full.json"));
      const incomeQuality = await import(pathToFileURL(join(CLONE, "tools/incomeos/data-quality.mjs")).href);
      if (name === "incomeos-research") {
        // Owner-authorized scheduled research publication is not live execution.
        // Preserve every source-time/coverage disclosure; never archive a partial operation.
        const publication = await import(pathToFileURL(join(CLONE, "tools/incomeos/research-publication.mjs")).href);
        const prepared = publication.prepareResearchPublication(research, expectedSession(), new Date(), { scheduledResearch: true });
        writeFileSync(join(CLONE, job.stampFile), `${JSON.stringify(prepared, null, 2)}\n`);
      } else if (incomeQuality.finalPublicationErrors(research, expectedSession()).length || research?.dataQuality?.publicationReady !== true || research?.mode !== "live") throw new Error("IncomeOS publication blocked: incomplete or unverified source data");
    }
    for (const [cmd, args] of job.tests) await sh(cmd, args);
    await sh("python3", ["-m", "unittest", "portal.test_portal"], { timeout: 15 * 60_000 });

    await sh("git", ["add", "-A", "--", job.dataDir]);
    const staged = await sh("git", ["diff", "--cached", "--name-only"]);
    if (!staged) {
      writeStatus(name, { ok: true, startedAt, finishedAt: new Date().toISOString(), stamp: after, message: "数据无变化" });
      return;
    }
    await sh("git", ["commit", "--quiet", "-m", `chore(data): ${name} refresh ${after ?? target} [${process.env.TRADERHOME_TRIGGER === "launchd" && !force ? "scheduled" : "manual"}]`]);
    await pushWithRetry();
    writeStatus(name, { ok: true, startedAt, finishedAt: new Date().toISOString(), stamp: after, message: `已推送 ${after}；部署及网页尚待核验` });
    log(`${name}: pushed ${after}; deployment and public readback not yet verified`);
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
