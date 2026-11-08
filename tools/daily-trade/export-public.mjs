#!/usr/bin/env node
/**
 * Export the public part of the daily trade workflow into TraderHome.
 *
 * Source: the owner's private workflow project (default ~/Documents/猴认知分析).
 * Output: portal/vendor/daily-trade/data/{index.json, days/<date>.json,
 *         trend-heatmap.json, latest-extras.json, manifest.json}
 *
 * Public boundary (allowlist, not blocklist):
 *   - Only named sections of the morning/evening Markdown are parsed; account
 *     (OKX), Desk (paid), daily potential zones and NQ/ES detail are never read.
 *   - Every string goes through clean(): sentences mentioning account, margin,
 *     liquidation, leverage, equity, Desk or OKX are dropped; tool logs are dropped.
 *   - A final scan rejects local paths, key-like fields and private markers; on a
 *     hit nothing is written and the process exits 1.
 *
 * Usage: node tools/daily-trade/export-public.mjs [--source <dir>] [--out <dir>] [--stamp]
 *        (--stamp only prints the source fingerprint; the scheduler uses it to decide)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SOURCE = join(homedir(), "Documents", "猴认知分析");
const DEFAULT_OUT = join(ROOT, "portal", "vendor", "daily-trade", "data");

/* ---------------- text hygiene ---------------- */
// "一般账户" is the Treasury General Account (TGA), a public macro series, not the owner's account.
const PRIVATE_WORDS = /(?<!一般)账户|OKX|Desk|保证金|强平|杠杆|权益|可用余额|提现|API\s*Key|密钥/i;
const LOG_LINE = /^\s*(Warning:|Error:|\|?\s*Command failed|at\s+\S+\s+\(|Traceback|File ")/;
export function clean(text, max = 400) {
  if (text == null) return null;
  let s = String(text)
    .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, "$1")       // markdown links -> text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/URLError:.*$/i, "网络不可用")
    .replace(/\s+/g, " ")
    .trim();
  const parts = s.split(/(?<=[；。;])/).filter((p) => !PRIVATE_WORDS.test(p));
  s = parts.join("").trim();
  if (s.length > max) s = s.slice(0, max - 1) + "…";
  return s || null;
}
const num = (v) => {
  if (v == null) return null;
  const m = String(v).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/* ---------------- markdown → sections ---------------- */
export function parseMarkdown(md) {
  const lines = md.split(/\r?\n/).filter((l) => !LOG_LINE.test(l));
  const sections = [];
  let cur = { title: "_head", level: 1, lines: [] };
  for (const line of lines) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { sections.push(cur); cur = { title: h[2].trim(), level: h[1].length, lines: [] }; continue; }
    cur.lines.push(line);
  }
  sections.push(cur);
  for (const s of sections) {
    s.tables = [];
    s.bullets = [];
    s.text = [];
    let table = null;
    for (const raw of s.lines) {
      const line = raw.trim();
      if (line.startsWith("|")) {
        const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
        if (!table) { table = { headers: cells, rows: [] }; s.tables.push(table); } else table.rows.push(cells);
        continue;
      }
      table = null;
      if (/^[-*]\s+/.test(line)) s.bullets.push(line.replace(/^[-*]\s+/, ""));
      else if (line) s.text.push(line);
    }
  }
  return sections;
}
const find = (sections, re) => sections.find((s) => re.test(s.title));
const rowsOf = (section, i = 0) => (section?.tables?.[i]?.rows ?? []).filter((r) => r[0] && !/^(无|—)$/.test(r[0]));

/* ---------------- morning report ---------------- */
export function parseMorning(md, date) {
  const sec = parseMarkdown(md);
  const head = sec[0].text.join("\n");
  const all = md;
  const headlineRaw = (all.match(/\*\*一句话结论：\*\*\s*(.+)/) || [])[1];
  const stanceMatch = all.match(/\*\*假设研究账户动作：([^。*]+)。?\*\*\s*([^\n]*)/);
  const riskCap = num((all.match(/风险倍率上限(?:降至|为|：)?\s*([0-9.]+)/) || [])[1]);
  const fresh = rowsOf(find(sec, /^数据新鲜度/))
    .filter((r) => !PRIVATE_WORDS.test(r[0]) && !/潜力区/.test(r[0]))
    .map((r) => ({ name: clean(r[0], 40), date: /\d{4}-\d{2}-\d{2}/.test(r[1]) ? r[1] : null, state: clean(r[2], 60), ageDays: num((r[2] || "").match(/（(\d+) 天）/)?.[1]) }));
  const classes = rowsOf(find(sec, /^大类背景/)).map((r) => ({ name: r[0], temp: r[1], phase: r[2] === "—" ? null : r[2], date: r[3] || null }));
  const signalRows = (s) => rowsOf(s).map((r) => ({
    symbol: clean(r[0], 24), market: clean(r[1], 16), agreement: clean(r[2], 24),
    score: num((r[2] || "").match(/\(([+-]?\d+)\)/)?.[1]), evidence: clean(r[3], 220), entry: clean(r[4], 120),
  }));
  const surf = rowsOf(find(sec, /冲浪形态/)).map((r) => ({ symbol: clean(r[0], 24), status: clean(r[1], 30), score: num(r[2]), window: clean(r[3], 60), next: clean(r[r.length - 1], 160) }));
  const bpSection = find(sec, /^13买点扫描/);
  const buyPoints = rowsOf(bpSection).map((r) => ({ symbol: clean(r[0], 24), level: clean(r[1], 60), entry: num(r[2]), stop: num(r[3]), targets: clean(r[4], 40), bar: clean(r[5], 30) }));
  const riskSection = find(sec, /^市场风险三开关/);
  const riskConclusion = clean((riskSection?.text ?? []).find((t) => t.startsWith("**结论")), 120);
  const questions = rowsOf(riskSection).map((r) => ({ question: clean(r[0], 40), state: clean(r[1], 20) }));
  const liquidity = rowsOf(find(sec, /^流动性燃料/)).map((r) => ({ name: clean(r[0], 30), value: clean(r[1], 20), date: clean(r[2], 30), state: clean(r[3], 16) }));
  const slow = rowsOf(find(sec, /^七项慢速拥挤/));
  const crypto = rowsOf(find(sec, /^BTC \/ ETH 期权面/)).filter((r) => /^(BTC|ETH)$/.test(r[0])).map((r) => ({
    symbol: r[0], spot: num(r[1]), dvol: num(r[2]), hv30: num(r[3]), ivHv: num(r[4]), volPc: num(r[5]), oiPc: num(r[6]), tenor: clean(r[7], 30), atmIv: num(r[8]), rr25: num(r[9]),
  }));
  const bullets = (re) => (find(sec, re)?.bullets ?? []).map((b) => clean(b, 220)).filter(Boolean);
  return {
    date,
    headline: clean(headlineRaw, 260),
    stance: stanceMatch ? { label: clean(stanceMatch[1], 20), summary: clean(stanceMatch[2], 200) } : null,
    riskCap,
    freshness: fresh,
    classes,
    buys: signalRows(find(sec, /^Buy 候选/)),
    sells: signalRows(find(sec, /^Sell \/ 回避/)),
    divergences: signalRows(find(sec, /^背离警示/)),
    unconfirmed: rowsOf(find(sec, /^无交叉确认/)).map((r) => ({ symbol: clean(r[0], 24), market: clean(r[1], 16), signal: clean(r[2], 10), agreement: clean(r[3], 24), score: num((r[3] || "").match(/\(([+-]?\d+)\)/)?.[1]) })),
    surf,
    buyPoints,
    buyPointScanNote: clean((bpSection?.text ?? [])[0], 160),
    buyPointErrors: (bpSection?.bullets ?? []).filter((b) => /扫描异常/.test(b)).length,
    risk: { conclusion: riskConclusion, questions, liquidity, slowMissing: slow.filter((r) => /缺失/.test(r[3] || "")).length, slowTotal: slow.length },
    crypto,
    changes: bullets(/^会改变结论的条件/).slice(0, 6),
    // One line per gap: keep the first sentence so a pasted source note doesn't flood the page.
    gaps: bullets(/^当前缺口/).map((g) => { const first = g.split("。")[0]; return first.length > 110 ? `${first.slice(0, 109)}…` : first; }).slice(0, 12),
  };
}

/* ---------------- evening report ---------------- */
export function parseEvening(md, date) {
  const sec = parseMarkdown(md);
  const collected = (md.match(/最新采集：\s*([0-9-]+ [0-9:]+)/) || [])[1] ?? null;
  const offline = /在线采集失败|回退本地缓存/.test(md);
  const classes = rowsOf(find(sec, /^大类整体/)).map((r) => ({
    name: r[0], date: r[1], temp: r[2], phase: r[3] === "—" ? null : r[3],
    change: clean(String(r[4] ?? "").replace(/\/(?=\s|$)/g, "").replace(/\s+/g, " "), 30),
  }));
  const warmToHot = (find(sec, /^温转热组合/)?.bullets ?? []).map((b) => {
    const m = b.match(/^温转热\(([^)]+)\)：(.*)$/);
    if (!m) return null;
    const items = m[2].trim() === "空" ? [] : m[2].split("、").map((x) => {
      const t = x.match(/^(.*)\(([^·()]+)·([^)]+)\)$/);
      return t ? { name: clean(t[1], 40), symbol: t[2], temp: t[3] } : { name: clean(x, 40), symbol: null, temp: null };
    }).filter((x) => x.name);
    return { group: m[1], items };
  }).filter(Boolean);
  const s1 = (find(sec, /^s1 Buy 冷热/)?.bullets ?? []).map((b) => {
    const m = b.match(/^([^：]+)：\s*([^ /]+)\s*\/\s*([^（]+)（([^）]+)）/);
    return m ? { symbol: m[1].trim(), temp: m[2], phase: m[3].trim() === "—" ? null : m[3].trim(), market: m[4] } : null;
  }).filter(Boolean);
  return { date, collected, offline, classes, warmToHot, s1 };
}

