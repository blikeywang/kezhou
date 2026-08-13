const DAY_MS = 86_400_000;

export const TAILTREND_CONFIG = Object.freeze({
  schema: "traderhome_tailtrend_snapshot_v1",
  version: "0.1.0",
  tailLookback: 60,
  tailFraction: 0.20,
  atrPeriod: 20,
  hvPeriod: 20,
  hvRankLookback: 252,
  breakoutBufferAtr: 0.25,
  breakoutHoldCloses: 2,
  breakoutHoldWindow: 3,
  maximumTrendExtensionAtr: 1.0,
  gapQuarantineAtr: 1.5,
  eventQuarantineCalendarDays: 2,
});

export const STATE_META = Object.freeze({
  OBSERVE: {
    bucket: "EDGE_OBSERVE",
    label: "资料不足",
    action: "补齐数据后再判断",
    newPositionAllowed: false,
  },
  LOWER_TAIL_FALLING: {
    bucket: "EDGE_OBSERVE",
    label: "下沿仍在下落",
    action: "只观察，不接飞刀",
    newPositionAllowed: false,
  },
  LOWER_TAIL_RECLAIMED: {
    bucket: "TAIL_RECLAIM_WATCH",
    label: "下沿收复",
    action: "尾部核心多头候选",
    newPositionAllowed: true,
    riskModule: "tail_core",
  },
  RANGE_MIDDLE: {
    bucket: "NO_TRADE_MIDDLE",
    label: "区间中部",
    action: "不开新仓",
    newPositionAllowed: false,
  },
  UPPER_TAIL_DECISION: {
    bucket: "EDGE_OBSERVE",
    label: "上沿决策区",
    action: "兑现核心仓，等待突破或拒绝",
    newPositionAllowed: false,
  },
  BREAKOUT_CANDIDATE: {
    bucket: "TREND_ACCEPTANCE_WATCH",
    label: "突破候选",
    action: "等待日线接受，不追完整仓位",
    newPositionAllowed: false,
  },
  TREND_ACCEPTED: {
    bucket: "TREND_ACCEPTANCE_WATCH",
    label: "趋势已接受",
    action: "纯趋势仓候选；过度伸展则等待",
    newPositionAllowed: true,
    riskModule: "pure_trend",
  },
  BREAKOUT_FAILED: {
    bucket: "BREAKOUT_FAILURE_WATCH",
    label: "突破失败",
    action: "退出趋势袖套，另行评估反转",
    newPositionAllowed: false,
  },
  UPPER_TAIL_REJECTED: {
    bucket: "BREAKOUT_FAILURE_WATCH",
    label: "上沿拒绝",
    action: "仅美股进入独立小风险做空复核",
    newPositionAllowed: true,
    riskModule: "us_short",
  },
  LOWER_TAIL_BREAKDOWN: {
    bucket: "BREAKDOWN_RISK",
    label: "下沿破位",
    action: "先处理多头；美股另评估趋势空头",
    newPositionAllowed: true,
    riskModule: "us_short",
  },
  DOWNTREND_COVER_ZONE: {
    bucket: "EDGE_OBSERVE",
    label: "空头回补区",
    action: "空头减仓，等待下沿收复",
    newPositionAllowed: false,
  },
  EVENT_QUARANTINE: {
    bucket: "EVENT_QUARANTINE",
    label: "事件隔离",
    action: "普通 ATR 仓位公式停用",
    newPositionAllowed: false,
  },
});

