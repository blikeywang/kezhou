const TRADE_ALIASES = {
  id: ["trade_id", "tradeid", "id", "ticket", "order_id", "orderid", "交易编号", "成交编号", "订单号"],
  symbol: ["symbol", "instrument", "ticker", "market", "contract", "品种", "标的", "合约", "交易对"],
  side: ["side", "direction", "position_side", "type", "方向", "多空", "买卖"],
  entryTime: ["entry_time", "entrytime", "open_time", "opentime", "opened_at", "timestamp", "time", "date", "入场时间", "开仓时间", "成交时间"],
  exitTime: ["exit_time", "exittime", "close_time", "closetime", "closed_at", "平仓时间", "出场时间"],
  entryPrice: ["entry_price", "entryprice", "open_price", "openprice", "avg_entry", "price_open", "入场价", "开仓价", "成交均价"],
  exitPrice: ["exit_price", "exitprice", "close_price", "closeprice", "avg_exit", "price_close", "出场价", "平仓价"],
  quantity: ["quantity", "qty", "size", "contracts", "volume", "position_size", "数量", "手数", "仓位"],
  pointValue: ["point_value", "pointvalue", "contract_multiplier", "multiplier", "每点价值", "合约乘数"],
  currency: ["currency", "pnl_currency", "pnlcurrency", "settlement_currency", "币种", "结算币种", "盈亏币种"],
  pnl: ["net_pnl", "netpnl", "realized_pnl", "realizedpnl", "pnl", "profit", "profit_loss", "净盈亏", "已实现盈亏", "盈亏"],
  fees: ["fees", "fee", "commission", "commissions", "手续费", "佣金"],
  stop: ["stop_loss", "stoploss", "sl", "stop", "invalidation", "止损", "失效价"],
  target: ["take_profit", "takeprofit", "tp", "target", "目标价", "止盈"],
  riskAmount: ["risk_amount", "riskamount", "planned_risk", "risk", "风险金额", "计划风险"],
  rMultiple: ["r_multiple", "rmultiple", "result_r", "r_result", "r倍数", "盈亏r"],
  mfeR: ["mfe_r", "mfer", "max_favorable_r", "最大浮盈r"],
  maeR: ["mae_r", "maer", "max_adverse_r", "最大浮亏r"],
  mfeMoney: ["mfe", "max_favorable_excursion", "max_favorable_pnl", "最大浮盈"],
  maeMoney: ["mae", "max_adverse_excursion", "max_adverse_pnl", "最大浮亏"],
  strategy: ["strategy", "setup", "system", "tag", "playbook", "策略", "形态", "标签"],
  notes: ["notes", "note", "comment", "comments", "journal", "备注", "复盘", "交易日志"],
};

const BAR_ALIASES = {
  symbol: TRADE_ALIASES.symbol,
  time: ["timestamp", "time", "datetime", "date", "open_time", "opentime", "时间", "日期"],
  open: ["open", "o", "开盘", "开盘价"],
  high: ["high", "h", "最高", "最高价"],
  low: ["low", "l", "最低", "最低价"],
  close: ["close", "c", "收盘", "收盘价"],
  volume: ["volume", "vol", "v", "成交量"],
};

const pct = (value, digits = 0) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sum = values => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
const mean = values => values.length ? sum(values) / values.length : null;

export function normalizeHeader(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_\-./\\()[\]{}:%$]+/g, "");
}

function delimiterScore(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) count += 1;
  }
  return count;
}

export function parseDelimited(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/).find(line => line.trim()) || "";
  const delimiter = [",", "\t", ";"].sort((left, right) => delimiterScore(firstLine, right) - delimiterScore(firstLine, left))[0];
  if (!delimiterScore(firstLine, delimiter)) throw new Error("没有识别到 CSV/TSV 表头分隔符");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  const populated = rows.filter(values => values.some(value => String(value).trim() !== ""));
  if (populated.length < 2) throw new Error("文件只有表头，没有可分析的数据行");
  const headers = populated[0].map((header, index) => String(header).trim() || `column_${index + 1}`);
  return populated.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function parseRecords(text, fileName = "") {
  const source = String(text ?? "").trim();
  if (!source) throw new Error("文件为空");
  const isJson = /\.json$/i.test(fileName) || source.startsWith("[") || source.startsWith("{");
  if (!isJson) return parseDelimited(source);
  let payload;
  try { payload = JSON.parse(source); } catch (error) { throw new Error(`JSON 无法解析：${error.message}`); }
  if (Array.isArray(payload)) return payload;
  const containers = [payload, payload?.data, payload?.result].filter(value => value && typeof value === "object" && !Array.isArray(value));
  for (const container of containers) {
    for (const key of ["trades", "closed_trades", "closedTrades", "positions", "history", "records"]) {
      if (Array.isArray(container[key])) return container[key];
    }
  }
  throw new Error("JSON 必须是数组，或包含 trades / closed_trades / positions / history / records 数组");
}

function recordMap(record) {
  const mapped = new Map();
  Object.keys(record || {}).forEach(key => mapped.set(normalizeHeader(key), key));
  return mapped;
}

function resolveMapping(records, aliases) {
  const headers = [...new Set(records.flatMap(record => Object.keys(record || {})))];
  const normalized = new Map(headers.map(header => [normalizeHeader(header), header]));
  return Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, names.map(normalizeHeader).map(name => normalized.get(name)).find(Boolean) || null]));
}

function readField(record, mapping, field, aliases) {
  if (mapping[field] && record[mapping[field]] !== undefined) return record[mapping[field]];
  const indexed = recordMap(record);
  const key = aliases[field].map(normalizeHeader).map(name => indexed.get(name)).find(Boolean);
  return key ? record[key] : null;
}

