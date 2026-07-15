import {
  analyzeTrades,
  attachMarketData,
  createExportReport,
  normalizeBarRecords,
  normalizeTradeRecords,
  parseRecords,
  reviewTrade,
} from "./review-engine.mjs";

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
  "tradeCanSay", "tradeCannotSay", "toast",
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
  selectedTradeId: null,
};

let toastTimer;
let resizeTimer;

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
const displayTimezone = () => refs.reviewTimezone?.value || "UTC";
const dateTime = value => finite(value) ? new Intl.DateTimeFormat("zh-CN", {
  timeZone: displayTimezone(), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value)) : "-";
const fullDateTime = value => finite(value) ? new Intl.DateTimeFormat("zh-CN", {
  timeZone: displayTimezone(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).format(new Date(value)) : "-";

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
  refs.importView.hidden = true;
  refs.resultsView.hidden = false;
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
  window.requestAnimationFrame(() => drawEquityChart());
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
  const bars = trade.marketBars || [];
  const hasBars = bars.length > 1;
  refs.tradeChart.hidden = !hasBars;
  refs.tradeChartEmpty.hidden = hasBars;
  if (!hasBars) {
    refs.tradeChartEmpty.textContent = "这笔交易没有匹配到历史K线。当前只展示订单证据，不生成支撑阻力、趋势或最佳进出场点。";
    return;
  }
  const surface = canvasContext(refs.tradeChart, 500);
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
  refs.tradeFile.value = "";
  refs.barFile.value = "";
  refs.tradeSearch.value = "";
  refs.tradeResultFilter.value = "all";
  refs.barFileState.textContent = "尚未导入 · 需要 time, open, high, low, close";
  refs.barFileState.classList.remove("is-ready");
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
  showToast("完整教学案例已就绪：点击绿色案例卡查看专家如何重做");
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
document.querySelectorAll("[data-group]").forEach(button => button.addEventListener("click", () => {
  state.groupKey = button.dataset.group;
  document.querySelectorAll("[data-group]").forEach(item => item.classList.toggle("is-active", item === button));
  renderGroups();
}));

[refs.tradeSearch, refs.tradeResultFilter, refs.tradeSymbolFilter].forEach(control => control.addEventListener("input", renderTrades));
[refs.accountSize, refs.riskPercent, refs.maxDailyTrades, refs.revengeMinutes, refs.reviewTimezone].forEach(control => control.addEventListener("change", recompute));
refs.tradeTableBody.addEventListener("click", event => {
  const button = event.target.closest("[data-trade-id]");
  if (button) openTradeReview(decodeURIComponent(button.dataset.tradeId));
});

window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (state.activeTab === "overview") drawEquityChart();
    if (state.activeTab === "growth") drawGrowthChart();
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
