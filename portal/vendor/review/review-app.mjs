import {
  analyzeTrades,
  attachMarketData,
  createExportReport,
  normalizeBarRecords,
  normalizeTradeRecords,
  parseRecords,
  reviewTrade,
} from "./review-engine.mjs";
import { REVIEW_BENCHMARKS } from "./review-benchmarks.mjs";
import {
  createCasePacket,
  createFeedbackPacket,
  createPublicCase,
  decodeSharePayload,
  encodeSharePayload,
  validateCasePacket,
  validateFeedbackPacket,
} from "./review-community.mjs";

const byId = id => document.getElementById(id);
const refs = Object.fromEntries([
  "importView", "resultsView", "tradeFile", "barFile", "tradeDropzone", "chooseTradeButton", "chooseBarButton",
  "loadSampleButton", "downloadTemplateButton", "openApiButton", "replaceDataButton", "addBarsButton", "exportButton",
  "clearButton", "barFileState", "sourceBadge", "sourceName", "sourceFacts", "sampleStatus", "prescriptionTitle",
  "prescriptionAction", "successMetric", "prescriptionConfidence", "kpiNet", "kpiCurrency", "kpiWinRate", "kpiWinLoss",
  "kpiExpectancy", "kpiPf", "kpiDrawdown", "kpiR", "kpiRCoverage", "evidenceSummary", "qualityTitle",
  "qualityScore", "qualityIssues", "equityCaption", "equityChart", "groupTableBody", "behaviorCount", "tradeCount",
  "behaviorList", "tradeSearch", "tradeResultFilter", "tradeSymbolFilter", "tradeFilterFacts", "tradeTableBody",
  "growthChart", "dimensionList", "recentCompare", "accountSize", "riskPercent", "maxDailyTrades", "revengeMinutes", "reviewTimezone",
  "sampleCaseBanner", "sampleCaseTitle", "sampleCaseSummary", "openSampleCaseButton", "betterPlan",
  "apiDialog", "apiUrl", "apiToken", "apiError", "connectApiButton", "tradeDialog", "closeTradeDialog",
  "tradeDialogTitle", "tradeDialogMeta", "tradeChart", "tradeChartEmpty", "tradeFacts", "tradeReviewNotes",
  "tradeCanSay", "tradeCannotSay", "toast", "coachTradeSelect", "coachChartTitle", "coachChartCaption",
  "coachChart", "coachChartEmpty", "coachBrief", "coachCards", "coachConsensus", "benchmarkUpdatedAt",
  "growthPassport", "benchmarkChartTitle", "benchmarkChart", "benchmarkChartNote", "growthStageTitle",
  "growthStageScore", "growthStageActions", "benchmarkCards", "consultBuilder", "consultTradeSelect", "consultAlias",
  "consultQuestion", "shareSymbol", "shareTime", "sharePrice", "shareMoney", "shareNotes", "createCaseButton",
  "copyCaseButton", "caseLinkOutput", "consultCase", "consultEmpty", "consultCaseContent", "consultCaseHead",
  "consultChart", "consultChartEmpty", "consultFacts", "publicFeedback", "feedbackWorkbench", "feedbackAlias",
  "feedbackStance", "feedbackThesis", "feedbackEvidence", "feedbackPlan", "createFeedbackButton", "copyFeedbackButton",
  "feedbackLinkOutput", "ownerCuration", "privateFeedbackList", "createPublicCaseButton", "copyPublicCaseButton",
  "publicCaseLinkOutput",
].map(id => [id, byId(id)]));

const state = {
  normalized: null,
  bars: null,
  trades: [],
  analysis: null,
  source: "browser_import",
  sourceName: "",
  isSample: false,
  groupKey: "symbols",
  activeTab: "overview",
  activeWorkspace: "review",
  selectedTradeId: null,
  coachTradeId: null,
  consultCase: null,
  consultFeedbacks: [],
  ownedCaseIds: new Set(),
};

let toastTimer;
let resizeTimer;
const OWNED_CASES_KEY = "traderhome-review-owned-cases-v1";
const FEEDBACKS_KEY = "traderhome-review-private-feedback-v1";

const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const finite = value => Number.isFinite(value);
const compact = value => finite(value) ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 }).format(value) : "-";
const signed = value => finite(value) ? `${value > 0 ? "+" : ""}${compact(value)}` : "-";
const percent = (value, digits = 1) => finite(value) ? `${Number(value.toFixed(digits))}%` : "-";
const ratio = value => value === Infinity ? "∞" : finite(value) ? Number(value.toFixed(2)).toString() : "-";
const rValue = value => finite(value) ? `${value > 0 ? "+" : ""}${Number(value.toFixed(2))}R` : "-";
const maeValue = value => finite(value) ? `-${Number(Math.abs(value).toFixed(2))}R` : "-";
const displayTimezone = () => refs.reviewTimezone?.value || "UTC";
const dateTime = value => finite(value) ? new Intl.DateTimeFormat("zh-CN", {
  timeZone: displayTimezone(), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value)) : "-";
const fullDateTime = value => finite(value) ? new Intl.DateTimeFormat("zh-CN", {
  timeZone: displayTimezone(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).format(new Date(value)) : "-";

function loadStoredArray(key) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveStoredArray(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    showToast("浏览器未允许本地保存；链接仍可复制使用。", "error");
  }
}

function rememberOwnedCase(caseId) {
  state.ownedCaseIds.add(caseId);
  saveStoredArray(OWNED_CASES_KEY, [...state.ownedCaseIds]);
}

function saveFeedback(feedback) {
  const stored = loadStoredArray(FEEDBACKS_KEY).filter(item => item?.id !== feedback.id);
  stored.push(feedback);
  saveStoredArray(FEEDBACKS_KEY, stored.slice(-100));
}

function feedbacksForCase(caseId) {
  return loadStoredArray(FEEDBACKS_KEY).filter(item => item?.caseId === caseId);
}

function shareUrl(casePacket, feedbackPacket = null) {
  const url = new URL(window.location.href);
  url.search = "";
  const parts = [`case=${encodeSharePayload(casePacket)}`];
  if (feedbackPacket) parts.push(`feedback=${encodeSharePayload(feedbackPacket)}`);
  url.hash = parts.join("&");
  return url.toString();
}

async function copyOutput(input, successMessage) {
  if (!input.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.focus();
    input.select();
    document.execCommand("copy");
  }
  showToast(successMessage);
}

function showToast(message, type = "success") {
  window.clearTimeout(toastTimer);
  refs.toast.textContent = message;
  refs.toast.classList.toggle("is-error", type === "error");
  refs.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => refs.toast.classList.remove("is-visible"), 3600);
}

function setSignedText(element, value) {
  element.textContent = signed(value);
  element.classList.toggle("is-positive", finite(value) && value > 0);
  element.classList.toggle("is-negative", finite(value) && value < 0);
}

function currentOptions() {
  return {
    accountSize: Number(refs.accountSize.value),
    riskPercent: Number(refs.riskPercent.value),
    maxDailyTrades: Number(refs.maxDailyTrades.value),
    revengeMinutes: Number(refs.revengeMinutes.value),
    timezone: refs.reviewTimezone.value,
  };
}

function applyBars() {
  state.trades = attachMarketData(state.normalized?.trades || [], state.bars?.bars || []);
}

function resetBars() {
  state.bars = null;
  refs.barFile.value = "";
  refs.barFileState.textContent = "尚未导入 · 需要 time, open, high, low, close";
  refs.barFileState.classList.remove("is-ready");
}

function setBars(result, name) {
  state.bars = { ...result, name };
  refs.barFileState.textContent = `${name} · ${compact(result.bars.length)} 根有效K线${result.invalid.length ? ` · ${result.invalid.length} 行无效` : ""}`;
  refs.barFileState.classList.add("is-ready");
}

function recompute() {
  if (!state.normalized?.trades?.length) return;
  applyBars();
  state.analysis = analyzeTrades(state.trades, currentOptions());
  renderAll();
}