/* ---------------- structured latest data ---------------- */
function readJson(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }

export function trendHeatmap(csvText, keepDates = 90) {
  const [header, ...lines] = csvText.trim().split(/\r?\n/);
  const cols = header.split(",");
  const idx = (k) => cols.indexOf(k);
  const cells = {};
  const dates = new Set();
  for (const line of lines) {
    const c = line.split(",");
    if (c[idx("level")] !== "大类") continue;
    const date = c[idx("asOfDate")]; const name = c[idx("asset")]; const temp = c[idx("temperature")];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name || !temp) continue;
    (cells[name] ??= {})[date] = temp;
    dates.add(date);
  }
  const sorted = [...dates].sort().slice(-keepDates);
  const classes = Object.keys(cells).sort((a, b) => ["美股", "美国ETF", "加密币", "商品期货", "A股", "ETF基金"].indexOf(a) - ["美股", "美国ETF", "加密币", "商品期货", "A股", "ETF基金"].indexOf(b));
  return { schema: "traderhome_trend_heatmap_v1", scale: ["寒", "凉", "平", "温", "热", "沸"], dates: sorted, classes, cells: Object.fromEntries(classes.map((k) => [k, Object.fromEntries(sorted.filter((d) => cells[k][d]).map((d) => [d, cells[k][d]]))])) };
}

