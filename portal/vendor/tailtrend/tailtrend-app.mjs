import {
  BUCKET_META,
  STATE_META,
  analyzeBars,
  calculateRiskPlan,
} from "/tailtrend/tailtrend-engine.mjs";

const $ = (selector) => document.querySelector(selector);
const state = {
  snapshot: null,
  history: null,
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

function dataClass(value) {
  return value === "FRESH" ? "" : value === "CACHED" ? "cached" : "stale";
}

function renderHeader() {
  const snapshot = state.snapshot;
  const quality = snapshot.dataQuality;
  $("#snapshotMode").textContent = snapshot.mode === "complete" ? "完整日线快照" : "部分数据降级";
  $("#snapshotDate").textContent = `截至 ${snapshot.tradingDate}`;
  $("#metricUniverse").textContent = snapshot.universe.published;
  const edgeBuckets = ["TAIL_RECLAIM_WATCH", "TREND_ACCEPTANCE_WATCH", "BREAKOUT_FAILURE_WATCH", "BREAKDOWN_RISK", "EVENT_QUARANTINE"];
  $("#metricEdges").textContent = snapshot.records.filter((row) => edgeBuckets.includes(row.bucket)).length;
  $("#metricMiddle").textContent = snapshot.summary.bucketCounts.NO_TRADE_MIDDLE ?? 0;
  $("#metricFresh").textContent = `${quality.fresh}/${snapshot.universe.requested}`;
  $("#metricQuality").textContent = quality.errors.length ? `${quality.errors.length} 项失败，已禁止缓存触发新仓` : "全部 Fresh · 无缺失";
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
      <td><div class="tt-symbol"><strong>${escapeHtml(record.ticker)}</strong><small>${escapeHtml(record.name)}</small></div></td>
      <td><span class="tt-state ${toneFor(record)}">${escapeHtml(record.label)}</span><small class="tt-cell-sub">复核优先级 ${record.priority}</small></td>
      <td><div class="tt-position"><div class="tt-position__bar"><i style="left:${position}%"></i></div><small class="tt-cell-sub">60日区间 ${number(record.rangePositionPct, 0)}%</small></div></td>
      <td><b>${escapeHtml(weeklyLabel(record.weeklyRegime))}</b><small class="tt-cell-sub">ATR ${number(record.atrPct)}% · HV p${number(record.hvPercentile, 0)}</small></td>
      <td class="tt-action">${escapeHtml(record.action)}${record.blockers?.length ? `<small class="tt-cell-sub">${escapeHtml(record.blockers[0])}</small>` : ""}</td>
      <td><span class="tt-fresh ${dataClass(record.dataStatus)}">${escapeHtml(record.dataStatus)}</span><small class="tt-cell-sub">${escapeHtml(record.tradingDate)}</small></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("tr[data-symbol]").forEach((row) => row.addEventListener("click", () => selectRecord(row.dataset.symbol)));
}

function managementRows(record) {
  const rows = [];
  if (record.management?.entryReference) rows.push(`参考入场：${money(record.management.entryReference)}`);
  if (record.management?.hardStop) rows.push(`硬失效：${money(record.management.hardStop)}`);
  if (record.management?.firstZone) rows.push(`第一管理区：${money(record.management.firstZone)}`);
  if (record.management?.secondZone) rows.push(`第二管理区：${money(record.management.secondZone)}`);
  if (record.management?.trailingExit) rows.push(`10日低点：${money(record.management.trailingExit)}`);
  if (record.management?.exitMethod) rows.push(record.management.exitMethod);
  if (record.event) rows.push(`事件：${record.event.date} · ${record.event.label}${record.event.timing ? ` · ${record.event.timing}` : ""}`);
  return rows;
}

function detailMarkup(record, compact = false) {
  const map = record.tailMap;
  if (!map) {
    return `<div class="tt-detail__title"><div><small>${escapeHtml(record.symbol)}</small><h3>${escapeHtml(record.name)}</h3><span class="tt-state tone-muted">${escapeHtml(record.label)}</span></div><div class="tt-priority"><span>有效日线</span><b>${record.bars ?? 0}</b></div></div><div class="tt-detail__verdict tone-muted">${escapeHtml(record.action)}</div><div class="tt-detail__plan"><h4>无法生成地图</h4><ul>${(record.blockers ?? []).map((item) => `<li class="tt-blocker">${escapeHtml(item)}</li>`).join("")}</ul></div>`;
  }
  const position = Math.max(0, Math.min(100, record.rangePositionPct ?? 50));
  const blockers = record.blockers?.length ? record.blockers : ["无额外阻断；仍需人工确认事件、成本与组合相关性"];
  return `<div class="tt-detail__title"><div><small>${escapeHtml(record.symbol)} · ${escapeHtml(record.sector)}</small><h3>${escapeHtml(record.name)}</h3><span class="tt-state ${toneFor(record)}">${escapeHtml(record.label)}</span></div><div class="tt-priority"><span>复核优先级</span><b>${record.priority}</b></div></div>
    <div class="tt-detail__verdict ${toneFor(record)}">${escapeHtml(record.action)}</div>
    <div class="tt-map"><div class="tt-map__labels"><span>${money(map.rangeLow)}</span><span>中轴 ${money(map.midpoint)}</span><span>${money(map.rangeHigh)}</span></div><div class="tt-map__track"><span></span><span></span><span></span><i style="left:${position}%"></i></div></div>
    <div class="tt-detail-grid">
      <div><span>正式收盘</span><b>${money(record.close)}</b></div>
      <div><span>周线环境</span><b>${escapeHtml(weeklyLabel(record.weeklyRegime))}</b></div>
      <div><span>ATR / 价格</span><b>${number(record.atrPct)}%</b></div>
      <div><span>HV20 百分位</span><b>p${number(record.hvPercentile, 0)}</b></div>
      <div><span>量比 / 20日</span><b>${number(record.volumeRatio, 2)}×</b></div>
      <div><span>平均成交额</span><b>${money(record.averageTurnover20, 0)}</b></div>
    </div>
    <div class="tt-detail__plan"><h4>预先写下的管理方式</h4><ul>${managementRows(record).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="tt-detail__plan"><h4>阻断 / 复核</h4><ul>${blockers.map((item) => `<li class="${record.blockers?.length ? "tt-blocker" : ""}">${escapeHtml(item)}</li>`).join("")}</ul></div>
    ${compact ? "" : `<div class="tt-detail__plan"><h4>地图版本</h4><ul><li>${escapeHtml(map.version)} · prior completed bars only</li><li>数据：${escapeHtml(record.dataStatus)} · ${escapeHtml(record.source)}</li></ul></div>`}`;
}

function selectRecord(symbol) {
  const record = state.snapshot.records.find((item) => item.symbol === symbol);
  if (!record) return;
  state.selected = record;
  $("#recordDetail").innerHTML = detailMarkup(record);
  populateRisk(record);
  renderRows();
}

function chosenModule(record) {
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
  $("#riskGap").value = Number.isFinite(record.atr) ? Math.max(0, record.atr * 0.25).toFixed(2) : 0;
  calculateAndRenderRisk();
}

function formNumber(selector) {
  const raw = $(selector).value;
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
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
  });
  const notes = [
    ...plan.blockers.map((item) => ({ text: item, block: true })),
    ...plan.warnings.map((item) => ({ text: item, block: false })),
  ];
  $("#riskOutput").innerHTML = `<div class="tt-risk-verdict"><div><span>${escapeHtml(record?.symbol ?? "未选择标的")} · ${escapeHtml(plan.moduleLabel)}</span><h3>${plan.allowed ? "压力预算允许" : "当前禁止新仓"}</h3><small class="tt-cell-sub">最终结果以全部组合、事件与执行闸门为准</small></div><div><b>${plan.shares}</b><span>股</span></div></div>
    <div class="tt-risk-metrics">
      <div><span>${plan.allowed ? "本袖套计划亏损" : "闸门通过后的风险预算"}</span><strong>${money(plan.plannedLoss)}</strong></div>
      <div><span>每股压力损失</span><strong>${money(plan.stressPerShare)}</strong></div>
      <div><span>本袖套账户风险</span><strong>${number(plan.tradeRiskPct, 3)}%</strong></div>
      <div><span>同想法趋势预留</span><strong>${number(plan.reservedRiskPct, 3)}%</strong></div>
      <div><span>估算仓位市值</span><strong>${money(plan.positionValue)}</strong></div>
      <div><span>风险乘数</span><strong>${number(plan.multipliers.drawdown, 2)} × ${number(plan.multipliers.volatility, 2)} × ${number(plan.multipliers.weekly, 2)}</strong></div>
    </div>
    <div class="tt-risk-notes">${notes.length ? notes.map((item) => `<div class="tt-risk-note ${item.block ? "block" : ""}">${escapeHtml(item.text)}</div>`).join("") : '<div class="tt-risk-note">未触发账户级阻断；这不代表策略已有正期望。</div>'}</div>`;
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
    const text = await file.text();
    const rows = file.name.toLowerCase().endsWith(".csv") ? parseCsv(text) : JSON.parse(text);
    const symbol = $("#importSymbol").value.trim().toUpperCase() || "CUSTOM.US";
    const result = analyzeBars(Array.isArray(rows) ? rows : rows?.data ?? rows?.bars ?? [], {
      symbol,
      name: `${symbol} 本地导入`,
      dataStatus: "LOCAL",
    });
    status.textContent = `已在浏览器内存读取 ${result.bars ?? 0} 根有效日线；文件未上传。`;
    $("#importResult").innerHTML = detailMarkup(result, true);
  } catch (error) {
    status.textContent = `无法解析文件：${error instanceof Error ? error.message : String(error)}`;
    $("#importResult").innerHTML = '<div class="tt-empty">请确认 JSON 是 K 线数组，或 CSV 含标准 OHLC 字段。</div>';
  }
}

async function load() {
  try {
    const [snapshotResponse, historyResponse] = await Promise.all([
      fetch("/tailtrend/data/tailtrend-snapshot.json", { cache: "no-store", credentials: "omit" }),
      fetch("/tailtrend/data/run-history.json", { cache: "no-store", credentials: "omit" }),
    ]);
    if (!snapshotResponse.ok) throw new Error(`snapshot HTTP ${snapshotResponse.status}`);
    state.snapshot = await snapshotResponse.json();
    state.history = historyResponse.ok ? await historyResponse.json() : { records: [] };
    if (state.snapshot.schema !== "traderhome_tailtrend_snapshot_v1") throw new Error("unknown TailTrend snapshot schema");
    renderHeader();
    renderFilters();
    renderRows();
    const preferred = state.snapshot.records.find((record) => record.symbol === "SPXC.US")
      ?? state.snapshot.records.find((record) => record.newPositionAllowed)
      ?? state.snapshot.records[0];
    if (preferred) selectRecord(preferred.symbol);
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
$("#barFile").addEventListener("change", (event) => handleImport(event.target.files?.[0]));

load();
