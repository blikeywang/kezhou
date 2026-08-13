import {
  BUCKET_META,
  STATE_META,
  analyzeBars,
  calculateRiskPlan,
  normalizeBars,
} from "/tailtrend/tailtrend-engine.mjs";

const $ = (selector) => document.querySelector(selector);
const state = {
  snapshot: null,
  history: null,
  index: null,
  audit: null,
  selected: null,
  filter: "ALL",
  search: "",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value, digits = 2) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

function number(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

function toneFor(record) {
  return `tone-${BUCKET_META[record.bucket]?.tone ?? "muted"}`;
}

function weeklyLabel(value) {
  return ({ UP: "上升", DOWN: "下降", RANGE: "震荡", UNKNOWN: "未知" })[value] ?? value;
}

function bindingLabel(value) {
  return ({
    base: "袖套基准",
    pressure_group: "压力环境组",
    portfolio_headroom: "组合剩余额度",
    cluster_headroom: "集群剩余额度",
    liquidity: "流动性上限",
    circuit_breaker: "当日行为熔断",
    hard_gate: "状态 / 数据硬闸门",
  })[value] ?? value ?? "—";
}

function dataClass(value) {
  return value === "FRESH" ? "" : value === "CACHED" ? "cached" : "stale";
}

function renderHeader() {
  const snapshot = state.snapshot;
  const quality = snapshot.dataQuality;
  const newest = state.index?.entries?.[0];
  $("#snapshotMode").textContent = newest?.status === "MISSING"
    ? `缺少 ${newest.dataAsOf} · 已禁新仓`
    : snapshot.mode === "complete" ? "完整日线快照" : "部分数据降级";
  $("#snapshotDate").textContent = newest?.status === "MISSING"
    ? `最近完整 ${snapshot.tradingDate}`
    : `截至 ${snapshot.tradingDate}`;
  $("#metricUniverse").textContent = snapshot.universe.published;
  const edgeBuckets = ["TAIL_RECLAIM_WATCH", "BREAKOUT_CANDIDATE_WATCH", "TREND_ACCEPTED_WATCH", "BREAKOUT_FAILURE_WATCH", "BREAKDOWN_RISK", "EVENT_QUARANTINE"];
  $("#metricEdges").textContent = snapshot.records.filter((row) => edgeBuckets.includes(row.bucket)).length;
  $("#metricMiddle").textContent = snapshot.summary.bucketCounts.NO_TRADE_MIDDLE ?? 0;
  $("#metricFresh").textContent = `${quality.fresh}/${snapshot.universe.requested}`;
  $("#metricQuality").textContent = newest?.status === "MISSING"
    ? `${newest.dataAsOf} 已写入 MISSING，不沿用旧信号`
    : quality.errors.length ? `${quality.errors.length} 项失败，已禁止缓存触发新仓` : "全部 Fresh · 无缺失";
  $("#metricTransitions").textContent = snapshot.transitions.length;
}

function renderFilters() {
  const counts = state.snapshot.summary.bucketCounts;
  const buttons = [
    ["ALL", "全部", state.snapshot.records.length],
    ...Object.entries(BUCKET_META).map(([key, meta]) => [key, meta.label, counts[key] ?? 0]),
  ];
  $("#bucketFilters").innerHTML = buttons.map(([key, label, count]) => `<button type="button" class="tt-filter" data-bucket="${key}" aria-pressed="${state.filter === key}">${escapeHtml(label)}<b>${count}</b></button>`).join("");
  $("#bucketFilters").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.bucket;
    renderFilters();
    renderRows();
  }));
}

function filteredRecords() {
  const query = state.search.trim().toLowerCase();
  return state.snapshot.records.filter((record) => {
    if (state.filter !== "ALL" && record.bucket !== state.filter) return false;
    if (!query) return true;
    return [record.symbol, record.ticker, record.name, record.sector, record.cluster, record.label]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
  });
}