async function importTradeText(text, name, source = "browser_import", isSample = false) {
  const records = parseRecords(text, name);
  const normalized = normalizeTradeRecords(records);
  if (!normalized.trades.length) {
    const detail = normalized.invalid.slice(0, 3).map(item => `第${item.row}行：${item.reasons.join("、")}`).join("；");
    throw new Error(`没有可分析的有效交易。${detail}`);
  }
  resetBars();
  state.normalized = normalized;
  state.source = source;
  state.sourceName = name;
  state.isSample = isSample;
  state.activeTab = "overview";
  state.coachTradeId = null;
  state.consultCase = null;
  state.consultFeedbacks = [];
  refs.importView.hidden = true;
  refs.resultsView.hidden = false;
  document.querySelector(".rv-workbar").hidden = false;
  document.querySelectorAll("[data-workspace]").forEach(button => { button.disabled = false; });
  setWorkspace("review");
  setActiveTab("overview");
  recompute();
  window.scrollTo({ top: 0, behavior: "smooth" });
  const rejected = normalized.invalid.length ? `，${normalized.invalid.length} 行未通过校验` : "";
  showToast(`已读取 ${normalized.trades.length} 笔有效交易${rejected}`);
}

async function importTradeFile(file) {
  if (!file) return;
  if (file.size > 80 * 1024 * 1024) throw new Error("成交文件超过80MB，请先按账户或月份拆分");
  await importTradeText(await file.text(), file.name, "browser_import", false);
}

async function importBarFile(file) {
  if (!file) return;
  if (file.size > 300 * 1024 * 1024) throw new Error("K线文件超过300MB，请按品种或月份拆分后导入");
  const records = parseRecords(await file.text(), file.name);
  const result = normalizeBarRecords(records);
  if (!result.bars.length) throw new Error("K线文件没有有效 OHLC 记录");
  setBars(result, file.name);
  if (state.normalized) recompute();
  showToast(`已读取 ${compact(result.bars.length)} 根K线`);
}

function renderAll() {
  renderSource();
  renderSummary();
  renderQuality();
  renderGroups();
  renderSampleCase();
  renderBehaviors();
  refreshTradeFilters();
  renderTrades();
  renderGrowth();
  renderCoachWorkspace();
  renderBenchmarkWorkspace();
  renderConsultation();
  window.requestAnimationFrame(() => {
    drawEquityChart();
    if (state.activeWorkspace === "coach") drawCoachChart();
    if (state.activeWorkspace === "benchmark") drawBenchmarkChart();
    if (state.activeWorkspace === "consult") drawConsultChart();
  });
}

function renderSampleCase() {
  const trade = state.trades.find(item => item.id === "DEMO-014");
  refs.sampleCaseBanner.hidden = !(state.isSample && trade);
  if (!state.isSample || !trade) return;
  refs.sampleCaseTitle.textContent = `${trade.symbol} 多单：${rValue(trade.mfeR)} 浮盈，为什么最后变成 ${rValue(trade.rMultiple)}？`;
  refs.sampleCaseSummary.textContent = trade.marketCoverage
    ? `入场位于上行窗口高位，行情先向有利方向运行，随后全部回吐。打开案例可查看具体入场确认、${compact(trade.entryPrice + Math.abs(trade.entryPrice - trade.stop))} 附近的+1R保护、加仓条件与退出边界。`
    : "案例K线正在读取；完成后会展示从入场前结构到最终退出的完整路径。";
}

function renderSource() {
  const normalized = state.normalized;
  const analysis = state.analysis;
  refs.sourceBadge.textContent = state.isSample ? "合成教学样例" : state.source === "self_hosted_api" ? "自托管 API" : "浏览器本地";
  refs.sourceBadge.className = `rv-badge${state.isSample ? " is-sample" : ""}`;
  refs.sourceName.textContent = state.sourceName || "未命名数据源";
  const facts = [`${normalized.trades.length} 笔有效`, `${normalized.invalid.length} 行无效`, `${normalized.duplicates} 笔去重`];
  if (state.bars) facts.push(`${compact(state.bars.bars.length)} 根K线`);
  refs.sourceFacts.textContent = facts.join(" · ");
  refs.evidenceSummary.innerHTML = [
    `<span><b>${normalized.trades.length}</b> 笔纳入计算</span>`,
    `<span>止损覆盖 <b>${percent(analysis.fieldCoverage.stop, 0)}</b></span>`,
    `<span>R覆盖 <b>${percent(analysis.fieldCoverage.rMultiple, 0)}</b></span>`,
    `<span>K线匹配 <b>${percent(analysis.fieldCoverage.market, 0)}</b></span>`,
    `<span>交易日 <b>${escapeHtml(analysis.options.timezone)}</b></span>`,
  ].join("<span aria-hidden=\"true\">/</span>");
}

function renderSummary() {
  const { summary, prescription, sampleStatus } = state.analysis;
  const mixedCurrencies = state.analysis.currencies.length > 1;
  const status = sampleStatus === "usable" ? ["样本可用", "is-usable"] : sampleStatus === "early" ? ["早期样本", ""] : ["样本不足", ""];
  refs.sampleStatus.textContent = status[0];
  refs.sampleStatus.className = `rv-badge ${status[1]}`.trim();
  refs.prescriptionTitle.textContent = prescription.title;
  refs.prescriptionAction.textContent = prescription.action;
  refs.successMetric.textContent = prescription.successMetric;
  refs.prescriptionConfidence.textContent = prescription.confidence ? `${prescription.confidence} / 100` : "等待更多样本";
  if (mixedCurrencies) {
    for (const element of [refs.kpiNet, refs.kpiExpectancy, refs.kpiPf, refs.kpiDrawdown]) {
      element.textContent = "不可合计";
      element.classList.remove("is-positive", "is-negative");
    }
    refs.kpiCurrency.textContent = `混合币种：${state.analysis.currencies.join(" / ")}`;
  } else {
    setSignedText(refs.kpiNet, summary.netPnl);
    setSignedText(refs.kpiExpectancy, summary.expectancy);
    refs.kpiPf.textContent = ratio(summary.profitFactor);
    refs.kpiDrawdown.textContent = compact(summary.maxDrawdown);
    refs.kpiCurrency.textContent = state.analysis.currencies.length === 1 ? `币种 ${state.analysis.currencies[0]}` : "按文件记账单位";
  }
  refs.kpiWinRate.textContent = percent(summary.winRate);
  refs.kpiWinLoss.textContent = `${summary.wins} 胜 / ${summary.losses} 负 / ${summary.count - summary.wins - summary.losses} 平`;
  refs.kpiR.textContent = rValue(summary.averageR);
  refs.kpiRCoverage.textContent = `覆盖 ${percent(summary.rCoverage, 0)} 交易`;
  refs.equityCaption.textContent = `${summary.count} 笔 · 最长连亏 ${summary.maxLossStreak} 笔 · 费用 ${compact(summary.fees)}`;
}

function renderQuality() {
  const analysis = state.analysis;
  refs.qualityScore.textContent = `${analysis.qualityScore}`;
  refs.qualityTitle.textContent = `证据覆盖 · ${analysis.qualityScore}/100`;
  const issues = analysis.qualityIssues.length ? analysis.qualityIssues : [{ severity: "good", label: "关键证据字段完整", impact: "当前样本可以进行计划、R倍数和持仓路径复盘。" }];
  const coverageRows = [
    ["平仓时间", analysis.fieldCoverage.exitTime],
    ["止损", analysis.fieldCoverage.stop],
    ["目标", analysis.fieldCoverage.target],
    ["结果 R", analysis.fieldCoverage.rMultiple],
    ["MFE / MAE", Math.min(analysis.fieldCoverage.mfeR, analysis.fieldCoverage.maeR)],
    ["历史 K 线", analysis.fieldCoverage.market],
    ["策略标签", analysis.fieldCoverage.strategy],
    ["原始备注", analysis.fieldCoverage.notes],
  ];
  refs.qualityIssues.innerHTML = issues.map(issue => `
    <div class="rv-quality-item is-${escapeHtml(issue.severity)}">
      <strong>${escapeHtml(issue.label)}</strong><p>${escapeHtml(issue.impact)}</p>
    </div>`).join("") + `<div class="rv-coverage-grid">${coverageRows.map(([label, value]) => `
      <div class="rv-coverage-row"><span>${escapeHtml(label)}</span><div class="rv-meter"><i style="--value:${Math.max(0, Math.min(100, value))}%"></i></div><b>${escapeHtml(percent(value, 0))}</b></div>`).join("")}</div>`;
}