export function latestExtras(source) {
  const decision = readJson(join(source, "data", "decision", "latest.json"));
  const risk = readJson(join(source, "data", "risk_watch", "latest.json"));
  const crypto = readJson(join(source, "data", "options", "crypto_latest.json"));
  const out = { schema: "traderhome_daily_extras_v1" };
  if (decision) {
    out.decision = {
      date: decision.report_date ?? null,
      stance: decision.stance ? { label: clean(decision.stance.label, 20), riskCap: num(decision.stance.risk_multiplier), summary: clean(decision.stance.summary, 200), confidence: clean(decision.stance.confidence, 10) } : null,
      actions: (decision.actions ?? []).filter((a) => !PRIVATE_WORDS.test(a.market ?? "")).map((a) => ({ market: clean(a.market, 30), state: clean(a.state, 20), action: clean(a.action, 160), trigger: clean(a.trigger, 200), invalidation: clean(a.invalidation, 200) })).filter((a) => a.action),
      sources: Object.entries(decision.sources ?? {}).filter(([k]) => !PRIVATE_WORDS.test(k) && !/潜力区/.test(k)).map(([k, v]) => ({ name: clean(k, 40), date: v?.data_date ?? null, state: clean(v?.state, 40), ageDays: Number.isFinite(v?.age_days) ? v.age_days : null })),
    };
  }
  if (risk) {
    out.risk = {
      date: risk.report_date ?? null,
      overall: risk.overall ? { level: clean(risk.overall.level, 20), coverage: clean(risk.overall.coverage, 20), summary: clean(risk.overall.summary, 120) } : null,
      questions: (risk.three_questions ?? []).map((q) => ({ question: clean(q.question, 30), answer: clean(q.answer, 40), state: clean(q.state, 20) })),
      liquidity: (risk.liquidity?.metrics ?? []).map((m) => ({
        name: clean(m.name, 30), value: Number.isFinite(m.value) ? Math.round(m.value * 1e4) / 1e4 : null, valueText: clean(m.value_text, 20),
        date: m.data_date ?? null, frequency: clean(m.frequency, 12), state: clean(m.state, 16), source: clean(m.source, 80),
        rule: clean(String(m.interpretation ?? "").replace(/^视频启发式：/, ""), 140),
      })).filter((m) => m.name),
      riskCap: num(risk.action_gate?.risk_multiplier_cap),
    };
  }
  if (crypto?.instruments) {
    out.crypto = {
      date: crypto.report_date ?? null,
      collectedAt: crypto.collected_at ?? null,
      source: clean(crypto.provider ?? "Deribit", 40),
      instruments: Object.entries(crypto.instruments).filter(([, v]) => v?.status === "ready").map(([k, v]) => ({
        symbol: k, spot: v.spot ?? null, dvol: v.dvol?.current ?? null, dvolPctile365: v.dvol?.pctile_365d ?? null, dvolHi: v.dvol?.hi_365d ?? null, dvolLo: v.dvol?.lo_365d ?? null,
        hv30: v.hv30 ?? null, volPc: v.put_call?.vol_pc ?? null, oiPc: v.put_call?.oi_pc ?? null,
        term: (v.term_structure ?? []).map((t) => ({ expiry: t.expiry, dte: t.dte, atmIv: t.atm_iv ?? null, rr25: t.rr25 ?? null })).filter((t) => Number.isFinite(t.dte) && Number.isFinite(t.atmIv)),
      })),
    };
  }
  return out;
}

