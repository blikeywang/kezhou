import {
  formatMoney,
  formatPercentValue,
  portfolioContributionPlan,
} from "./incomeos-engine.mjs";

const STORAGE_KEY = "traderhome-incomeos-plan-v2";
const FONT_KEY = "traderhome-incomeos-font-scale";
const TAB_IDS = ["report", "overview", "ranking", "portfolio", "calls", "puts", "risk", "backtest", "data"];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const signed = (value, digits = 1) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%` : "—";
const pct = (value, digits = 1) => formatPercentValue(value, digits);
const moneyCompact = (value) => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value) : "—";
const number = (value, digits = 0) => Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "—";
const state = {
  data: null,
  plan: null,
  rankingFilter: "top50",
  search: "",
  detailTicker: null,
};

function safeLoadPlan() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function currentInput() {
  return {
    weeklyContribution: Math.max(0, Number($("#weeklyContribution").value) || 0),
    accountValue: Math.max(0, Number($("#accountValue").value) || 0),
    optionReserve: Math.max(0, Number($("#optionReserve").value) || 0),
  };
}

function setFontScale(value) {
  const allowed = [90, 100, 115, 130];
  const scale = allowed.includes(Number(value)) ? Number(value) : 100;
  document.documentElement.style.setProperty("--income-font-scale", `${scale / 100}`);
  localStorage.setItem(FONT_KEY, String(scale));
  $$('[data-font-scale]').forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.fontScale) === scale)));
}

function setTab(id, updateHash = true) {
  const next = TAB_IDS.includes(id) ? id : "report";
  $$('[data-tab]').forEach((button) => button.classList.toggle("active", button.dataset.tab === next));
  $$('[data-view]').forEach((view) => view.classList.toggle("active", view.dataset.view === next));
  if (updateHash) history.replaceState(null, "", `#${next}`);
  if (updateHash) window.scrollTo({ top: $("#moduleTabs").offsetTop - 18, behavior: "smooth" });
}

function snapshotState(data) {
  const now = new Date();
  const ageHours = Math.max(0, (now - new Date(data.asOf)) / 3_600_000);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const clock = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(clock.hour) * 60 + Number(clock.minute);
  if (ageHours > 72) return { level: "stale", label: "STALE · 旧快照", detail: "超过 72 小时，只用于研究，不按合约执行。" };
  if (clock.weekday === "Fri" && minutes >= 600 && minutes < 960 && ageHours <= 24) return { level: "review", label: "FRIDAY REVIEW", detail: "周五执行窗口；仍需在 IBKR 复核现金、持仓和限价。" };
  return { level: "preview", label: "PREVIEW · 最新可得快照", detail: "非周五 10:00 ET 执行窗口；本页先生成预案。" };
}

function statusLabel(status) {
  return ({ COMPOUNDER: "复利合格", QUALIFIED: "合格", VALUATION_WAIT: "估值等待", CYCLE_WATCH: "周期观察", WATCH: "观察", BENCHMARK: "基准" })[status] ?? status;
}

function optionLabel(action) {
  return ({ REVIEW_CASH: "现金复核", REVIEW_100_SHARES: "100 股复核", WAIT_VALUATION: "估值等待", WAIT_EARNINGS: "跨财报暂停", WAIT_MARKET: "市场闸门未过" })[action] ?? action;
}

function assetReason(asset) {
  if (!asset) return "—";
  if (asset.status === "VALUATION_WAIT") return `质量仍高，但自身 ${asset.valuation?.rangeYears ?? 5} 年估值分位 ${pct(asset.valuation?.historicalPercentile, 0)}，本周不放大。`;
  const strengths = [];
  if ((asset.scores?.compound ?? 0) >= 85) strengths.push("跨周期复利");
  if ((asset.scores?.forward ?? 0) >= 80) strengths.push("盈利/预期");
  if ((asset.scores?.valuation ?? 0) >= 65) strengths.push("当前估值");
  if ((asset.scores?.safety ?? 0) >= 75) strengths.push("风险控制");
  return `${strengths.slice(0, 3).join("、") || "综合质量"}通过；仍受单股 12% 和期权独立闸门约束。`;
}

function colorFor(index) {
  return ["#5ee8e0", "#63a9ff", "#ad8cff", "#f3bf6b", "#78e2aa", "#ff9f7e", "#77bdf8", "#cf8cff", "#a6d66d"][index % 9];
}