function renderGroups() {
  const rows = state.analysis.groups[state.groupKey] || [];
  refs.groupTableBody.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td><strong>${escapeHtml(row.key)}</strong></td>
      <td>${row.count}</td>
      <td class="${row.netPnl > 0 ? "rv-value-positive" : row.netPnl < 0 ? "rv-value-negative" : ""}">${escapeHtml(signed(row.netPnl))}</td>
      <td>${escapeHtml(percent(row.winRate))}</td>
      <td>${escapeHtml(signed(row.expectancy))}</td>
      <td>${escapeHtml(ratio(row.profitFactor))}</td>
    </tr>`).join("") : '<tr><td colspan="6" class="rv-empty-row">没有可分组的数据</td></tr>';
}

function renderBehaviors() {
  const behaviors = state.analysis.behaviors;
  refs.behaviorCount.textContent = String(behaviors.length);
  refs.behaviorList.innerHTML = behaviors.length ? behaviors.map((behavior, index) => `
    <article class="rv-behavior">
      <div class="rv-behavior__score" title="证据优先级分数">${escapeHtml(behavior.score)}</div>
      <div>
        <span class="rv-step">${index === 0 && state.analysis.primary?.id === behavior.id ? "当前唯一处方" : "证据规则"}</span>
        <h3>${escapeHtml(behavior.label)}</h3>
        <p>${escapeHtml(behavior.description)}</p>
      </div>
      <div class="rv-behavior__action"><strong>未来动作</strong><p>${escapeHtml(behavior.prescription)}</p><p><b>验收：</b>${escapeHtml(behavior.successMetric)}</p></div>
      <div class="rv-behavior__meta"><dl>
        <div><dt>发生</dt><dd>${behavior.occurrence} 笔 / ${escapeHtml(percent(behavior.rate))}</dd></div>
        <div><dt>共现亏损</dt><dd class="rv-value-negative">${escapeHtml(finite(behavior.associatedLoss) ? compact(behavior.associatedLoss) : "不可合计")}</dd></div>
        <div><dt>字段覆盖</dt><dd>${escapeHtml(percent(behavior.evidenceCoverage))}</dd></div>
        <div><dt>置信度</dt><dd>${behavior.confidence} / 100</dd></div>
      </dl></div>
      <div class="rv-behavior__limit"><b>局限：</b>${escapeHtml(behavior.limitation)} · 命中编号：${escapeHtml(behavior.affectedTradeIds.slice(0, 8).join("、"))}${behavior.affectedTradeIds.length > 8 ? "…" : ""}</div>
    </article>`).join("") : `
      <div class="rv-module"><strong>当前没有重复命中的行为规则</strong><p class="rv-caption">这不代表交易已经完美。样本不足或字段覆盖偏低时，系统宁可不下结论。</p></div>`;
}

function refreshTradeFilters() {
  const previous = refs.tradeSymbolFilter.value;
  const symbols = [...new Set(state.trades.map(trade => trade.symbol))].sort();
  refs.tradeSymbolFilter.innerHTML = '<option value="all">全部品种</option>' + symbols.map(symbol => `<option value="${escapeHtml(symbol)}">${escapeHtml(symbol)}</option>`).join("");
  if (symbols.includes(previous)) refs.tradeSymbolFilter.value = previous;
  refs.tradeCount.textContent = String(state.trades.length);
}

function filteredTrades() {
  const query = refs.tradeSearch.value.trim().toLowerCase();
  const result = refs.tradeResultFilter.value;
  const symbol = refs.tradeSymbolFilter.value;
  return state.trades.filter(trade => {
    if (symbol !== "all" && trade.symbol !== symbol) return false;
    if (result === "win" && trade.netPnl <= 0) return false;
    if (result === "loss" && trade.netPnl >= 0) return false;
    if (result === "flat" && trade.netPnl !== 0) return false;
    if (query && ![trade.id, trade.symbol, trade.strategy, trade.notes].join(" ").toLowerCase().includes(query)) return false;
    return true;
  });
}

function renderTrades() {
  const trades = filteredTrades();
  refs.tradeFilterFacts.textContent = `显示 ${trades.length} / ${state.trades.length} 笔`;
  refs.tradeTableBody.innerHTML = trades.length ? trades.slice().reverse().map(trade => {
    const flags = state.analysis.behaviors.filter(behavior => behavior.affectedTradeIds.includes(trade.id));
    const completePlan = trade.stop !== null && trade.target !== null;
    return `
      <tr>
        <td>${escapeHtml(dateTime(trade.entryTime))}<span class="rv-trade-id">${escapeHtml(trade.id)}</span></td>
        <td><strong>${escapeHtml(trade.symbol)}</strong></td>
        <td><span class="rv-side ${trade.side === "short" ? "is-short" : ""}">${trade.side === "long" ? "多" : "空"}</span></td>
        <td>${escapeHtml(trade.strategy || "未标记")}</td>
        <td class="${trade.netPnl > 0 ? "rv-value-positive" : trade.netPnl < 0 ? "rv-value-negative" : ""}">${escapeHtml(signed(trade.netPnl))}</td>
        <td>${escapeHtml(rValue(trade.rMultiple))}</td>
        <td><span class="rv-plan-state ${completePlan ? "" : "is-missing"}">${completePlan ? `1:${compact(trade.plannedRR)}` : "不完整"}</span></td>
        <td>${trade.marketCoverage ? "K线" : "订单"}${flags.length ? ` · ${flags.length}条规则` : ""}</td>
        <td><button type="button" class="rv-review-button" data-trade-id="${escapeHtml(encodeURIComponent(trade.id))}">重演</button></td>
      </tr>`;
  }).join("") : '<tr><td colspan="9" class="rv-empty-row">当前筛选没有匹配交易</td></tr>';
}

function renderGrowth() {
  refs.dimensionList.innerHTML = state.analysis.dimensions.map(dimension => {
    const score = finite(dimension.score) ? dimension.score : 0;
    return `
      <div class="rv-dimension">
        <div class="rv-dimension__top"><strong>${escapeHtml(dimension.label)}</strong><span>${finite(dimension.score) ? `${dimension.score}/100` : "证据不足"} · 覆盖 ${dimension.coverage}%</span></div>
        <div class="rv-meter"><i style="--value:${score}%"></i></div><p>${escapeHtml(dimension.definition)}</p>
      </div>`;
  }).join("");
  const { recent, prior, primary } = state.analysis;
  const behaviorLabel = primary?.label || "主要行为";
  refs.recentCompare.innerHTML = `
    <div><span>最近10笔期望值</span><strong class="${recent.expectancy > 0 ? "rv-value-positive" : recent.expectancy < 0 ? "rv-value-negative" : ""}">${escapeHtml(signed(recent.expectancy))}</strong><small>此前样本 ${escapeHtml(signed(prior.expectancy))}</small></div>
    <div><span>最近10笔胜率</span><strong>${escapeHtml(percent(recent.winRate))}</strong><small>此前样本 ${escapeHtml(percent(prior.winRate))}</small></div>
    <div><span>${escapeHtml(behaviorLabel)}频率</span><strong>${escapeHtml(percent(recent.behaviorRate))}</strong><small>此前样本 ${escapeHtml(percent(prior.behaviorRate))}</small></div>`;
}

function setWorkspace(name) {
  if (!state.analysis && name !== "consult") {
    showToast("先导入自己的成交，才能使用复盘、教练和成长对标。", "error");
    return;
  }
  state.activeWorkspace = name;
  document.querySelectorAll("[data-workspace]").forEach(button => button.setAttribute("aria-selected", button.dataset.workspace === name ? "true" : "false"));
  document.querySelectorAll("[data-workspace-panel]").forEach(panel => { panel.hidden = panel.dataset.workspacePanel !== name; });
  window.requestAnimationFrame(() => {
    if (name === "review") {
      if (state.activeTab === "overview") drawEquityChart();
      if (state.activeTab === "growth") drawGrowthChart();
    }
    if (name === "coach") drawCoachChart();
    if (name === "benchmark") drawBenchmarkChart();
    if (name === "consult") drawConsultChart();
  });
}

function renderTradeSelect(select, selectedId) {
  if (!state.trades.length) {
    select.innerHTML = '<option value="">没有本地交易</option>';
    select.disabled = true;
    return null;
  }
  select.disabled = false;
  const fallback = state.trades.find(trade => trade.id === "DEMO-014")?.id || state.trades.at(-1).id;
  const selected = state.trades.some(trade => trade.id === selectedId) ? selectedId : fallback;
  select.innerHTML = state.trades.slice().reverse().map(trade => `<option value="${escapeHtml(encodeURIComponent(trade.id))}">${escapeHtml(trade.symbol)} · ${trade.side === "long" ? "多" : "空"} · ${escapeHtml(rValue(trade.rMultiple))} · ${escapeHtml(trade.id)}</option>`).join("");
  select.value = encodeURIComponent(selected);
  return selected;
}

function renderCoachWorkspace() {
  if (!state.analysis) return;
  state.coachTradeId = renderTradeSelect(refs.coachTradeSelect, state.coachTradeId);
  const trade = state.trades.find(item => item.id === state.coachTradeId);
  if (!trade) return;
  const review = reviewTrade(trade, state.analysis);
  refs.coachChartTitle.textContent = `${trade.symbol} · ${trade.side === "long" ? "做多" : "做空"} · ${trade.id}`;
  refs.coachChartCaption.textContent = trade.marketCoverage ? `入场前结构 + 持仓路径 · ${rValue(trade.rMultiple)}` : "只有订单证据 · 具体点位暂停";
  refs.coachBrief.innerHTML = `
    <span class="rv-step">真实结果与重做目标</span>
    <h3>${escapeHtml(review.betterPlan.headline)}</h3>
    <p>${escapeHtml(review.betterPlan.diagnosis)}</p>
    <dl>
      <div><dt>实际结果</dt><dd class="${trade.rMultiple > 0 ? "rv-value-positive" : trade.rMultiple < 0 ? "rv-value-negative" : ""}">${escapeHtml(rValue(trade.rMultiple))}</dd></div>
      <div><dt>最大有利 / 不利</dt><dd>${escapeHtml(rValue(trade.mfeR))} / ${escapeHtml(maeValue(trade.maeR))}</dd></div>
      <div><dt>计划赔率</dt><dd>${finite(trade.plannedRR) ? `1:${escapeHtml(compact(trade.plannedRR))}` : "不完整"}</dd></div>
      <div><dt>当前证据</dt><dd>${trade.marketCoverage ? "订单 + K线" : "订单字段"}</dd></div>
    </dl>`;
  refs.coachCards.innerHTML = review.coachReplay.map(coach => `
    <article class="rv-coach-card">
      <div class="rv-coach-card__head"><div><span class="rv-step">${escapeHtml(coach.school)}</span><h3>${escapeHtml(coach.name)}</h3></div><span class="rv-evidence-pill">${escapeHtml(coach.evidence)}</span></div>
      <div class="rv-coach-decision"><span>会不会做</span><strong>${escapeHtml(coach.decision)}</strong></div>
      <dl class="rv-coach-plan">
        <div><dt>入场</dt><dd>${escapeHtml(coach.entry)}</dd></div>
        <div><dt>止损</dt><dd>${escapeHtml(coach.stop)}</dd></div>
        <div><dt>加仓</dt><dd>${escapeHtml(coach.add)}</dd></div>
        <div><dt>减仓</dt><dd>${escapeHtml(coach.reduce)}</dd></div>
        <div><dt>退出</dt><dd>${escapeHtml(coach.exit)}</dd></div>
      </dl>
      <div class="rv-coach-rationale"><strong>为什么</strong><p>${escapeHtml(coach.rationale)}</p></div>
      <div class="rv-coach-limit"><span>推演完整度 ${coach.confidence}/100，不是胜率</span><p>${escapeHtml(coach.limitation)}</p></div>
    </article>`).join("");
  refs.coachConsensus.innerHTML = `
    <div><span class="rv-step">三位教练的共同底线</span><h3>他们可以不同意方向，但不能违背同一套生存规则</h3></div>
    <div class="rv-consensus-rules"><span>价格离开计划区，不追</span><span>亏损仓不摊平</span><span>加仓后总风险仍≤1R</span><span>失效先退，不拿目标放宽止损</span></div>
    <p>${escapeHtml(review.betterPlan.nextTradeRule)}</p>`;
}

function growthPassport() {
  if (!state.analysis) return [];
  const { analysis } = state;
  const dimensionMap = Object.fromEntries(analysis.dimensions.map(item => [item.label, item]));
  const risk = dimensionMap["风险预算"];
  const executionScores = analysis.dimensions.filter(item => finite(item.score) && item.coverage >= 50).map(item => item.score);
  const executionAverage = executionScores.length ? executionScores.reduce((sum, value) => sum + value, 0) / executionScores.length : 0;
  const behaviorImproving = analysis.primary
    ? finite(analysis.recent.behaviorRate) && finite(analysis.prior.behaviorRate) && analysis.recent.behaviorRate < analysis.prior.behaviorRate
    : analysis.summary.count >= 20;
  return [
    { label: "证据完整", pass: analysis.summary.count >= 20 && analysis.qualityScore >= 70, value: `${analysis.summary.count}笔 · 质量${analysis.qualityScore}`, action: "先积累20笔，并让止损、目标、时间和R覆盖达到可核验水平。" },
    { label: "损失受控", pass: finite(risk?.score) && risk.score >= 80 && risk.coverage >= 60, value: finite(risk?.score) ? `${risk.score}/100` : "证据不足", action: "固定1R；止损变宽只能减仓，亏损后下一笔不得扩大风险。" },
    { label: "执行一致", pass: executionAverage >= 75 && behaviorImproving, value: `${Math.round(executionAverage)}/100`, action: "只练当前唯一处方，让主要违规频率在下一个10笔窗口下降。" },
    { label: "优势可重复", pass: analysis.summary.count >= 30 && analysis.recent.expectancy > 0 && analysis.prior.expectancy > 0, value: `近10笔 ${signed(analysis.recent.expectancy)}`, action: "至少让前后两个独立窗口都保持正期望，再讨论放大仓位。" },
  ];
}

function renderBenchmarkWorkspace() {
  refs.benchmarkUpdatedAt.textContent = `资料核对至 ${REVIEW_BENCHMARKS.updatedAt}`;
  const passport = growthPassport();
  refs.growthPassport.innerHTML = passport.length ? passport.map((item, index) => `
    <article class="${item.pass ? "is-pass" : ""}"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.value)}</small></div><b>${item.pass ? "已通过" : "进行中"}</b></article>`).join("") : '<p>导入自己的交易后生成成长护照。</p>';
  const firstIncomplete = passport.findIndex(item => !item.pass);
  const currentIndex = firstIncomplete === -1 ? Math.max(0, passport.length - 1) : firstIncomplete;
  const current = passport[currentIndex] || passport.at(-1);
  const passed = passport.filter(item => item.pass).length;
  refs.growthStageTitle.textContent = current ? `当前阶段：${current.label}` : "等待交易样本";
  refs.growthStageScore.textContent = passport.length ? `${passed}/4` : "-";
  refs.growthStageActions.innerHTML = current ? `
    <div class="rv-growth-next"><strong>这阶段先做什么</strong><p>${escapeHtml(current.action)}</p></div>
    <div class="rv-growth-next"><strong>毕业条件</strong><p>${escapeHtml(current.value)} 只是当前值；满足本阶段后，还要在后续样本继续保持。</p></div>
    <div class="rv-growth-next"><strong>不做什么</strong><p>不拿高手的一段高收益替代自己的样本，不因一次盈利提前放大风险。</p></div>` : '<p class="rv-caption">至少导入5笔后开始判断。</p>';
  refs.benchmarkChartTitle.textContent = `${REVIEW_BENCHMARKS.trajectory.name} · ${REVIEW_BENCHMARKS.trajectory.label}`;
  refs.benchmarkChartNote.innerHTML = `${escapeHtml(REVIEW_BENCHMARKS.trajectory.lesson)} <a href="${escapeHtml(REVIEW_BENCHMARKS.trajectory.sourceUrl)}" target="_blank" rel="noreferrer">查看官方来源</a>。${escapeHtml(REVIEW_BENCHMARKS.trajectory.limitation)}`;
  refs.benchmarkCards.innerHTML = REVIEW_BENCHMARKS.references.map(reference => `
    <article class="rv-benchmark-card">
      <div class="rv-benchmark-card__head"><span class="rv-step">${escapeHtml(reference.eyebrow)}</span><span class="rv-evidence-pill">${escapeHtml(reference.evidence)}</span></div>
      <h3>${escapeHtml(reference.name)}</h3><strong>${escapeHtml(reference.headline)}</strong><p>${escapeHtml(reference.body)}</p>
      <div class="rv-benchmark-takeaway">${escapeHtml(reference.takeaway)}</div>
      <a href="${escapeHtml(reference.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(reference.sourceLabel)}</a>
    </article>`).join("");
}

function stanceLabel(value) {
  return value === "agree" ? "赞同" : value === "oppose" ? "反对" : "谨慎";
}

function renderConsultation() {
  const selected = renderTradeSelect(refs.consultTradeSelect, refs.consultTradeSelect.value ? decodeURIComponent(refs.consultTradeSelect.value) : state.coachTradeId);
  refs.createCaseButton.disabled = !selected;
  refs.consultBuilder.classList.toggle("is-disabled", !state.analysis);
  const packet = state.consultCase;
  refs.consultEmpty.hidden = Boolean(packet);
  refs.consultCaseContent.hidden = !packet;
  refs.feedbackWorkbench.hidden = !packet;
  refs.ownerCuration.hidden = true;
  if (!packet) return;
  state.consultFeedbacks = feedbacksForCase(packet.id);
  refs.consultCaseHead.innerHTML = `
    <div><span class="rv-step">${escapeHtml(packet.id)} · ${packet.publicFeedback?.length ? "本人精选公开版" : "匿名会诊单"}</span><h3>${escapeHtml(packet.trade.symbol)} · ${packet.trade.side === "long" ? "做多" : "做空"} · ${escapeHtml(packet.author)}</h3><p>${escapeHtml(packet.question)}</p></div>
    <span class="rv-evidence-pill">${packet.chart.bars.length ? "含匿名K线" : "只有订单字段"}</span>`;
  const priceSuffix = packet.chart.priceMode === "entry_normalized_to_100" ? "（入场归一为100）" : "";
  const facts = [
    ["方向 / 策略", `${packet.trade.side === "long" ? "做多" : "做空"} / ${packet.trade.strategy}`],
    ["入场 / 出场", `${compact(packet.trade.entry)} / ${compact(packet.trade.exit)} ${priceSuffix}`],
    ["止损 / 目标", `${compact(packet.trade.stop)} / ${compact(packet.trade.target)}`],
    ["结果 / MFE / MAE", `${rValue(packet.trade.rMultiple)} / ${rValue(packet.trade.mfeR)} / ${maeValue(packet.trade.maeR)}`],
  ];
  if (packet.trade.netPnl !== null) facts.push(["金额盈亏", `${signed(packet.trade.netPnl)} ${packet.trade.currency || ""}`]);
  if (packet.trade.entryTime) facts.push(["精确时间", packet.trade.entryTime]);
  if (packet.trade.notes) facts.push(["原始备注", packet.trade.notes]);
  refs.consultFacts.innerHTML = facts.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  refs.publicFeedback.innerHTML = packet.publicFeedback?.length
    ? `<div class="rv-module__head"><div><span class="rv-step">由交易本人选出的公开思路</span><h3>${packet.publicFeedback.length} 条</h3></div></div>${packet.publicFeedback.map(item => `
      <article><div><span>${escapeHtml(stanceLabel(item.stance))}</span><strong>${escapeHtml(item.author)}</strong></div><h4>${escapeHtml(item.thesis)}</h4>${item.evidence ? `<p><b>证据：</b>${escapeHtml(item.evidence)}</p>` : ""}<p><b>计划：</b>${escapeHtml(item.plan)}</p></article>`).join("")}`
    : '<div class="rv-public-empty"><strong>还没有本人公开的战友思路</strong><p>私评默认不可见，只有发单者勾选后才会出现在精选公开链接中。</p></div>';
  const owner = state.ownedCaseIds.has(packet.id);
  refs.ownerCuration.hidden = !owner;
  if (owner) {
    refs.privateFeedbackList.innerHTML = state.consultFeedbacks.length ? state.consultFeedbacks.map(item => `
      <label class="rv-private-view"><input type="checkbox" value="${escapeHtml(item.id)}"><div><span>${escapeHtml(stanceLabel(item.stance))} · ${escapeHtml(item.author)}</span><strong>${escapeHtml(item.thesis)}</strong>${item.evidence ? `<p>证据：${escapeHtml(item.evidence)}</p>` : ""}<p>计划：${escapeHtml(item.plan)}</p></div></label>`).join("") : '<p class="rv-caption">还没有收到私评。战友打开会诊链接后生成回传链接，你打开一次就会进入这里。</p>';
  }
}

function createConsultationCase() {
  if (!state.analysis) throw new Error("请先导入自己的成交，再选择一笔生成会诊链接。");
  const tradeId = decodeURIComponent(refs.consultTradeSelect.value || "");
  const trade = state.trades.find(item => item.id === tradeId);
  const packet = createCasePacket({
    trade,
    alias: refs.consultAlias.value,
    question: refs.consultQuestion.value,
    visibility: {
      symbol: refs.shareSymbol.checked,
      time: refs.shareTime.checked,
      price: refs.sharePrice.checked,
      money: refs.shareMoney.checked,
      notes: refs.shareNotes.checked,
    },
  });
  state.consultCase = packet;
  rememberOwnedCase(packet.id);
  refs.caseLinkOutput.value = shareUrl(packet);
  refs.copyCaseButton.disabled = false;
  refs.feedbackLinkOutput.value = "";
  refs.copyFeedbackButton.disabled = true;
  renderConsultation();
  window.requestAnimationFrame(drawConsultChart);
  showToast("匿名会诊链接已生成；默认字段不会离开这个链接。");
}

function createPrivateFeedback() {
  if (!state.consultCase) throw new Error("请先打开一张会诊单。");
  const feedback = createFeedbackPacket({
    casePacket: state.consultCase,
    alias: refs.feedbackAlias.value,
    stance: refs.feedbackStance.value,
    thesis: refs.feedbackThesis.value,
    evidence: refs.feedbackEvidence.value,
    plan: refs.feedbackPlan.value,
  });
  refs.feedbackLinkOutput.value = shareUrl(state.consultCase, feedback);
  refs.copyFeedbackButton.disabled = false;
  showToast("私评回传链接已生成；它不会自动公开。");
}

function createCuratedPublicCase() {
  if (!state.consultCase || !state.ownedCaseIds.has(state.consultCase.id)) throw new Error("只有这张会诊单的发起浏览器可以生成精选公开版。");
  const selectedIds = [...refs.privateFeedbackList.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
  if (!selectedIds.length) throw new Error("请先勾选至少一条值得公开的私评。");
  const publicCase = createPublicCase(state.consultCase, state.consultFeedbacks, selectedIds);
  refs.publicCaseLinkOutput.value = shareUrl(publicCase);
  refs.copyPublicCaseButton.disabled = false;
  showToast(`已生成包含 ${publicCase.publicFeedback.length} 条精选思路的公开链接。`);
}

function loadSharedHash() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw.includes("case=")) return false;
  const params = new URLSearchParams(raw);
  const packet = validateCasePacket(decodeSharePayload(params.get("case")));
  const feedbackEncoded = params.get("feedback");
  if (feedbackEncoded) {
    const feedback = validateFeedbackPacket(decodeSharePayload(feedbackEncoded));
    if (feedback.caseId !== packet.id) throw new Error("私评与会诊单编号不一致。");
    saveFeedback(feedback);
    showToast(state.ownedCaseIds.has(packet.id) ? "已收到一条私评，只有你选择后才会公开。" : "私评链接已读取；仅会诊单发起者能进入筛选区。");
  }
  state.consultCase = packet;
  refs.importView.hidden = true;
  refs.resultsView.hidden = false;
  document.querySelector(".rv-workbar").hidden = !state.analysis;
  document.querySelectorAll("[data-workspace]").forEach(button => { button.disabled = !state.analysis && button.dataset.workspace !== "consult"; });
  renderConsultation();
  setWorkspace("consult");
  window.scrollTo({ top: 0, behavior: "smooth" });
  return true;
}

function setActiveTab(name) {
  state.activeTab = name;
  document.querySelectorAll("[data-tab]").forEach(button => button.setAttribute("aria-selected", button.dataset.tab === name ? "true" : "false"));
  document.querySelectorAll("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
  window.requestAnimationFrame(() => {
    if (name === "overview") drawEquityChart();
    if (name === "growth") drawGrowthChart();
  });
}

function canvasContext(canvas, minimumWidth = 320) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return null;
  const width = Math.max(minimumWidth, Math.floor(rect.width));
  const height = Math.max(220, Math.floor(rect.height || 280));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawEmptyChart(context, width, height, message) {
  context.fillStyle = "#8795a3";
  context.font = "11px ui-sans-serif, system-ui";
  context.textAlign = "center";
  context.fillText(message, width / 2, height / 2);
  context.textAlign = "left";
}

function drawEquityChart() {
  if (!state.analysis || state.activeTab !== "overview") return;
  const surface = canvasContext(refs.equityChart);
  if (!surface) return;
  const { context: ctx, width, height } = surface;
  const curve = [{ value: 0, time: state.trades[0]?.entryTime }, ...state.analysis.summary.curve];
  if (curve.length < 2) { drawEmptyChart(ctx, width, height, "至少需要1笔交易绘制权益曲线"); return; }
  const values = curve.map(point => point.value);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  const span = Math.max(1, max - min);
  min -= span * .12;
  max += span * .12;
  const pad = { left: 48, right: 18, top: 16, bottom: 28 };
  const x = index => pad.left + index * (width - pad.left - pad.right) / Math.max(1, curve.length - 1);
  const y = value => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
  ctx.font = "9px ui-sans-serif, system-ui";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const value = min + (max - min) * index / 4;
    ctx.strokeStyle = "#202a34";
    ctx.beginPath(); ctx.moveTo(pad.left, y(value)); ctx.lineTo(width - pad.right, y(value)); ctx.stroke();
    ctx.fillStyle = "#758493"; ctx.fillText(compact(value), 4, y(value) + 3);
  }
  if (min < 0 && max > 0) {
    ctx.strokeStyle = "#46515c"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad.left, y(0)); ctx.lineTo(width - pad.right, y(0)); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.strokeStyle = values.at(-1) >= 0 ? "#55d68b" : "#ef7c86";
  ctx.lineWidth = 2;
  ctx.beginPath(); curve.forEach((point, index) => index ? ctx.lineTo(x(index), y(point.value)) : ctx.moveTo(x(index), y(point.value))); ctx.stroke();
  curve.forEach((point, index) => {
    if (index === 0 || index === curve.length - 1 || index % Math.ceil(curve.length / 8) === 0) {
      ctx.fillStyle = "#9aabb9"; ctx.beginPath(); ctx.arc(x(index), y(point.value), 2.3, 0, Math.PI * 2); ctx.fill();
    }
  });
  ctx.fillStyle = "#9caab8";
  ctx.fillText("0", pad.left - 3, height - 7);
  ctx.textAlign = "right"; ctx.fillText(`${curve.length - 1} 笔`, width - pad.right, height - 7); ctx.textAlign = "left";
}

function drawGrowthChart() {
  if (!state.analysis || state.activeTab !== "growth") return;
  const surface = canvasContext(refs.growthChart);
  if (!surface) return;
  const { context: ctx, width, height } = surface;
  const points = state.analysis.rolling;
  if (points.length < 2) { drawEmptyChart(ctx, width, height, "至少需要2笔交易绘制滚动变化"); return; }
  const expectancies = points.map(point => point.expectancy).filter(finite);
  let min = Math.min(0, ...expectancies);
  let max = Math.max(0, ...expectancies);
  const span = Math.max(1, max - min);
  min -= span * .12; max += span * .12;
  const pad = { left: 48, right: 38, top: 20, bottom: 28 };
  const x = index => pad.left + index * (width - pad.left - pad.right) / Math.max(1, points.length - 1);
  const yMoney = value => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
  const yRate = value => pad.top + (100 - value) * (height - pad.top - pad.bottom) / 100;
  ctx.font = "9px ui-sans-serif, system-ui";
  for (let index = 0; index <= 4; index += 1) {
    const value = min + (max - min) * index / 4;
    const yy = yMoney(value);
    ctx.strokeStyle = "#202a34"; ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke();
    ctx.fillStyle = "#758493"; ctx.fillText(compact(value), 4, yy + 3);
  }
  ctx.strokeStyle = "#55d68b"; ctx.lineWidth = 2; ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(x(index), yMoney(point.expectancy)) : ctx.moveTo(x(index), yMoney(point.expectancy))); ctx.stroke();
  const behaviorPoints = points.filter(point => finite(point.behaviorRate));
  if (behaviorPoints.length) {
    ctx.strokeStyle = "#f1bd62"; ctx.lineWidth = 1.7; ctx.setLineDash([5, 4]); ctx.beginPath();
    points.forEach((point, index) => { if (!finite(point.behaviorRate)) return; if (!index || !finite(points[index - 1].behaviorRate)) ctx.moveTo(x(index), yRate(point.behaviorRate)); else ctx.lineTo(x(index), yRate(point.behaviorRate)); });
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = "#55d68b"; ctx.fillText("期望值", pad.left, 11);
  ctx.fillStyle = "#f1bd62"; ctx.fillText("主要行为频率", pad.left + 48, 11);
  ctx.fillStyle = "#758493"; ctx.textAlign = "right"; ctx.fillText("100%", width - 2, pad.top + 3); ctx.fillText("0%", width - 2, height - pad.bottom); ctx.textAlign = "left";
}

function drawBenchmarkChart() {
  if (state.activeWorkspace !== "benchmark") return;
  const surface = canvasContext(refs.benchmarkChart);
  if (!surface) return;
  const { context: ctx, width, height } = surface;
  const points = REVIEW_BENCHMARKS.trajectory.points;
  const values = points.map(point => point.value);
  let min = Math.min(0, ...values);
  let max = Math.max(...values);
  const span = Math.max(1, max - min);
  min -= span * .08; max += span * .12;
  const pad = { left: 48, right: 22, top: 24, bottom: 34 };
  const x = index => pad.left + index * (width - pad.left - pad.right) / Math.max(1, points.length - 1);
  const y = value => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
  ctx.font = "9px ui-sans-serif, system-ui";
  for (let index = 0; index <= 4; index += 1) {
    const value = min + (max - min) * index / 4;
    ctx.strokeStyle = "#202a34"; ctx.beginPath(); ctx.moveTo(pad.left, y(value)); ctx.lineTo(width - pad.right, y(value)); ctx.stroke();
    ctx.fillStyle = "#758493"; ctx.fillText(`${Math.round(value)}%`, 3, y(value) + 3);
  }
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, "rgba(99,166,244,.28)"); gradient.addColorStop(1, "rgba(99,166,244,0)");
  ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(x(index), y(point.value)) : ctx.moveTo(x(index), y(point.value)));
  ctx.lineTo(x(points.length - 1), height - pad.bottom); ctx.lineTo(x(0), height - pad.bottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(x(index), y(point.value)) : ctx.moveTo(x(index), y(point.value)));
  ctx.strokeStyle = "#63a6f4"; ctx.lineWidth = 2.2; ctx.stroke();
  points.forEach((point, index) => {
    ctx.fillStyle = index === 3 ? "#ef7c86" : "#63a6f4"; ctx.beginPath(); ctx.arc(x(index), y(point.value), 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#aab7c4"; ctx.textAlign = "center"; ctx.fillText(point.label, x(index), height - 12); ctx.fillText(`${point.value}%`, x(index), y(point.value) - 8);
  });
  ctx.textAlign = "left";
}

function openTradeReview(tradeId) {
  const trade = state.trades.find(item => item.id === tradeId);
  if (!trade) return;
  state.selectedTradeId = tradeId;
  const review = reviewTrade(trade, state.analysis);
  refs.tradeDialogTitle.textContent = `${trade.symbol} · ${trade.side === "long" ? "做多" : "做空"} · ${signed(trade.netPnl)}`;
  refs.tradeDialogMeta.textContent = `${fullDateTime(trade.entryTime)} · ${trade.id}${trade.strategy ? ` · ${trade.strategy}` : ""}`;
  const facts = [
    ["入场 / 出场", `${compact(trade.entryPrice)} / ${compact(trade.exitPrice)}`],
    ["止损 / 目标", `${compact(trade.stop)} / ${compact(trade.target)}`],
    ["净盈亏 / 结果R", `${signed(trade.netPnl)} / ${rValue(trade.rMultiple)}`],
    ["MFE / MAE", `${rValue(trade.mfeR)} / ${finite(trade.maeR) ? `${compact(trade.maeR)}R` : "-"}`],
    ["持仓时间", finite(trade.durationMinutes) ? `${compact(trade.durationMinutes)} 分钟` : "未知"],
    ["费用", compact(trade.fees)],
    ["行为规则", review.flags.length ? review.flags.join("、") : "未命中"],
    ["过程备注", trade.notes || "未记录"],
  ];
  refs.tradeFacts.innerHTML = facts.map(([label, value]) => `<div class="rv-replay-fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  const notes = [
    ["行情结构", review.structure],
    ["老手的入场计划", review.plan],
    ["持仓与加减仓", review.management],
    ["结果核验", review.result],
    ...(review.expertLenses || []).map(lens => [lens.label, lens.text]),
  ];
  refs.tradeReviewNotes.innerHTML = notes.map(([label, text]) => `<article class="rv-review-note"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(text)}</p></article>`).join("");
  refs.betterPlan.innerHTML = `
    <div class="rv-better-plan__head">
      <div><span class="rv-step">这笔怎样做得更好</span><h3>${escapeHtml(review.betterPlan.headline)}</h3><p>${escapeHtml(review.betterPlan.diagnosis)}</p></div>
      <span class="rv-better-plan__tag">执行重写 · 非结果倒推</span>
    </div>
    <div class="rv-better-plan__steps">${review.betterPlan.steps.map((step, index) => `
      <div class="rv-better-step"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(step.stage)}</strong><p>${escapeHtml(step.action)}</p></div>`).join("")}</div>
    <div class="rv-better-plan__rule">
      <div><strong>下一次只练这一条</strong><p>${escapeHtml(review.betterPlan.nextTradeRule)}</p></div>
      <div><strong>边界</strong><p>${escapeHtml(review.betterPlan.limitation)}</p></div>
    </div>`;
  refs.tradeCanSay.innerHTML = review.canSay.map(item => `<li>${escapeHtml(item)}</li>`).join("");
  refs.tradeCannotSay.innerHTML = review.cannotSay.map(item => `<li>${escapeHtml(item)}</li>`).join("");
  refs.tradeDialog.showModal();
  window.requestAnimationFrame(() => drawTradeChart(trade));
}

