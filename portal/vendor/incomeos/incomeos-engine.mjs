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