export function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || String(value).trim() === "") return null;
  let source = String(value).trim();
  const negative = /^\(.*\)$/.test(source);
  source = source.replace(/[,$¥￥€£\s]/g, "").replace(/^\((.*)\)$/, "$1").replace(/%$/, "");
  const number = Number(source);
  return Number.isFinite(number) ? (negative ? -number : number) : null;
}

export function toTimestamp(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  const numeric = toNumber(value);
  if (numeric !== null && /^\s*[\d.]+\s*$/.test(String(value))) {
    if (numeric > 1e12) return numeric;
    if (numeric > 1e9) return numeric * 1000;
    if (numeric > 20000 && numeric < 100000) return Math.round((numeric - 25569) * 86400000);
  }
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const source = String(value).trim();
  const normalized = /^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}/.test(source) ? source.replace(/\s+/, "T") : source;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSide(value) {
  const source = String(value ?? "").trim().toLowerCase();
  if (["long", "buy", "b", "多", "做多", "买", "买入"].includes(source)) return "long";
  if (["short", "sell", "s", "空", "做空", "卖", "卖出"].includes(source)) return "short";
  return null;
}

function symbolKey(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function coverage(trades, field) {
  return trades.length ? 100 * trades.filter(trade => trade[field] !== null && trade[field] !== undefined && trade[field] !== "").length / trades.length : 0;
}

export function normalizeTradeRecords(records) {
  if (!Array.isArray(records) || !records.length) throw new Error("没有交易记录");
  const mapping = resolveMapping(records, TRADE_ALIASES);
  const valid = [];
  const invalid = [];
  const seenIds = new Set();
  const seenComposite = new Set();
  let duplicates = 0;
  records.forEach((record, rowIndex) => {
    const get = field => readField(record, mapping, field, TRADE_ALIASES);
    const suppliedId = String(get("id") ?? "").trim();
    const symbol = String(get("symbol") ?? "").trim().toUpperCase();
    const side = normalizeSide(get("side"));
    const entryTime = toTimestamp(get("entryTime"));
    const exitTime = toTimestamp(get("exitTime"));
    const entryPrice = toNumber(get("entryPrice"));
    const exitPrice = toNumber(get("exitPrice"));
    const suppliedQuantity = toNumber(get("quantity"));
    const suppliedPointValue = toNumber(get("pointValue"));
    const quantity = Math.abs(suppliedQuantity ?? 1);
    const pointValue = Math.abs(suppliedPointValue ?? 1);
    const quantityAssumed = suppliedQuantity === null;
    const pointValueAssumed = suppliedPointValue === null;
    const currency = String(get("currency") ?? "").trim().toUpperCase();
    const fees = Math.abs(toNumber(get("fees")) ?? 0);
    const suppliedPnl = toNumber(get("pnl"));
    let netPnl = suppliedPnl;
    let pnlSource = "provided";
    if (netPnl === null && side && entryPrice !== null && exitPrice !== null) {
      netPnl = (side === "long" ? exitPrice - entryPrice : entryPrice - exitPrice) * quantity * pointValue - fees;
      pnlSource = "calculated_from_prices";
    }
    const stop = toNumber(get("stop"));
    const target = toNumber(get("target"));
    const stopSideValid = stop === null || entryPrice === null || (side === "long" ? stop < entryPrice : stop > entryPrice);
    const targetSideValid = target === null || entryPrice === null || (side === "long" ? target > entryPrice : target < entryPrice);
    const suppliedRisk = Math.abs(toNumber(get("riskAmount")) ?? 0) || null;
    const priceRisk = entryPrice !== null && stop !== null && stopSideValid ? Math.abs(entryPrice - stop) * quantity * pointValue : null;
    const riskAmount = suppliedRisk ?? (priceRisk && priceRisk > 0 ? priceRisk : null);
    const suppliedR = toNumber(get("rMultiple"));
    const calculatedR = riskAmount && netPnl !== null ? netPnl / riskAmount : null;
    const rMultiple = suppliedR ?? calculatedR;
    const plannedRR = entryPrice !== null && stop !== null && target !== null && stopSideValid && targetSideValid && Math.abs(entryPrice - stop) > 0 ? Math.abs(target - entryPrice) / Math.abs(entryPrice - stop) : null;
    const mfeMoney = toNumber(get("mfeMoney"));
    const maeMoney = toNumber(get("maeMoney"));
    const mfeR = toNumber(get("mfeR")) ?? (riskAmount && mfeMoney !== null ? mfeMoney / riskAmount : null);
    const maeR = toNumber(get("maeR")) ?? (riskAmount && maeMoney !== null ? Math.abs(maeMoney) / riskAmount : null);
    const reasons = [];
    if (!symbol) reasons.push("缺少标的");
    if (!side) reasons.push("方向无法识别");
    if (entryTime === null) reasons.push("缺少或无法解析开仓时间");
    if (suppliedQuantity !== null && quantity === 0) reasons.push("数量必须大于0");
    if (suppliedPointValue !== null && pointValue === 0) reasons.push("合约乘数必须大于0");
    if (netPnl === null) reasons.push("缺少盈亏且无法用进出场价格计算");
    if (reasons.length) { invalid.push({ row: rowIndex + 2, reasons, record }); return; }
    const composite = [symbolKey(symbol), side, entryTime, exitTime ?? "", entryPrice ?? "", quantity, netPnl].join("|");
    if ((suppliedId && seenIds.has(suppliedId)) || seenComposite.has(composite)) { duplicates += 1; return; }
    if (suppliedId) seenIds.add(suppliedId);
    seenComposite.add(composite);
    const id = suppliedId || `ROW-${rowIndex + 2}`;
    valid.push({
      id, symbol, symbolKey: symbolKey(symbol), side, entryTime, exitTime, entryPrice, exitPrice, quantity, pointValue,
      netPnl, fees, pnlSource, pnlField: mapping.pnl, stop, target, riskAmount, rMultiple, plannedRR, mfeR, maeR,
      currency, quantityAssumed, pointValueAssumed,
      riskSource: suppliedRisk !== null ? "provided" : priceRisk !== null ? "calculated_from_prices" : null,
      rMismatch: suppliedR !== null && calculatedR !== null && Math.abs(suppliedR - calculatedR) > Math.max(.05, Math.abs(calculatedR) * .08),
      strategy: String(get("strategy") ?? "").trim(), notes: String(get("notes") ?? "").trim(),
      durationMinutes: exitTime && exitTime >= entryTime ? (exitTime - entryTime) / 60000 : null,
      stopSideValid, targetSideValid, sourceRow: rowIndex + 2, marketBars: [], marketCoverage: false,
    });
  });
  valid.sort((left, right) => left.entryTime - right.entryTime || left.id.localeCompare(right.id));
  const fields = ["exitTime", "entryPrice", "exitPrice", "quantity", "pointValue", "currency", "stop", "target", "riskAmount", "rMultiple", "mfeR", "maeR", "strategy", "notes"];
  const fieldCoverage = Object.fromEntries(fields.map(field => [field, pct(coverage(valid, field), 1)]));
  fieldCoverage.quantity = valid.length ? pct(100 * valid.filter(trade => !trade.quantityAssumed).length / valid.length, 1) : 0;
  fieldCoverage.pointValue = valid.length ? pct(100 * valid.filter(trade => !trade.pointValueAssumed).length / valid.length, 1) : 0;
  return {
    trades: valid,
    invalid,
    duplicates,
    mapping,
    rawCount: records.length,
    coverage: fieldCoverage,
  };
}

export function normalizeBarRecords(records) {
  if (!Array.isArray(records) || !records.length) throw new Error("没有 K 线记录");
  const mapping = resolveMapping(records, BAR_ALIASES);
  const bars = [];
  const invalid = [];
  const seen = new Set();
  records.forEach((record, rowIndex) => {
    const get = field => readField(record, mapping, field, BAR_ALIASES);
    const time = toTimestamp(get("time"));
    const open = toNumber(get("open"));
    const high = toNumber(get("high"));
    const low = toNumber(get("low"));
    const close = toNumber(get("close"));
    const symbol = String(get("symbol") ?? "").trim().toUpperCase();
    const reasons = [];
    if (time === null) reasons.push("时间无法解析");
    if ([open, high, low, close].some(value => value === null)) reasons.push("OHLC 不完整");
    if (!reasons.length && (high < Math.max(open, close) || low > Math.min(open, close) || high < low)) reasons.push("OHLC 价格关系无效");
    if (reasons.length) { invalid.push({ row: rowIndex + 2, reasons }); return; }
    const key = `${symbolKey(symbol)}|${time}`;
    if (seen.has(key)) return;
    seen.add(key);
    bars.push({ symbol, symbolKey: symbolKey(symbol), time, open, high, low, close, volume: toNumber(get("volume")) ?? 0 });
  });
  bars.sort((left, right) => left.symbolKey.localeCompare(right.symbolKey) || left.time - right.time);
  return { bars, invalid, mapping, rawCount: records.length };
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function lowerBound(items, time) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (items[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function attachMarketData(trades, bars) {
  if (!Array.isArray(bars) || !bars.length) return trades.map(trade => ({ ...trade, marketBars: [], marketCoverage: false }));
  const groups = new Map();
  bars.forEach(bar => {
    const key = bar.symbolKey || "__NO_SYMBOL__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bar);
  });
  return trades.map(trade => {
    const group = groups.get(trade.symbolKey) || groups.get("__NO_SYMBOL__");
    if (!group?.length) return { ...trade, marketBars: [], marketCoverage: false };
    const diffs = group.slice(1, 120).map((bar, index) => bar.time - group[index].time).filter(value => value > 0);
    const interval = median(diffs) || 60000;
    const entryIndex = lowerBound(group, trade.entryTime);
    const exitAt = trade.exitTime && trade.exitTime >= trade.entryTime ? trade.exitTime : trade.entryTime + interval * 40;
    const exitIndex = lowerBound(group, exitAt + interval);
    const start = Math.max(0, entryIndex - 60);
    const end = Math.min(group.length, Math.max(exitIndex + 20, entryIndex + 30));
    let selected = group.slice(start, end);
    if (selected.length > 800) selected = [...selected.slice(0, 400), ...selected.slice(-400)];
    const active = group.slice(entryIndex, Math.max(entryIndex, exitIndex)).filter(bar => bar.time <= exitAt + interval);
    if (!active.length) return { ...trade, marketBars: selected, marketCoverage: false, marketIntervalMs: interval };
    const favorable = trade.entryPrice === null ? null : trade.side === "long" ? Math.max(...active.map(bar => bar.high - trade.entryPrice)) : Math.max(...active.map(bar => trade.entryPrice - bar.low));
    const adverse = trade.entryPrice === null ? null : trade.side === "long" ? Math.max(...active.map(bar => trade.entryPrice - bar.low)) : Math.max(...active.map(bar => bar.high - trade.entryPrice));
    const riskPerUnit = trade.entryPrice !== null && trade.stop !== null ? Math.abs(trade.entryPrice - trade.stop) : null;
    return {
      ...trade,
      marketBars: selected,
      marketCoverage: true,
      marketIntervalMs: interval,
      mfeR: riskPerUnit && favorable !== null ? favorable / riskPerUnit : trade.mfeR,
      maeR: riskPerUnit && adverse !== null ? adverse / riskPerUnit : trade.maeR,
      excursionSource: riskPerUnit ? "market_bars" : trade.mfeR !== null || trade.maeR !== null ? "provided" : null,
    };
  });
}

function basicStats(trades) {
  const pnls = trades.map(trade => trade.netPnl);
  const wins = trades.filter(trade => trade.netPnl > 0);
  const losses = trades.filter(trade => trade.netPnl < 0);
  const grossProfit = sum(wins.map(trade => trade.netPnl));
  const grossLoss = sum(losses.map(trade => Math.abs(trade.netPnl)));
  const rValues = trades.map(trade => trade.rMultiple).filter(Number.isFinite);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let winStreak = 0;
  let lossStreak = 0;
  const curve = trades.map(trade => {
    equity += trade.netPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    if (trade.netPnl > 0) { winStreak += 1; lossStreak = 0; } else if (trade.netPnl < 0) { lossStreak += 1; winStreak = 0; } else { winStreak = 0; lossStreak = 0; }
    maxWinStreak = Math.max(maxWinStreak, winStreak);
    maxLossStreak = Math.max(maxLossStreak, lossStreak);
    return { id: trade.id, time: trade.entryTime, value: equity };
  });
  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? 100 * wins.length / trades.length : null,
    netPnl: sum(pnls),
    grossProfit,
    grossLoss,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    expectancy: mean(pnls),
    averageWin: mean(wins.map(trade => trade.netPnl)),
    averageLoss: mean(losses.map(trade => trade.netPnl)),
    averageR: mean(rValues),
    rCoverage: trades.length ? 100 * rValues.length / trades.length : 0,
    maxDrawdown,
    maxWinStreak,
    maxLossStreak,
    fees: sum(trades.map(trade => trade.fees)),
    curve,
  };
}

function groupStats(trades, keyFn) {
  const groups = new Map();
  trades.forEach(trade => {
    const key = keyFn(trade) || "未标记";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  });
  return [...groups.entries()].map(([key, items]) => ({ key, ...basicStats(items) })).sort((left, right) => right.count - left.count || right.netPnl - left.netPnl);
}

const timezoneFormatters = new Map();

function safeTimezone(value) {
  const timezone = String(value || "UTC");
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(0);
    return timezone;
  } catch (_error) {
    return "UTC";
  }
}

function zonedParts(timestamp, timezone) {
  if (!timezoneFormatters.has(timezone)) {
    timezoneFormatters.set(timezone, new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }));
  }
  return Object.fromEntries(timezoneFormatters.get(timezone).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
}

function zonedDay(timestamp, timezone) {
  const parts = zonedParts(timestamp, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zonedHour(timestamp, timezone) {
  return zonedParts(timestamp, timezone).hour;
}

function makeBehavior(definition, affected, allTrades, grossLoss, evidenceCoverage, extra = {}) {
  const monetaryComparable = grossLoss !== null;
  const associatedLoss = monetaryComparable ? sum(affected.filter(trade => trade.netPnl < 0).map(trade => Math.abs(trade.netPnl))) : null;
  const associatedNet = monetaryComparable ? sum(affected.map(trade => trade.netPnl)) : null;
  const rate = allTrades.length ? 100 * affected.length / allTrades.length : 0;
  const confidence = clamp(25 + Math.min(affected.length, 8) * 5 + evidenceCoverage * .35, 0, 95);
  const lossShare = grossLoss ? associatedLoss / grossLoss : 0;
  const score = clamp(rate * .32 + lossShare * 48 + confidence * .2 + (extra.scoreBoost || 0), 0, 100);
  return {
    ...definition,
    occurrence: affected.length,
    rate: pct(rate, 1),
    associatedLoss,
    associatedNet,
    affectedTradeIds: affected.map(trade => trade.id),
    evidenceCoverage: pct(evidenceCoverage, 1),
    confidence: pct(confidence, 0),
    score: pct(score, 1),
    ...extra,
  };
}

function behaviorDefinitions(trades, options, grossLoss, fieldCoverage) {
  const definitions = [];
  const add = (definition, affected, evidenceCoverage, extra) => { if (affected.length) definitions.push(makeBehavior(definition, affected, trades, grossLoss, evidenceCoverage, extra)); };
  if (fieldCoverage.stop > 0 && fieldCoverage.stop < 100) add({
    id: "stop_record_missing", label: "止损记录不完整", description: "部分交易没有可核验的入场前失效价。缺失字段不等于一定没有止损，但会让复盘无法区分计划与事后解释。",
    prescription: "未来10笔在入场前记录唯一硬止损价；没有记录，不允许把该笔计为合格执行。", successMetric: "未来10笔止损字段完整率达到100%。",
    limitation: "只能证明记录缺失，不能证明交易员当时完全没有心理止损。",
  }, trades.filter(trade => trade.stop === null), fieldCoverage.stop);

  const budget = options.accountSize * options.riskPercent / 100;
  const riskKnown = trades.filter(trade => Number.isFinite(trade.riskAmount));
  if (budget > 0) add({
    id: "risk_over_budget", label: "单笔风险超过预算", description: `计划风险高于设定的 ${options.riskPercent}% 账户预算至少25%。`,
    prescription: `未来10笔把初始风险锁定在账户的 ${options.riskPercent}% 以内；止损变宽时只减仓，不放大风险金额。`, successMetric: "未来10笔超预算交易为0笔。",
    limitation: "依赖止损、数量、合约乘数和账户金额；任一字段错误都会影响判断。",
  }, riskKnown.filter(trade => trade.riskAmount > budget * 1.25), 100 * riskKnown.length / Math.max(1, trades.length));

  const rrKnown = trades.filter(trade => Number.isFinite(trade.plannedRR));
  add({
    id: "low_planned_rr", label: "计划赔率低于1.5", description: "入场前目标距离不足以覆盖一次完整止损的1.5倍，长期需要更高胜率才能抵消成本。",
    prescription: "未来10笔只有计划赔率达到1:1.5才允许占用风险预算；未达标只观察，不临场放宽目标。", successMetric: "未来10笔低于1:1.5的执行为0笔。",
    limitation: "目标价是计划字段；它不能证明价格一定有能力到达目标。",
  }, rrKnown.filter(trade => trade.plannedRR < 1.5), 100 * rrKnown.length / Math.max(1, trades.length));

  const mfeKnown = trades.filter(trade => Number.isFinite(trade.mfeR) && Number.isFinite(trade.rMultiple));
  const givebacks = mfeKnown.filter(trade => trade.mfeR >= 1 && trade.rMultiple <= .25);
  const givebackR = sum(givebacks.map(trade => Math.max(0, trade.mfeR - Math.max(0, trade.rMultiple))));
  add({
    id: "profit_giveback", label: "达到1R后利润保护不足", description: "交易曾达到至少+1R，最终却只保留不超过+0.25R或转为亏损。",
    prescription: "未来10笔首次达到+1R时执行预先写好的保护动作：减仓或把失效点推进到结构保护位，二选一并保持一致。", successMetric: "未来10笔“达到+1R后最终≤0R”的发生率低于10%。",
    limitation: "浮盈回吐与亏损共现不等于这些利润必然可以保住。",
  }, givebacks, 100 * mfeKnown.length / Math.max(1, trades.length), { opportunityR: pct(givebackR, 2), scoreBoost: Math.min(15, givebackR) });

  const maeKnown = trades.filter(trade => Number.isFinite(trade.maeR) && Number.isFinite(trade.rMultiple));
  add({
    id: "stop_overrun", label: "亏损超过原始1R", description: "行情最大不利波动超过1.2R，且最终亏损超过1.05R，说明止损执行或滑点需要核查。",
    prescription: "未来10笔触及硬止损立即退出，并记录预期止损价与实际成交价的差额。", successMetric: "未来10笔最终亏损不超过-1.05R；滑点单独记账。",
    limitation: "需要可靠K线或MAE字段；跳空和流动性滑点必须与纪律违规分开。",
  }, maeKnown.filter(trade => trade.maeR >= 1.2 && trade.rMultiple <= -1.05), 100 * maeKnown.length / Math.max(1, trades.length));

  const revenge = [];
  for (let index = 1; index < trades.length; index += 1) {
    const previous = trades[index - 1];
    const current = trades[index];
    if (previous.netPnl >= 0 || !previous.exitTime) continue;
    const minutes = (current.entryTime - previous.exitTime) / 60000;
    if (minutes >= 0 && minutes <= options.revengeMinutes) revenge.push(current);
  }
  add({
    id: "rapid_reentry_after_loss", label: "亏损后快速再入场", description: `上一笔亏损结束后 ${options.revengeMinutes} 分钟内再次开仓。它是报复性交易的风险代理，不直接等同于情绪失控。`,
    prescription: `未来10笔亏损后强制等待 ${options.revengeMinutes} 分钟，并重新写方向、失效点和赔率后才能开下一笔。`, successMetric: `未来10笔亏损后 ${options.revengeMinutes} 分钟内再入场为0笔。`,
    limitation: "只能识别时间上的快速再入场；没有当时自评时不能断言交易动机。",
  }, revenge, fieldCoverage.exitTime);

  const byDay = new Map();
  trades.forEach(trade => {
    const day = zonedDay(trade.entryTime, options.timezone);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(trade);
  });
  const overtrades = [...byDay.values()].flatMap(items => items.length > options.maxDailyTrades ? items.slice(options.maxDailyTrades) : []);
  add({
    id: "overtrading", label: "单日交易超过上限", description: `单日第 ${options.maxDailyTrades + 1} 笔及之后的交易被标记，用于检验交易频率是否挤压选择质量。`,
    prescription: `未来10笔设置每日最多 ${options.maxDailyTrades} 笔；达到上限后只记录机会，不再执行。`, successMetric: `未来10笔中没有超过每日 ${options.maxDailyTrades} 笔上限的执行。`,
    limitation: "上限来自用户设置，不代表所有策略的普遍最优频率。",
  }, overtrades, 100);

  const escalation = [];
  for (let index = 1; index < trades.length; index += 1) {
    const previous = trades[index - 1];
    const current = trades[index];
    if (previous.netPnl < 0 && previous.riskAmount && current.riskAmount > previous.riskAmount * 1.5) escalation.push(current);
  }
  add({
    id: "risk_escalation_after_loss", label: "亏损后扩大风险", description: "上一笔亏损后，下一笔计划风险提高了至少50%。",
    prescription: "未来10笔使用固定风险金额；亏损后下一笔不得提高1R，只有账户权益创新高后才重新计算。", successMetric: "未来10笔亏损后扩大风险为0笔。",
    limitation: "依赖每笔风险金额；策略切换和合约乘数变化需要人工确认。",
  }, escalation, 100 * riskKnown.length / Math.max(1, trades.length));
  return definitions.sort((left, right) => right.score - left.score || right.occurrence - left.occurrence);
}

function dimension(label, values, pass, definition) {
  const known = values.filter(value => value !== null && value !== undefined);
  return { label, score: known.length ? pct(100 * known.filter(pass).length / known.length, 0) : null, coverage: values.length ? pct(100 * known.length / values.length, 0) : 0, definition };
}

export function analyzeTrades(trades, inputOptions = {}) {
  const options = {
    accountSize: Number(inputOptions.accountSize) > 0 ? Number(inputOptions.accountSize) : 10000,
    riskPercent: Number(inputOptions.riskPercent) > 0 ? Number(inputOptions.riskPercent) : 1,
    maxDailyTrades: Number(inputOptions.maxDailyTrades) > 0 ? Math.round(Number(inputOptions.maxDailyTrades)) : 6,
    revengeMinutes: Number(inputOptions.revengeMinutes) >= 0 ? Number(inputOptions.revengeMinutes) : 20,
    timezone: safeTimezone(inputOptions.timezone),
  };
  const ordered = trades.slice().sort((left, right) => left.entryTime - right.entryTime || left.id.localeCompare(right.id));
  const summary = basicStats(ordered);
  const fieldCoverage = {
    exitTime: coverage(ordered, "exitTime"), stop: coverage(ordered, "stop"), target: coverage(ordered, "target"),
    riskAmount: coverage(ordered, "riskAmount"), rMultiple: coverage(ordered, "rMultiple"), mfeR: coverage(ordered, "mfeR"),
    maeR: coverage(ordered, "maeR"), strategy: coverage(ordered, "strategy"), notes: coverage(ordered, "notes"),
    quantity: ordered.length ? 100 * ordered.filter(trade => !trade.quantityAssumed).length / ordered.length : 0,
    pointValue: ordered.length ? 100 * ordered.filter(trade => !trade.pointValueAssumed).length / ordered.length : 0,
    currency: coverage(ordered, "currency"),
    market: ordered.length ? 100 * ordered.filter(trade => trade.marketCoverage).length / ordered.length : 0,
  };
  const currencies = [...new Set(ordered.map(trade => trade.currency).filter(Boolean))].sort();
  const behaviors = behaviorDefinitions(ordered, options, currencies.length > 1 ? null : summary.grossLoss, fieldCoverage);
  const repeatable = behaviors.filter(behavior => behavior.occurrence >= 2);
  const sampleStatus = ordered.length < 5 ? "insufficient" : ordered.length < 20 ? "early" : "usable";
  const primary = sampleStatus === "insufficient" ? null : repeatable[0] || null;
  const recentTrades = ordered.slice(-10);
  const priorTrades = ordered.slice(0, Math.max(0, ordered.length - recentTrades.length));
  const recent = basicStats(recentTrades);
  const prior = basicStats(priorTrades);
  const behaviorRate = (items, behavior) => behavior && items.length ? 100 * items.filter(trade => behavior.affectedTradeIds.includes(trade.id)).length / items.length : null;
  const recentBehaviorRate = behaviorRate(recentTrades, primary);
  const priorBehaviorRate = behaviorRate(priorTrades, primary);
  const requiredCoverage = ordered.length ? 100 : 0;
  const invalidStops = ordered.filter(trade => !trade.stopSideValid);
  const invalidTargets = ordered.filter(trade => !trade.targetSideValid);
  const reversedTimes = ordered.filter(trade => trade.exitTime !== null && trade.exitTime < trade.entryTime);
  const calculatedWithDefaults = ordered.filter(trade => (trade.pnlSource === "calculated_from_prices" || trade.riskSource === "calculated_from_prices") && (trade.quantityAssumed || trade.pointValueAssumed));
  const rMismatches = ordered.filter(trade => trade.rMismatch);
  const ambiguousPnl = ordered.filter(trade => trade.pnlSource === "provided" && trade.fees > 0 && ["pnl", "profit", "profitloss"].includes(normalizeHeader(trade.pnlField)));
  const baseQuality = requiredCoverage * .5 + fieldCoverage.exitTime * .08 + fieldCoverage.stop * .1 + fieldCoverage.target * .05 + fieldCoverage.rMultiple * .07 + fieldCoverage.market * .2;
  const qualityPenalty = 100 * (invalidStops.length + invalidTargets.length + reversedTimes.length + rMismatches.length) / Math.max(1, ordered.length) * .2
    + 100 * calculatedWithDefaults.length / Math.max(1, ordered.length) * .12
    + (currencies.length > 1 ? 18 : 0);
  const qualityScore = pct(clamp(baseQuality - qualityPenalty, 0, 100), 0);
  const qualityIssues = [];
  if (fieldCoverage.stop === 0) qualityIssues.push({ severity: "high", label: "止损字段覆盖为0%", impact: "无法判断每笔1R、超预算风险和止损执行。" });
  else if (fieldCoverage.stop < 80) qualityIssues.push({ severity: "medium", label: `止损字段覆盖 ${pct(fieldCoverage.stop, 0)}%`, impact: "部分交易无法进行R倍数和失效点复盘。" });
  if (fieldCoverage.target < 50) qualityIssues.push({ severity: "medium", label: `目标字段覆盖 ${pct(fieldCoverage.target, 0)}%`, impact: "多数交易无法核验入场前计划赔率。" });
  if (fieldCoverage.market === 0) qualityIssues.push({ severity: "info", label: "尚未匹配历史K线", impact: "不会输出具体K线结构或自动推断MFE/MAE。" });
  if (fieldCoverage.exitTime < 80) qualityIssues.push({ severity: "medium", label: `平仓时间覆盖 ${pct(fieldCoverage.exitTime, 0)}%`, impact: "持仓时长和亏损后快速再入场判断会降级。" });
  if (invalidStops.length) qualityIssues.push({ severity: "high", label: `${invalidStops.length} 笔止损位于方向错误的一侧`, impact: "这些止损不参与计划赔率和按价格计算的风险。" });
  if (invalidTargets.length) qualityIssues.push({ severity: "high", label: `${invalidTargets.length} 笔目标位于方向错误的一侧`, impact: "这些目标不参与计划赔率判断。" });
  if (reversedTimes.length) qualityIssues.push({ severity: "high", label: `${reversedTimes.length} 笔平仓时间早于开仓`, impact: "这些交易的持仓时长和快速再入场判断不可用。" });
  if (calculatedWithDefaults.length) qualityIssues.push({ severity: "medium", label: `${calculatedWithDefaults.length} 笔使用默认数量或合约乘数`, impact: "由价格计算的盈亏/风险可能不适用于期货合约，请补 quantity 与 point_value。" });
  if (rMismatches.length) qualityIssues.push({ severity: "medium", label: `${rMismatches.length} 笔结果R与净盈亏/风险不一致`, impact: "系统保留源文件R，但需要核对风险金额与单位。" });
  if (ambiguousPnl.length) qualityIssues.push({ severity: "medium", label: `${ambiguousPnl.length} 笔使用 PnL/Profit 字段且另有费用`, impact: "系统不会二次扣费；请确认该字段已经是净盈亏，推荐改名 net_pnl。" });
  if (currencies.length > 1) qualityIssues.push({ severity: "high", label: `检测到混合盈亏币种：${currencies.join(" / ")}`, impact: "不同币种不能直接合计；总盈亏、期望值、PF和回撤仅作原值提示。" });
  const dimensions = [
    dimension("止损记录", ordered.map(trade => trade.stop), value => Number.isFinite(value), "入场前硬失效价覆盖率"),
    dimension("计划赔率", ordered.map(trade => trade.plannedRR), value => value >= 1.5, "有完整计划的交易中，赔率≥1:1.5的比例"),
    dimension("风险预算", ordered.map(trade => trade.riskAmount), value => value <= options.accountSize * options.riskPercent / 100 * 1.25, "风险已知交易中，不超过预算125%的比例"),
    dimension("利润保护", ordered.map(trade => Number.isFinite(trade.mfeR) && trade.mfeR >= 1 && Number.isFinite(trade.rMultiple) ? trade.rMultiple : null), value => value > 0, "达到+1R后最终仍保留正R的比例"),
    dimension("过程证据", ordered.map(trade => trade.strategy || trade.notes || null), value => Boolean(value), "策略或原始备注覆盖率"),
  ];
  const rolling = ordered.map((trade, index) => {
    const windowTrades = ordered.slice(Math.max(0, index - 9), index + 1);
    return { index: index + 1, time: trade.entryTime, expectancy: basicStats(windowTrades).expectancy, behaviorRate: behaviorRate(windowTrades, primary) };
  });
  let prescription;
  if (sampleStatus === "insufficient") prescription = { title: "先补足最小复盘样本", action: "至少导入5笔已完成交易，并补齐方向、时间和净盈亏；推荐20笔后再判断重复行为。", successMetric: "有效交易达到5笔以上。", confidence: 0 };
  else if (primary) prescription = { title: primary.label, action: primary.prescription, successMetric: primary.successMetric, confidence: primary.confidence };
  else if (fieldCoverage.stop === 0) prescription = { title: "先建立可复盘记录", action: "未来10笔在入场前记录止损、目标和计划风险；当前数据不能可靠挑选行为处方。", successMetric: "未来10笔止损和目标字段覆盖率达到100%。", confidence: 25 };
  else prescription = { title: "暂未发现重复且高成本的行为", action: "继续用同一字段模板记录未来10笔，不为凑结论而扩大解释。", successMetric: "保持字段完整，并等待至少2次同类行为后再立项。", confidence: 40 };
  return {
    options, trades: ordered, summary, currencies, fieldCoverage, qualityScore, qualityIssues, behaviors, primary, prescription, sampleStatus,
    recent: { ...recent, behaviorRate: recentBehaviorRate }, prior: { ...prior, behaviorRate: priorBehaviorRate }, rolling, dimensions,
    groups: {
      symbols: groupStats(ordered, trade => trade.symbol),
      strategies: groupStats(ordered, trade => trade.strategy || "未标记"),
      sides: groupStats(ordered, trade => trade.side === "long" ? "做多" : "做空"),
      hours: groupStats(ordered, trade => `${zonedHour(trade.entryTime, options.timezone)}:00`),
    },
  };
}

export function reviewTrade(trade, analysis) {
  const planned = trade.stop !== null && trade.target !== null && trade.entryPrice !== null && trade.stopSideValid && trade.targetSideValid;
  const plan = planned
    ? `入场 ${trade.entryPrice}，硬失效 ${trade.stop}，目标 ${trade.target}，计划赔率 1:${pct(trade.plannedRR, 2)}。老手会先确认失效点成立，再决定仓位；价格没有到计划位置时不追。`
    : !trade.stopSideValid || !trade.targetSideValid
      ? "止损或目标位于交易方向错误的一侧，不能被当成有效计划。先核对多空方向和价格单位，再讨论更好的进出场。"
      : "缺少完整的入场、止损或目标字段。专业复盘的第一步不是猜更好的点位，而是承认无法证明这笔交易入场前存在完整计划。";
  let management = "没有MFE/MAE或匹配K线，无法判断持仓途中是否出现过可执行的加减仓或利润保护位置。";
  if (Number.isFinite(trade.mfeR) || Number.isFinite(trade.maeR)) {
    management = `持仓期间最大有利波动 ${Number.isFinite(trade.mfeR) ? `${pct(trade.mfeR, 2)}R` : "未知"}，最大不利波动 ${Number.isFinite(trade.maeR) ? `${pct(trade.maeR, 2)}R` : "未知"}。`;
    if (trade.mfeR >= 1 && trade.rMultiple <= 0) management += " 曾达到+1R后最终转亏；应核对预先写好的保护动作是否执行，而不是事后假设最高点可以卖出。";
    else if (trade.maeR > 1.2) management += " 不利波动超过原始1R；需要区分跳空/滑点与止损未执行。";
  }
  const preEntryBars = (trade.marketBars || []).filter(bar => bar.time < trade.entryTime).slice(-30);
  let context = null;
  let structure = trade.marketCoverage
    ? `已匹配持仓期K线，但入场前只有 ${preEntryBars.length} 根上下文，少于形成结构判断所需的8根；因此不输出趋势或支撑阻力结论。`
    : "未导入覆盖该交易的历史K线，因此不会冒充PA、趋势或支撑阻力专家给出具体点位。";
  if (preEntryBars.length >= 8 && trade.entryPrice !== null) {
    const first = preEntryBars[0].close;
    const last = preEntryBars.at(-1).close;
    const high = Math.max(...preEntryBars.map(bar => bar.high));
    const low = Math.min(...preEntryBars.map(bar => bar.low));
    const position = high > low ? 100 * (trade.entryPrice - low) / (high - low) : 50;
    const averageRange = mean(preEntryBars.map(bar => Math.max(0, bar.high - bar.low))) || 0;
    const trendThreshold = Math.max(Math.abs(first) * .0002, averageRange * 1.5);
    const trend = last - first > trendThreshold ? "上行" : first - last > trendThreshold ? "下行" : "横向";
    const recent = preEntryBars.slice(-8);
    context = {
      trend,
      position: clamp(position, 0, 100),
      high,
      low,
      recentHigh: Math.max(...recent.map(bar => bar.high)),
      recentLow: Math.min(...recent.map(bar => bar.low)),
      recentMid: (Math.max(...recent.map(bar => bar.high)) + Math.min(...recent.map(bar => bar.low))) / 2,
    };
    structure = `入场前 ${preEntryBars.length} 根K线整体${trend}；入场价位于该窗口从低到高约 ${pct(clamp(position, 0, 100), 0)}% 位置。这个描述只用于定位，不等于方向优势。`;
  }
  const flags = analysis.behaviors.filter(behavior => behavior.affectedTradeIds.includes(trade.id)).map(behavior => behavior.label);
  const result = Number.isFinite(trade.rMultiple) ? `${trade.rMultiple >= 0 ? "+" : ""}${pct(trade.rMultiple, 2)}R` : `${trade.netPnl >= 0 ? "+" : ""}${pct(trade.netPnl, 2)}`;
  const expertLenses = [];
  if (context) {
    const aligned = (trade.side === "long" && context.trend === "上行") || (trade.side === "short" && context.trend === "下行");
    const trigger = trade.side === "long" ? context.recentHigh : context.recentLow;
    const invalidation = trade.side === "long" ? context.recentLow : context.recentHigh;
    expertLenses.push({
      label: "趋势 / 价格行为镜头",
      text: aligned
        ? `方向与入场前趋势一致。老手不会因为“看对方向”直接追价：候选计划是等最近8根边界 ${pct(trigger, 4)} 被确认，再观察回踩是否守住；结构失效参考 ${pct(invalidation, 4)}。实际仓位仍以原始止损控制在1R内。`
        : `这是一笔${context.trend === "横向" ? "缺少趋势优势" : "与入场前趋势相反"}的尝试。趋势交易者会等待最近8根边界 ${pct(trigger, 4)} 被收复/跌破并确认后再参与；确认前不加仓，结构失效参考 ${pct(invalidation, 4)}。`,
    });
    expertLenses.push({
      label: "区间 / 均值回归镜头",
      text: context.trend === "横向"
        ? `区间派只在边缘承担风险：最近8根低点 ${pct(context.recentLow, 4)}、高点 ${pct(context.recentHigh, 4)}、中值 ${pct(context.recentMid, 4)}。靠近中值入场没有足够空间；到对侧先减仓，突破边界则退出原假设。`
        : `当前窗口有${context.trend}倾向，均值回归派不会仅因价格“涨多/跌多”逆势。它会等价格偏离后重新回到最近8根中值 ${pct(context.recentMid, 4)}，再以边界 ${pct(trade.side === "long" ? context.recentLow : context.recentHigh, 4)} 为条件判断，而不是提前猜顶底。`,
    });
    expertLenses.push({
      label: "Paul Wei 方法迁移 · D级",
      text: `本页没有为该时点运行Paul Wei历史相似度模型，所以不伪造动作概率。这里只迁移可核验的顺序：先用小于完整1R的试仓；只有价格向有利方向确认 ${pct(trigger, 4)} 且总风险仍在预算内才加；结构退回 ${pct(invalidation, 4)} 先减风险再退出。Sell/减多不自动解释为开空。`,
    });
  } else {
    expertLenses.push({
      label: "专家会诊状态",
      text: "缺少足够的入场前K线上下文，趋势、区间与Paul Wei方法迁移均暂停。补充OHLC后才会给出带价格边界的条件计划；当前只复盘订单和风险执行。",
    });
  }
  return {
    plan,
    management,
    structure,
    result: `最终结果 ${result}；${trade.exitTime ? `持仓 ${pct(trade.durationMinutes, 0)} 分钟` : "缺少平仓时间"}。结果用于验证执行，不反向证明原始方向一定正确或错误。`,
    flags,
    expertLenses,
    canSay: ["订单字段、已发生盈亏与可计算R", trade.marketCoverage ? "匹配K线中的实际路径与MFE/MAE" : "当前没有K线结构证据", "规则命中的行为共现"],
    cannotSay: ["某个最高点本来一定可以成交", "关联亏损就是可挽回利润", "缺少时间戳证据时冒充某位大师的真实做法"],
  };
}

export function createExportReport(analysis, metadata = {}) {
  const aggregateStats = (stats, includeCurve = false) => {
    const { curve, ...rest } = stats;
    return includeCurve ? { ...rest, curve: curve.map((point, index) => ({ index: index + 1, value: point.value })) } : rest;
  };
  const aggregateGroups = Object.fromEntries(Object.entries(analysis.groups).map(([key, rows]) => [key, rows.map(row => aggregateStats(row))]));
  return {
    schema: "traderhome_review_report_v1",
    generatedAt: new Date().toISOString(),
    source: metadata.source || "browser_import",
    sourceName: metadata.sourceName || null,
    settings: analysis.options,
    sampleStatus: analysis.sampleStatus,
    summary: aggregateStats(analysis.summary, true),
    currencies: analysis.currencies,
    fieldCoverage: analysis.fieldCoverage,
    qualityScore: analysis.qualityScore,
    qualityIssues: analysis.qualityIssues,
    primary: analysis.primary ? { ...analysis.primary } : null,
    prescription: analysis.prescription,
    behaviors: analysis.behaviors.map(behavior => ({ ...behavior })),
    dimensions: analysis.dimensions,
    groups: aggregateGroups,
    privacy: "报告只含聚合指标、脱敏权益序号与受影响交易ID；不含逐笔时间、价格和原始备注。TraderHome没有接收或保存原始成交记录。",
  };
}
