// Wording for the parts of the TailTrend page that describe the run calendar: which days have a
// snapshot, which were skipped on purpose, which were missed. Pure functions (no DOM, no engine),
// so portal/test_site_display.mjs can check them against the published index.
//
// The index gives every trading day one status (tools/tailtrend/README.md):
//   COMPLETE       a snapshot was published
//   MISSING        a scheduled run did not happen
//   NOT_SCHEDULED  weekly rhythm (from 2026-11-10): no run is planned for that day
// The page reads that status. It does not guess intent from the length of a gap.

export function dayKind(entry) {
  const status = String(entry?.status ?? "").toUpperCase();
  if (status === "MISSING") return "missing";
  if (status === "NOT_SCHEDULED") return "planned";
  return "run";
}

// The newest day a run was due. A day that is off the schedule never stands in for the latest
// result (same rule as the snapshot store uses for staleness).
export function newestScheduled(entries) {
  return (entries ?? []).find((entry) => dayKind(entry) !== "planned") ?? null;
}

// Trading days strictly between two data days, counted by kind.
export function gapBetween(entries, fromDate, toDate) {
  const gap = { missing: 0, planned: 0 };
  for (const entry of entries ?? []) {
    if (!(entry.dataAsOf > fromDate && entry.dataAsOf < toDate)) continue;
    const kind = dayKind(entry);
    if (kind !== "run") gap[kind] += 1;
  }
  return gap;
}

// A complete snapshot states its own gap (`observationContext`). Use it when it describes this
// comparison; otherwise the caller counts from the index.
export function gapFromContext(context, fromDate) {
  if (!context || !fromDate || context.previousObservationDate !== fromDate) return null;
  const planned = Number(context.plannedNonRunSessions);
  const missing = Number(context.missingScheduledSessions);
  return Number.isFinite(planned) && Number.isFinite(missing) ? { missing, planned } : null;
}

// "与上一份快照（2026-11-09）相比；每周一份": names what a run is compared with and what lies in
// between. A missed run is always said; days off the schedule only explain the rhythm.
export function comparisonNote(fromDate, gap) {
  if (!fromDate) return "这是第一份快照，没有可比的上一份";
  const base = `与上一份快照（${fromDate}）相比`;
  const missing = gap?.missing ?? 0;
  const planned = gap?.planned ?? 0;
  if (missing && planned) return `${base}；中间有 ${missing} 个应运行的交易日没有运行`;
  if (missing) return `${base}；中间 ${missing} 个交易日没有运行`;
  return planned ? `${base}；每周一份` : base;
}

// The run list under "事后验证", newest first. Days without a snapshot are folded into one block
// per stretch and kind, never shown as "0 changes"; each run names the run it is compared with,
// which is the previous published snapshot and not simply the previous day in the index.
export function auditBlocks(entries, { limit = 6 } = {}) {
  const list = entries ?? [];
  const blocks = [];
  for (let i = 0; i < list.length && blocks.length < limit; i += 1) {
    const kind = dayKind(list[i]);
    if (kind !== "run") {
      let j = i;
      while (j + 1 < list.length && dayKind(list[j + 1]) === kind) j += 1;
      blocks.push({ kind, from: list[j].dataAsOf, to: list[i].dataAsOf, count: j - i + 1 });
      i = j;
      continue;
    }
    const previous = list.slice(i + 1).find((entry) => dayKind(entry) === "run") ?? null;
    blocks.push({
      kind: "run",
      date: list[i].dataAsOf,
      transitions: list[i].transitions ?? [],
      previous: previous?.dataAsOf ?? null,
      gap: previous ? gapBetween(list, previous.dataAsOf, list[i].dataAsOf) : null,
    });
  }
  return blocks;
}

// What the audit ledger counts. The ledger says so itself (`sampleUnit`): on the weekly rhythm one
// sample is one published observation, not one trading day. The forward horizons (1/3/5/10) stay
// trading days and are worded in the page's static text.
export function auditSampleWording(ledger) {
  const unit = ledger?.sampleUnit ?? ledger?.schedule?.sampleUnit;
  if (unit === "signal_observation") {
    return {
      progress: (count) => `${Math.min(count, 10)}/10 期观察`,
      label: "已积累的观察期数",
      note: "先积累 5–10 期同版本观察，再看结果",
    };
  }
  return {
    progress: (count) => `${Math.min(count, 10)}/10 个交易日`,
    label: "已运行的交易日",
    note: "先积累 5–10 天再看结果",
  };
}
