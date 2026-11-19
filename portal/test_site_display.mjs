// Display-layer tests: how editions, times and data gaps are worded on the pages.
// These never touch the engines; they guard that a non-executable snapshot always says so,
// and that summarising the data-quality messages loses none of them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  groupIssues,
  isResearch,
  localStamp,
  marketStamp,
  optionRowTimes,
  optionTimeNote,
  quoteTimeNote,
  snapshotNotice,
  sourceGaps,
  sourceStatusLabel,
  timePolicyLines,
} from "./vendor/incomeos/incomeos-display.mjs";
import {
  auditBlocks,
  auditSampleWording,
  comparisonNote,
  dayKind,
  gapBetween,
  gapFromContext,
  newestScheduled,
} from "./vendor/tailtrend/tailtrend-display.mjs";

const published = JSON.parse(readFileSync(new URL("./vendor/incomeos/data/incomeos-full.json", import.meta.url), "utf8"));
const readTailTrend = (name) => JSON.parse(readFileSync(new URL(`./vendor/tailtrend/data/${name}`, import.meta.url), "utf8"));

function researchSnapshot(overrides = {}) {
  return {
    asOf: "2026-11-10T05:32:21.593Z",
    tradingDate: "2026-11-09",
    mode: "partial",
    publicationMode: "research_partial",
    executionAllowed: false,
    assets: [{ ticker: "SPY", sourceTimestamp: null }, { ticker: "QQQ", sourceTimestamp: null }],
    options: [{ ticker: "SPY", call: { quoteTimestamp: "2026-11-09T21:00:00.000Z", depthTimestamp: null }, put: { quoteTimestamp: "2026-11-09T21:15:00.000Z", depthTimestamp: null } }],
    ...overrides,
  };
}

test("a research snapshot is announced as non-executable, with the reason and readable times", () => {
  const notice = snapshotNotice(researchSnapshot(), { executionAllowed: false, now: new Date("2026-11-10T06:00:00Z") });
  assert.equal(notice.level, "research");
  assert.match(notice.label, /研究版/);
  assert.match(notice.label, /不可执行/);
  assert.match(notice.detail, /2 只标的的报价和2 条期权盘口没有来源时间/);
  assert.match(notice.detail, /不生成订单/);
  assert.match(notice.detail, /生成时间不是行情的来源时间/);
  assert.doesNotMatch(notice.detail, /\d{4}-\d{2}-\d{2}T\d{2}/, "no raw ISO timestamps on the page");
  assert.doesNotMatch(notice.label + notice.detail, /PARTIAL/);
});

test("every snapshot that cannot produce orders says 不可执行; an executable one does not", () => {
  const now = new Date("2026-11-10T15:00:00Z"); // Tuesday
  const live = { asOf: "2026-11-10T14:00:00Z", tradingDate: "2026-11-09", mode: "live", assets: [], options: [] };
  assert.match(snapshotNotice({ ...live, asOf: "2026-11-01T14:00:00Z" }, { executionAllowed: false, now }).label, /已过期.*不可执行/);
  assert.match(snapshotNotice({ ...live, mode: "partial" }, { executionAllowed: false, now }).label, /部分数据.*不可执行/);
  assert.match(snapshotNotice({ ...live, asOf: "not a date" }, { executionAllowed: false, now }).label, /不可执行/);
  const preview = snapshotNotice(live, { executionAllowed: true, now });
  assert.equal(preview.level, "preview");
  assert.doesNotMatch(preview.label, /不可执行/);
  const friday = snapshotNotice({ ...live, asOf: "2026-11-13T14:30:00Z" }, { executionAllowed: true, now: new Date("2026-11-13T15:30:00Z") });
  assert.equal(friday.level, "review");
  // A research edition stays a research edition no matter what the caller claims.
  assert.equal(snapshotNotice(researchSnapshot(), { executionAllowed: true, now }).level, "research");
});