function renderStatus(data) {
  const snapshot = snapshotState(data);
  const status = $("#snapshotStatus");
  status.className = `io-status ${snapshot.level}`;
  status.innerHTML = `<b>${snapshot.label}</b><span>${snapshot.detail}</span>`;
  $("#topbarStatus").textContent = `${data.tradingDate} · ${data.mode === "live" ? "DATA COMPLETE" : "PARTIAL DATA"}`;
  $("#candidateCount").textContent = data.universe.candidateCount;
  $("#top50Count").textContent = data.universe.top50Count;
  $("#optionScanCount").textContent = `${data.optionDataQuality.usable}/${data.optionDataQuality.scanned}`;
  const model = data.portfolio.comparisons.find((item) => item.label.includes("IncomeOS"));
  $("#modelCagr").textContent = pct(model?.cagr);
  $("#snapshotDate").textContent = `${data.tradingDate} · ${new Intl.DateTimeFormat("zh-CN", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(data.asOf))}`;
}

function renderMarket(data) {
  const rows = [
    ["市场温度", data.market.temperature, "/100", data.market.description ?? "—"],
    ["估值热度", data.market.valuation, "/100", data.market.valuation >= 80 ? "整体估值偏热，单股加仓更看自身分位" : "整体估值可接受"],
    ["情绪热度", data.market.sentiment, "/100", "情绪只作风险背景，不单独择时"],
    ["数据覆盖", data.dataQuality.priced, `/${data.universe.candidateCount}`, `${data.optionDataQuality.usable} 个标的有双边期权快照`],
  ];
  $("#marketStrip").innerHTML = rows.map(([label, value, suffix, detail]) => `<article><span>${label}</span><strong>${value ?? "—"}<small>${suffix}</small></strong><p>${escapeHtml(detail)}</p></article>`).join("");
}

function renderAllocation(plan) {
  $("#allocationHeadline").textContent = `${plan.stage.label} · ${plan.weights.length} 个资金去向`;
  $("#allocationBar").innerHTML = plan.weights.map((item, index) => `<span style="width:${item.weight * 100}%;background:${colorFor(index)}" title="${item.ticker} ${(item.weight * 100).toFixed(1)}%"></span>`).join("");
  $("#allocationLegend").innerHTML = plan.weights.map((item, index) => `<div><i style="background:${colorFor(index)}"></i><span>${item.ticker}</span><b>${(item.weight * 100).toFixed(1)}%</b></div>`).join("");
}

function renderOrders(data, plan) {
  const assetMap = new Map(data.assets.map((asset) => [asset.ticker, asset]));
  const orders = plan.orders.filter((order) => order.amount >= 0.01);
  $("#orderCount").textContent = String(orders.length);
  $("#orders").innerHTML = orders.map((order) => {
    const asset = assetMap.get(order.ticker);
    return `<article class="io-order"><div><span>${escapeHtml(order.role)}</span><strong>${order.ticker}</strong><small>${escapeHtml(assetReason(asset))}</small></div><b>${formatMoney(order.amount)}</b></article>`;
  }).join("");
  $("#portfolioOrders").innerHTML = orders.map((order) => {
    const asset = assetMap.get(order.ticker);
    const shares = asset?.price ? order.amount / asset.price : null;
    return `<tr><td><strong>${order.ticker}</strong><small>${escapeHtml(order.role)}</small></td><td>${pct(order.weight * 100)}</td><td>${formatMoney(order.amount)}</td><td>${asset?.price ? formatMoney(asset.price) : "—"}</td><td>${shares ? shares.toFixed(4) : "—"}</td><td><small>${escapeHtml(assetReason(asset))}</small></td></tr>`;
  }).join("");
}