export const BUCKET_META = Object.freeze({
  TAIL_RECLAIM_WATCH: { label: "下沿收复", tone: "positive" },
  TREND_ACCEPTANCE_WATCH: { label: "趋势接受", tone: "trend" },
  BREAKOUT_FAILURE_WATCH: { label: "突破失败 / 上沿拒绝", tone: "negative" },
  BREAKDOWN_RISK: { label: "下沿破位", tone: "danger" },
  EVENT_QUARANTINE: { label: "事件隔离", tone: "event" },
  EDGE_OBSERVE: { label: "边缘观察", tone: "watch" },
  NO_TRADE_MIDDLE: { label: "中部不交易", tone: "muted" },
});

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function standardDeviation(values) {
  const avg = mean(values);
  if (!Number.isFinite(avg) || values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function dateOnly(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value);
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function normalizeBars(rows) {
  if (!Array.isArray(rows)) return [];
  const byDate = new Map();
  for (const row of rows) {
    const date = dateOnly(row?.time ?? row?.date ?? row?.timestamp);
    const open = finite(row?.open);
    const high = finite(row?.high);
    const low = finite(row?.low);
    const close = finite(row?.close);
    if (!date || ![open, high, low, close].every(Number.isFinite) || close <= 0 || high < low) continue;
    byDate.set(date, {
      date,
      open,
      high,
      low,
      close,
      volume: finite(row?.volume),
      turnover: finite(row?.turnover),
    });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function trueRangeSeries(rows) {
  const bars = normalizeBars(rows);
  return bars.map((bar, index) => {
    if (index === 0) return bar.high - bar.low;
    const previousClose = bars[index - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
}

export function wilderAtrSeries(rows, period = TAILTREND_CONFIG.atrPeriod) {
  const bars = normalizeBars(rows);
  const ranges = trueRangeSeries(bars);
  const result = Array(bars.length).fill(null);
  if (ranges.length < period + 1) return result;
  let atr = mean(ranges.slice(1, period + 1));
  result[period] = atr;
  for (let index = period + 1; index < ranges.length; index += 1) {
    atr = (atr * (period - 1) + ranges[index]) / period;
    result[index] = atr;
  }
  return result;
}

function hvSeries(bars, period = TAILTREND_CONFIG.hvPeriod) {
  const returns = Array(bars.length).fill(null);
  for (let index = 1; index < bars.length; index += 1) {
    returns[index] = Math.log(bars[index].close / bars[index - 1].close);
  }
  const result = Array(bars.length).fill(null);
  for (let index = period; index < bars.length; index += 1) {
    const deviation = standardDeviation(returns.slice(index - period + 1, index + 1));
    result[index] = Number.isFinite(deviation) ? deviation * Math.sqrt(252) : null;
  }
  return result;
}

function percentileRank(value, values) {
  const valid = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!Number.isFinite(value) || !valid.length) return null;
  const less = valid.filter((item) => item < value).length;
  const equal = valid.filter((item) => item === value).length;
  return ((less + equal * 0.5) / valid.length) * 100;
}

function ema(values, period) {
  if (values.length < period) return [];
  const alpha = 2 / (period + 1);
  const output = Array(values.length).fill(null);
  let current = mean(values.slice(0, period));
  output[period - 1] = current;
  for (let index = period; index < values.length; index += 1) {
    current = values[index] * alpha + current * (1 - alpha);
    output[index] = current;
  }
  return output;
}

function isoWeekKey(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

export function weeklyRegime(rows) {
  const bars = normalizeBars(rows);
  const weeks = [];
  for (const bar of bars) {
    const key = isoWeekKey(bar.date);
    if (weeks.at(-1)?.key === key) weeks[weeks.length - 1] = { key, close: bar.close };
    else weeks.push({ key, close: bar.close });
  }
  if (weeks.length < 24) return "UNKNOWN";
  const closes = weeks.map((week) => week.close);
  const averages = ema(closes, 20);
  const latest = averages.at(-1);
  const prior = averages.at(-5);
  if (![latest, prior].every(Number.isFinite)) return "UNKNOWN";
  if (closes.at(-1) > latest && latest > prior) return "UP";
  if (closes.at(-1) < latest && latest < prior) return "DOWN";
  return "RANGE";
}

function tailMapAt(bars, index, lookback = TAILTREND_CONFIG.tailLookback) {
  if (index < lookback) return null;
  const history = bars.slice(index - lookback, index);
  const rangeHigh = Math.max(...history.map((bar) => bar.high));
  const rangeLow = Math.min(...history.map((bar) => bar.low));
  const width = rangeHigh - rangeLow;
  if (!Number.isFinite(width) || width <= 0) return null;
  return {
    rangeHigh,
    rangeLow,
    midpoint: rangeLow + width * 0.5,
    lowerTailTop: rangeLow + width * TAILTREND_CONFIG.tailFraction,
    upperTailBottom: rangeHigh - width * TAILTREND_CONFIG.tailFraction,
    width,
  };
}

function eventDistance(lastDate, eventDate) {
  if (!lastDate || !eventDate) return null;
  const last = new Date(`${lastDate}T00:00:00Z`);
  const event = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(last.getTime()) || Number.isNaN(event.getTime())) return null;
  return Math.round((event - last) / DAY_MS);
}

function recentBreakoutContext(bars, atrs, currentIndex) {
  const minimum = Math.max(TAILTREND_CONFIG.tailLookback, currentIndex - 5);
  let failure = null;
  let accepted = null;
  let candidate = null;
  for (let start = minimum; start <= currentIndex; start += 1) {
    const map = tailMapAt(bars, start);
    const atr = atrs[start];
    if (!map || !Number.isFinite(atr)) continue;
    const threshold = map.rangeHigh + TAILTREND_CONFIG.breakoutBufferAtr * atr;
    if (bars[start].close < threshold) continue;
    const elapsed = currentIndex - start;
    const closes = bars.slice(start, Math.min(currentIndex, start + TAILTREND_CONFIG.breakoutHoldWindow - 1) + 1);
    const holdCloses = closes.filter((bar) => bar.close > map.rangeHigh).length;
    const context = {
      start,
      boundary: map.rangeHigh,
      threshold,
      holdCloses,
      elapsed,
      extensionAtr: (bars[currentIndex].close - map.rangeHigh) / atrs[currentIndex],
    };
    if (currentIndex > start && bars[currentIndex].close <= map.rangeHigh) failure = context;
    else if (elapsed < TAILTREND_CONFIG.breakoutHoldWindow && holdCloses >= TAILTREND_CONFIG.breakoutHoldCloses) accepted = context;
    else if (start === currentIndex) candidate = context;
  }
  return { failure, accepted, candidate };
}

function recentBreakdown(bars, atrs, currentIndex, window = 20) {
  for (let index = currentIndex - 1; index >= Math.max(TAILTREND_CONFIG.tailLookback, currentIndex - window); index -= 1) {
    const map = tailMapAt(bars, index);
    const atr = atrs[index];
    if (map && Number.isFinite(atr) && bars[index].close <= map.rangeLow - TAILTREND_CONFIG.breakoutBufferAtr * atr) {
      return { index, boundary: map.rangeLow };
    }
  }
  return null;
}

function statePriority(state, context) {
  const weekly = context.weeklyRegime;
  const hv = context.hvPercentile ?? 50;
  const volume = context.volumeRatio ?? 1;
  let score = 0;
  if (state === "LOWER_TAIL_RECLAIMED") {
    score = 56 + (weekly === "UP" ? 16 : weekly === "RANGE" ? 8 : 0) + clamp(volume - 1, 0, 1.5) * 8;
  } else if (state === "TREND_ACCEPTED") {
    score = 62 + (weekly === "UP" ? 18 : 0) + Math.min(10, (context.breakout?.holdCloses ?? 0) * 5);
    if ((context.breakout?.extensionAtr ?? 0) > 1) score -= 22;
  } else if (state === "BREAKOUT_CANDIDATE") {
    score = 48 + (weekly === "UP" ? 15 : 0) + Math.min(9, volume * 4);
  } else if (state === "UPPER_TAIL_REJECTED" || state === "BREAKOUT_FAILED") {
    score = 55 + (weekly === "DOWN" ? 16 : weekly === "RANGE" ? 8 : 0);
  } else if (state === "LOWER_TAIL_BREAKDOWN") {
    score = 58 + (weekly === "DOWN" ? 18 : 0);
  } else if (state === "EVENT_QUARANTINE") {
    score = 100;
  } else if (state === "LOWER_TAIL_FALLING" || state === "UPPER_TAIL_DECISION" || state === "DOWNTREND_COVER_ZONE") {
    score = 35;
  }
  if (hv > 90 && state !== "EVENT_QUARANTINE") score -= 10;
  return Math.round(clamp(score, 0, 100));
}

function marketFromSymbol(symbol) {
  const suffix = String(symbol ?? "").split(".").at(-1)?.toUpperCase();
  return ["US", "HK", "SH", "SZ", "SG"].includes(suffix) ? suffix : "US";
}

function liquidityBand(turnover) {
  if (!Number.isFinite(turnover)) return "UNKNOWN";
  if (turnover >= 100_000_000) return "HIGH";
  if (turnover >= 20_000_000) return "MEDIUM";
  return "LOW";
}

function managementFor(state, map, bars, index, atr, breakout) {
  const current = bars[index];
  const tenDayExit = Math.min(...bars.slice(Math.max(0, index - 9), index + 1).map((bar) => bar.low));
  if (state === "LOWER_TAIL_RECLAIMED") {
    return {
      entryReference: current.close,
      hardStop: map.rangeLow - 0.25 * atr,
      firstZone: map.midpoint,
      secondZone: map.upperTailBottom,
      exitMethod: "中轴减25% · 上尾减50% · 余25%仅在趋势接受后继续",
    };
  }
  if (state === "TREND_ACCEPTED" || state === "BREAKOUT_CANDIDATE") {
    const boundary = breakout?.boundary ?? map.rangeHigh;
    const recentLow = Math.min(...bars.slice(Math.max(0, index - 2), index + 1).map((bar) => bar.low));
    return {
      entryReference: current.close,
      hardStop: Math.min(boundary, recentLow) - 0.25 * atr,
      firstZone: null,
      secondZone: null,
      trailingExit: tenDayExit,
      exitMethod: "日线收盘跌破10日低点退出；下一高周期尾部仅减仓1/3",
    };
  }
  if (state === "UPPER_TAIL_REJECTED") {
    return {
      entryReference: current.close,
      hardStop: Math.max(current.high, map.rangeHigh) + 0.25 * atr,
      firstZone: map.midpoint,
      secondZone: map.lowerTailTop,
      exitMethod: "仅美股且借券、事件与账户权限全部复核后才可研究",
    };
  }
  if (state === "LOWER_TAIL_BREAKDOWN") {
    return {
      entryReference: current.close,
      hardStop: map.rangeLow + 0.25 * atr,
      firstZone: null,
      secondZone: null,
      exitMethod: "先处理原多头；趋势空头只限美股独立复核",
    };
  }
  return {
    entryReference: current.close,
    hardStop: null,
    firstZone: map.midpoint,
    secondZone: null,
    exitMethod: STATE_META[state].action,
  };
}

export function analyzeBars(inputRows, options = {}) {
  const bars = normalizeBars(inputRows);
  const symbol = String(options.symbol ?? "UNKNOWN.US").toUpperCase();
  const market = options.market ?? marketFromSymbol(symbol);
  const minimumBars = TAILTREND_CONFIG.tailLookback + TAILTREND_CONFIG.atrPeriod + 5;
  if (bars.length < minimumBars) {
    return {
      symbol,
      ticker: symbol.split(".")[0],
      name: options.name ?? symbol,
      market,
      state: "OBSERVE",
      ...STATE_META.OBSERVE,
      priority: 0,
      dataStatus: "INSUFFICIENT",
      bars: bars.length,
      requiredBars: minimumBars,
      blockers: [`有效日线仅 ${bars.length} 根，至少需要 ${minimumBars} 根`],
    };
  }

  const index = bars.length - 1;
  const current = bars[index];
  const previous = bars[index - 1];
  const atrs = wilderAtrSeries(bars);
  const atr = atrs[index];
  const map = tailMapAt(bars, index);
  const hvs = hvSeries(bars);
  const hv = hvs[index];
  const hvHistory = hvs.slice(Math.max(0, index - TAILTREND_CONFIG.hvRankLookback + 1), index + 1);
  const hvPercentile = percentileRank(hv, hvHistory);
  const regime = weeklyRegime(bars);
  const gapAtr = Number.isFinite(atr) && atr > 0 ? Math.abs(current.open - previous.close) / atr : null;
  const daysToEvent = eventDistance(current.date, options.eventDate);
  const eventQuarantine = (Number.isFinite(gapAtr) && gapAtr > TAILTREND_CONFIG.gapQuarantineAtr)
    || (Number.isFinite(daysToEvent) && daysToEvent >= 0 && daysToEvent <= TAILTREND_CONFIG.eventQuarantineCalendarDays);
  const breakout = recentBreakoutContext(bars, atrs, index);
  const breakdown = recentBreakdown(bars, atrs, index);
  const previousClose = previous.close;
  const breakoutFloor = map.rangeHigh + TAILTREND_CONFIG.breakoutBufferAtr * atr;
  const breakdownFloor = map.rangeLow - TAILTREND_CONFIG.breakoutBufferAtr * atr;
  const lowerReclaim = current.low <= map.lowerTailTop && current.close > map.lowerTailTop
    && (current.close > current.open || current.close > previousClose);
  const upperReject = current.high >= map.upperTailBottom && current.close < map.upperTailBottom
    && (current.close < current.open || current.close < previousClose);

  let state = "RANGE_MIDDLE";
  let breakoutEvidence = null;
  if (eventQuarantine) state = "EVENT_QUARANTINE";
  else if (breakout.failure) {
    state = "BREAKOUT_FAILED";
    breakoutEvidence = breakout.failure;
  } else if (breakout.accepted) {
    state = "TREND_ACCEPTED";
    breakoutEvidence = breakout.accepted;
  } else if (current.close >= breakoutFloor || breakout.candidate) {
    state = "BREAKOUT_CANDIDATE";
    breakoutEvidence = breakout.candidate;
  } else if (current.close <= breakdownFloor) state = "LOWER_TAIL_BREAKDOWN";
  else if (breakdown && current.close <= map.lowerTailTop && current.close > previousClose) state = "DOWNTREND_COVER_ZONE";
  else if (lowerReclaim) state = "LOWER_TAIL_RECLAIMED";
  else if (upperReject) state = "UPPER_TAIL_REJECTED";
  else if (current.close <= map.lowerTailTop) state = "LOWER_TAIL_FALLING";
  else if (current.close >= map.upperTailBottom) state = "UPPER_TAIL_DECISION";

  const avgVolume = mean(bars.slice(index - 19, index + 1).map((bar) => bar.volume));
  const avgTurnover = mean(bars.slice(index - 19, index + 1).map((bar) => bar.turnover));
  const volumeRatio = Number.isFinite(current.volume) && avgVolume > 0 ? current.volume / avgVolume : null;
  const rangePosition = (current.close - map.rangeLow) / map.width;
  const meta = STATE_META[state];
  const context = { weeklyRegime: regime, hvPercentile, volumeRatio, breakout: breakoutEvidence };
  const management = managementFor(state, map, bars, index, atr, breakoutEvidence);
  const blockers = [];
  const overextended = state === "TREND_ACCEPTED" && (breakoutEvidence?.extensionAtr ?? 0) > TAILTREND_CONFIG.maximumTrendExtensionAtr;
  if (state === "BREAKOUT_CANDIDATE") blockers.push("日线接受尚未完成");
  if (state === "TREND_ACCEPTED" && regime !== "UP") blockers.push("纯趋势与周线未同向");
  if (overextended) blockers.push("距旧边界超过 1 ATR，等待回踩或新平衡");
  if (meta.riskModule === "us_short" && market !== "US") blockers.push("A/H/SG 不输出做空开仓动作");
  if (meta.riskModule === "us_short" && market === "US" && options.borrowVerified !== true) blockers.push("借券、成本与账户做空权限尚未核验");
  if (liquidityBand(avgTurnover) === "LOW") blockers.push("20日平均成交额偏低，需额外滑点与冲击复核");
  if (state === "EVENT_QUARANTINE") blockers.push("事件或跳空令普通 ATR 仓位公式失真");

  const allowed = Boolean(meta.newPositionAllowed)
    && blockers.length === 0
    && !overextended
    && !(meta.riskModule === "pure_trend" && regime !== "UP")
    && !(meta.riskModule === "us_short" && market !== "US")
    && state !== "EVENT_QUARANTINE";

  return {
    schemaVersion: TAILTREND_CONFIG.version,
    symbol,
    ticker: symbol.split(".")[0],
    name: options.name ?? symbol,
    sector: options.sector ?? "Unknown",
    cluster: options.cluster ?? options.sector ?? "Unknown",
    market,
    tradingDate: current.date,
    state,
    bucket: meta.bucket,
    label: meta.label,
    action: meta.action,
    newPositionAllowed: allowed,
    candidateModule: meta.riskModule ?? null,
    riskModule: allowed ? meta.riskModule ?? null : null,
    priority: statePriority(state, context),
    dataStatus: options.dataStatus ?? "FRESH",
    bars: bars.length,
    close: round(current.close, 3),
    atr: round(atr, 3),
    atrPct: round((atr / current.close) * 100, 2),
    hv20: round(hv * 100, 1),
    hvPercentile: round(hvPercentile, 0),
    weeklyRegime: regime,
    rangePositionPct: round(clamp(rangePosition, -0.25, 1.25) * 100, 1),
    distanceToLowerTailAtr: round((current.close - map.lowerTailTop) / atr, 2),
    distanceToUpperTailAtr: round((map.upperTailBottom - current.close) / atr, 2),
    gapAtr: round(gapAtr, 2),
    volumeRatio: round(volumeRatio, 2),
    averageTurnover20: round(avgTurnover, 0),
    liquidityBand: liquidityBand(avgTurnover),
    eventDate: options.eventDate ?? null,
    daysToEvent,
    tailMap: {
      provider: "rolling_range",
      version: `${current.date}:60:20`,
      lookback: TAILTREND_CONFIG.tailLookback,
      fraction: TAILTREND_CONFIG.tailFraction,
      rangeLow: round(map.rangeLow, 3),
      lowerTailTop: round(map.lowerTailTop, 3),
      midpoint: round(map.midpoint, 3),
      upperTailBottom: round(map.upperTailBottom, 3),
      rangeHigh: round(map.rangeHigh, 3),
    },
    breakout: breakoutEvidence ? {
      boundary: round(breakoutEvidence.boundary, 3),
      holdCloses: breakoutEvidence.holdCloses,
      extensionAtr: round(breakoutEvidence.extensionAtr, 2),
      overextended,
    } : null,
    management: Object.fromEntries(Object.entries(management).map(([key, value]) => [key, typeof value === "number" ? round(value, 3) : value])),
    blockers,
  };
}

export function drawdownMultiplier(drawdownPct) {
  const value = Math.max(0, Number(drawdownPct) || 0);
  if (value >= 10) return 0;
  if (value >= 8) return 0.25;
  if (value >= 5) return 0.5;
  return 1;
}

export function volatilityMultiplier(hvPercentile) {
  const value = Number(hvPercentile);
  if (!Number.isFinite(value)) return 1;
  if (value > 90) return 0.5;
  if (value >= 75) return 0.75;
  return 1;
}

export function calculateRiskPlan(input) {
  const module = input.module ?? "tail_core";
  const moduleRules = {
    tail_core: { ideaCap: 0.004, sleeve: 0.60, reserve: 0.40, label: "尾部核心" },
    pure_trend: { ideaCap: 0.002, sleeve: 1, reserve: 0, label: "纯趋势" },
    us_short: { ideaCap: 0.0015, sleeve: 1, reserve: 0, label: "美股做空" },
    event: { ideaCap: 0, sleeve: 0, reserve: 0, label: "事件隔离" },
  };
  const rule = moduleRules[module] ?? moduleRules.tail_core;
  const equity = Math.max(0, Number(input.equity) || 0);
  const entry = finite(input.entry);
  const stop = finite(input.stop);
  const gapReserve = Math.max(0, Number(input.gapReserve) || 0);
  const slippageReserve = Math.max(0, Number(input.slippageReserve) || 0);
  const drawdown = Math.max(0, Number(input.drawdownPct) || 0);
  const weekly = input.weeklyRegime ?? "RANGE";
  const existingHeat = Math.max(0, Number(input.existingPortfolioHeatPct) || 0) / 100;
  const clusterHeat = Math.max(0, Number(input.clusterHeatPct) || 0) / 100;
  const fullStopsToday = Math.max(0, Number(input.fullStopsToday) || 0);
  const dailyLoss = Math.max(0, Number(input.dailyRealizedLossPct) || 0) / 100;
  const blockers = [];
  const warnings = [];
  let weeklyMultiplier = 1;
  if (module === "pure_trend" && weekly !== "UP") weeklyMultiplier = 0;
  if (module === "tail_core" && weekly === "DOWN") weeklyMultiplier = 0.5;
  if (module === "us_short" && weekly === "UP") weeklyMultiplier = 0.5;
  const drawdownFactor = drawdownMultiplier(drawdown);
  const volatilityFactor = volatilityMultiplier(input.hvPercentile);
  const finalIdeaRiskPct = rule.ideaCap * drawdownFactor * volatilityFactor * weeklyMultiplier;
  const tradeRiskPct = finalIdeaRiskPct * rule.sleeve;
  const reservedRiskPct = finalIdeaRiskPct * rule.reserve;
  const stressPerShare = Number.isFinite(entry) && Number.isFinite(stop)
    ? Math.abs(entry - stop) + gapReserve + slippageReserve
    : null;

  if (!equity) blockers.push("账户权益必须大于 0");
  if (![entry, stop].every(Number.isFinite) || entry <= 0 || stop <= 0) blockers.push("入场与硬止损必须是有效价格");
  if (Number.isFinite(entry) && Number.isFinite(stop) && entry === stop) blockers.push("入场与硬止损不能相同");
  if (module === "event") blockers.push("事件隔离状态不得使用普通 ATR 仓位公式");
  if (drawdownFactor === 0) blockers.push("账户回撤达到 10%，暂停新增风险并审计");
  if (module === "pure_trend" && weeklyMultiplier === 0) blockers.push("纯趋势机会必须与周线同向");
  if (fullStopsToday >= 2) blockers.push("当日已出现两个完整止损，停止新开仓");
  if (dailyLoss >= 0.01) blockers.push("当日已实现亏损达到权益 1%，停止新开仓");
  if (existingHeat + finalIdeaRiskPct > 0.015) blockers.push("加入后组合计划风险超过 1.50% 硬上限");
  else if (existingHeat + finalIdeaRiskPct > 0.0125) warnings.push("加入后组合计划风险超过 1.25% 正常上限");
  if (clusterHeat + finalIdeaRiskPct > 0.0075) blockers.push("加入后同集群风险超过 0.75% 硬上限");
  else if (clusterHeat + finalIdeaRiskPct > 0.006) warnings.push("加入后同集群风险超过 0.60% 警戒线");

  const plannedLoss = equity * tradeRiskPct;
  let shares = blockers.length || !Number.isFinite(stressPerShare) || stressPerShare <= 0
    ? 0
    : Math.floor(plannedLoss / stressPerShare);
  const advTurnover = Number(input.averageTurnover20);
  let liquidityCapShares = null;
  if (Number.isFinite(advTurnover) && advTurnover > 0 && Number.isFinite(entry) && entry > 0) {
    liquidityCapShares = Math.floor((advTurnover * 0.01) / entry);
    if (shares > liquidityCapShares) {
      shares = liquidityCapShares;
      warnings.push("股数已降至近20日平均成交额 1% 以下");
    }
  }
  if (!blockers.length && shares < 1) blockers.push("压力损失下可承担股数不足 1 股");

  return {
    module,
    moduleLabel: rule.label,
    allowed: blockers.length === 0,
    equity: round(equity, 2),
    ideaRiskPct: round(finalIdeaRiskPct * 100, 3),
    tradeRiskPct: round(tradeRiskPct * 100, 3),
    reservedRiskPct: round(reservedRiskPct * 100, 3),
    ideaRiskDollars: round(equity * finalIdeaRiskPct, 2),
    plannedLoss: round(plannedLoss, 2),
    stressPerShare: round(stressPerShare, 3),
    shares,
    positionValue: round(shares * (Number.isFinite(entry) ? entry : 0), 2),
    liquidityCapShares,
    multipliers: {
      drawdown: drawdownFactor,
      volatility: volatilityFactor,
      weekly: weeklyMultiplier,
    },
    blockers,
    warnings,
  };
}

export function summarizeSnapshot(records) {
  const rows = Array.isArray(records) ? records : [];
  const bucketCounts = {};
  const stateCounts = {};
  for (const row of rows) {
    bucketCounts[row.bucket] = (bucketCounts[row.bucket] ?? 0) + 1;
    stateCounts[row.state] = (stateCounts[row.state] ?? 0) + 1;
  }
  return {
    records: rows.length,
    actionable: rows.filter((row) => row.newPositionAllowed).length,
    blocked: rows.filter((row) => row.blockers?.length).length,
    bucketCounts,
    stateCounts,
  };
}
