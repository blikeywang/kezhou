import {
  contributionPlan,
  formatMoney,
  growthCycleScore,
} from "./incomeos-engine.mjs";

const STORAGE_KEY = "traderhome-incomeos-plan-v1";
const FONT_KEY = "traderhome-incomeos-font-scale";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const percent = (value, digits = 0) => `${Number(value).toFixed(digits)}%`;
const signed = (value, digits = 1) => `${value >= 0 ? "+" : ""}${Number(value).toFixed(digits)}%`;

function safeLoadPlan() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function setFontScale(value) {
  const allowed = [90, 100, 115, 130];
  const scale = allowed.includes(Number(value)) ? Number(value) : 100;
  document.documentElement.style.setProperty("--income-font-scale", `${scale / 100}`);
  localStorage.setItem(FONT_KEY, String(scale));
  $$("[data-font-scale]").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.fontScale) === scale));
  });
}

function statusFor(snapshot) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const clock = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(clock.hour) * 60 + Number(clock.minute);
  const ageHours = Math.max(0, (now.getTime() - new Date(snapshot.asOf).getTime()) / 3_600_000);
  if (ageHours > 72) return { level: "stale", label: "STALE · 只读旧快照", detail: "超过 72 小时，不按本页合约下单。" };
  if (clock.weekday === "Fri" && minutes >= 600 && minutes < 960 && ageHours <= 24) {
    return { level: "review", label: "FRIDAY REVIEW", detail: "处于周五窗口；仍需在 IBKR 复核 bid/ask、现金与持仓。" };
  }
  return { level: "preview", label: "PREVIEW · 周五预案", detail: "到周五美东 10:00 重新核对，再执行。" };
}

function renderOrders(plan) {
  const rows = [
    { symbol: "SPY", name: "宽基核心", amount: plan.amounts.core, note: "IBKR 按美元买入 / Recurring Investment" },
    { symbol: "SCHD", name: "股息质量", amount: plan.amounts.dividend, note: "按美元买入；不为更高股息牺牲成长" },
    { symbol: "JPM", name: "成长收益卫星", amount: plan.amounts.growth, note: "仅碎股 DCA；账户内同类单股总额上限 12%" },
    { symbol: "SGOV / CASH", name: "现金与 put 准备金", amount: plan.amounts.option + plan.amounts.reserve, note: "停泊等待；不是本周必须卖 put 的额度" },
  ].filter((row) => row.amount >= 0.5);
  $("#orderCount").textContent = String(rows.length);
  $("#orders").innerHTML = rows.map((row) => `
    <article class="io-order">
      <div><span>${row.name}</span><strong>${row.symbol}</strong><small>${row.note}</small></div>
      <b>${formatMoney(row.amount)}</b>
    </article>`).join("");
  $("#growthCapNote").hidden = plan.amounts.growth > 0;
}

function renderAllocation(plan) {
  const parts = [
    ["core", "SPY 核心", "cyan"],
    ["dividend", "SCHD 股息", "blue"],
    ["growth", "成长收益", "violet"],
    ["option", "Put 准备", "amber"],
    ["reserve", "现金缓冲", "slate"],
  ];
  $("#allocationBar").innerHTML = parts.map(([key, label, color]) => `
    <span class="${color}" style="width:${plan.split[key] * 100}%" title="${label} ${percent(plan.split[key] * 100, 1)}"></span>`).join("");
  $("#allocationLegend").innerHTML = parts.map(([key, label, color]) => `
    <div><i class="${color}"></i><span>${label}</span><b>${percent(plan.split[key] * 100, 1)}</b></div>`).join("");
  $("#stageLabel").textContent = plan.stage.label;
  $("#stageDetail").textContent = plan.stage.detail;
  $("#postDepositValue").textContent = formatMoney(plan.postDepositValue);
  $("#projectedPutReserve").textContent = formatMoney(plan.projectedOptionReserve);
}

function renderPutDecision(plan) {
  const first = plan.puts[0];
  const executable = plan.executablePut;
  $("#optionOrders").textContent = executable ? "1" : "0";
  $("#putHeadline").textContent = executable
    ? `${executable.contract} 通过静态闸门；仍需 IBKR 盘口确认`
    : "本周不直接卖 put：资金、估值或可成交盘口至少一项未过线";
  $("#putExplanation").textContent = executable
    ? `现金担保 ${formatMoney(executable.cashRequired)}，被指派后仍在集中度上限内。使用限价单，不追最后成交价。`
    : `以 JPM 为例，340P 需要 ${formatMoney(first.cashRequired)} 现金；要把单股指派风险控制在 12%，账户至少需要约 ${formatMoney(first.cashRequired / first.maxConcentration)}。当前估值也未过闸。`;
  $("#putRows").innerHTML = plan.puts.map((candidate) => {
    const evaluation = candidate.evaluation;
    const state = evaluation.eligible ? "PASS" : "WAIT";
    const reasons = evaluation.reasons.slice(0, 3).join("；");
    return `<tr>
      <td><strong>${candidate.symbol}</strong><small>${candidate.contract}</small></td>
      <td>${candidate.delta.toFixed(3)}</td>
      <td>${formatMoney(candidate.cashRequired)}</td>
      <td>${percent(candidate.simpleAnnualYield, 1)}</td>
      <td>${percent(candidate.breakevenDiscount, 1)}</td>
      <td>${candidate.ivHv.toFixed(2)}×</td>
      <td>${candidate.oi.toLocaleString("en-US")}</td>
      <td><span class="io-state ${state.toLowerCase()}">${state}</span><small>${reasons || "静态闸门通过"}</small></td>
    </tr>`;
  }).join("");
}

