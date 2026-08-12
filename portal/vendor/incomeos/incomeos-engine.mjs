const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const scale = (value, low, high) => clamp(((value - low) / (high - low)) * 100);
const inverseScale = (value, good, bad) => 100 - scale(value, good, bad);
const average = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
};
const round = (value, digits = 2) => Number(value.toFixed(digits));

export const ALLOCATION_ANCHORS = [
  { account: 0, core: 0.55, dividend: 0.15, growth: 0.10, option: 0.00, reserve: 0.20 },
  { account: 20_000, core: 0.50, dividend: 0.15, growth: 0.15, option: 0.05, reserve: 0.15 },
  { account: 60_000, core: 0.45, dividend: 0.15, growth: 0.15, option: 0.15, reserve: 0.10 },
  { account: 150_000, core: 0.48, dividend: 0.17, growth: 0.15, option: 0.12, reserve: 0.08 },
  { account: 300_000, core: 0.50, dividend: 0.18, growth: 0.16, option: 0.11, reserve: 0.05 },
  { account: 500_000, core: 0.52, dividend: 0.18, growth: 0.16, option: 0.10, reserve: 0.04 },
];

export function allocationFor(accountValue) {
  const account = Math.max(0, Number(accountValue) || 0);
  let left = ALLOCATION_ANCHORS[0];
  let right = ALLOCATION_ANCHORS.at(-1);
  for (let index = 1; index < ALLOCATION_ANCHORS.length; index += 1) {
    if (account <= ALLOCATION_ANCHORS[index].account) {
      left = ALLOCATION_ANCHORS[index - 1];
      right = ALLOCATION_ANCHORS[index];
      break;
    }
    left = ALLOCATION_ANCHORS[index];
  }
  if (account >= right.account) return { ...right };
  const width = Math.max(1, right.account - left.account);
  const progress = clamp((account - left.account) / width, 0, 1);
  const result = { account };
  for (const key of ["core", "dividend", "growth", "option", "reserve"]) {
    result[key] = left[key] + (right[key] - left[key]) * progress;
  }
  return result;
}

export function accountStage(accountValue) {
  const value = Math.max(0, Number(accountValue) || 0);
  if (value < 20_000) return { id: "accumulate", label: "积累期", detail: "碎股定投优先，期权资金先停泊。" };
  if (value < 60_000) return { id: "prepare", label: "准备期", detail: "开始建立 put 准备金，但不牺牲宽基核心。" };
  if (value < 150_000) return { id: "first_put", label: "首份合约期", detail: "只允许低集中度、愿意接货的现金担保 put。" };
  if (value < 300_000) return { id: "portfolio_income", label: "组合收益期", detail: "ETF 与单股期权分层，单股仍受 12% 上限约束。" };
  return { id: "mature", label: "成熟期", detail: "JPM 级别的现金担保 put 才可能不突破集中度上限。" };
}

export function growthCycleScore(asset) {
  const history = average([
    scale(asset.cagr10y, 8, 22),
    scale(asset.cagr5y, 5, 22),
    scale(asset.cagr3y, 8, 40),
  ]);
  const expectations = average([
    scale(asset.revenueYoy, 0, 30),
    scale(asset.profitYoy, 0, 50),
    scale(asset.epsYoy, 0, 50),
    scale(asset.epsRevision, 0, 20),
    asset.epsBeatRate,
  ]);
  const quality = average([
    scale(asset.roe, 8, 20),
    inverseScale(Math.abs((asset.payoutRatio ?? 40) - 35), 0, 35),
  ]);
  const valuation = 100 - 0.7 * average([asset.pbPercentile, asset.pePercentile]);
  const risk = average([
    inverseScale(asset.annVol, 12, 35),
    inverseScale(Math.abs(asset.maxDrawdown), 20, 50),
  ]);
  const income = average([
    scale(asset.dividendYield, 0.5, 4),
    inverseScale(Math.abs((asset.payoutRatio ?? 40) - 35), 0, 35),
    scale(asset.dpsVsFiveYearAverage, 0, 40),
  ]);
  const total = history * 0.30 + expectations * 0.20 + quality * 0.15
    + valuation * 0.15 + risk * 0.15 + income * 0.05;
  return {
    total: round(total, 0),
    history: round(history, 0),
    expectations: round(expectations, 0),
    quality: round(quality, 0),
    valuation: round(valuation, 0),
    risk: round(risk, 0),
    income: round(income, 0),
  };
}

