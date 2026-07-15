const CASE_SCHEMA = "traderhome_case_packet_v1";
const FEEDBACK_SCHEMA = "traderhome_private_feedback_v1";
const MAX_SHARE_TEXT = 50000;

const finite = value => Number.isFinite(value);
const round = (value, digits = 4) => finite(value) ? Number(value.toFixed(digits)) : null;
const cleanText = (value, max = 800) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0");
}

function normalizedPrice(value, base, revealPrice) {
  if (!finite(value)) return null;
  if (revealPrice || !finite(base) || base === 0) return round(value);
  return round(100 * value / base);
}

function compactBars(trade, revealPrice) {
  const source = (trade.marketBars || []).slice(-96);
  const base = finite(trade.entryPrice) && trade.entryPrice !== 0
    ? trade.entryPrice
    : source.find(bar => finite(bar.close) && bar.close !== 0)?.close;
  return source.map(bar => ({
    minute: Math.round((bar.time - trade.entryTime) / 60000),
    open: normalizedPrice(bar.open, base, revealPrice),
    high: normalizedPrice(bar.high, base, revealPrice),
    low: normalizedPrice(bar.low, base, revealPrice),
    close: normalizedPrice(bar.close, base, revealPrice),
  })).filter(bar => [bar.open, bar.high, bar.low, bar.close].every(finite));
}

export function createCasePacket({ trade, alias, question, visibility = {}, createdAt = new Date().toISOString() }) {
  if (!trade?.id || !trade?.side) throw new Error("请选择一笔有效交易后再生成会诊链接。");
  const revealPrice = Boolean(visibility.price);
  const revealTime = Boolean(visibility.time);
  const revealMoney = Boolean(visibility.money);
  const revealNotes = Boolean(visibility.notes);
  const entryBase = finite(trade.entryPrice) && trade.entryPrice !== 0 ? trade.entryPrice : null;
  const seed = `${trade.id}|${createdAt}|${alias}`;
  return {
    schema: CASE_SCHEMA,
    id: `CASE-${hashText(seed)}`,
    createdAt,
    author: cleanText(alias, 32) || "匿名战友",
    question: cleanText(question, 500) || "请帮我判断这笔交易的入场、管理与退出还能怎样改进。",
    privacy: {
      symbol: visibility.symbol !== false,
      time: revealTime,
      price: revealPrice,
      money: revealMoney,
      notes: revealNotes,
      transport: "URL fragment; not sent in the page request",
    },
    trade: {
      id: `TRADE-${hashText(`${trade.id}|${createdAt}`)}`,
      symbol: visibility.symbol === false ? "匿名品种" : cleanText(trade.symbol, 32),
      side: trade.side,
      strategy: cleanText(trade.strategy || "未标记", 80),
      entryTime: revealTime && finite(trade.entryTime) ? new Date(trade.entryTime).toISOString() : null,
      durationMinutes: finite(trade.durationMinutes) ? round(trade.durationMinutes, 0) : null,
      entry: normalizedPrice(trade.entryPrice, entryBase, revealPrice),
      exit: normalizedPrice(trade.exitPrice, entryBase, revealPrice),
      stop: normalizedPrice(trade.stop, entryBase, revealPrice),
      target: normalizedPrice(trade.target, entryBase, revealPrice),
      rMultiple: finite(trade.rMultiple) ? round(trade.rMultiple, 2) : null,
      mfeR: finite(trade.mfeR) ? round(trade.mfeR, 2) : null,
      maeR: finite(trade.maeR) ? round(trade.maeR, 2) : null,
      netPnl: revealMoney && finite(trade.netPnl) ? round(trade.netPnl, 2) : null,
      currency: revealMoney ? cleanText(trade.currency, 12) : null,
      notes: revealNotes ? cleanText(trade.notes, 1000) : null,
    },
    chart: {
      priceMode: revealPrice ? "exact" : "entry_normalized_to_100",
      bars: compactBars(trade, revealPrice),
    },
    publicFeedback: [],
  };
}

export function createFeedbackPacket({ casePacket, alias, stance, thesis, evidence, plan, createdAt = new Date().toISOString() }) {
  const validCase = validateCasePacket(casePacket);
  const cleanThesis = cleanText(thesis, 800);
  const cleanPlan = cleanText(plan, 800);
  if (!cleanThesis || !cleanPlan) throw new Error("请至少写清你的判断和可执行改法。");
  const normalizedStance = ["agree", "caution", "oppose"].includes(stance) ? stance : "caution";
  const author = cleanText(alias, 32) || "匿名战友";
  return {
    schema: FEEDBACK_SCHEMA,
    id: `VIEW-${hashText(`${validCase.id}|${createdAt}|${author}|${cleanThesis}`)}`,
    caseId: validCase.id,
    createdAt,
    author,
    stance: normalizedStance,
    thesis: cleanThesis,
    evidence: cleanText(evidence, 800),
    plan: cleanPlan,
    visibility: "private_until_owner_selects",
  };
}

export function createPublicCase(casePacket, feedbacks, selectedIds, publishedAt = new Date().toISOString()) {
  const validCase = validateCasePacket(casePacket);
  const selected = new Set(selectedIds || []);
  const publicFeedback = (feedbacks || [])
    .map(validateFeedbackPacket)
    .filter(item => item.caseId === validCase.id && selected.has(item.id))
    .map(({ schema, visibility, ...item }) => ({ ...item, visibility: "owner_selected_public" }));
  return { ...validCase, publishedAt, publicFeedback };
}

export function validateCasePacket(value) {
  if (!value || value.schema !== CASE_SCHEMA || !cleanText(value.id, 80) || !value.trade) throw new Error("这不是有效的 TraderHome 会诊链接。");
  if (!Array.isArray(value.chart?.bars) || value.chart.bars.length > 96) throw new Error("会诊K线内容无效或过大。");
  return value;
}

export function validateFeedbackPacket(value) {
  if (!value || value.schema !== FEEDBACK_SCHEMA || !cleanText(value.id, 80) || !cleanText(value.caseId, 80)) throw new Error("这不是有效的私评链接。");
  return value;
}

export function encodeSharePayload(value) {
  const text = JSON.stringify(value);
  if (text.length > MAX_SHARE_TEXT) throw new Error("会诊内容过大，请减少K线或公开字段后重试。");
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function decodeSharePayload(encoded) {
  if (!encoded || encoded.length > MAX_SHARE_TEXT * 2) throw new Error("分享链接为空或过大。");
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (value?.schema === CASE_SCHEMA) return validateCasePacket(value);
  if (value?.schema === FEEDBACK_SCHEMA) return validateFeedbackPacket(value);
  throw new Error("分享内容版本不受支持。");
}

export const COMMUNITY_SCHEMAS = { case: CASE_SCHEMA, feedback: FEEDBACK_SCHEMA };