function renderRows() {
  const records = filteredRecords();
  const body = $("#scannerRows");
  if (!records.length) {
    body.innerHTML = '<tr><td colspan="6" class="tt-empty">当前筛选没有标的。</td></tr>';
    return;
  }
  body.innerHTML = records.map((record) => {
    const position = Math.max(0, Math.min(100, record.rangePositionPct ?? 50));
    const selected = state.selected?.symbol === record.symbol;
    return `<tr data-symbol="${escapeHtml(record.symbol)}" aria-selected="${selected}">
      <td data-label="标的"><div class="tt-symbol"><strong>${escapeHtml(record.ticker)}</strong><small>${escapeHtml(record.name)}</small></div></td>
      <td data-label="状态"><span class="tt-state ${toneFor(record)}">${escapeHtml(record.label)}</span><small class="tt-cell-sub">复核优先级 ${record.priority}</small></td>
      <td data-label="位置"><div class="tt-position"><div class="tt-position__bar"><i style="left:${position}%"></i></div><small class="tt-cell-sub">60日区间 ${number(record.rangePositionPct, 0)}%</small></div></td>
      <td data-label="周线 / 波动"><b>${escapeHtml(weeklyLabel(record.weeklyRegime))}</b><small class="tt-cell-sub">ATR ${number(record.atrPct)}% · HV p${number(record.hvPercentile, 0)}</small></td>
      <td data-label="动作" class="tt-action">${escapeHtml(record.action)}${record.blockers?.length ? `<small class="tt-cell-sub">${escapeHtml(record.blockers[0])}</small>` : ""}</td>
      <td data-label="数据"><span class="tt-fresh ${dataClass(record.dataStatus)}">${escapeHtml(record.dataStatus)}</span><small class="tt-cell-sub">${escapeHtml(record.tradingDate)}</small></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("tr[data-symbol]").forEach((row) => row.addEventListener("click", () => selectRecord(row.dataset.symbol, { openDetail: true })));
}

function managementRows(record) {
  const rows = [];
  if (record.signalBoundary?.boundary) rows.push(`本状态冻结边界：${money(record.signalBoundary.boundary)}${record.signalBoundary.atrAtLock ? ` · 锁定 ATR ${money(record.signalBoundary.atrAtLock)}` : ""}`);
  if (record.management?.entryReference) rows.push(`参考入场：${money(record.management.entryReference)}`);
  if (record.management?.hardStop) rows.push(`硬失效：${money(record.management.hardStop)}`);
  if (record.management?.firstZone) rows.push(`第一管理区：${money(record.management.firstZone)}`);
  if (record.management?.secondZone) rows.push(`第二管理区：${money(record.management.secondZone)}`);
  if (record.management?.trailingExit) rows.push(`10日低点：${money(record.management.trailingExit)}`);
  if (record.management?.exitMethod) rows.push(record.management.exitMethod);
  if (record.event) rows.push(`事件：${record.event.date} · ${record.event.label}${record.event.timing ? ` · ${record.event.timing}` : ""}`);
  if (record.eventRiskPolicy) rows.push(`已知事件进入 ${record.eventRiskPolicy.appliesWithinCalendarDays} 日风险窗口：跳空准备金基准放大至 ${record.eventRiskPolicy.gapReserveMultiplier}×`);
  if (record.holdingRule?.action) rows.push(`持仓侧：${record.holdingRule.action}`);
  return rows;
}

function changeMarkup(record) {
  const change = record.change;
  const comparison = change?.comparisonDate;
  const priorLabel = change?.from ? STATE_META[change.from]?.label ?? change.from : null;
  const headline = !comparison
    ? "首份审计基线，暂无昨日对照"
    : change.changed
      ? `${comparison}：${priorLabel} → ${record.label}`
      : `较 ${comparison} 状态未变化`;
  const reasons = record.stateReason?.length ? record.stateReason : [change?.reason ?? record.action];
  return `<div class="tt-explain"><div><span>较昨日变化</span><strong>${escapeHtml(headline)}</strong></div><ul>${reasons.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
}

function nextConditionMarkup(record) {
  const next = record.nextCondition;
  if (!next) return "";
  const distance = Number.isFinite(next.distanceAtr) ? ` · 约 ${number(next.distanceAtr, 2)} ATR` : "";
  return `<div class="tt-next"><span>距离下一状态 / 管理条件</span><strong>${escapeHtml(next.label ?? next.targetState)}</strong><p>${escapeHtml(next.condition)}${escapeHtml(distance)}</p></div>`;
}

function priorityMarkup(record) {
  const components = record.priorityBreakdown ?? [];
  if (!components.length) return '<div class="tt-priority-list"><span>优先级构成尚未写入该快照。</span></div>';
  return `<div class="tt-priority-list">${components.map((component) => `<div><span>${escapeHtml(component.label)}<small>${escapeHtml(component.reason)}</small></span><b class="${component.points < 0 ? "negative" : ""}">${component.points > 0 ? "+" : ""}${number(component.points, 1)}</b></div>`).join("")}</div>`;
}

function detailMarkup(record, compact = false) {
  const map = record.tailMap;
  if (!map) {
    return `<button class="tt-detail-close" type="button" aria-label="关闭标的详情">关闭</button><div class="tt-detail__title"><div><small>${escapeHtml(record.symbol)}</small><h3>${escapeHtml(record.name)}</h3><span class="tt-state tone-muted">${escapeHtml(record.label)}</span></div><div class="tt-priority"><span>有效日线</span><b>${record.bars ?? 0}</b></div></div><div class="tt-detail__verdict tone-muted">${escapeHtml(record.action)}</div><div class="tt-detail__plan"><h4>无法生成地图</h4><ul>${(record.blockers ?? []).map((item) => `<li class="tt-blocker">${escapeHtml(item)}</li>`).join("")}</ul></div>`;
  }
  const position = Math.max(0, Math.min(100, record.rangePositionPct ?? 50));
  const blockers = record.blockers?.length ? record.blockers : ["无额外阻断；仍需人工确认事件、成本与组合相关性"];
  return `<button class="tt-detail-close" type="button" aria-label="关闭标的详情">关闭</button><div class="tt-detail__title"><div><small>${escapeHtml(record.symbol)} · ${escapeHtml(record.sector)}</small><h3>${escapeHtml(record.name)}</h3><span class="tt-state ${toneFor(record)}">${escapeHtml(record.label)}</span></div><div class="tt-priority"><span>复核优先级</span><b>${record.priority}</b></div></div>
    <div class="tt-detail__verdict ${toneFor(record)}">${escapeHtml(record.action)}</div>
    ${changeMarkup(record)}
    ${nextConditionMarkup(record)}
    <div class="tt-map"><div class="tt-map__labels"><span>${money(map.rangeLow)}</span><span>中轴 ${money(map.midpoint)}</span><span>${money(map.rangeHigh)}</span></div><div class="tt-map__track"><span></span><span></span><span></span><i style="left:${position}%"></i></div></div>
    <div class="tt-detail-grid">
      <div><span>正式收盘</span><b>${money(record.close)}</b></div>
      <div><span>周线环境</span><b>${escapeHtml(weeklyLabel(record.weeklyRegime))}</b></div>
      <div><span>ATR / 价格</span><b>${number(record.atrPct)}%</b></div>
      <div><span>HV20 百分位</span><b>p${number(record.hvPercentile, 0)}</b></div>
      <div><span>量比 / 20日</span><b>${number(record.volumeRatio, 2)}×</b></div>
      <div><span>平均成交额</span><b>${money(record.averageTurnover20, 0)}</b></div>
      <div><span>ATR 尾部对照 · 仅影子</span><b>${escapeHtml(STATE_META[record.comparisonStates?.atr]?.label ?? "—")}</b></div>
      <div><span>边界记忆</span><b>${record.locked?.lockedAt ? `${escapeHtml(record.locked.lockedAt)} · ${escapeHtml(record.locked.lockedBy)}` : "无活动锁"}</b></div>
    </div>
    <div class="tt-detail__plan"><h4>预先写下的管理方式</h4><ul>${managementRows(record).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="tt-detail__plan"><h4>阻断 / 复核</h4><ul>${blockers.map((item) => `<li class="${record.blockers?.length ? "tt-blocker" : ""}">${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="tt-detail__plan"><h4>优先级构成 · 只用于复核排序</h4>${priorityMarkup(record)}</div>
    ${compact ? "" : `<div class="tt-detail__plan"><h4>地图版本</h4><ul><li>${escapeHtml(map.version)} · prior completed bars only</li><li>数据：${escapeHtml(record.dataStatus)} · ${escapeHtml(record.source)}</li></ul></div>`}`;
}

function closeDetail() {
  document.body.classList.remove("tt-detail-open");
  $("#detailBackdrop").hidden = true;
}

function selectRecord(symbol, { openDetail = false } = {}) {
  const record = state.snapshot.records.find((item) => item.symbol === symbol);
  if (!record) return;
  state.selected = record;
  $("#recordDetail").innerHTML = detailMarkup(record);
  $("#recordDetail").querySelector(".tt-detail-close")?.addEventListener("click", closeDetail);
  document.body.classList.toggle("tt-detail-open", openDetail);
  $("#detailBackdrop").hidden = !openDetail;
  populateRisk(record);
  renderRows();
}

function chosenModule(record) {
  if (record.candidateModule) return record.candidateModule;
  if (record.riskModule) return record.riskModule;
  if (record.state === "EVENT_QUARANTINE") return "event";
  if (["BREAKOUT_CANDIDATE", "TREND_ACCEPTED", "BREAKOUT_FAILED"].includes(record.state)) return "pure_trend";
  if (["UPPER_TAIL_REJECTED", "LOWER_TAIL_BREAKDOWN"].includes(record.state)) return "us_short";
  return "tail_core";
}

function populateRisk(record) {
  $("#riskModule").value = chosenModule(record);
  $("#riskEntry").value = Number.isFinite(record.management?.entryReference) ? record.management.entryReference : "";
  $("#riskStop").value = Number.isFinite(record.management?.hardStop) ? record.management.hardStop : "";
  const eventMultiplier = record.eventRiskPolicy?.gapReserveMultiplier ?? 1;
  $("#riskGap").value = Number.isFinite(record.atr) ? Math.max(0, record.atr * 0.25 * eventMultiplier).toFixed(2) : 0;
  calculateAndRenderRisk();
}

function formNumber(selector) {
  const raw = $(selector).value;
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const RISK_CONFIG_FIELDS = [
  "riskEquity",
  "riskSlippage",
  "riskDrawdown",
  "riskHeat",
  "riskCluster",
  "riskStops",
  "riskDailyLoss",
];

function exportRiskConfig() {
  const config = {
    schema: "traderhome_tailtrend_local_risk_config_v1",
    exportedAt: new Date().toISOString(),
    values: Object.fromEntries(RISK_CONFIG_FIELDS.map((id) => [id, $("#" + id).value])),
  };
  const blob = new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "tailtrend-risk-config.json";
  anchor.click();
  URL.revokeObjectURL(url);
  $("#riskConfigStatus").textContent = "配置已导出到本地文件；未写入浏览器存储。";
}

async function importRiskConfig(file) {
  if (!file) return;
  const status = $("#riskConfigStatus");
  try {
    if (file.size > 100 * 1024) throw new Error("配置文件超过 100 KB 上限");
    const config = JSON.parse(await file.text());
    if (config?.schema !== "traderhome_tailtrend_local_risk_config_v1") throw new Error("配置 schema 不匹配");
    for (const id of RISK_CONFIG_FIELDS) {
      const raw = config.values?.[id];
      if (raw === undefined) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new Error(`${id} 不是有效非负数`);
      $("#" + id).value = String(value);
    }
    status.textContent = "本地配置已导入；标的入场、止损与事件准备金仍由当前状态重新带入。";
    calculateAndRenderRisk();
  } catch (error) {
    status.textContent = `配置导入失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    $("#riskConfigFile").value = "";
  }
}

function calculateAndRenderRisk() {
  const record = state.selected;
  const plan = calculateRiskPlan({
    module: $("#riskModule").value,
    equity: formNumber("#riskEquity"),
    entry: formNumber("#riskEntry"),
    stop: formNumber("#riskStop"),
    gapReserve: formNumber("#riskGap"),
    slippageReserve: formNumber("#riskSlippage"),
    drawdownPct: formNumber("#riskDrawdown"),
    hvPercentile: record?.hvPercentile,
    weeklyRegime: record?.weeklyRegime ?? "RANGE",
    existingPortfolioHeatPct: formNumber("#riskHeat"),
    clusterHeatPct: formNumber("#riskCluster"),
    fullStopsToday: formNumber("#riskStops"),
    dailyRealizedLossPct: formNumber("#riskDailyLoss"),
    averageTurnover20: record?.averageTurnover20,
    signalGate: record ? {
      expectedModule: chosenModule(record),
      newPositionAllowed: record.newPositionAllowed,
      state: record.state,
      stateLabel: record.label,
      dataStatus: record.dataStatus,
      eventClear: record.state !== "EVENT_QUARANTINE",
      shortQualified: record.shortQualified,
      blockers: record.blockers,
    } : null,
  });
  const notes = [
    ...plan.blockers.map((item) => ({ text: item, block: true })),
    ...plan.warnings.map((item) => ({ text: item, block: false })),
  ];
  $("#riskOutput").innerHTML = `<div class="tt-risk-verdict"><div><span>${escapeHtml(record?.symbol ?? "未选择标的")} · ${escapeHtml(plan.moduleLabel)}</span><h3>${plan.allowed ? "状态闸门通过 · 待人工复核" : "当前禁止新仓"}</h3><small class="tt-cell-sub">该股数只是压力上限；事件、组合相关性、可成交性与实际账户仍需人工确认</small></div><div><b>${plan.shares}</b><span>股</span></div></div>
    <div class="tt-risk-metrics">
      <div><span>${plan.allowed ? "本袖套计划亏损" : "闸门通过后的风险预算"}</span><strong>${money(plan.plannedLoss)}</strong></div>
      <div><span>每股压力损失</span><strong>${money(plan.stressPerShare)}</strong></div>
      <div><span>本袖套账户风险</span><strong>${number(plan.tradeRiskPct, 3)}%</strong></div>
      <div><span>同想法趋势预留</span><strong>${number(plan.reservedRiskPct, 3)}%</strong></div>
      <div><span>估算仓位市值</span><strong>${money(plan.positionValue)}</strong></div>
      <div><span>压力组 · 取最严值</span><strong>min(${number(plan.multipliers.drawdown, 2)}, ${number(plan.multipliers.volatility, 2)}, ${number(plan.multipliers.weekly, 2)}) = ${number(plan.multipliers.pressureGroup, 2)}</strong></div>
      <div><span>最终约束</span><strong>${escapeHtml(bindingLabel(plan.bindingConstraint))}</strong></div>
    </div>
    <div class="tt-risk-notes">${notes.length ? notes.map((item) => `<div class="tt-risk-note ${item.block ? "block" : ""}">${escapeHtml(item.text)}</div>`).join("") : '<div class="tt-risk-note">未触发账户级阻断；这不代表策略已有正期望。</div>'}</div>`;
}

function renderAudit() {
  const ledger = state.audit ?? { entries: [], daysCollected: 0 };
  const entries = (ledger.entries ?? []).filter((entry) => !ledger.activeEpochId || entry.epochId === ledger.activeEpochId);
  const days = ledger.daysCollected ?? new Set(entries.map((entry) => entry.originDate)).size;
  const trackedSignals = entries.filter((entry) => entry.direction !== "OBSERVE").length;
  const nextReferences = entries.filter((entry) => Number.isFinite(entry.execution?.nextTradableReference)).length;
  const completedFive = entries.filter((entry) => entry.forward?.horizons?.["5"]).length;
  const skippedLargeMoves = entries.filter((entry) => entry.direction === "OBSERVE"
    && Math.max(Math.abs(entry.forward?.running?.maxUpPct ?? 0), Math.abs(entry.forward?.running?.maxDownPct ?? 0)) >= 5).length;
  $("#auditProgress").textContent = `${Math.min(days, 10)}/10 个交易日`;
  $("#auditSummary").innerHTML = [
    ["真实交易日", days, "目标先积累 5–10 日"],
    ["方向性观察", trackedSignals, "含被硬闸门阻断的影子候选"],
    ["次日参考", nextReferences, "用于计算提醒到下一可交易日偏差"],
    ["5日结果", completedFive, "派生 MFE / MAE 已完成"],
    ["主动放弃后大幅运行", skippedLargeMoves, "中部/观察状态后绝对波动 ≥5%"],
  ].map(([label, value, note]) => `<article><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(note)}</small></article>`).join("");

  const daysHistory = state.history?.records ?? [];
  $("#auditChanges").innerHTML = daysHistory.slice(0, 5).map((run) => {
    const transitions = run.transitions ?? [];
    const body = transitions.length
      ? `<ul>${transitions.map((item) => `<li><b>${escapeHtml(item.symbol)}</b> ${escapeHtml(STATE_META[item.from]?.label ?? item.from)} → ${escapeHtml(STATE_META[item.to]?.label ?? item.to)}<small>${escapeHtml(item.reason ?? "等待原因记录")}</small></li>`).join("")}</ul>`
      : '<p>这是首份审计基线，或相对上一交易日没有状态变化；不补造历史转换。</p>';
    return `<article><div><span>${escapeHtml(run.tradingDate)}</span><b>${transitions.length} 个状态变化</b></div>${body}</article>`;
  }).join("") || '<div class="tt-empty">尚无真实日更记录。</div>';
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return [];
  const headers = rows[0].split(",").map((item) => item.trim().toLowerCase());
  return rows.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim()]));
  });
}