export function evaluatePut(candidate, accountValue, optionReserve) {
  const account = Math.max(0, Number(accountValue) || 0);
  const reserve = Math.max(0, Number(optionReserve) || 0);
  const reasons = [];
  const concentration = account > 0 ? candidate.cashRequired / account : Infinity;
  if (reserve < candidate.cashRequired) reasons.push(`准备金还差 $${Math.ceil(candidate.cashRequired - reserve).toLocaleString("en-US")}`);
  if (concentration > candidate.maxConcentration) {
    reasons.push(`被指派后占账户 ${(concentration * 100).toFixed(1)}%，超过 ${(candidate.maxConcentration * 100).toFixed(0)}% 上限`);
  }
  if (Math.abs(candidate.delta) < 0.18 || Math.abs(candidate.delta) > 0.27) reasons.push("Delta 不在 0.18–0.27 闸门");
  if (candidate.oi < 500) reasons.push("OI 低于 500");
  if (candidate.ivHv < 0.95) reasons.push("IV/HV 低于 0.95");
  if (candidate.simpleAnnualYield < 6) reasons.push("年化权利金代理低于 6%");
  if (candidate.earningsBeforeExpiry) reasons.push("到期前跨越财报日");
  if (!candidate.valuationGate) reasons.push("估值周期闸门未通过");
  if (!candidate.hasBidAsk) reasons.push("快照缺 bid/ask，IBKR 必须复核限价与价差");
  return {
    eligible: reasons.length === 0,
    reasons,
    concentration: Number.isFinite(concentration) ? round(concentration * 100, 1) : null,
  };
}

export function contributionPlan(input, snapshot) {
  const accountValue = Math.max(0, Number(input.accountValue) || 0);
  const weeklyContribution = Math.max(0, Number(input.weeklyContribution) || 0);
  const optionReserve = Math.max(0, Number(input.optionReserve) || 0);
  const currentGrowthValue = Math.max(0, Number(input.currentGrowthValue) || 0);
  const postDepositValue = accountValue + weeklyContribution;
  const split = allocationFor(postDepositValue);
  const stage = accountStage(postDepositValue);
  const desiredGrowth = weeklyContribution * split.growth;
  const growthRoom = Math.max(0, postDepositValue * 0.12 - currentGrowthValue);
  const growthAmount = Math.min(desiredGrowth, growthRoom);
  const redirected = desiredGrowth - growthAmount;
  const amounts = {
    core: weeklyContribution * split.core + redirected,
    dividend: weeklyContribution * split.dividend,
    growth: growthAmount,
    option: weeklyContribution * split.option,
    reserve: weeklyContribution * split.reserve,
  };
  const projectedOptionReserve = optionReserve + amounts.option;
  const puts = snapshot.puts.map((candidate) => ({
    ...candidate,
    evaluation: evaluatePut(candidate, postDepositValue, projectedOptionReserve),
  }));
  const executablePut = puts.find((candidate) => candidate.evaluation.eligible) ?? null;
  return {
    accountValue,
    weeklyContribution,
    postDepositValue,
    currentGrowthValue,
    split,
    stage,
    amounts,
    projectedOptionReserve,
    puts,
    executablePut,
  };
}

export function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value || 0);
}

const PORTFOLIO_ANCHORS = [
  { account: 0, core: 0.55, dividend: 0.20, growthEtf: 0.00, reserve: 0.15, satellites: 0.10 },
  { account: 20_000, core: 0.50, dividend: 0.18, growthEtf: 0.04, reserve: 0.15, satellites: 0.13 },
  { account: 60_000, core: 0.42, dividend: 0.16, growthEtf: 0.06, reserve: 0.14, satellites: 0.22 },
  { account: 150_000, core: 0.32, dividend: 0.13, growthEtf: 0.08, reserve: 0.12, satellites: 0.35 },
  { account: 300_000, core: 0.30, dividend: 0.14, growthEtf: 0.08, reserve: 0.10, satellites: 0.38 },
  { account: 500_000, core: 0.30, dividend: 0.15, growthEtf: 0.08, reserve: 0.10, satellites: 0.37 },
];