function renderGrowthTest(snapshot) {
  $("#growthRows").innerHTML = snapshot.benchmarks.map((asset) => `
    <tr class="${asset.symbol === "JPM" ? "focus" : ""}">
      <td><strong>${asset.symbol}</strong><small>${asset.role}</small></td>
      <td>${percent(asset.cagr10y, 1)}</td>
      <td>${percent(asset.cagr5y, 1)}</td>
      <td>${percent(asset.cycle2020_2022, 1)}</td>
      <td>${percent(asset.cycle2023_now, 1)}</td>
      <td>${signed(asset.maxDrawdown, 1)}</td>
      <td>${percent(asset.dividendYield, 2)}</td>
    </tr>`).join("");

  const scored = snapshot.banks.map((asset) => ({ ...asset, scores: growthCycleScore(asset) }))
    .sort((left, right) => right.scores.total - left.scores.total);
  $("#scoreCards").innerHTML = scored.map((asset) => `
    <article class="io-score-card ${asset.symbol === "JPM" ? "focus" : ""}">
      <div><span>${asset.symbol}</span><b>${asset.scores.total}</b></div>
      <p>${asset.decisionLabel}</p>
      <dl>
        <div><dt>复利</dt><dd>${asset.scores.history}</dd></div>
        <div><dt>预期</dt><dd>${asset.scores.expectations}</dd></div>
        <div><dt>质量</dt><dd>${asset.scores.quality}</dd></div>
        <div><dt>估值</dt><dd>${asset.scores.valuation}</dd></div>
        <div><dt>风险</dt><dd>${asset.scores.risk}</dd></div>
      </dl>
    </article>`).join("");
}

function renderEvidence(snapshot) {
  const evidence = snapshot.jpmEvidence;
  $("#jpmEvidence").innerHTML = [
    ["2026 H1 收入", signed(evidence.revenueYoy)],
    ["2026 H1 EPS", signed(evidence.epsYoy)],
    ["ROE", percent(evidence.roe, 2)],
    ["EPS 预期修正", signed(evidence.epsConsensusRevisionYtd)],
    ["近 8 季 EPS 超预期", percent(evidence.lastEightQuarterEpsBeatRate)],
    ["2016–2025 股息 CAGR", percent(evidence.dividendCagr2016_2025)],
  ].map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join("");
  $("#snapshotDate").textContent = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/New_York", dateStyle: "long", timeStyle: "short",
  }).format(new Date(snapshot.asOf));
  $("#dataMethod").textContent = `${snapshot.method.returnLabel}；${snapshot.method.returnWarning}`;
}

function readInputs() {
  return {
    weeklyContribution: Number($("#weeklyContribution").value),
    accountValue: Number($("#accountValue").value),
    optionReserve: Number($("#optionReserve").value),
    currentGrowthValue: Number($("#currentGrowthValue").value),
  };
}

function renderPlan(snapshot) {
  const input = readInputs();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
  const plan = contributionPlan(input, snapshot);
  renderAllocation(plan);
  renderOrders(plan);
  renderPutDecision(plan);
  $("#weeklyAmountHero").textContent = formatMoney(plan.weeklyContribution);
}

async function start() {
  const response = await fetch("./data/research-snapshot.json", { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`snapshot ${response.status}`);
  const snapshot = await response.json();
  const saved = safeLoadPlan();
  for (const [id, fallback] of [
    ["weeklyContribution", 1000],
    ["accountValue", 0],
    ["optionReserve", 0],
    ["currentGrowthValue", 0],
  ]) {
    $("#" + id).value = Number.isFinite(Number(saved[id])) ? Number(saved[id]) : fallback;
  }
  setFontScale(Number(localStorage.getItem(FONT_KEY) || 100));
  $$("[data-font-scale]").forEach((button) => button.addEventListener("click", () => setFontScale(button.dataset.fontScale)));
  $$(".io-input input").forEach((input) => input.addEventListener("input", () => renderPlan(snapshot)));
  const status = statusFor(snapshot);
  $("#snapshotStatus").className = `io-status ${status.level}`;
  $("#snapshotStatus").innerHTML = `<b>${status.label}</b><span>${status.detail}</span>`;
  renderGrowthTest(snapshot);
  renderEvidence(snapshot);
  renderPlan(snapshot);
  document.documentElement.dataset.incomeosReady = "true";
}

start().catch((error) => {
  $("#appError").hidden = false;
  $("#appError").textContent = `IncomeOS 数据加载失败：${error.message}。请不要依据旧页面下单。`;
});