async function handleImport(file) {
  const status = $("#importStatus");
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("文件超过 5 MB 上限");
    const text = await file.text();
    const rows = file.name.toLowerCase().endsWith(".csv") ? parseCsv(text) : JSON.parse(text);
    const symbol = $("#importSymbol").value.trim().toUpperCase() || "CUSTOM.US";
    const sourceRows = Array.isArray(rows) ? rows : rows?.data ?? rows?.bars ?? [];
    const normalized = normalizeBars(sourceRows);
    if (normalized.length < 90) throw new Error(`只有 ${normalized.length} 根有效日线；本地研究槽至少需要 90 根`);
    const turnoverAvailable = normalized.slice(-20).some((row) => Number.isFinite(row.turnover) && row.turnover > 0);
    const result = analyzeBars(normalized, {
      symbol,
      name: `${symbol} 本地导入`,
      dataStatus: "LOCAL",
    });
    status.textContent = `已在浏览器内存读取 ${result.bars ?? 0} 根有效日线；文件未上传。${turnoverAvailable ? "" : " 缺 turnover：流动性闸门已停用，仓位结果会显示警告。"}`;
    $("#importResult").innerHTML = detailMarkup(result, true);
  } catch (error) {
    status.textContent = `无法解析文件：${error instanceof Error ? error.message : String(error)}`;
    $("#importResult").innerHTML = '<div class="tt-empty">请确认 JSON 是 K 线数组，或 CSV 含标准 OHLC 字段。</div>';
  }
}