function interpolatedPortfolioSleeves(accountValue) {
  const account = Math.max(0, Number(accountValue) || 0);
  let left = PORTFOLIO_ANCHORS[0];
  let right = PORTFOLIO_ANCHORS.at(-1);
  for (let index = 1; index < PORTFOLIO_ANCHORS.length; index += 1) {
    if (account <= PORTFOLIO_ANCHORS[index].account) {
      left = PORTFOLIO_ANCHORS[index - 1];
      right = PORTFOLIO_ANCHORS[index];
      break;
    }
    left = PORTFOLIO_ANCHORS[index];
  }
  if (account >= right.account) return { ...right, account };
  const progress = (account - left.account) / Math.max(1, right.account - left.account);
  const result = { account };
  for (const key of ["core", "dividend", "growthEtf", "reserve", "satellites"]) {
    result[key] = left[key] + (right[key] - left[key]) * progress;
  }
  return result;
}

export function dynamicPortfolioWeights(model, accountValue) {
  const sleeves = interpolatedPortfolioSleeves(accountValue);
  const byTicker = new Map((model?.weights ?? []).map((item) => [item.ticker, item]));
  const satelliteModels = (model?.weights ?? []).filter((item) => !["SPY", "SCHD", "QQQ", "SGOV"].includes(item.ticker));
  const satelliteWeight = satelliteModels.length ? sleeves.satellites / satelliteModels.length : 0;
  const rows = [
    { ...(byTicker.get("SPY") ?? { ticker: "SPY", symbol: "SPY.US", name: "SPDR S&P 500 ETF", role: "宽基核心" }), weight: sleeves.core },
    { ...(byTicker.get("SCHD") ?? { ticker: "SCHD", symbol: "SCHD.US", name: "Schwab US Dividend Equity ETF", role: "股息质量" }), weight: sleeves.dividend },
    { ...(byTicker.get("QQQ") ?? { ticker: "QQQ", symbol: "QQQ.US", name: "Invesco QQQ", role: "成长宽基" }), weight: sleeves.growthEtf },
    { ...(byTicker.get("SGOV") ?? { ticker: "SGOV", symbol: "SGOV.US", name: "iShares 0-3 Month Treasury Bond ETF", role: "现金/期权准备" }), weight: sleeves.reserve },
    ...satelliteModels.map((item) => ({ ...item, weight: satelliteWeight })),
  ];
  return rows.filter((item) => item.weight > 0.0001);
}

export function allocateDollarOrders(totalDollars, weights) {
  const totalCents = Math.max(0, Math.round((Number(totalDollars) || 0) * 100));
  const raw = weights.map((item) => totalCents * item.weight);
  const cents = raw.map(Math.floor);
  let remaining = totalCents - cents.reduce((sum, value) => sum + value, 0);
  const priority = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let cursor = 0; remaining > 0 && priority.length; cursor += 1) {
    cents[priority[cursor % priority.length].index] += 1;
    remaining -= 1;
  }
  return weights.map((item, index) => ({ ...item, amount: cents[index] / 100 }));
}

const WHOLE_SHARE_PROXY = {
  SPY: "SPYM",
};

function wholeShareAssetMap(data) {
  return new Map([...(data?.assets ?? []), ...(data?.executionAssets ?? [])].map((asset) => [asset.ticker, asset]));
}

