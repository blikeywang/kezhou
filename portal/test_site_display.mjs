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

const published = JSON.parse(readFileSync(new URL("./vendor/incomeos/data/incomeos-full.json", import.meta.url), "utf8"));

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