function renderReport(data, plan) {
  $("#weeklyAmountHero").textContent = formatMoney(plan.weeklyContribution);
  $("#stageLabel").textContent = plan.stage.label;
  $("#stageDetail").textContent = plan.stage.detail;
  $("#postDepositValue").textContent = formatMoney(plan.postDepositValue);
  $("#projectedPutReserve").textContent = formatMoney(plan.projectedOptionReserve);
  $("#optionOrders").textContent = plan.executablePut ? "1" : "0";
  renderAllocation(plan);
  renderOrders(data, plan);
  const structural = plan.optionReviews.find((row) => String(row.put?.action).startsWith("REVIEW"));
  if (plan.executablePut) {
    const put = plan.executablePut.put;
    $("#putHeadline").textContent = `${plan.executablePut.ticker} Put 进入 IBKR 最终复核`;
    $("#putExplanation").textContent = `${put.contract} · ${formatMoney(put.cashRequired)} 现金担保；用 bid/ask 中间附近限价，不追最后成交。`;
    $("#putReasons").innerHTML = ["确认隔离现金未被其他订单占用", "再次检查实时价差与财报日", "确认被指派后仍愿意长期持有"].map((item) => `<li>${item}</li>`).join("");
  } else if (structural) {
    const evaluation = structural.accountEvaluation;
    $("#putHeadline").textContent = `本周 0 张；${structural.ticker} 只通过结构闸门`;
    $("#putExplanation").textContent = `${structural.put.contract} 的市场结构可复核，但按你输入的账户/现金仍不合格。`;
    $("#putReasons").innerHTML = evaluation.reasons.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  } else {
    $("#putHeadline").textContent = "本周没有通过全部闸门的 Put";
    $("#putExplanation").textContent = "继续执行美元买入与现金停泊；没有合格权利金时，零期权订单也是正确动作。";
    $("#putReasons").innerHTML = ["不为收入目标降低估值标准", "不跨财报卖出", "不接受过宽价差或低 IV/HV"].map((item) => `<li>${item}</li>`).join("");
  }
  $("#noActions").innerHTML = ["不因 JPM/GS/BAC 质量高就忽略其自身估值高位", "没有确认 100 股持仓，不卖 Covered Call", "不用 IBKR 保证金补足现金担保", "不把当前权利金年化代理当成长期收益率"].map((item) => `<li>${item}</li>`).join("");
  $("#finalChecks").innerHTML = ["IBKR 可用现金与未结算资金", "碎股订单币种与限价/市价设置", "期权实时 bid/ask、OI 与财报日", "下单后单股和行业集中度"].map((item) => `<li>${item}</li>`).join("");
}

function renderOverview(data) {
  const modules = [
    ["周五操作单", "把本周入金转成今天的美元订单"], ["Top 50", "71 个候选每周竞争 50 个席位"], ["组合引擎", "把高分变成受行业与仓位约束的组合"],
    ["Sell Call", "100 股、Delta、IV 与事件闸门"], ["Sell Put", "底层、期权和账户容量三层闸门"], ["Risk Engine", "账户阶段、集中度和现金约束"],
    ["回测 / 基准", "与 SPY、QQQI、JEPI、JEPQ、SPYI 比较"], ["数据室", "数据覆盖、缺口与外部源"], ["IBKR 边界", "手工输入到 Flex Query 的升级路径"],
  ];
  $("#moduleMap").innerHTML = modules.map(([name, detail], index) => `<article><span>${String(index + 1).padStart(2, "0")}</span><h3>${name}</h3><p>${detail}</p></article>`).join("");
  const qualified = data.assets.find((asset) => asset.rank && asset.status !== "VALUATION_WAIT" && asset.kind === "Stock");
  $("#currentFinding").textContent = `${qualified.ticker} 暂列可加仓公司第一`;
  $("#currentFindingDetail").textContent = `${qualified.name} 总分 ${qualified.scores.total}；但组合只给单股卫星 7%，不把排行第一变成单票押注。`;
  const jpm = data.assets.find((asset) => asset.ticker === "JPM");
  $("#jpmStatus").textContent = `质量 ${jpm.scores.total} 分 · ${statusLabel(jpm.status)}`;
  $("#jpmStatusDetail").textContent = `10 年 CAGR 约 ${pct(jpm.history.cagr10)}，但 PB ${jpm.valuation.current} 处在自身五年 ${pct(jpm.valuation.historicalPercentile, 0)} 分位；JPM 是观察对象，不是本周新增资金默认目的地。`;
  $("#leaderCards").innerHTML = data.assets.filter((asset) => asset.rank && asset.rank <= 8).map((asset) => `<article class="io-leader-card"><div><span>#${asset.rank} · ${asset.pool === "challenger" ? "挑战者" : "原池"}</span><b>${asset.scores.total}</b></div><h3>${asset.ticker}</h3><p>${escapeHtml(assetReason(asset))}</p><footer><span>${asset.sector}</span><strong>${statusLabel(asset.status)}</strong></footer></article>`).join("");
}

