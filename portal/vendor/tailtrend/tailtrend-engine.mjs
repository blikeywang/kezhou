const DAY_MS = 86_400_000;

export const TAILTREND_CONFIG = Object.freeze({
  schema: "traderhome_tailtrend_snapshot_v1",
  version: "0.3.0",
  tailLookback: 60,
  tailFraction: 0.20,
  atrTailWidth: 1.5,
  atrPeriod: 20,
  hvPeriod: 20,
  hvRankLookback: 252,
  breakoutBufferAtr: 0.25,
  breakoutHoldCloses: 2,
  breakoutHoldWindow: 3,
  maximumTrendExtensionAtr: 1.0,
  lowerBoundaryStableSessions: 5,
  structureResetAtr: 1.0,
  structureLockMaxSessions: 40,
  gapQuarantineAtr: 1.5,
  eventQuarantineCalendarDays: 2,
  eventGapReserveMultiplier: 2.5,
  eventRiskLookaheadCalendarDays: 10,
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
    bucket: "BREAKOUT_CANDIDATE_WATCH",
    label: "突破候选",
    action: "等待日线接受，不追完整仓位",
    newPositionAllowed: false,
  },
  TREND_ACCEPTED: {
    bucket: "TREND_ACCEPTED_WATCH",
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
  BREAKOUT_CANDIDATE_WATCH: { label: "突破候选", tone: "watch" },
  TREND_ACCEPTED_WATCH: { label: "趋势已接受", tone: "trend" },
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

function tailMapFromHistory(history) {
  if (!Array.isArray(history) || !history.length) return null;
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

function tailMapAt(bars, index, lookback = TAILTREND_CONFIG.tailLookback) {
  if (index < lookback) return null;
  return tailMapFromHistory(bars.slice(index - lookback, index));
}

function tailMapEndingAt(bars, index, lookback = TAILTREND_CONFIG.tailLookback) {
  if (index + 1 < lookback) return null;
  return tailMapFromHistory(bars.slice(index - lookback + 1, index + 1));
}

function eventDistance(lastDate, eventDate) {
  if (!lastDate || !eventDate) return null;
  const last = new Date(`${lastDate}T00:00:00Z`);
  const event = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(last.getTime()) || Number.isNaN(event.getTime())) return null;
  return Math.round((event - last) / DAY_MS);
}

function emptyStateMemory() {
  return { version: 1, lower: null, upper: null, trend: null };
}

function cloneStateMemory(value) {
  const source = value && typeof value === "object" ? value : emptyStateMemory();
  return {
    version: 1,
    lower: source.lower ? { ...source.lower } : null,
    upper: source.upper ? { ...source.upper } : null,
    trend: source.trend ? { ...source.trend } : null,
  };
}

function lowerLock(map, bar, atr, lockedBy = "LOWER_TAIL_FALLING") {
  const newStructuralLow = bar.low < map.rangeLow;
  return {
    boundary: map.lowerTailTop,
    rangeLow: map.rangeLow,
    rangeHigh: map.rangeHigh,
    atrAtLock: atr,
    lockedAt: bar.date,
    lockedBy,
    ageSessions: 0,
    stableSessions: newStructuralLow ? 0 : 1,
    trackedLow: Math.min(map.rangeLow, bar.low),
  };
}

function upperLock(map, bar, atr) {
  return {
    boundary: map.rangeHigh,
    threshold: map.rangeHigh + TAILTREND_CONFIG.breakoutBufferAtr * atr,
    atrAtLock: atr,
    lockedAt: bar.date,
    lockedBy: "BREAKOUT_CANDIDATE",
    ageSessions: 0,
    holdCloses: 1,
  };
}

function breakoutEvidence(lock, current) {
  if (!lock) return null;
  return {
    boundary: lock.boundary,
    threshold: lock.threshold,
    atrAtLock: lock.atrAtLock,
    lockedAt: lock.lockedAt,
    holdCloses: lock.holdCloses,
    elapsed: lock.ageSessions,
    extensionAtr: (current.close - lock.boundary) / lock.atrAtLock,
  };
}

function priorTrailingLow(bars, index, sessions = 10) {
  const history = bars.slice(Math.max(0, index - sessions), index);
  return history.length ? Math.min(...history.map((bar) => bar.low)) : null;
}

function advanceStateMemory(previousMemory, bars, atrs, index) {
  const memory = cloneStateMemory(previousMemory);
  const current = bars[index];
  const previous = bars[index - 1];
  const map = tailMapAt(bars, index);
  const atr = atrs[index];
  if (!map || !Number.isFinite(atr) || !previous) return { memory, structural: null };

  if (memory.trend) {
    const trailingExit = priorTrailingLow(bars, index);
    const evidence = breakoutEvidence(memory.trend, current);
    if (Number.isFinite(trailingExit) && current.close < trailingExit) {
      memory.trend = null;
      return {
        memory,
        structural: { state: "BREAKOUT_FAILED", breakout: evidence, reasonCode: "TREND_TRAILING_EXIT", trailingExit },
      };
    }
    memory.trend.ageSessions = (memory.trend.ageSessions ?? 0) + 1;
    return { memory, structural: { state: "TREND_ACCEPTED", breakout: evidence, reasonCode: "TREND_PERSISTS", trailingExit } };
  }

  if (memory.upper) {
    memory.upper.ageSessions = (memory.upper.ageSessions ?? 0) + 1;
    if (current.close > memory.upper.threshold) memory.upper.holdCloses = (memory.upper.holdCloses ?? 0) + 1;
    const evidence = breakoutEvidence(memory.upper, current);
    const failureFloor = memory.upper.boundary - TAILTREND_CONFIG.breakoutBufferAtr * memory.upper.atrAtLock;
    if (current.close < failureFloor) {
      memory.upper = null;
      return { memory, structural: { state: "BREAKOUT_FAILED", breakout: evidence, reasonCode: "BREAKOUT_RETURNED_INSIDE" } };
    }
    if (memory.upper.holdCloses >= TAILTREND_CONFIG.breakoutHoldCloses) {
      memory.trend = {
        ...memory.upper,
        acceptedAt: current.date,
        lockedBy: "TREND_ACCEPTED",
      };
      memory.upper = null;
      return { memory, structural: { state: "TREND_ACCEPTED", breakout: evidence, reasonCode: "BREAKOUT_ACCEPTED" } };
    }
    if (memory.upper.ageSessions >= TAILTREND_CONFIG.breakoutHoldWindow - 1) {
      memory.upper = null;
      return { memory, structural: { state: "BREAKOUT_FAILED", breakout: evidence, reasonCode: "ACCEPTANCE_WINDOW_EXPIRED" } };
    }
    return { memory, structural: { state: "BREAKOUT_CANDIDATE", breakout: evidence, reasonCode: "ACCEPTANCE_PENDING" } };
  }

  const breakdownFloor = map.rangeLow - TAILTREND_CONFIG.breakoutBufferAtr * atr;
  if (memory.lower) {
    memory.lower.ageSessions = (memory.lower.ageSessions ?? 0) + 1;
    const resetFloor = memory.lower.rangeLow - TAILTREND_CONFIG.structureResetAtr * memory.lower.atrAtLock;
    if (current.close < resetFloor) {
      const resetMap = tailMapEndingAt(bars, index) ?? map;
      memory.lower = lowerLock(resetMap, current, atr, "STRUCTURE_RESET");
      return { memory, structural: { state: "LOWER_TAIL_FALLING", lower: { ...memory.lower }, reasonCode: "STRUCTURE_RESET" } };
    }

    if (current.low < memory.lower.trackedLow) {
      memory.lower.trackedLow = current.low;
      memory.lower.stableSessions = 0;
    } else {
      memory.lower.stableSessions = (memory.lower.stableSessions ?? 0) + 1;
    }

    if (current.close <= breakdownFloor) {
      return { memory, structural: { state: "LOWER_TAIL_BREAKDOWN", lower: { ...memory.lower }, reasonCode: "CURRENT_RANGE_BREAKDOWN" } };
    }

    if (memory.lower.ageSessions >= TAILTREND_CONFIG.structureLockMaxSessions) {
      if (current.low <= map.lowerTailTop || current.close <= map.lowerTailTop) {
        memory.lower = lowerLock(map, current, atr, "LOCK_EXPIRED_REBASE");
        return { memory, structural: { state: "LOWER_TAIL_FALLING", lower: { ...memory.lower }, reasonCode: "LOCK_EXPIRED_REBASE" } };
      }
      memory.lower = null;
      return { memory, structural: null };
    }

    const reversalConfirmed = current.close > current.open || current.close > previous.close;
    if (current.close > memory.lower.boundary
      && reversalConfirmed
      && memory.lower.stableSessions >= TAILTREND_CONFIG.lowerBoundaryStableSessions) {
      const evidence = { ...memory.lower };
      memory.lower = null;
      return { memory, structural: { state: "LOWER_TAIL_RECLAIMED", lower: evidence, reasonCode: "LOCKED_LOWER_RECLAIMED" } };
    }
    return { memory, structural: { state: "LOWER_TAIL_FALLING", lower: { ...memory.lower }, reasonCode: "LOWER_LOCK_PENDING" } };
  }

  if (current.close <= breakdownFloor) {
    return { memory, structural: { state: "LOWER_TAIL_BREAKDOWN", reasonCode: "CURRENT_RANGE_BREAKDOWN" } };
  }

  const breakoutThreshold = map.rangeHigh + TAILTREND_CONFIG.breakoutBufferAtr * atr;
  if (current.close >= breakoutThreshold) {
    memory.upper = upperLock(map, current, atr);
    return {
      memory,
      structural: {
        state: "BREAKOUT_CANDIDATE",
        breakout: breakoutEvidence(memory.upper, current),
        reasonCode: "BREAKOUT_LOCKED",
      },
    };
  }

  const reversalConfirmed = current.close > current.open || current.close > previous.close;
  if (current.close <= map.lowerTailTop) {
    memory.lower = lowerLock(map, current, atr);
    return { memory, structural: { state: "LOWER_TAIL_FALLING", lower: { ...memory.lower }, reasonCode: "LOWER_LOCKED" } };
  }
  if (current.low <= map.lowerTailTop && current.close > map.lowerTailTop && reversalConfirmed) {
    if (current.low < map.rangeLow) {
      memory.lower = lowerLock(map, current, atr, "NEW_LOW_REQUIRES_STABILITY");
      return { memory, structural: { state: "LOWER_TAIL_FALLING", lower: { ...memory.lower }, reasonCode: "NEW_LOW_REQUIRES_STABILITY" } };
    }
    return {
      memory,
      structural: {
        state: "LOWER_TAIL_RECLAIMED",
        lower: { ...lowerLock(map, current, atr, "STABLE_MAP_RECLAIM") },
        reasonCode: "STABLE_MAP_RECLAIM",
      },
    };
  }
  return { memory, structural: null };
}

function replayStateMemory(bars, atrs, options = {}) {
  const currentIndex = bars.length - 1;
  const previousRecord = options.previousState && typeof options.previousState === "object" ? options.previousState : null;
  const canSeed = previousRecord?.tradingDate === bars[currentIndex - 1]?.date && previousRecord?.stateMemory;
  let memory = canSeed ? cloneStateMemory(previousRecord.stateMemory) : emptyStateMemory();
  let structural = null;
  const start = canSeed ? currentIndex : TAILTREND_CONFIG.tailLookback;
  for (let index = start; index <= currentIndex; index += 1) {
    const step = advanceStateMemory(memory, bars, atrs, index);
    memory = step.memory;
    structural = step.structural;
  }
  return { memory, structural, coldStart: !canSeed };
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

function priorityAnalysis(state, context) {
  const weekly = context.weeklyRegime;
  const hv = context.hvPercentile ?? 50;
  const volume = context.volumeRatio ?? 1;
  const components = [];
  const add = (label, points, reason) => {
    if (!points) return;
    components.push({ label, points: round(points, 1), reason });
  };
  if (state === "LOWER_TAIL_RECLAIMED") {
    add("状态基础", 56, "日线触及下尾后重新收复边界");
    add("周线环境", weekly === "UP" ? 16 : weekly === "RANGE" ? 8 : 0, weekly === "UP" ? "周线向上" : "周线震荡");
    add("成交量确认", clamp(volume - 1, 0, 1.5) * 8, `量比 ${round(volume, 2)}×`);
  } else if (state === "TREND_ACCEPTED") {
    add("状态基础", 62, "突破已满足收盘接受规则");
    add("周线环境", weekly === "UP" ? 18 : 0, "周线与趋势同向");
    add("收盘保持", Math.min(10, (context.breakout?.holdCloses ?? 0) * 5), `${context.breakout?.holdCloses ?? 0} 个确认收盘`);
    add("过度伸展", (context.breakout?.extensionAtr ?? 0) > 1 ? -22 : 0, "距旧边界超过 1 ATR");
  } else if (state === "BREAKOUT_CANDIDATE") {
    add("状态基础", 48, "已越过突破缓冲，但接受尚未完成");
    add("周线环境", weekly === "UP" ? 15 : 0, "周线向上");
    add("成交量背景", Math.min(9, volume * 4), `量比 ${round(volume, 2)}×`);
  } else if (state === "UPPER_TAIL_REJECTED" || state === "BREAKOUT_FAILED") {
    add("状态基础", 55, state === "BREAKOUT_FAILED" ? "突破后回到旧区间" : "上尾触及后收盘拒绝");
    add("周线环境", weekly === "DOWN" ? 16 : weekly === "RANGE" ? 8 : 0, weekly === "DOWN" ? "周线向下" : "周线震荡");
  } else if (state === "LOWER_TAIL_BREAKDOWN") {
    add("状态基础", 58, "收盘跌破下沿缓冲");
    add("周线环境", weekly === "DOWN" ? 18 : 0, "周线向下");
  } else if (state === "EVENT_QUARANTINE") {
    add("隔离优先", 100, "事件或大跳空需要先人工处理");
  } else if (state === "LOWER_TAIL_FALLING" || state === "UPPER_TAIL_DECISION" || state === "DOWNTREND_COVER_ZONE") {
    add("边缘观察", 35, "已靠近边缘，但尚无可执行确认");
  }
  if (components.some((component) => component.points > 0) && hv > 90 && state !== "EVENT_QUARANTINE") {
    add("高波动降级", -10, `HV 历史百分位 p${round(hv, 0)}`);
  }
  const raw = components.reduce((sum, component) => sum + component.points, 0);
  return { total: Math.round(clamp(raw, 0, 100)), components };
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
  const tenDayExit = priorTrailingLow(bars, index);
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

function stateExplanation(state, context) {
  const {
    current, previous, map, atr, breakout, management, gapAtr, daysToEvent, lowerLock: lockedLower, reasonCode, trailingExit,
  } = context;
  const distance = (price) => Number.isFinite(price) && Number.isFinite(atr) && atr > 0
    ? round(Math.abs(price - current.close) / atr, 2)
    : null;
  const output = { reasons: [], nextCondition: null };
  if (state === "EVENT_QUARANTINE") {
    if (Number.isFinite(gapAtr) && gapAtr > TAILTREND_CONFIG.gapQuarantineAtr) {
      output.reasons.push(`开盘缺口 ${round(gapAtr, 2)} ATR，超过 ${TAILTREND_CONFIG.gapQuarantineAtr} ATR 隔离线`);
    }
    if (Number.isFinite(daysToEvent) && daysToEvent >= 0) output.reasons.push(`距已知事件 ${daysToEvent} 个日历日`);
    output.nextCondition = { targetState: "REASSESS", label: "事件后重算", condition: "事件完成且形成新的完整日线后重新计算，不沿用普通 ATR 仓位", distanceAtr: null };
  } else if (state === "BREAKOUT_FAILED") {
    output.reasons.push(reasonCode === "TREND_TRAILING_EXIT"
      ? `收盘跌破进入今天前已知的 10 日低点 ${moneyless(trailingExit)}`
      : reasonCode === "ACCEPTANCE_WINDOW_EXPIRED"
        ? `3 日接受窗口结束，未取得 ${TAILTREND_CONFIG.breakoutHoldCloses} 个缓冲线外收盘`
        : `此前越过 ${moneyless(breakout?.boundary)} 的突破退回失败线内`);
    output.nextCondition = { targetState: "RANGE_REASSESS", label: "旧区间内重评", condition: "先退出趋势袖套，再等待新的边缘状态", distanceAtr: null };
  } else if (state === "TREND_ACCEPTED") {
    output.reasons.push(`${breakout?.holdCloses ?? 0}/${TAILTREND_CONFIG.breakoutHoldCloses} 个确认收盘留在冻结缓冲线 ${moneyless(breakout?.threshold)} 外`);
    output.nextCondition = { targetState: "TRAILING_EXIT", label: "趋势退出线", condition: `日线收盘跌破 10 日低点 ${moneyless(management?.trailingExit)}`, distanceAtr: distance(management?.trailingExit) };
  } else if (state === "BREAKOUT_CANDIDATE") {
    const remaining = Math.max(0, TAILTREND_CONFIG.breakoutHoldCloses - (breakout?.holdCloses ?? 1));
    output.reasons.push(`收盘已越过旧上沿与 ${TAILTREND_CONFIG.breakoutBufferAtr} ATR 缓冲，但接受窗口尚未完成`);
    output.nextCondition = { targetState: "TREND_ACCEPTED", label: "趋势已接受", condition: `3 日窗口内还需 ${remaining} 个收盘留在边界外`, closesRemaining: remaining, distanceAtr: null };
  } else if (state === "LOWER_TAIL_BREAKDOWN") {
    const floor = map.rangeLow - TAILTREND_CONFIG.breakoutBufferAtr * atr;
    output.reasons.push(`收盘低于下沿破位线 ${moneyless(floor)}`);
    output.nextCondition = { targetState: "DOWNTREND_COVER_ZONE", label: "空头回补观察", condition: `重新靠近或收复下尾上界 ${moneyless(map.lowerTailTop)}`, distanceAtr: distance(map.lowerTailTop) };
  } else if (state === "DOWNTREND_COVER_ZONE") {
    output.reasons.push("此前发生下沿破位，当前回到下尾附近并较前收盘改善");
    output.nextCondition = { targetState: "LOWER_TAIL_RECLAIMED", label: "下沿收复", condition: `日线收盘重新站上 ${moneyless(map.lowerTailTop)} 并出现反转确认`, distanceAtr: distance(map.lowerTailTop) };
  } else if (state === "LOWER_TAIL_RECLAIMED") {
    output.reasons.push(`盘中触及下尾后，收盘重新站上冻结边界 ${moneyless(lockedLower?.boundary ?? map.lowerTailTop)}`);
    if (lockedLower?.stableSessions >= TAILTREND_CONFIG.lowerBoundaryStableSessions) {
      output.reasons.push(`结构低点已稳定 ${lockedLower.stableSessions} 个交易日`);
    }
    output.reasons.push(current.close > current.open ? "收盘高于开盘" : `收盘高于前收盘 ${moneyless(previous.close)}`);
    output.nextCondition = { targetState: "UPPER_TAIL_DECISION", label: "第一管理区", condition: `先观察中轴 ${moneyless(map.midpoint)}，再看上尾决策区`, distanceAtr: distance(map.midpoint) };
  } else if (state === "UPPER_TAIL_REJECTED") {
    output.reasons.push(`盘中触及上尾后，收盘退回 ${moneyless(map.upperTailBottom)} 下方`);
    output.nextCondition = { targetState: "RANGE_MIDDLE", label: "均值回归管理", condition: `先观察中轴 ${moneyless(map.midpoint)}；做空仍需独立资格核验`, distanceAtr: distance(map.midpoint) };
  } else if (state === "LOWER_TAIL_FALLING") {
    const boundary = lockedLower?.boundary ?? map.lowerTailTop;
    const stable = lockedLower?.stableSessions ?? 0;
    output.reasons.push(reasonCode === "NEW_LOW_REQUIRES_STABILITY"
      ? `当天形成新结构低点，禁止把同日反弹误记为收复`
      : reasonCode === "STRUCTURE_RESET"
        ? `收盘跌破旧结构低点 1 ATR，已在新区间重新锁定`
        : `冻结下沿 ${moneyless(boundary)}；结构稳定 ${stable}/${TAILTREND_CONFIG.lowerBoundaryStableSessions} 日`);
    output.nextCondition = { targetState: "LOWER_TAIL_RECLAIMED", label: "下沿收复", condition: `结构低点稳定满 ${TAILTREND_CONFIG.lowerBoundaryStableSessions} 日后，收盘站回冻结边界 ${moneyless(boundary)} 并出现反转确认`, distanceAtr: distance(boundary) };
  } else if (state === "UPPER_TAIL_DECISION") {
    const breakoutFloor = map.rangeHigh + TAILTREND_CONFIG.breakoutBufferAtr * atr;
    output.reasons.push(`收盘位于上尾决策区 ${moneyless(map.upperTailBottom)}–${moneyless(map.rangeHigh)}`);
    output.nextCondition = { targetState: "BREAKOUT_CANDIDATE", label: "突破候选", condition: `收盘越过 ${moneyless(breakoutFloor)}；若收盘退回上尾下方则转为拒绝`, distanceAtr: distance(breakoutFloor) };
  } else if (state === "RANGE_MIDDLE") {
    const lowerDistance = Math.max(0, (current.close - map.lowerTailTop) / atr);
    const upperDistance = Math.max(0, (map.upperTailBottom - current.close) / atr);
    output.reasons.push(`收盘位于下尾上界 ${moneyless(map.lowerTailTop)} 与上尾下界 ${moneyless(map.upperTailBottom)} 之间`);
    output.nextCondition = lowerDistance <= upperDistance
      ? { targetState: "LOWER_TAIL_RECLAIMED", label: "下沿观察区", condition: `距下尾上界 ${round(lowerDistance, 2)} ATR；触及后仍需收盘收复`, distanceAtr: round(lowerDistance, 2) }
      : { targetState: "UPPER_TAIL_DECISION", label: "上沿决策区", condition: `距上尾下界 ${round(upperDistance, 2)} ATR`, distanceAtr: round(upperDistance, 2) };
  }
  if (!output.reasons.length) output.reasons.push(STATE_META[state]?.action ?? "等待更多完整日线");
  return output;
}

function moneyless(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)).toString() : "待计算";
}

function atrTailComparison(state, map, current, previous, atr) {
  const structuralStates = new Set([
    "EVENT_QUARANTINE", "BREAKOUT_CANDIDATE", "TREND_ACCEPTED", "BREAKOUT_FAILED", "LOWER_TAIL_BREAKDOWN",
  ]);
  const width = Math.min(TAILTREND_CONFIG.atrTailWidth * atr, map.width * 0.45);
  const lowerTailTop = map.rangeLow + width;
  const upperTailBottom = map.rangeHigh - width;
  let comparisonState = state;
  if (!structuralStates.has(state)) {
    const reversalUp = current.close > current.open || current.close > previous.close;
    const reversalDown = current.close < current.open || current.close < previous.close;
    if (current.low <= lowerTailTop && current.close > lowerTailTop && current.low >= map.rangeLow && reversalUp) comparisonState = "LOWER_TAIL_RECLAIMED";
    else if (current.high >= upperTailBottom && current.close < upperTailBottom && reversalDown) comparisonState = "UPPER_TAIL_REJECTED";
    else if (current.close <= lowerTailTop) comparisonState = "LOWER_TAIL_FALLING";
    else if (current.close >= upperTailBottom) comparisonState = "UPPER_TAIL_DECISION";
    else comparisonState = "RANGE_MIDDLE";
  }
  return {
    state: comparisonState,
    bucket: STATE_META[comparisonState]?.bucket ?? "EDGE_OBSERVE",
    k: TAILTREND_CONFIG.atrTailWidth,
    lowerTailTop: round(lowerTailTop, 3),
    upperTailBottom: round(upperTailBottom, 3),
    shadowOnly: true,
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
  const replay = replayStateMemory(bars, atrs, options);
  const structural = replay.structural;
  const breakdown = recentBreakdown(bars, atrs, index);
  const previousClose = previous.close;
  const upperReject = current.high >= map.upperTailBottom && current.close < map.upperTailBottom
    && (current.close < current.open || current.close < previousClose);

  let state = "RANGE_MIDDLE";
  let breakoutEvidence = structural?.breakout ?? null;
  if (eventQuarantine) state = "EVENT_QUARANTINE";
  else if (structural?.state === "LOWER_TAIL_FALLING"
    && breakdown && current.close <= map.lowerTailTop && current.close > previousClose) state = "DOWNTREND_COVER_ZONE";
  else if (structural?.state) state = structural.state;
  else if (upperReject) state = "UPPER_TAIL_REJECTED";
  else if (current.close >= map.upperTailBottom) state = "UPPER_TAIL_DECISION";

  const lockedLower = structural?.lower ?? replay.memory.lower;
  const signalMap = lockedLower ? {
    rangeHigh: lockedLower.rangeHigh,
    rangeLow: lockedLower.rangeLow,
    width: lockedLower.rangeHigh - lockedLower.rangeLow,
    lowerTailTop: lockedLower.boundary,
    midpoint: lockedLower.rangeLow + (lockedLower.rangeHigh - lockedLower.rangeLow) * 0.5,
    upperTailBottom: lockedLower.rangeHigh - (lockedLower.rangeHigh - lockedLower.rangeLow) * TAILTREND_CONFIG.tailFraction,
  } : map;

  const avgVolume = mean(bars.slice(index - 19, index + 1).map((bar) => bar.volume));
  const avgTurnover = mean(bars.slice(index - 19, index + 1).map((bar) => bar.turnover));
  const volumeRatio = Number.isFinite(current.volume) && avgVolume > 0 ? current.volume / avgVolume : null;
  const rangePosition = (current.close - map.rangeLow) / map.width;
  const meta = STATE_META[state];
  const atrComparison = atrTailComparison(state, map, current, previous, atr);
  const context = { weeklyRegime: regime, hvPercentile, volumeRatio, breakout: breakoutEvidence };
  const priority = priorityAnalysis(state, context);
  const management = managementFor(state, signalMap, bars, index, atr, breakoutEvidence);
  const explanation = stateExplanation(state, {
    current,
    previous,
    map: signalMap,
    atr,
    breakout: breakoutEvidence,
    management,
    gapAtr,
    daysToEvent,
    lowerLock: lockedLower,
    reasonCode: structural?.reasonCode,
    trailingExit: structural?.trailingExit,
  });
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
  const candidateModule = meta.riskModule
    ?? (state === "BREAKOUT_CANDIDATE" ? "pure_trend" : state === "EVENT_QUARANTINE" ? "event" : null);

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
    candidateModule,
    riskModule: allowed ? meta.riskModule ?? null : null,
    shortQualified: meta.riskModule === "us_short" ? market === "US" && options.borrowVerified === true : null,
    priority: priority.total,
    priorityBreakdown: priority.components,
    stateReason: explanation.reasons,
    nextCondition: explanation.nextCondition,
    signalDirection: candidateModule === "us_short" ? "SHORT"
      : ["tail_core", "pure_trend"].includes(candidateModule) ? "LONG" : "OBSERVE",
    comparisonStates: {
      pct: state,
      atr: atrComparison.state,
    },
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
    holdingRule: state === "EVENT_QUARANTINE" ? {
      policy: "PRE_FUNDED_EVENT_GAP",
      gapReserveMultiplier: TAILTREND_CONFIG.eventGapReserveMultiplier,
      action: "已有仓位须在事件前一完整交易日确认放大的跳空预算；未确认则不新增风险，也不把普通10日低点当成事件日市价单。",
    } : null,
    eventRiskPolicy: Number.isFinite(daysToEvent)
      && daysToEvent >= 0
      && daysToEvent <= TAILTREND_CONFIG.eventRiskLookaheadCalendarDays ? {
        policy: "PRE_FUNDED_EVENT_GAP",
        gapReserveMultiplier: TAILTREND_CONFIG.eventGapReserveMultiplier,
        appliesWithinCalendarDays: TAILTREND_CONFIG.eventRiskLookaheadCalendarDays,
      } : null,
    stateMemory: replay.memory,
    stateMemorySource: replay.coldStart ? "COLD_REPLAY" : "PREVIOUS_SNAPSHOT",
    locked: {
      lowerBoundary: round(replay.memory.lower?.boundary, 3),
      upperBoundary: round(replay.memory.upper?.boundary, 3),
      atrAtLock: round(replay.memory.upper?.atrAtLock ?? replay.memory.lower?.atrAtLock, 3),
      lockedAt: replay.memory.upper?.lockedAt ?? replay.memory.lower?.lockedAt ?? null,
      lockedBy: replay.memory.upper?.lockedBy ?? replay.memory.lower?.lockedBy ?? null,
      lowerStableSessions: replay.memory.lower?.stableSessions ?? null,
    },
    signalBoundary: structural?.lower ? {
      side: "LOWER",
      boundary: round(structural.lower.boundary, 3),
      structuralLow: round(structural.lower.rangeLow, 3),
      atrAtLock: round(structural.lower.atrAtLock, 3),
      lockedAt: structural.lower.lockedAt,
      stableSessions: structural.lower.stableSessions,
      reasonCode: structural.reasonCode,
    } : breakoutEvidence ? {
      side: "UPPER",
      boundary: round(breakoutEvidence.boundary, 3),
      threshold: round(breakoutEvidence.threshold, 3),
      atrAtLock: round(breakoutEvidence.atrAtLock, 3),
      lockedAt: breakoutEvidence.lockedAt,
      reasonCode: structural?.reasonCode ?? null,
    } : null,
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
    atrTailMap: atrComparison,
    breakout: breakoutEvidence ? {
      boundary: round(breakoutEvidence.boundary, 3),
      threshold: round(breakoutEvidence.threshold, 3),
      atrAtLock: round(breakoutEvidence.atrAtLock, 3),
      lockedAt: breakoutEvidence.lockedAt,
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
  const signalGate = input.signalGate && typeof input.signalGate === "object" ? input.signalGate : null;
  let weeklyMultiplier = 1;
  if (module === "pure_trend" && weekly !== "UP") weeklyMultiplier = 0;
  if (module === "tail_core" && weekly === "DOWN") weeklyMultiplier = 0.5;
  if (module === "us_short" && weekly === "UP") weeklyMultiplier = 0.5;
  const drawdownFactor = drawdownMultiplier(drawdown);
  const volatilityFactor = volatilityMultiplier(input.hvPercentile);
  const pressureGroup = Math.min(drawdownFactor, volatilityFactor, weeklyMultiplier);
  const wantedIdeaRiskPct = rule.ideaCap * pressureGroup;
  const stressPerShare = Number.isFinite(entry) && Number.isFinite(stop)
    ? Math.abs(entry - stop) + gapReserve + slippageReserve
    : null;
  const portfolioHeadroom = Math.max(0, 0.0125 - existingHeat);
  const clusterHeadroom = Math.max(0, 0.006 - clusterHeat);
  const advTurnover = Number(input.averageTurnover20);
  let liquidityCapShares = null;
  let liquidityHeadroom = Number.POSITIVE_INFINITY;
  if (Number.isFinite(advTurnover) && advTurnover > 0 && Number.isFinite(entry) && entry > 0) {
    liquidityCapShares = Math.floor((advTurnover * 0.01) / entry);
    if (equity > 0 && Number.isFinite(stressPerShare) && stressPerShare > 0 && rule.sleeve > 0) {
      liquidityHeadroom = (liquidityCapShares * stressPerShare) / equity / rule.sleeve;
    }
  }
  const circuitBreaker = fullStopsToday >= 2 || dailyLoss >= 0.01;
  const capacityCandidates = [
    { key: pressureGroup < 1 ? "pressure_group" : "base", value: wantedIdeaRiskPct },
    { key: "portfolio_headroom", value: portfolioHeadroom },
    { key: "cluster_headroom", value: clusterHeadroom },
    { key: "liquidity", value: liquidityHeadroom },
  ];
  const binding = capacityCandidates.reduce((lowest, candidate) => candidate.value < lowest.value ? candidate : lowest);
  const finalIdeaRiskPct = circuitBreaker ? 0 : Math.max(0, binding.value);
  const tradeRiskPct = finalIdeaRiskPct * rule.sleeve;
  const reservedRiskPct = finalIdeaRiskPct * rule.reserve;

  if (!equity) blockers.push("账户权益必须大于 0");
  if (![entry, stop].every(Number.isFinite) || entry <= 0 || stop <= 0) blockers.push("入场与硬止损必须是有效价格");
  if (Number.isFinite(entry) && Number.isFinite(stop) && entry === stop) blockers.push("入场与硬止损不能相同");
  if (signalGate) {
    if (signalGate.expectedModule && signalGate.expectedModule !== module) blockers.push("策略袖套与状态机不一致，不允许手动绕开");
    if (signalGate.newPositionAllowed !== true) blockers.push(`状态机禁止新仓${signalGate.stateLabel ? `：${signalGate.stateLabel}` : ""}`);
    if (!['FRESH', 'LOCAL'].includes(signalGate.dataStatus)) blockers.push(`数据状态 ${signalGate.dataStatus ?? "UNKNOWN"}，不得计算新仓股数`);
    if (signalGate.state === "EVENT_QUARANTINE" || signalGate.eventClear === false) blockers.push("事件或跳空隔离尚未解除");
    if (module === "us_short" && signalGate.shortQualified !== true) blockers.push("借券、成本、市场与账户做空资格尚未全部核验");
    for (const item of signalGate.blockers ?? []) blockers.push(`状态阻断：${item}`);
  }
  if (module === "event") blockers.push("事件隔离状态不得使用普通 ATR 仓位公式");
  if (drawdownFactor === 0) blockers.push("账户回撤达到 10%，暂停新增风险并审计");
  if (module === "pure_trend" && weeklyMultiplier === 0) blockers.push("纯趋势机会必须与周线同向");
  if (fullStopsToday >= 2) blockers.push("当日已出现两个完整止损，停止新开仓");
  if (dailyLoss >= 0.01) blockers.push("当日已实现亏损达到权益 1%，停止新开仓");
  if (existingHeat >= 0.015) blockers.push("组合计划风险已达到 1.50% 硬上限");
  else if (portfolioHeadroom <= 0 && wantedIdeaRiskPct > 0) blockers.push("组合计划风险已无 1.25% 正常额度");
  else if (portfolioHeadroom < wantedIdeaRiskPct) warnings.push("风险已裁剪到组合 1.25% 正常上限的剩余额度");
  if (clusterHeat >= 0.0075) blockers.push("同集群风险已达到 0.75% 硬上限");
  else if (clusterHeadroom <= 0 && wantedIdeaRiskPct > 0) blockers.push("同集群风险已无 0.60% 正常额度");
  else if (clusterHeadroom < wantedIdeaRiskPct) warnings.push("风险已裁剪到同集群 0.60% 正常额度");
  if (!Number.isFinite(advTurnover) || advTurnover <= 0) warnings.push("缺少20日平均成交额，流动性上限未启用");
  else if (liquidityHeadroom < wantedIdeaRiskPct) warnings.push("风险已裁剪到近20日平均成交额 1% 的流动性上限");

  const budgetedLoss = equity * tradeRiskPct;
  let shares = blockers.length || !Number.isFinite(stressPerShare) || stressPerShare <= 0
    ? 0
    : Math.floor(budgetedLoss / stressPerShare);
  if (Number.isFinite(liquidityCapShares)) shares = Math.min(shares, liquidityCapShares);
  if (!blockers.length && shares < 1) blockers.push("压力损失下可承担股数不足 1 股");

  const uniqueBlockers = [...new Set(blockers)];
  if (uniqueBlockers.length) shares = 0;
  const plannedLoss = Number.isFinite(stressPerShare) ? shares * stressPerShare : 0;
  const bindingConstraint = circuitBreaker ? "circuit_breaker" : uniqueBlockers.length ? "hard_gate" : binding.key;
  return {
    module,
    moduleLabel: rule.label,
    allowed: uniqueBlockers.length === 0,
    equity: round(equity, 2),
    ideaRiskPct: round(finalIdeaRiskPct * 100, 3),
    tradeRiskPct: round(tradeRiskPct * 100, 3),
    reservedRiskPct: round(reservedRiskPct * 100, 3),
    ideaRiskDollars: round(equity * finalIdeaRiskPct, 2),
    budgetedLoss: round(budgetedLoss, 2),
    plannedLoss: round(plannedLoss, 2),
    stressPerShare: round(stressPerShare, 3),
    shares,
    positionValue: round(shares * (Number.isFinite(entry) ? entry : 0), 2),
    liquidityCapShares,
    multipliers: {
      drawdown: drawdownFactor,
      volatility: volatilityFactor,
      weekly: weeklyMultiplier,
      pressureGroup,
    },
    riskDiagnostics: {
      mDrawdown: drawdownFactor,
      mHv: volatilityFactor,
      mWeekly: weeklyMultiplier,
      groupA: pressureGroup,
      headroomPortfolioPct: round(portfolioHeadroom * 100, 3),
      headroomClusterPct: round(clusterHeadroom * 100, 3),
      headroomLiquidityPct: Number.isFinite(liquidityHeadroom) ? round(liquidityHeadroom * 100, 3) : null,
      circuitBreaker,
      wantedIdeaRiskPct: round(wantedIdeaRiskPct * 100, 3),
      finalIdeaRiskPct: round(finalIdeaRiskPct * 100, 3),
      effectiveTradeRiskPct: equity > 0 ? round((plannedLoss / equity) * 100, 3) : 0,
      bindingConstraint,
    },
    bindingConstraint,
    blockers: uniqueBlockers,
    warnings,
  };
}

export function updateAuditLedger(previousLedger, records, latestBars, options = {}) {
  const horizons = [1, 3, 5, 10];
  const source = previousLedger?.schema === "traderhome_tailtrend_audit_v1" ? previousLedger : { entries: [] };
  const inheritedEpoch = source.activeEpochId ?? (options.epochId ? "legacy_pre_v0_3" : "default");
  const activeEpochId = options.epochId ?? inheritedEpoch;
  const barLookup = latestBars instanceof Map ? latestBars : new Map(Object.entries(latestBars ?? {}));
  const entries = (source.entries ?? []).map((entry) => ({
    ...JSON.parse(JSON.stringify(entry)),
    epochId: entry.epochId ?? inheritedEpoch,
  }));
  const idSet = new Set(entries.map((entry) => entry.id));

  for (const entry of entries) {
    const reference = finite(entry.execution?.alertReference);
    if (!Number.isFinite(reference) || reference <= 0) continue;
    const rawBars = barLookup.get(entry.symbol);
    const unseenBars = normalizeBars(Array.isArray(rawBars) ? rawBars : rawBars ? [rawBars] : [])
      .filter((bar) => bar.date > entry.originDate && (!entry.forward?.lastObservedDate || bar.date > entry.forward.lastObservedDate));
    entry.execution = {
      alertReference: reference,
      nextTradableReference: null,
      slippagePct: null,
      referenceDate: null,
      ...(entry.execution ?? {}),
    };
    for (const bar of unseenBars) {
      const open = finite(bar.open);
      const high = finite(bar.high);
      const low = finite(bar.low);
      if (![open, high, low].every(Number.isFinite)) continue;
      const upPct = ((high - reference) / reference) * 100;
      const downPct = ((low - reference) / reference) * 100;
      const direction = entry.direction ?? "OBSERVE";
      const favorablePct = direction === "LONG" ? upPct : direction === "SHORT" ? -downPct : null;
      const adversePct = direction === "LONG" ? downPct : direction === "SHORT" ? -upPct : null;
      const sessions = (entry.forward?.sessions ?? 0) + 1;
      const running = entry.forward?.running ?? { mfePct: null, maePct: null, maxUpPct: null, maxDownPct: null };
      running.maxUpPct = round(Math.max(Number(running.maxUpPct) || 0, upPct), 3);
      running.maxDownPct = round(Math.min(Number(running.maxDownPct) || 0, downPct), 3);
      if (Number.isFinite(favorablePct)) running.mfePct = round(Math.max(Number(running.mfePct) || 0, favorablePct), 3);
      if (Number.isFinite(adversePct)) running.maePct = round(Math.min(Number(running.maePct) || 0, adversePct), 3);
      entry.forward = {
        ...entry.forward,
        sessions,
        lastObservedDate: bar.date,
        running,
        horizons: { ...(entry.forward?.horizons ?? {}) },
      };
      if (horizons.includes(sessions)) {
        entry.forward.horizons[String(sessions)] = {
          asOf: bar.date,
          mfePct: direction === "OBSERVE" ? null : running.mfePct,
          maePct: direction === "OBSERVE" ? null : running.maePct,
          maxUpPct: running.maxUpPct,
          maxDownPct: running.maxDownPct,
        };
      }
      if (sessions === 1 && entry.execution.nextTradableReference === null) {
        const rawGapPct = ((open - reference) / reference) * 100;
        const slippagePct = direction === "SHORT" ? -rawGapPct : rawGapPct;
        entry.execution.nextTradableReference = round(open, 3);
        entry.execution.slippagePct = round(slippagePct, 3);
        entry.execution.referenceDate = bar.date;
      }
    }
  }

  for (const record of records ?? []) {
    const originDate = dateOnly(record.tradingDate);
    if (!originDate || !record.symbol) continue;
    const id = `${activeEpochId}:${originDate}:${record.symbol}`;
    if (idSet.has(id)) continue;
    const alertReference = finite(record.management?.entryReference) ?? finite(record.close);
    entries.push({
      id,
      epochId: activeEpochId,
      originDate,
      symbol: record.symbol,
      state: record.state,
      bucket: record.bucket,
      priority: record.priority,
      direction: record.signalDirection ?? "OBSERVE",
      newPositionAllowed: record.newPositionAllowed === true,
      dataStatus: record.dataStatus,
      stateReason: [...(record.stateReason ?? [])],
      blockers: [...(record.blockers ?? [])],
      transition: record.change ?? null,
      prevState: record.prevState ?? record.change?.from ?? null,
      previousObservationDate: record.previousObservationDate ?? record.change?.comparisonDate ?? null,
      transitionReason: [...(record.transitionReason ?? record.stateReason ?? [])],
      nextCondition: record.nextCondition ?? null,
      locked: record.locked ?? null,
      signalBoundary: record.signalBoundary ?? null,
      comparisonStates: record.comparisonStates ?? null,
      riskFactors: record.riskFactors ?? null,
      execution: {
        alertReference: round(alertReference, 3),
        nextTradableReference: null,
        slippagePct: null,
        referenceDate: null,
      },
      forward: {
        sessions: 0,
        lastObservedDate: null,
        running: { mfePct: null, maePct: null, maxUpPct: null, maxDownPct: null },
        horizons: Object.fromEntries(horizons.map((horizon) => [String(horizon), null])),
      },
      gates: {
        eventOrGap: record.state === "EVENT_QUARANTINE",
        shortQualification: record.candidateModule === "us_short" ? record.shortQualified === true : null,
        cluster: null,
      },
      manualOverride: null,
    });
    idSet.add(id);
  }

  const dates = [...new Set(entries.filter((entry) => entry.epochId === activeEpochId).map((entry) => entry.originDate))].sort().reverse();
  const kept = entries
    .sort((left, right) => right.originDate.localeCompare(left.originDate) || left.symbol.localeCompare(right.symbol));
  const epochs = Object.values(kept.reduce((groups, entry) => {
    const key = entry.epochId ?? "unknown";
    groups[key] ??= { epochId: key, entries: 0, dates: new Set() };
    groups[key].entries += 1;
    groups[key].dates.add(entry.originDate);
    return groups;
  }, {})).map((item) => ({ epochId: item.epochId, entries: item.entries, daysCollected: item.dates.size }));
  return {
    schema: "traderhome_tailtrend_audit_v1",
    version: 1,
    frameworkVersion: TAILTREND_CONFIG.version,
    activeEpochId,
    epochs,
    horizons,
    retentionPolicy: "APPEND_BY_TRADING_DAY_NO_TRUNCATION",
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    daysCollected: dates.length,
    entries: kept,
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