async function load() {
  try {
    const [snapshotResponse, indexResponse, auditResponse] = await Promise.all([
      fetch("/tailtrend/data/latest.json", { cache: "no-store", credentials: "omit" }),
      fetch("/tailtrend/data/index.json", { cache: "no-store", credentials: "omit" }),
      fetch("/tailtrend/data/tailtrend-audit.json", { cache: "no-store", credentials: "omit" }),
    ]);
    if (!snapshotResponse.ok) throw new Error(`snapshot HTTP ${snapshotResponse.status}`);
    state.snapshot = await snapshotResponse.json();
    state.index = indexResponse.ok ? await indexResponse.json() : { entries: [] };
    state.history = { records: (state.index.entries ?? []).map((entry) => ({
      asOf: entry.runAt,
      tradingDate: entry.dataAsOf,
      mode: entry.status?.toLowerCase(),
      summary: entry.summary,
      dataQuality: entry.health,
      transitions: entry.transitions ?? [],
    })) };
    state.audit = auditResponse.ok ? await auditResponse.json() : { entries: [], daysCollected: 0 };
    if (state.snapshot.schema !== "traderhome_tailtrend_snapshot_v1") throw new Error("unknown TailTrend snapshot schema");
    renderHeader();
    renderFilters();
    renderRows();
    renderAudit();
    const eligible = state.snapshot.records.filter((record) => record.newPositionAllowed === true && record.dataStatus === "FRESH");
    const reviewable = state.snapshot.records.filter((record) => record.bucket !== "NO_TRADE_MIDDLE" && record.dataStatus === "FRESH");
    const preferred = [...eligible].sort((left, right) => right.priority - left.priority)[0]
      ?? [...reviewable].sort((left, right) => right.priority - left.priority)[0]
      ?? state.snapshot.records[0];
    if (preferred) selectRecord(preferred.symbol, { openDetail: false });
  } catch (error) {
    $("#scannerError").hidden = false;
    $("#scannerError").textContent = `无法读取 TailTrend 快照：${error instanceof Error ? error.message : String(error)}`;
    $("#scannerRows").innerHTML = '<tr><td colspan="6" class="tt-empty">快照不可用，不显示旧信号。</td></tr>';
  }
}

$("#symbolSearch").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderRows();
});
$("#riskForm").addEventListener("submit", (event) => {
  event.preventDefault();
  calculateAndRenderRisk();
});
$("#riskForm").addEventListener("input", () => calculateAndRenderRisk());
$("#exportRiskConfig").addEventListener("click", exportRiskConfig);
$("#riskConfigFile").addEventListener("change", (event) => importRiskConfig(event.target.files?.[0]));
$("#barFile").addEventListener("change", (event) => handleImport(event.target.files?.[0]));
$("#detailBackdrop").addEventListener("click", closeDetail);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDetail();
});

load();