function filteredAssets(data) {
  const query = state.search.trim().toLowerCase();
  return data.assets.filter((asset) => {
    if (state.rankingFilter === "top50" && !asset.selectedTop50) return false;
    if (state.rankingFilter === "challenger" && asset.pool !== "challenger") return false;
    if (state.rankingFilter === "valuation" && asset.status !== "VALUATION_WAIT") return false;
    if (query && ![asset.ticker, asset.name, asset.sector, asset.kind].some((value) => String(value).toLowerCase().includes(query))) return false;
    return true;
  });
}

function renderRankingDetail(asset) {
  if (!asset) return;
  state.detailTicker = asset.ticker;
  const h = asset.history ?? {};
  const valuation = asset.valuation;
  $("#rankingDetail").innerHTML = `<div class="io-detail-head"><div><span class="io-label">#${asset.rank ?? "BENCHMARK"} · ${escapeHtml(asset.sector)}</span><h3>${asset.ticker} · ${escapeHtml(asset.name)}</h3><p>${escapeHtml(assetReason(asset))}</p></div><b>${asset.scores.total}</b></div>
    <div class="io-detail-metrics">
      <div><span>10Y / 5Y / 3Y</span><strong>${pct(h.cagr10)} · ${pct(h.cagr5)} · ${pct(h.cagr3)}</strong></div>
      <div><span>2020–22 / 2023–今</span><strong>${pct(h.cycle2020_2022)} · ${pct(h.cycle2023_now)}</strong></div>
      <div><span>最大回撤 / 波动</span><strong>${pct(h.maxDrawdown)} · ${pct(h.annualizedVol)}</strong></div>
      <div><span>EPS YoY / 预期修正</span><strong>${pct(asset.fundamentals?.epsYoy)} · ${pct(asset.expectations?.revision)}</strong></div>
      <div><span>估值</span><strong>${valuation ? `${valuation.indicator.toUpperCase()} ${valuation.current} · ${pct(valuation.historicalPercentile, 0)} 分位` : "ETF / 不适用"}</strong></div>
      <div><span>数据置信度</span><strong>${asset.confidence}%</strong></div>
    </div>`;
}

function renderRanking(data) {
  const rows = filteredAssets(data);
  $("#rankingRows").innerHTML = rows.map((asset) => `<tr data-ticker="${escapeHtml(asset.ticker)}" class="${asset.ticker === state.detailTicker ? "focus" : ""}"><td><strong>${asset.rank ?? "B"} · ${asset.ticker}</strong><small>${escapeHtml(asset.name)} · ${asset.pool === "challenger" ? "挑战者" : asset.kind}</small></td><td><b>${asset.scores.total}</b></td><td>${asset.scores.compound}</td><td>${asset.scores.forward}</td><td>${asset.scores.quality}</td><td>${asset.scores.valuation}</td><td>${asset.scores.safety}</td><td>${pct(asset.dividendYield)}</td><td>${pct(asset.history?.cagr5)}</td><td>${asset.valuation ? pct(asset.valuation.historicalPercentile, 0) : "—"}</td><td><span class="io-state ${asset.status === "VALUATION_WAIT" ? "wait" : asset.status === "BENCHMARK" ? "neutral" : "pass"}">${statusLabel(asset.status)}</span></td></tr>`).join("");
  const detail = data.assets.find((asset) => asset.ticker === state.detailTicker) ?? rows[0];
  renderRankingDetail(detail);
}

function weightRow(item, index) {
  return `<div><i style="background:${colorFor(index)}"></i><span><b>${item.ticker}</b><small>${escapeHtml(item.role)}</small></span><strong>${pct(item.weight * 100)}</strong></div>`;
}

function renderPortfolio(data, plan) {
  $("#portfolioMethodShort").textContent = "ETF 65% · 五个行业卫星各 7%";
  $("#portfolioVerdict").textContent = `当前组合：SPY / SCHD / QQQ / SGOV + ${data.portfolio.weights.filter((item) => !["SPY", "SCHD", "QQQ", "SGOV"].includes(item.ticker)).map((item) => item.ticker).join(" / ")}`;
  $("#portfolioVerdictDetail").textContent = "这是质量、估值、跨周期表现与行业约束共同筛出的当前解，不是最高历史 CAGR 的机械拼盘。JPM、GS、BAC 因自身估值高位暂不拿新增卫星权重。";
  $("#modelWeights").innerHTML = data.portfolio.weights.map(weightRow).join("");
  $("#dynamicWeights").innerHTML = plan.weights.map(weightRow).join("");
  $("#portfolioGuardrails").innerHTML = data.portfolio.guardrails.map((item, index) => `<article><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(item)}</p></article>`).join("");
}

