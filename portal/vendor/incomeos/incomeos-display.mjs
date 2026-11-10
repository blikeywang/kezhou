// Display helpers for IncomeOS: how a snapshot's edition, times and data gaps are worded on the page.
// Pure functions, no DOM and no calculations — the model lives in incomeos-engine.mjs and the
// publication rules in tools/incomeos/. Nothing here can make a snapshot executable.

// A research edition is published by hand after the automatic source-time checks fail
// (tools/incomeos/research-publication.mjs). It shows the model's output and never an order.
export const isResearch = (data) => data?.publicationMode === "research_partial";

const pad = (value) => String(value).padStart(2, "0");

// "11-10 13:32" on the visitor's clock — for "when was this generated".
export function localStamp(value) {
  const time = new Date(value);
  if (!value || !Number.isFinite(time.getTime())) return null;
  return `${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

// "11-09 16:00 美东" — market data is dated on the exchange's clock.
export function marketStamp(value) {
  const time = new Date(value);
  if (!value || !Number.isFinite(time.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(time).map((part) => [part.type, part.value]));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute} 美东`;
}

export function optionLegs(data) {
  return (data?.options ?? []).flatMap((row) => ["call", "put"].filter((side) => row[side]).map((side) => ({ ticker: row.ticker, side, leg: row[side] })));
}

// How many quotes and order-book depths carry no source time.
export function sourceGaps(data) {
  const assets = data?.assets ?? [];
  const legs = optionLegs(data);
  return {
    assets: assets.length,
    quotesMissing: assets.filter((asset) => !asset.sourceTimestamp).length,
    legs: legs.length,
    optionQuotesMissing: legs.filter(({ leg }) => !leg.quoteTimestamp).length,
    depthMissing: legs.filter(({ leg }) => !leg.depthTimestamp).length,
  };
}