export function allocateWholeShareOrders(totalDollars, weights, data, options = {}) {
  const budget = Math.max(0, round(Number(totalDollars) || 0));
  const cashBuffer = Math.min(budget, Math.max(0, round(Number(options.cashBuffer) || 0)));
  const spendableBudget = round(budget - cashBuffer);
  const assetMap = wholeShareAssetMap(data);
  const targets = new Map();
  const deferred = [];
  const blocked = [];
  let reserveRedirect = 0;

  for (const item of weights) {
    const executionTicker = WHOLE_SHARE_PROXY[item.ticker] ?? item.ticker;
    const asset = assetMap.get(executionTicker);
    const targetAmount = spendableBudget * item.weight;
    const price = Number(asset?.price);
    const validPrice = Number.isFinite(price) && price > 0;
    if (!validPrice) {
      blocked.push({ ticker: item.ticker, executionTicker, reason: "缺少有效执行价格" });
      deferred.push({
        ticker: item.ticker,
        executionTicker,
        role: item.role,
        targetAmount: round(targetAmount),
        price: null,
        reason: "缺少可执行价格，本次保留现金",
      });
      continue;
    }
    if (item.ticker !== "SGOV" && targetAmount + 0.005 < price) {
      reserveRedirect += targetAmount;
      deferred.push({
        ticker: item.ticker,
        executionTicker,
        role: item.role,
        targetAmount: round(targetAmount),
        price: validPrice ? price : null,
        reason: "目标金额不足一股，暂时并入 SGOV",
      });
      continue;
    }
    const current = targets.get(executionTicker) ?? {
      ...item,
      ticker: executionTicker,
      sourceTicker: item.ticker,
      proxyFor: executionTicker === item.ticker ? null : item.ticker,
      symbol: asset?.symbol ?? `${executionTicker}.US`,
      name: asset?.name ?? item.name,
      price: validPrice ? price : null,
      targetAmount: 0,
      targetWeight: 0,
    };
    current.targetAmount += targetAmount;
    current.targetWeight += item.weight;
    targets.set(executionTicker, current);
  }

  const reserve = targets.get("SGOV");
  if (reserve) {
    reserve.targetAmount += reserveRedirect;
    reserve.targetWeight += spendableBudget > 0 ? reserveRedirect / spendableBudget : 0;
  } else if (reserveRedirect > 0) {
    const asset = assetMap.get("SGOV");
    const price = Number(asset?.price);
    targets.set("SGOV", {
      ticker: "SGOV",
      sourceTicker: "SGOV",
      proxyFor: null,
      symbol: asset?.symbol ?? "SGOV.US",
      name: asset?.name ?? "iShares 0-3 Month Treasury Bond ETF",
      role: "现金/整数股等待区",
      weight: spendableBudget > 0 ? reserveRedirect / spendableBudget : 0,
      targetWeight: spendableBudget > 0 ? reserveRedirect / spendableBudget : 0,
      targetAmount: reserveRedirect,
      price: Number.isFinite(price) && price > 0 ? price : null,
    });
  }

  const candidates = [...targets.values()]
    .filter((item) => Number.isFinite(item.price) && item.price > 0 && item.targetAmount > 0)
    .map((item) => ({ ...item, shares: Math.max(0, Math.round(item.targetAmount / item.price)) }));
  const cost = (rows) => rows.reduce((sum, item) => sum + item.shares * item.price, 0);
  const trackingError = (item, shares = item.shares) => Math.abs(shares * item.price - item.targetAmount);

  while (cost(candidates) > spendableBudget + 0.005) {
    const removable = candidates.filter((item) => item.shares > 0).sort((left, right) => {
      const leftPenalty = trackingError(left, left.shares - 1) - trackingError(left);
      const rightPenalty = trackingError(right, right.shares - 1) - trackingError(right);
      return leftPenalty - rightPenalty || right.price - left.price || left.ticker.localeCompare(right.ticker);
    });
    if (!removable.length) break;
    removable[0].shares -= 1;
  }

  let remaining = spendableBudget - cost(candidates);
  while (remaining > 0.005) {
    const additions = candidates.filter((item) => item.price <= remaining + 0.005).map((item) => ({
      item,
      improvement: trackingError(item) - trackingError(item, item.shares + 1),
    })).filter((row) => row.improvement > 0.005)
      .sort((left, right) => right.improvement - left.improvement || left.item.price - right.item.price || left.item.ticker.localeCompare(right.item.ticker));
    if (!additions.length) break;
    additions[0].item.shares += 1;
    remaining -= additions[0].item.price;
  }

  const orders = candidates.filter((item) => item.shares > 0).map((item) => ({
    ...item,
    targetAmount: round(item.targetAmount),
    targetWeight: round(item.targetWeight, 6),
    estimatedCost: round(item.shares * item.price),
    amount: round(item.shares * item.price),
  }));
  const investedAmount = round(orders.reduce((sum, item) => sum + item.estimatedCost, 0));
  return {
    budget,
    spendableBudget,
    cashBuffer,
    orders,
    investedAmount,
    cashRemaining: round(Math.max(0, budget - investedAmount)),
    deferred,
    blocked,
    deferredTargetAmount: round(deferred.reduce((sum, item) => sum + item.targetAmount, 0)),
  };
}

export function evaluateLivePut(optionRow, assets, accountValue, isolatedCash) {
  const put = optionRow?.put;
  if (!put) return { eligible: false, reasons: ["缺少 Put 快照"], concentration: null, reserveGap: null };
  const asset = (assets ?? []).find((candidate) => candidate.symbol === optionRow.symbol);
  const maxConcentration = asset?.kind === "ETF" ? 0.50 : 0.12;
  const account = Math.max(0, Number(accountValue) || 0);
  const reserve = Math.max(0, Number(isolatedCash) || 0);
  const reasons = [...(put.gates ?? [])];
  if (!String(put.action).startsWith("REVIEW")) {
    if (!reasons.length) reasons.push(put.action === "WAIT_VALUATION" ? "底层估值闸门未通过" : "期权结构闸门未通过");
  }
  const reserveGap = Math.max(0, (put.cashRequired ?? 0) - reserve);
  if (reserveGap > 0) reasons.push(`隔离现金还差 ${formatMoney(reserveGap)}`);
  const concentration = account > 0 ? (put.cashRequired ?? Infinity) / account : Infinity;
  if (concentration > maxConcentration) reasons.push(`被指派后占账户 ${Number.isFinite(concentration) ? (concentration * 100).toFixed(1) : "∞"}%，超过 ${(maxConcentration * 100).toFixed(0)}% 上限`);
  return {
    eligible: String(put.action).startsWith("REVIEW") && reasons.length === 0,
    reasons: [...new Set(reasons)],
    concentration: Number.isFinite(concentration) ? round(concentration * 100, 1) : null,
    reserveGap,
    maxConcentration: maxConcentration * 100,
  };
}