function gateText(option) {
  return option.gates?.length ? option.gates.join("；") : option.action.startsWith("REVIEW") ? "结构通过，等待账户复核" : "等待复核";
}

function renderCalls(data) {
  $("#callRows").innerHTML = data.options.map((row) => {
    const call = row.call;
    return `<tr><td><strong>#${row.rank ?? "—"} · ${row.ticker}</strong><small>${escapeHtml(call.contract)}</small></td><td>${call.dte}</td><td>${call.delta?.toFixed(3) ?? "—"}<small>目标 ${call.targetDelta?.toFixed(2) ?? "—"}</small></td><td>${call.ivHv?.toFixed(2) ?? "—"}</td><td>${number(call.oi)}</td><td>${call.bid !== null ? `${call.bid.toFixed(2)} / ${call.ask.toFixed(2)}` : "—"}</td><td>${pct(call.spreadPct)}</td><td>${pct(call.annualizedPremium)}</td><td><span class="io-state ${call.action.startsWith("REVIEW") ? "pass" : "wait"}">${optionLabel(call.action)}</span><small>${escapeHtml(gateText(call))}</small></td></tr>`;
  }).join("");
}

function renderPuts(data, plan) {
  const structural = plan.optionReviews.filter((row) => String(row.put?.action).startsWith("REVIEW"));
  $("#putStructureCount").textContent = `${structural.length} / ${data.optionDataQuality.usable}`;
  if (plan.executablePut) {
    $("#putVerdict").textContent = `${plan.executablePut.ticker} Put 通过账户闸门，进入 IBKR 最终限价复核`;
    $("#putVerdictDetail").textContent = "这仍不是自动下单；需确认实时盘口、隔离现金没有被占用，并愿意在行权价接货。";
  } else if (structural.length) {
    const row = structural[0];
    $("#putVerdict").textContent = `结构上只有 ${row.ticker} Put 通过；按你当前账户输入仍为 0 张`;
    $("#putVerdictDetail").textContent = `${row.put.contract} 需要 ${formatMoney(row.put.cashRequired)} 现金担保。当前被账户容量或隔离现金拦截；JPM/GS/BAC 则先被估值拦截。`;
  } else {
    $("#putVerdict").textContent = "本周没有 Put 通过结构闸门";
    $("#putVerdictDetail").textContent = "继续定投和停泊现金，不为制造现金流强行卖波动。";
  }
  const sorted = [...plan.optionReviews].sort((left, right) => Number(right.accountEvaluation.eligible) - Number(left.accountEvaluation.eligible) || Number(String(right.put.action).startsWith("REVIEW")) - Number(String(left.put.action).startsWith("REVIEW")) || (left.rank ?? 999) - (right.rank ?? 999));
  $("#putRows").innerHTML = sorted.map((row) => {
    const put = row.put;
    const evaluation = row.accountEvaluation;
    const conclusion = evaluation.eligible ? "账户可复核" : evaluation.reasons[0] ?? optionLabel(put.action);
    return `<tr><td><strong>#${row.rank ?? "—"} · ${row.ticker}</strong><small>${escapeHtml(put.contract)}</small></td><td>${put.delta?.toFixed(3) ?? "—"}</td><td>${formatMoney(put.cashRequired)}</td><td>${evaluation.concentration === null ? "∞" : pct(evaluation.concentration)}<small>上限 ${pct(evaluation.maxConcentration, 0)}</small></td><td>${put.bid !== null ? `${put.bid.toFixed(2)} / ${put.ask.toFixed(2)}` : "—"}</td><td>${put.ivHv?.toFixed(2) ?? "—"}</td><td>${number(put.oi)}</td><td>${pct(put.annualizedPremium)}</td><td>${pct(put.breakevenDiscount)}</td><td><span class="io-state ${evaluation.eligible ? "pass" : "wait"}">${evaluation.eligible ? "复核" : optionLabel(put.action)}</span><small>${escapeHtml(conclusion)}</small></td></tr>`;
  }).join("");
}