test("times are shown on a named clock, never as raw ISO strings", () => {
  assert.equal(marketStamp("2026-11-09T21:00:00.000Z"), "11-09 16:00 美东");
  assert.equal(marketStamp("2026-07-01T20:00:00.000Z"), "07-01 16:00 美东", "daylight time is handled by the zone, not a fixed offset");
  assert.equal(marketStamp(null), null);
  assert.equal(marketStamp("garbage"), null);
  assert.match(localStamp("2026-11-10T05:32:21.593Z"), /^\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(localStamp(undefined), null);
});

test("source-time notes say a uniform fact once and flag rows only when they differ", () => {
  const unknown = [{ sourceTimestamp: null }, { sourceTimestamp: null }];
  assert.deepEqual(quoteTimeNote(unknown), { text: "表中 2 只的报价都没有来源时间（行情源没有提供），不能当作实时价格。", perRow: false });
  const mixed = quoteTimeNote([{ sourceTimestamp: "2026-11-09T21:00:00Z" }, { sourceTimestamp: null }]);
  assert.equal(mixed.perRow, true);
  assert.match(mixed.text, /1 只的报价没有来源时间/);
  const known = quoteTimeNote([{ sourceTimestamp: "2026-11-09T21:00:00Z" }, { sourceTimestamp: "2026-11-09T21:15:00Z" }]);
  assert.equal(known.perRow, false);
  assert.match(known.text, /11-09 16:00 美东 至 11-09 16:15 美东/);
  assert.deepEqual(quoteTimeNote([]), { text: "", perRow: false });

  const legs = [{ quoteTimestamp: "2026-11-09T21:00:00Z", depthTimestamp: null }, { quoteTimestamp: "2026-11-09T21:15:00Z", depthTimestamp: null }];
  const note = optionTimeNote(legs);
  assert.equal(note.depthPerRow, false);
  assert.match(note.text, /2 个合约的盘口（买卖挂单）都没有来源时间/);
  assert.equal(optionRowTimes(legs[0], note), "报价 11-09 16:00 美东");
  const partial = optionTimeNote([{ quoteTimestamp: null, depthTimestamp: "2026-11-09T21:00:00Z" }, { quoteTimestamp: null, depthTimestamp: null }]);
  assert.equal(partial.depthPerRow, true);
  assert.equal(optionRowTimes({ quoteTimestamp: null, depthTimestamp: null }, partial), "报价时间未知 · 盘口时间未知");
});

test("grouping the check messages keeps every subject and merges the same problem from two checks", () => {
  const groups = groupIssues([
    "SPY: quote: source timestamp unavailable; freshness unverified",
    "QQQ: quote: source timestamp unavailable; freshness unverified",
    "SPY.US: source timestamp unavailable; freshness unverified",
    "LLY.US call depth: source timestamp unavailable; freshness unverified",
    "LLY.US put depth: source timestamp unavailable; freshness unverified",
    "MSFT: consensus: source request failed after retries",
    "UNH: financial: missing fundamentals",
    "something the parser has never seen",
  ]);
  const byTitle = Object.fromEntries(groups.map((group) => [group.title, group.subjects]));
  assert.deepEqual(byTitle["报价：没有来源时间，无法确认是不是最新的"], ["SPY", "QQQ"]);
  assert.deepEqual(byTitle["期权盘口：没有来源时间，无法确认是不是最新的"], ["LLY Call", "LLY Put"]);
  assert.deepEqual(byTitle["分析师一致预期：多次请求行情源仍然失败"], ["MSFT"]);
  assert.deepEqual(byTitle["财报数据：缺少基本面数据"], ["UNH"]);
  assert.deepEqual(byTitle["something the parser has never seen"], [], "unknown messages are shown verbatim, not dropped");
  assert.equal(groups[0].subjects.length >= groups.at(-1).subjects.length, true, "largest group first");
});

// Runs against whatever snapshot is currently published. It only checks that the summary loses
// nothing and that a research edition is labelled — it makes no assumption about which checks
// the data pipeline reports, so a new message format can never block a publish from here.
test("the published snapshot's quality messages are all accounted for after grouping", () => {
  const quality = published.dataQuality ?? {};
  const optionErrors = published.optionDataQuality?.errors;
  const messages = [...(quality.errors ?? []), ...(quality.publicationErrors ?? []), ...(Array.isArray(optionErrors) ? optionErrors : [])].map(String);
  const groups = groupIssues(messages);
  assert.ok(groups.length <= Math.max(1, messages.length), "never more groups than messages");
  for (const message of messages) {
    const ticker = message.match(/^([A-Z][A-Z0-9.]*?)(?:\.US)?[\s:]/)?.[1];
    const found = groups.some((group) => group.title === message || group.subjects.some((subject) => subject === ticker || subject.startsWith(`${ticker} `)));
    assert.ok(found, `lost: ${message}`);
  }
  if (isResearch(published)) {
    assert.ok(sourceGaps(published).quotesMissing <= (published.assets ?? []).length);
    const notice = snapshotNotice(published, { executionAllowed: false });
    assert.match(notice.label, /研究版.*不可执行/);
    assert.match(notice.detail, /不生成订单/);
  }
});

test("status and policy labels are Chinese and total", () => {
  assert.equal(sourceStatusLabel("unknown"), "未知");
  assert.equal(sourceStatusLabel("observed_not_execution_verified"), "有来源时间，未做执行级核对");
  assert.equal(sourceStatusLabel("stale_or_invalid"), "过旧或无效");
  assert.equal(sourceStatusLabel(undefined), "未核实");
  assert.equal(timePolicyLines(undefined).length, 0);
  assert.equal(timePolicyLines({ generation: "x", reference: "y", unknownKey: "z" }).length, 2);
  for (const line of timePolicyLines(published.sourceTimePolicy)) assert.match(line, /[一-鿿]/);
});

// ---- TailTrend: the run calendar (which days have a snapshot, which are off the schedule) ----

// Newest first, as in index.json: a weekly run, three days off the schedule, the run before it,
// two missed runs, and the first snapshot.
const weeklyIndex = [
  { dataAsOf: "2026-11-13", status: "COMPLETE", transitions: [{ symbol: "SPY", from: "A", to: "B" }] },
  { dataAsOf: "2026-11-12", status: "NOT_SCHEDULED", transitions: [] },
  { dataAsOf: "2026-11-11", status: "NOT_SCHEDULED", transitions: [] },
  { dataAsOf: "2026-11-10", status: "NOT_SCHEDULED", transitions: [] },
  { dataAsOf: "2026-11-09", status: "COMPLETE", transitions: [] },
  { dataAsOf: "2026-11-06", status: "MISSING", transitions: [] },
  { dataAsOf: "2026-11-05", status: "MISSING", transitions: [] },
  { dataAsOf: "2026-11-04", status: "COMPLETE", transitions: [] },
];

test("days off the weekly schedule are one planned block, never a run with 0 changes", () => {
  const blocks = auditBlocks(weeklyIndex);
  assert.deepEqual(blocks.map((block) => block.kind), ["run", "planned", "run", "missing", "run"]);
  assert.deepEqual(blocks[1], { kind: "planned", from: "2026-11-10", to: "2026-11-12", count: 3 });
  assert.deepEqual(blocks[3], { kind: "missing", from: "2026-11-05", to: "2026-11-06", count: 2 });
  for (const block of blocks.filter((item) => item.kind === "run")) {
    assert.equal(dayKind(weeklyIndex.find((entry) => entry.dataAsOf === block.date)), "run");
  }
});

test("a run is compared with the previous published snapshot, not with a day that has none", () => {
  const [latest, , earlier, , first] = auditBlocks(weeklyIndex);
  assert.equal(latest.previous, "2026-11-09");
  assert.equal(comparisonNote(latest.previous, latest.gap), "与上一份快照（2026-11-09）相比；每周一份");
  assert.equal(earlier.previous, "2026-11-04");
  assert.equal(comparisonNote(earlier.previous, earlier.gap), "与上一份快照（2026-11-04）相比；中间 2 个交易日没有运行");
  assert.equal(first.previous, null);
  assert.equal(comparisonNote(first.previous, first.gap), "这是第一份快照，没有可比的上一份");
  assert.equal(comparisonNote("2026-11-12", { missing: 0, planned: 0 }), "与上一份快照（2026-11-12）相比");
});

test("a missed weekly run is said as missed even when the days around it are off the schedule", () => {
  const index = [
    { dataAsOf: "2026-11-27", status: "COMPLETE" },
    { dataAsOf: "2026-11-25", status: "NOT_SCHEDULED" },
    { dataAsOf: "2026-11-24", status: "NOT_SCHEDULED" },
    { dataAsOf: "2026-11-23", status: "NOT_SCHEDULED" },
    { dataAsOf: "2026-11-20", status: "MISSING" },
    { dataAsOf: "2026-11-19", status: "NOT_SCHEDULED" },
    { dataAsOf: "2026-11-13", status: "COMPLETE" },
  ];
  assert.deepEqual(gapBetween(index, "2026-11-13", "2026-11-27"), { missing: 1, planned: 4 });
  const blocks = auditBlocks(index);
  assert.deepEqual(blocks.map((block) => `${block.kind}:${block.count ?? ""}`), ["run:", "planned:3", "missing:1", "planned:1", "run:"]);
  assert.match(comparisonNote(blocks[0].previous, blocks[0].gap), /中间有 1 个应运行的交易日没有运行/);
  // A missed day on top of the index is the newest scheduled day; a day off the schedule is not.
  assert.equal(newestScheduled([{ dataAsOf: "2026-12-01", status: "NOT_SCHEDULED" }, ...index]).dataAsOf, "2026-11-27");
  assert.equal(newestScheduled([{ dataAsOf: "2026-12-04", status: "MISSING" }, ...index]).status, "MISSING");
});

test("the snapshot's own gap statement is used only for the comparison it describes", () => {
  const context = { previousObservationDate: "2026-11-09", plannedNonRunSessions: 3, missingScheduledSessions: 0 };
  assert.deepEqual(gapFromContext(context, "2026-11-09"), { missing: 0, planned: 3 });
  assert.equal(gapFromContext(context, "2026-11-06"), null);
  assert.equal(gapFromContext(undefined, "2026-11-09"), null);
  assert.equal(gapFromContext({ previousObservationDate: "2026-11-09" }, "2026-11-09"), null);
});

test("the audit counts observations on the weekly rhythm and trading days otherwise", () => {
  const weekly = auditSampleWording({ sampleUnit: "signal_observation" });
  assert.equal(weekly.progress(1), "1/10 期观察");
  assert.equal(weekly.progress(14), "10/10 期观察");
  assert.equal(weekly.note, "先积累 5–10 期同版本观察，再看结果");
  assert.doesNotMatch(weekly.label + weekly.note, /交易日|天/);
  assert.equal(auditSampleWording({ schedule: { sampleUnit: "signal_observation" } }).label, weekly.label);
  const daily = auditSampleWording({ daysCollected: 2 });
  assert.equal(daily.progress(2), "2/10 个交易日");
  assert.match(daily.note, /5–10 天/);
});

// Runs against whatever index is currently published. It only checks that the list loses no day
// and never presents a day without a snapshot as a run — no assumption about which days exist,
// so a new refresh can never block a publish from here.
test("the published TailTrend index: every day is in exactly one block, and only runs read as runs", () => {
  const entries = readTailTrend("index.json").entries ?? [];
  const blocks = auditBlocks(entries, { limit: Infinity });
  const covered = blocks.reduce((sum, block) => sum + (block.kind === "run" ? 1 : block.count), 0);
  assert.equal(covered, entries.length);
  const runDates = new Set(entries.filter((entry) => dayKind(entry) === "run").map((entry) => entry.dataAsOf));
  for (const block of blocks) {
    if (block.kind !== "run") { assert.ok(block.from <= block.to); continue; }
    assert.ok(runDates.has(block.date), `${block.date} has no snapshot`);
    if (block.previous) {
      assert.ok(runDates.has(block.previous), `${block.date} is compared with ${block.previous}, which has no snapshot`);
      assert.match(comparisonNote(block.previous, block.gap), new RegExp(`^与上一份快照（${block.previous}）相比`));
    }
  }
  const newest = newestScheduled(entries);
  if (entries.length) assert.notEqual(dayKind(newest ?? entries[0]), "planned", "a day off the schedule is never the newest result");
  const sample = auditSampleWording(readTailTrend("tailtrend-audit.json"));
  for (const text of [sample.label, sample.note, sample.progress(1)]) assert.match(text, /[一-鿿]/);
});