function drawTradeChart(trade) {
  drawTradeChartInto(refs.tradeChart, refs.tradeChartEmpty, trade, "这笔交易没有匹配到历史K线。当前只展示订单证据，不生成支撑阻力、趋势或最佳进出场点。");
}

function drawCoachChart() {
  if (!state.analysis || state.activeWorkspace !== "coach") return;
  const trade = state.trades.find(item => item.id === state.coachTradeId);
  if (!trade) return;
  drawTradeChartInto(refs.coachChart, refs.coachChartEmpty, trade, "这笔交易缺少历史K线。三位教练只回答风险与记录要求，不会编造具体价位。");
}

function drawTradeChartInto(canvas, empty, trade, emptyMessage) {
  const bars = trade.marketBars || [];
  const hasBars = bars.length > 1;
  canvas.hidden = !hasBars;
  empty.hidden = hasBars;
  if (!hasBars) {
    empty.textContent = emptyMessage;
    return;
  }
  const surface = canvasContext(canvas, 500);
  if (!surface) return;
  const { context: ctx, width, height } = surface;
  const levels = [trade.entryPrice, trade.exitPrice, trade.stop, trade.target].filter(finite);
  let min = Math.min(...bars.map(bar => bar.low), ...levels);
  let max = Math.max(...bars.map(bar => bar.high), ...levels);
  const span = Math.max(Math.abs(max) * .0001, max - min, 1e-8);
  min -= span * .08; max += span * .08;
  const pad = { left: 12, right: 64, top: 16, bottom: 25 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const firstTime = bars[0].time;
  const lastTime = bars.at(-1).time;
  const timeX = value => pad.left + (value - firstTime) * plotWidth / Math.max(1, lastTime - firstTime);
  const x = index => timeX(bars[index].time);
  const y = value => pad.top + (max - value) * plotHeight / (max - min);
  ctx.font = "9px ui-sans-serif, system-ui";
  for (let index = 0; index <= 4; index += 1) {
    const value = min + (max - min) * index / 4;
    const yy = y(value);
    ctx.strokeStyle = "#1b252e"; ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke();
    ctx.fillStyle = "#758493"; ctx.fillText(compact(value), width - pad.right + 6, yy + 3);
  }
  const candleWidth = Math.max(1, Math.min(8, plotWidth / bars.length * .62));
  bars.forEach((bar, index) => {
    const rising = bar.close >= bar.open;
    const tone = rising ? "#55d68b" : "#ef7c86";
    ctx.strokeStyle = tone; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(index), y(bar.high)); ctx.lineTo(x(index), y(bar.low)); ctx.stroke();
    ctx.fillStyle = tone;
    const top = Math.min(y(bar.open), y(bar.close));
    const bodyHeight = Math.max(1, Math.abs(y(bar.open) - y(bar.close)));
    ctx.fillRect(x(index) - candleWidth / 2, top, candleWidth, bodyHeight);
  });
  const drawLevel = (value, label, tone, dashed = false) => {
    if (!finite(value)) return;
    ctx.strokeStyle = tone; ctx.lineWidth = 1; if (dashed) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(pad.left, y(value)); ctx.lineTo(width - pad.right, y(value)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = tone; ctx.fillText(label, pad.left + 4, y(value) - 4);
  };
  drawLevel(trade.entryPrice, "ENTRY", "#63a6f4");
  drawLevel(trade.exitPrice, "EXIT", "#c6d0da", true);
  drawLevel(trade.stop, "SL", "#ef7c86", true);
  drawLevel(trade.target, "TP", "#55d68b", true);
  [[trade.entryTime, "入场", "#63a6f4"], [trade.exitTime, "出场", "#c6d0da"]].forEach(([time, label, tone]) => {
    if (!finite(time) || time < firstTime || time > lastTime) return;
    const xx = timeX(time); ctx.strokeStyle = tone; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(xx, pad.top); ctx.lineTo(xx, height - pad.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = tone; ctx.fillText(label, Math.min(width - pad.right - 24, xx + 3), height - 8);
  });
}

function drawConsultChart() {
  if (state.activeWorkspace !== "consult" || !state.consultCase) return;
  const packet = state.consultCase;
  const bars = packet.chart.bars || [];
  const hasBars = bars.length > 1;
  refs.consultChart.hidden = !hasBars;
  refs.consultChartEmpty.hidden = hasBars;
  if (!hasBars) {
    refs.consultChartEmpty.textContent = "发单者没有分享可用K线；只能讨论订单计划与风险字段。";
    return;
  }
  const surface = canvasContext(refs.consultChart, 500);
  if (!surface) return;
  const { context: ctx, width, height } = surface;
  const levels = [packet.trade.entry, packet.trade.exit, packet.trade.stop, packet.trade.target].filter(finite);
  let min = Math.min(...bars.map(bar => bar.low), ...levels);
  let max = Math.max(...bars.map(bar => bar.high), ...levels);
  const span = Math.max(Math.abs(max) * .0001, max - min, 1e-8);
  min -= span * .08; max += span * .08;
  const pad = { left: 12, right: 64, top: 16, bottom: 26 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const firstMinute = bars[0].minute;
  const lastMinute = bars.at(-1).minute;
  const xFor = minute => pad.left + (minute - firstMinute) * plotWidth / Math.max(1, lastMinute - firstMinute);
  const y = value => pad.top + (max - value) * plotHeight / (max - min);
  ctx.font = "9px ui-sans-serif, system-ui";
  for (let index = 0; index <= 4; index += 1) {
    const value = min + (max - min) * index / 4;
    ctx.strokeStyle = "#1b252e"; ctx.beginPath(); ctx.moveTo(pad.left, y(value)); ctx.lineTo(width - pad.right, y(value)); ctx.stroke();
    ctx.fillStyle = "#758493"; ctx.fillText(compact(value), width - pad.right + 6, y(value) + 3);
  }
  const candleWidth = Math.max(1, Math.min(8, plotWidth / bars.length * .62));
  bars.forEach(bar => {
    const rising = bar.close >= bar.open;
    const tone = rising ? "#55d68b" : "#ef7c86";
    const xx = xFor(bar.minute);
    ctx.strokeStyle = tone; ctx.beginPath(); ctx.moveTo(xx, y(bar.high)); ctx.lineTo(xx, y(bar.low)); ctx.stroke();
    ctx.fillStyle = tone; ctx.fillRect(xx - candleWidth / 2, Math.min(y(bar.open), y(bar.close)), candleWidth, Math.max(1, Math.abs(y(bar.open) - y(bar.close))));
  });
  const drawLevel = (value, label, tone, dashed = false) => {
    if (!finite(value)) return;
    ctx.strokeStyle = tone; if (dashed) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(pad.left, y(value)); ctx.lineTo(width - pad.right, y(value)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = tone; ctx.fillText(label, pad.left + 4, y(value) - 4);
  };
  drawLevel(packet.trade.entry, "ENTRY", "#63a6f4");
  drawLevel(packet.trade.exit, "EXIT", "#c6d0da", true);
  drawLevel(packet.trade.stop, "SL", "#ef7c86", true);
  drawLevel(packet.trade.target, "TP", "#55d68b", true);
  ctx.fillStyle = "#8293a3"; ctx.fillText(`${firstMinute}m`, pad.left, height - 8); ctx.textAlign = "right"; ctx.fillText(`${lastMinute}m`, width - pad.right, height - 8); ctx.textAlign = "left";
}

function downloadBlob(content, fileName, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportReport() {
  const report = createExportReport(state.analysis, { source: state.source, sourceName: state.sourceName });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(JSON.stringify(report, (_key, value) => typeof value === "number" && !Number.isFinite(value) ? null : value, 2), `traderhome-review-${stamp}.json`, "application/json;charset=utf-8");
  showToast("聚合报告已生成；原始备注和逐笔明细未写入报告");
}

function downloadTemplate() {
  const header = "trade_id,symbol,side,entry_time,exit_time,entry_price,exit_price,quantity,point_value,net_pnl,currency,fees,stop_loss,take_profit,risk_amount,r_multiple,mfe_r,mae_r,strategy,notes\n";
  const example = "T-001,NQ,long,2026-01-02T14:30:00Z,2026-01-02T14:45:00Z,21000,21008,1,20,158,USD,2,20995,21010,100,1.58,1.8,0.4,opening_pullback,entry_after_confirmation\n";
  downloadBlob(header + example, "traderhome-trade-template.csv", "text/csv;charset=utf-8");
}

function clearData() {
  state.normalized = null;
  state.bars = null;
  state.trades = [];
  state.analysis = null;
  state.sourceName = "";
  state.isSample = false;
  state.selectedTradeId = null;
  state.coachTradeId = null;
  state.consultCase = null;
  state.consultFeedbacks = [];
  state.activeWorkspace = "review";
  refs.tradeFile.value = "";
  refs.barFile.value = "";
  refs.tradeSearch.value = "";
  refs.tradeResultFilter.value = "all";
  refs.barFileState.textContent = "尚未导入 · 需要 time, open, high, low, close";
  refs.barFileState.classList.remove("is-ready");
  refs.caseLinkOutput.value = "";
  refs.feedbackLinkOutput.value = "";
  refs.publicCaseLinkOutput.value = "";
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  refs.resultsView.hidden = true;
  refs.importView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  showToast("本页中的交易与K线数据已清除");
}

async function loadSample() {
  const [tradeResponse, barResponse] = await Promise.all([
    fetch(new URL("./sample-trades.csv", import.meta.url)),
    fetch(new URL("./sample-bars.csv", import.meta.url)),
  ]);
  if (!tradeResponse.ok || !barResponse.ok) throw new Error("教学案例读取失败");
  await importTradeText(await tradeResponse.text(), "合成教学案例 · 24笔", "synthetic_sample", true);
  const barResult = normalizeBarRecords(parseRecords(await barResponse.text(), "sample-bars.csv"));
  setBars(barResult, "DEMO-014 · BTCUSDT 1分钟K线");
  recompute();
  showToast("完整教学案例已就绪：可在教练重做和战友会诊中继续体验");
}

async function connectApi() {
  const url = refs.apiUrl.value.trim();
  if (!url) { refs.apiError.textContent = "请填写接口地址"; return; }
  refs.connectApiButton.disabled = true;
  refs.connectApiButton.textContent = "正在读取…";
  refs.apiError.textContent = "";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const headers = { Accept: "application/json, text/csv;q=0.9" };
    const token = refs.apiToken.value.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { headers, mode: "cors", credentials: "omit", signal: controller.signal });
    if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`);
    const text = await response.text();
    await importTradeText(text, new URL(url).hostname, "self_hosted_api", false);
    refs.apiDialog.close();
    refs.apiToken.value = "";
  } catch (error) {
    const message = error.name === "AbortError" ? "接口15秒内没有响应" : error.message;
    refs.apiError.textContent = `${message}。若浏览器提示跨域错误，请在你的接口允许本站域名读取。`;
  } finally {
    window.clearTimeout(timeout);
    refs.connectApiButton.disabled = false;
    refs.connectApiButton.textContent = "读取交易";
  }
}

function handleError(error) {
  console.error(error);
  showToast(error?.message || "处理数据时发生错误", "error");
}

refs.chooseTradeButton.addEventListener("click", () => refs.tradeFile.click());
refs.replaceDataButton.addEventListener("click", () => refs.tradeFile.click());
refs.chooseBarButton.addEventListener("click", () => refs.barFile.click());
refs.addBarsButton.addEventListener("click", () => refs.barFile.click());
refs.tradeFile.addEventListener("change", event => importTradeFile(event.target.files[0]).catch(handleError));
refs.barFile.addEventListener("change", event => importBarFile(event.target.files[0]).catch(handleError));
refs.loadSampleButton.addEventListener("click", () => loadSample().catch(handleError));
refs.downloadTemplateButton.addEventListener("click", downloadTemplate);
refs.exportButton.addEventListener("click", exportReport);
refs.clearButton.addEventListener("click", clearData);
refs.openApiButton.addEventListener("click", () => { refs.apiError.textContent = ""; refs.apiDialog.showModal(); });
refs.connectApiButton.addEventListener("click", connectApi);
refs.closeTradeDialog.addEventListener("click", () => refs.tradeDialog.close());
refs.openSampleCaseButton.addEventListener("click", () => openTradeReview("DEMO-014"));

["dragenter", "dragover"].forEach(name => refs.tradeDropzone.addEventListener(name, event => { event.preventDefault(); refs.tradeDropzone.classList.add("is-dragging"); }));
["dragleave", "drop"].forEach(name => refs.tradeDropzone.addEventListener(name, event => { event.preventDefault(); refs.tradeDropzone.classList.remove("is-dragging"); }));
refs.tradeDropzone.addEventListener("drop", event => importTradeFile(event.dataTransfer.files[0]).catch(handleError));

document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
document.querySelectorAll("[data-workspace]").forEach(button => button.addEventListener("click", () => setWorkspace(button.dataset.workspace)));
document.querySelectorAll("[data-group]").forEach(button => button.addEventListener("click", () => {
  state.groupKey = button.dataset.group;
  document.querySelectorAll("[data-group]").forEach(item => item.classList.toggle("is-active", item === button));
  renderGroups();
}));

[refs.tradeSearch, refs.tradeResultFilter, refs.tradeSymbolFilter].forEach(control => control.addEventListener("input", renderTrades));
[refs.accountSize, refs.riskPercent, refs.maxDailyTrades, refs.revengeMinutes, refs.reviewTimezone].forEach(control => control.addEventListener("change", recompute));
refs.coachTradeSelect.addEventListener("change", () => {
  state.coachTradeId = decodeURIComponent(refs.coachTradeSelect.value);
  renderCoachWorkspace();
  window.requestAnimationFrame(drawCoachChart);
});
refs.createCaseButton.addEventListener("click", () => { try { createConsultationCase(); } catch (error) { handleError(error); } });
refs.copyCaseButton.addEventListener("click", () => copyOutput(refs.caseLinkOutput, "会诊链接已复制"));
refs.createFeedbackButton.addEventListener("click", () => { try { createPrivateFeedback(); } catch (error) { handleError(error); } });
refs.copyFeedbackButton.addEventListener("click", () => copyOutput(refs.feedbackLinkOutput, "私评回传链接已复制"));
refs.createPublicCaseButton.addEventListener("click", () => { try { createCuratedPublicCase(); } catch (error) { handleError(error); } });
refs.copyPublicCaseButton.addEventListener("click", () => copyOutput(refs.publicCaseLinkOutput, "精选公开链接已复制"));
refs.tradeTableBody.addEventListener("click", event => {
  const button = event.target.closest("[data-trade-id]");
  if (button) openTradeReview(decodeURIComponent(button.dataset.tradeId));
});

window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (state.activeTab === "overview") drawEquityChart();
    if (state.activeTab === "growth") drawGrowthChart();
    if (state.activeWorkspace === "coach") drawCoachChart();
    if (state.activeWorkspace === "benchmark") drawBenchmarkChart();
    if (state.activeWorkspace === "consult") drawConsultChart();
    if (refs.tradeDialog.open && state.selectedTradeId) drawTradeChart(state.trades.find(trade => trade.id === state.selectedTradeId));
  }, 120);
}, { passive: true });

refs.apiDialog.addEventListener("click", event => {
  if (event.target === refs.apiDialog) refs.apiDialog.close();
});
refs.tradeDialog.addEventListener("click", event => {
  if (event.target === refs.tradeDialog) refs.tradeDialog.close();
});

const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
if ([...refs.reviewTimezone.options].some(option => option.value === browserTimezone)) refs.reviewTimezone.value = browserTimezone;
state.ownedCaseIds = new Set(loadStoredArray(OWNED_CASES_KEY));
window.addEventListener("hashchange", () => { try { loadSharedHash(); } catch (error) { handleError(error); } });
try { loadSharedHash(); } catch (error) { handleError(error); }