function renderRisk(data, plan) {
  $("#riskSummary").innerHTML = `<article><span>当前阶段</span><strong>${plan.stage.label}</strong><p>${plan.stage.detail}</p></article><article><span>市场估值热度</span><strong>${data.market.valuation}/100</strong><p>高于 80：新增单股必须通过自身估值分位。</p></article><article><span>隔离现金</span><strong>${formatMoney(plan.projectedOptionReserve)}</strong><p>本周 SGOV/现金分配后；不等于 IBKR 实时可用购买力。</p></article><article><span>合格期权订单</span><strong>${plan.executablePut ? "1" : "0"}</strong><p>无合格机会时不降低 Delta、价差或估值门槛。</p></article>`;
  const roadmap = [
    ["< $20k", "积累期", "SPY / SCHD / SGOV 为主，卫星仓小额碎股；不做期权。"],
    ["$20k–60k", "准备期", "逐步增加成长宽基和卫星仓，继续积累现金担保能力。"],
    ["$60k–150k", "首份合约期", "只允许账户装得下的低集中度现金担保 Put。"],
    ["$150k–300k", "组合收益期", "ETF 与单股期权分层；单股指派仍 ≤12%。"],
    ["$300k+", "成熟期", "合约选择增加，但不取消估值、财报和流动性闸门。"],
  ];
  const stageIndex = plan.postDepositValue < 20_000 ? 0 : plan.postDepositValue < 60_000 ? 1 : plan.postDepositValue < 150_000 ? 2 : plan.postDepositValue < 300_000 ? 3 : 4;
  $("#accountRoadmap").innerHTML = roadmap.map(([range, title, detail], index) => `<article class="${index === stageIndex ? "current" : ""}"><span>${range}</span><h3>${title}</h3><p>${detail}</p></article>`).join("");
  $("#riskGuardrails").innerHTML = data.portfolio.guardrails.map((item, index) => `<article><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(item)}</p></article>`).join("");
  const warnings = [
    data.market.valuation >= 80 ? `市场估值热度 ${data.market.valuation}/100，避免一次性放大高估值公司。` : null,
    `${data.assets.filter((asset) => asset.status === "VALUATION_WAIT" && asset.selectedTop50).length} 个 Top 50 标的处于自身估值等待。`,
    data.optionDataQuality.errors.length ? `期权数据缺口：${data.optionDataQuality.errors.join("；")}` : null,
    "尚未接入 IBKR Flex，现有持仓漂移、税基和 Covered Call 覆盖状态需要手工复核。",
  ].filter(Boolean);
  $("#riskWarnings").innerHTML = warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderBacktest(data) {
  const model = data.portfolio.comparisons.find((item) => item.label.includes("IncomeOS"));
  const spy = data.portfolio.comparisons.find((item) => item.label === "SPY");
  const qqqi = data.portfolio.comparisons.find((item) => item.label === "QQQI");
  $("#backtestHero").innerHTML = `<article><span>IncomeOS 5 年代理</span><strong>${pct(model.cagr)}</strong><small>最大回撤 ${pct(model.maxDrawdown)} · ${model.months} 个月</small></article><article><span>SPY 同期代理</span><strong>${pct(spy.cagr)}</strong><small>最大回撤 ${pct(spy.maxDrawdown)} · ${spy.months} 个月</small></article><article><span>QQQI 可得短样本</span><strong>${pct(qqqi.cagr)}</strong><small>仅 ${qqqi.months} 个月，不与 5 年样本等同</small></article><div><b>当前测试结论</b><p>底层均衡模型在可得 5 年代理中高于 SPY、回撤更低；但 QQQI 只有约 31 个月历史且领先，因此现在不能宣称 IncomeOS 已经击败 QQQI。期权层也尚无历史面，结论必须继续验证。</p></div>`;
  $("#backtestRows").innerHTML = data.portfolio.comparisons.map((row) => `<tr class="${row.label.includes("IncomeOS") ? "focus" : ""}"><td><strong>${escapeHtml(row.label)}</strong></td><td>${row.from?.slice(0, 7) ?? "—"} → ${row.to?.slice(0, 7) ?? "—"}</td><td>${row.months}</td><td>${pct(row.cagr)}</td><td>${pct(row.annualizedVol)}</td><td>${pct(row.maxDrawdown)}</td><td>${row.sharpeProxy?.toFixed(2) ?? "—"}</td><td>${pct(row.totalReturn)}</td></tr>`).join("");
  $("#cycleRows").innerHTML = data.assets.filter((asset) => asset.rank && asset.rank <= 12).map((asset) => `<tr><td><strong>#${asset.rank} · ${asset.ticker}</strong><small>${escapeHtml(asset.sector)}</small></td><td>${pct(asset.history?.cagr10)}</td><td>${pct(asset.history?.cagr5)}</td><td>${pct(asset.history?.cycle2016_2019)}</td><td>${pct(asset.history?.cycle2020_2022)}</td><td>${pct(asset.history?.cycle2023_now)}</td><td>${pct(asset.history?.maxDrawdown)}</td><td>${pct(asset.history?.positiveYearRate, 0)}</td></tr>`).join("");
  $("#backtestLimit").textContent = data.portfolio.limitation;
}

function renderDataRoom(data) {
  const cards = [
    ["候选现价", `${data.dataQuality.priced}/${data.universe.candidateCount}`, "Longbridge 当前快照"],
    ["历史 ≥ 36 月", `${data.dataQuality.historical}/${data.universe.candidateCount}`, "2016 至今前复权月线"],
    ["财报 / 预期", `${data.dataQuality.fundamentals}/${data.universe.candidateCount}`, "ETF 按不适用计为已覆盖"],
    ["双边期权", `${data.optionDataQuality.usable}/${data.optionDataQuality.scanned}`, `${data.optionDataQuality.callsWithMarket} Call + ${data.optionDataQuality.putsWithMarket} Put 有盘口`],
  ];
  $("#dataQuality").innerHTML = cards.map(([label, value, detail]) => `<article><span>${label}</span><strong>${value}</strong><p>${detail}</p></article>`).join("");
  $("#dataLimitations").innerHTML = [...data.limitations, ...data.dataQuality.errors, ...data.optionDataQuality.errors].map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderAll() {
  const data = state.data;
  const input = currentInput();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
  state.plan = portfolioContributionPlan(input, data);
  renderStatus(data);
  renderMarket(data);
  renderReport(data, state.plan);
  renderOverview(data);
  renderRanking(data);
  renderPortfolio(data, state.plan);
  renderCalls(data);
  renderPuts(data, state.plan);
  renderRisk(data, state.plan);
  renderBacktest(data);
  renderDataRoom(data);
}

function bindEvents() {
  $$('[data-tab]').forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  $$('[data-font-scale]').forEach((button) => button.addEventListener("click", () => setFontScale(button.dataset.fontScale)));
  ["#weeklyContribution", "#accountValue", "#optionReserve"].forEach((selector) => $(selector).addEventListener("input", () => state.data && renderAll()));
  $("#rankingFilters").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.rankingFilter = button.dataset.filter;
    $$('[data-filter]').forEach((item) => item.classList.toggle("active", item === button));
    renderRanking(state.data);
  });
  $("#rankingSearch").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderRanking(state.data);
  });
  $("#rankingRows").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-ticker]");
    if (!row) return;
    const asset = state.data.assets.find((item) => item.ticker === row.dataset.ticker);
    renderRankingDetail(asset);
    $$('[data-ticker]').forEach((item) => item.classList.toggle("focus", item === row));
  });
}

async function init() {
  const saved = safeLoadPlan();
  $("#weeklyContribution").value = saved.weeklyContribution ?? 1_000;
  $("#accountValue").value = saved.accountValue ?? 0;
  $("#optionReserve").value = saved.optionReserve ?? 0;
  setFontScale(localStorage.getItem(FONT_KEY) ?? 100);
  bindEvents();
  try {
    const response = await fetch("./data/incomeos-full.json", { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    state.detailTicker = state.data.assets.find((asset) => asset.rank === 1)?.ticker ?? null;
    renderAll();
    const hash = location.hash.replace("#", "");
    setTab(TAB_IDS.includes(hash) ? hash : "report", false);
  } catch (error) {
    $("#appError").hidden = false;
    $("#appError").textContent = `IncomeOS 数据加载失败：${error.message}`;
    $("#topbarStatus").textContent = "DATA ERROR";
  }
}

init();