// The single notice in the page header. Every non-executable case says "不可执行" in its label.
export function snapshotNotice(data, { executionAllowed, now = new Date() } = {}) {
  if (isResearch(data)) {
    const gaps = sourceGaps(data);
    const missing = [
      gaps.quotesMissing ? `${gaps.quotesMissing} 只标的的报价` : null,
      gaps.depthMissing ? `${gaps.depthMissing} 条期权盘口` : null,
    ].filter(Boolean);
    const why = missing.length
      ? `${missing.join("和")}没有来源时间，无法确认是不是最新行情`
      : "这份快照没有通过来源时间检查";
    const generated = localStamp(data.asOf);
    return {
      level: "research",
      tone: "info",
      label: "研究版 · 不可执行",
      short: "研究版 · 不可执行",
      detail: `按 ${data.tradingDate} 收盘后的数据计算${generated ? `，${generated} 生成（你的本地时间；生成时间不是行情的来源时间）` : ""}。${why}，所以本页只展示模型结果，不生成订单；逐项见“数据室”。历史操作单也不代表当前建议。`,
    };
  }
  const ageHours = Math.max(0, (now - new Date(data.asOf)) / 3_600_000);
  if (!(ageHours <= 72)) {
    const age = !Number.isFinite(ageHours) ? "未知时长" : ageHours >= 48 ? `${Math.floor(ageHours / 24)} 天` : `${Math.round(ageHours)} 小时`;
    return { level: "stale", tone: "stop", label: "已过期 · 旧快照 · 不可执行", short: "快照已过期", detail: `已 ${age}未更新（超过 72 小时），只用于回看，不生成订单。` };
  }
  if (!executionAllowed) {
    return { level: "partial", tone: "warn", label: "部分数据 · 不可执行", short: "部分数据 · 不可执行", detail: "这份快照没有通过发布检查，本页不生成订单；缺了什么见“数据室”。" };
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((part) => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (parts.weekday === "Fri" && minutes >= 600 && minutes < 960 && ageHours <= 24) {
    return { level: "review", tone: "ok", label: "周五复核窗口", short: "数据完整", detail: "周五执行窗口；仍需在 IBKR 复核现金、持仓和限价。" };
  }
  return { level: "preview", tone: "quiet", label: "预览 · 最新可得快照", short: data.mode === "live" ? "数据完整" : "部分数据", detail: "非周五 10:00 ET 执行窗口；本页先生成预案。" };
}

// One line above the ranking table instead of the same "unknown" on every row.
// perRow tells the table whether rows differ and need their own time.
export function quoteTimeNote(rows) {
  const known = rows.filter((asset) => asset.sourceTimestamp);
  if (!rows.length) return { text: "", perRow: false };
  if (!known.length) return { text: `表中 ${rows.length} 只的报价都没有来源时间（行情源没有提供），不能当作实时价格。`, perRow: false };
  if (known.length === rows.length) {
    const times = known.map((asset) => asset.sourceTimestamp).sort();
    const first = marketStamp(times[0]), last = marketStamp(times.at(-1));
    return { text: first === last ? `报价来源时间：${first}。` : `报价来源时间：${first} 至 ${last}。`, perRow: false };
  }
  return { text: `${rows.length - known.length} 只的报价没有来源时间，已在“状态”一栏逐个标出。`, perRow: true };
}

// Same idea for an option table: quotes keep their own time per row; a uniformly missing depth time is said once.
export function optionTimeNote(legs) {
  if (!legs.length) return { text: "", depthPerRow: false };
  const depthKnown = legs.filter((leg) => leg.depthTimestamp).length;
  const quoteKnown = legs.filter((leg) => leg.quoteTimestamp).length;
  const quotePart = quoteKnown === legs.length ? "每行标出报价的来源时间" : quoteKnown ? `${legs.length - quoteKnown} 个合约的报价没有来源时间` : "报价都没有来源时间";
  if (!depthKnown) return { text: `${quotePart}；${legs.length} 个合约的盘口（买卖挂单）都没有来源时间，Bid / Ask 和价差只能当作参考。`, depthPerRow: false };
  if (depthKnown === legs.length) return { text: `${quotePart}和盘口时间。`, depthPerRow: true };
  return { text: `${quotePart}；${legs.length - depthKnown} 个合约的盘口没有来源时间，已逐行标出。`, depthPerRow: true };
}

export function optionRowTimes(leg, { depthPerRow }) {
  const quote = marketStamp(leg.quoteTimestamp);
  const parts = [quote ? `报价 ${quote}` : "报价时间未知"];
  if (depthPerRow) parts.push(leg.depthTimestamp ? `盘口 ${marketStamp(leg.depthTimestamp)}` : "盘口时间未知");
  return parts.join(" · ");
}

const FIELD_LABELS = { quote: "报价", depth: "期权盘口", consensus: "分析师一致预期", forecast: "盈利预测", financial: "财报数据" };
const MESSAGE_LABELS = [
  [/source timestamp unavailable/i, "没有来源时间，无法确认是不是最新的"],
  [/source request failed after retries/i, "多次请求行情源仍然失败"],
  [/missing fundamentals/i, "缺少基本面数据"],
  [/future/i, "来源时间在未来，数据异常"],
  [/stale|expired|too old/i, "来源时间过旧"],
];
const messageLabel = (message) => MESSAGE_LABELS.find(([pattern]) => pattern.test(message))?.[1] ?? message;

// Turn the per-symbol check messages ("SPY: quote: …", "LLY.US call depth: …") into a few grouped
// facts. The same problem reported by two checks (research + publication) counts once per subject.
export function groupIssues(messages) {
  const groups = new Map();
  for (const raw of messages ?? []) {
    const text = String(raw);
    const match = text.match(/^([A-Z][A-Z0-9.]*?)(?:\.US)?(?:\s+(call|put)\s+(depth|quote))?:\s*(?:([a-z]+):\s*)?(.+)$/);
    let key, title, subject;
    if (match) {
      const [, ticker, side, optionField, field, message] = match;
      const kind = optionField ?? field ?? "quote";
      subject = side ? `${ticker} ${side === "call" ? "Call" : "Put"}` : ticker;
      title = `${FIELD_LABELS[kind] ?? kind}：${messageLabel(message)}`;
      key = `${kind}|${message}`;
    } else {
      key = text; title = text; subject = null;
    }
    const group = groups.get(key) ?? { title, subjects: new Set() };
    if (subject) group.subjects.add(subject);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ title: group.title, subjects: [...group.subjects] }))
    .sort((left, right) => right.subjects.length - left.subjects.length);
}

export function sourceStatusLabel(status) {
  return ({ unknown: "未知", observed_not_execution_verified: "有来源时间，未做执行级核对", stale_or_invalid: "过旧或无效" })[status] ?? "未核实";
}

// dot's snapshot explains its time fields in English; the page says the same in Chinese.
const TIME_POLICY = {
  generation: "“生成于”是计算完成的时间，不是行情的来源时间。",
  reference: "“参考交易日”是 SPY 最近一个已收盘的交易日，不代表每只标的的报价都来自那天。",
  execution: "报价和盘口的时间必须由行情源给出；不会用抓取时间代替。",
  history: "月线可能包含还没走完的当月；“历史数据截至”单独列出。",
  financial: "财报按报告期记录，没有核对它的发布时间。",
  market: "市场温度的发布时间未知。",
};
export function timePolicyLines(policy) {
  return Object.keys(TIME_POLICY).filter((key) => policy && key in policy).map((key) => TIME_POLICY[key]);
}