/* ---------------- privacy scan ---------------- */
const FORBIDDEN = [/\/Users\//, /\/home\//, /config\/private/i, /api[_-]?key/i, /secret/i, /passphrase/i, /bearer\s/i, /"equity_usd"/, /OKX/i, /保证金率|强平价|毛杠杆|净杠杆/];
export function privacyScan(text) {
  return FORBIDDEN.filter((re) => re.test(text)).map(String);
}

/* ---------------- main ---------------- */
function listReports(dir, prefix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((n) => n.match(new RegExp(`^${prefix}_(\\d{4}-\\d{2}-\\d{2})\\.md$`))).filter(Boolean).map((m) => ({ date: m[1], file: join(dir, m[0]) })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fingerprint of everything the export reads. The scheduler compares it with the
 * published index.json and only exports when the source changed, so an evening
 * report for an already-published date is picked up too.
 */
export function sourceStamp(source = DEFAULT_SOURCE) {
  const mornings = listReports(join(source, "reports", "morning"), "每日综合决策早报");
  const evenings = listReports(join(source, "reports", "evening"), "趋势冷热晚间状态");
  const inputs = [mornings.at(-1)?.file, evenings.at(-1)?.file,
    join(source, "data", "decision", "latest.json"), join(source, "data", "risk_watch", "latest.json"),
    join(source, "data", "options", "crypto_latest.json"), join(source, "data", "trend", "trend_history.csv")];
  const hash = createHash("sha1").update(`${mornings.length}|${evenings.length}`);
  for (const file of inputs) if (file && existsSync(file)) hash.update(readFileSync(file));
  const latest = [mornings.at(-1)?.date, evenings.at(-1)?.date].filter(Boolean).sort().at(-1) ?? "none";
  return `${latest}:${hash.digest("hex").slice(0, 16)}`;
}

export function exportPublic({ source = DEFAULT_SOURCE, out = DEFAULT_OUT, now = new Date() } = {}) {
  const mornings = listReports(join(source, "reports", "morning"), "每日综合决策早报");
  const evenings = listReports(join(source, "reports", "evening"), "趋势冷热晚间状态");
  if (!mornings.length && !evenings.length) throw new Error(`没有找到早报或晚报：${source}/reports`);
  const days = new Map();
  for (const m of mornings) days.set(m.date, { date: m.date, morning: parseMorning(readFileSync(m.file, "utf8"), m.date) });
  for (const e of evenings) (days.get(e.date) ?? days.set(e.date, { date: e.date }).get(e.date)).evening = parseEvening(readFileSync(e.file, "utf8"), e.date);

  const files = {};
  const index = [];
  for (const day of [...days.values()].sort((a, b) => b.date.localeCompare(a.date))) {
    files[`days/${day.date}.json`] = { schema: "traderhome_daily_report_v1", ...day };
    const m = day.morning;
    index.push({
      date: day.date,
      stance: m?.stance?.label ?? null,
      riskCap: m?.riskCap ?? null,
      headline: m?.headline ? (m.headline.length > 90 ? m.headline.slice(0, 89) + "…" : m.headline) : null,
      counts: m ? { buy: m.buys.length, sell: m.sells.length, divergence: m.divergences.length, unconfirmed: m.unconfirmed.length, buyPoints: m.buyPoints.length, surfConfirmed: m.surf.filter((s) => /确认/.test(s.status ?? "") && !/待/.test(s.status ?? "")).length } : null,
      freshness: m ? { fresh: m.freshness.filter((f) => /最新/.test(f.state ?? "")).length, total: m.freshness.length } : null,
      hasMorning: Boolean(m),
      hasEvening: Boolean(day.evening),
    });
  }
  const trendCsv = join(source, "data", "trend", "trend_history.csv");
  if (existsSync(trendCsv)) files["trend-heatmap.json"] = trendHeatmap(readFileSync(trendCsv, "utf8"));
  files["latest-extras.json"] = latestExtras(source);

  const latest = index[0];
  // A report for day D is written on day D (Asia/Shanghai). Cap the file time at the
  // end of that day so a copied or re-synced old file never looks new.
  const latestMorning = mornings.at(-1);
  let generatedAt = now.toISOString();
  if (latestMorning) {
    const mtime = statSync(latestMorning.file).mtimeMs;
    const endOfDay = Date.parse(`${latestMorning.date}T23:59:00+08:00`);
    generatedAt = new Date(Math.min(mtime, endOfDay)).toISOString();
  }
  files["index.json"] = { schema: "traderhome_daily_index_v1", exportedAt: now.toISOString(), sourceStamp: sourceStamp(source), latest: latest?.date ?? null, days: index };

  // Keep the legacy HTML routes so older links keep working.
  const manifestPath = join(out, "manifest.json");
  const previous = readJson(manifestPath) ?? {};
  files["manifest.json"] = {
    schema_version: 2,
    report_date: latest?.date ?? previous.report_date ?? null,
    generated_at: generatedAt,
    source_project: "独立交易流程（公开摘要）",
    public_boundary: "allowlisted_sections_no_account_no_desk_no_keys",
    routes: previous.routes ?? {},
    reports: previous.reports ?? [],
    publishing: { state: "active", exporter: "tools/daily-trade/export-public.mjs" },
  };

  const serialized = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, `${JSON.stringify(v, null, 1)}\n`]));
  const hits = Object.entries(serialized).flatMap(([k, text]) => privacyScan(text).map((p) => `${k}: ${p}`));
  if (hits.length) throw new Error(`公开数据含私密内容，已中止：${hits.slice(0, 5).join("; ")}`);

  rmSync(join(out, "days"), { recursive: true, force: true });
  mkdirSync(join(out, "days"), { recursive: true });
  for (const [k, text] of Object.entries(serialized)) writeFileSync(join(out, k), text);
  return { days: index.length, latest: latest?.date ?? null, files: Object.keys(files).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const source = arg("--source") ?? process.env.TRADERHOME_DAILY_SOURCE ?? DEFAULT_SOURCE;
  if (process.argv.includes("--stamp")) { console.log(sourceStamp(source)); process.exit(0); }
  const result = exportPublic({ source, out: arg("--out") ?? DEFAULT_OUT });
  console.log(`daily-trade export: ${result.days} days, latest ${result.latest}, ${result.files} files`);
}