export function portfolioContributionPlan(input, data) {
  const accountValue = Math.max(0, Number(input.accountValue) || 0);
  const weeklyContribution = Math.max(0, Number(input.weeklyContribution) || 0);
  const optionReserve = Math.max(0, Number(input.optionReserve) || 0);
  const postDepositValue = accountValue + weeklyContribution;
  const weights = dynamicPortfolioWeights(data.portfolio, postDepositValue);
  const orders = allocateDollarOrders(weeklyContribution, weights);
  const stage = accountStage(postDepositValue);
  const reserveOrder = orders.find((item) => item.ticker === "SGOV")?.amount ?? 0;
  const projectedOptionReserve = optionReserve + reserveOrder;
  const optionReviews = (data.options ?? []).map((row) => ({
    ...row,
    accountEvaluation: evaluateLivePut(row, data.assets, postDepositValue, projectedOptionReserve),
  }));
  const executablePut = optionReviews.find((row) => row.accountEvaluation.eligible) ?? null;
  return {
    accountValue,
    weeklyContribution,
    optionReserve,
    postDepositValue,
    stage,
    weights,
    orders,
    projectedOptionReserve,
    optionReviews,
    executablePut,
  };
}

export function wholeShareContributionPlan(input, data) {
  const accountValue = Math.max(0, Number(input.accountValue) || 0);
  const weeklyContribution = Math.max(0, Number(input.weeklyContribution) || 0);
  const carryCash = Math.max(0, Number(input.carryCash) || 0);
  const cashBuffer = input.cashBuffer === undefined ? 15 : Math.max(0, Number(input.cashBuffer) || 0);
  const optionReserve = Math.max(0, Number(input.optionReserve) || 0);
  const postDepositValue = accountValue + weeklyContribution;
  const weights = dynamicPortfolioWeights(data.portfolio, postDepositValue);
  const allocation = allocateWholeShareOrders(weeklyContribution + carryCash, weights, data, { cashBuffer });
  const baseStage = accountStage(postDepositValue);
  const stage = baseStage.id === "accumulate"
    ? { ...baseStage, detail: "整股核心优先；不足一股的小额目标先停泊在 SGOV，剩余现金滚入下次。" }
    : { ...baseStage, detail: `${baseStage.detail} 整股版只输出完整股数。` };
  const reserveOrder = allocation.orders.find((item) => item.ticker === "SGOV")?.estimatedCost ?? 0;
  const strategicReserveTarget = allocation.spendableBudget * (weights.find((item) => item.ticker === "SGOV")?.weight ?? 0);
  const projectedOptionReserve = optionReserve + Math.min(reserveOrder, strategicReserveTarget);
  const optionReviews = (data.options ?? []).map((row) => ({
    ...row,
    accountEvaluation: evaluateLivePut(row, data.assets, postDepositValue, projectedOptionReserve),
  }));
  const executablePut = optionReviews.find((row) => row.accountEvaluation.eligible) ?? null;
  return {
    accountValue,
    weeklyContribution,
    carryCash,
    optionReserve,
    postDepositValue,
    stage,
    weights,
    wholeShareMode: true,
    budget: allocation.budget,
    spendableBudget: allocation.spendableBudget,
    cashBuffer: allocation.cashBuffer,
    orders: allocation.orders,
    investedAmount: allocation.investedAmount,
    cashRemaining: allocation.cashRemaining,
    deferred: allocation.deferred,
    blocked: allocation.blocked,
    deferredTargetAmount: allocation.deferredTargetAmount,
    projectedOptionReserve,
    optionReviews,
    executablePut,
  };
}

export const formatPercentValue = (value, digits = 1) => Number.isFinite(value) ? `${value.toFixed(digits)}%` : "—";
