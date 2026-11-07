(function () {
  "use strict";
  if (document.querySelector(".th-shell")) return;

  var path = window.location.pathname;
  var section = path.indexOf("/history/") === 0 ? "history"
    : path.indexOf("/review/") === 0 ? "review"
    : path.indexOf("/incomeos/") === 0 ? "incomeos"
    : path.indexOf("/tailtrend/") === 0 ? "tailtrend"
    : path.indexOf("/daily-trade/") === 0 ? "dailyTrade"
    : path.indexOf("/market-simulation/") === 0 ? "marketSimulation"
    : path.indexOf("/otc/") === 0 ? "otc"
    : "home";
  document.documentElement.setAttribute("data-th-stage", section);

  // [key, route, label] — order is the navigation order.
  var links = [
    ["home", "/", "首页"],
    ["history", "/history/", "历史证据"],
    ["review", "/review/", "交易复盘"],
    ["incomeos", "/incomeos/", "IncomeOS"],
    ["tailtrend", "/tailtrend/", "TailTrend"],
    ["otc", "/otc/", "场外日线"],
    ["marketSimulation", "/market-simulation/", "模拟盘"],
    ["dailyTrade", "/daily-trade/", "早晚报"],
  ];
  var groups = [
    { label: "", keys: ["home"] },
    { label: "核心工作流", keys: ["history", "review"] },
    { label: "独立研究系统", keys: ["incomeos", "tailtrend", "otc", "marketSimulation", "dailyTrade"] },
  ];
  var blurbs = {
    home: "今日状态与全部系统入口",
    history: "历史相似形态的概率证据",
    review: "交易后复盘与改进处方",
    incomeos: "每周入金配比与期权闸门",
    tailtrend: "日线边缘与趋势状态机",
    otc: "场外指数与周期节点",
    marketSimulation: "公开模拟盘与小时复核",
    dailyTrade: "已校验的早报与晚报",
  };
  var stages = {
    history: {
      step: "01", label: "研究", title: "先建立一个可证伪的交易假设",
      output: "共识概率 · Edge · 区间 · 稳健性", boundary: "不输出确定走势或买卖指令",
      next: "/review/", nextText: "下一步：交易后验证"
    },
    review: {
      step: "02", label: "复盘", title: "找到最贵的重复错误，并验证它是否真的改变",
      output: "成本行为 · 证据单 · 唯一处方 · 成长证明", boundary: "不把相关亏损写成可挽回收益",
      next: "/history/", nextText: "下一步：开始下一轮研究"
    }
  };

  /* ---------- Freshness helper (shared with the home board) ---------- */
  var HOUR = 3600 * 1000;
  function ago(ms) {
    if (!isFinite(ms)) return "时间未知";
    if (ms < 0) ms = 0;
    var m = Math.round(ms / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return m + " 分钟前";
    var h = Math.round(ms / HOUR);
    if (h < 48) return h + " 小时前";
    var d = Math.round(ms / (24 * HOUR));
    if (d < 60) return d + " 天前";
    return Math.round(d / 30) + " 个月前";
  }
  function freshness(asOf, policy, now) {
    var t = typeof asOf === "number" ? asOf : Date.parse(asOf || "");
    now = now || Date.now();
    if (!isFinite(t)) return { state: "unknown", label: "未知", ago: "时间未知", ageMs: NaN };
    var age = now - t;
    var p = policy || {};
    var freshMs = (p.freshHours || 36) * HOUR;
    var lateMs = (p.lateHours || 96) * HOUR;
    var state = age <= freshMs ? "fresh" : age <= lateMs ? "late" : "stale";
    var label = state === "fresh" ? "已更新" : state === "late" ? "更新延迟" : "已过期";
    return { state: state, label: label, ago: ago(age), ageMs: age };
  }
  function shortDate(t) {
    var d = new Date(t);
    if (!isFinite(d.getTime())) return "—";
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  var statusPromise = null;
  function loadStatus() {
    if (statusPromise) return statusPromise;
    statusPromise = fetch("/assets/traderhome-status.json", { cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : { modules: [] }; })
      .catch(function () { return { modules: [] }; })
      .then(function (status) {
        var market = (status.modules || []).filter(function (m) { return m.key === "marketSimulation"; })[0];
        if (!market) return status;
        // Paper data is exported after the site build, so read its own stamp.
        return fetch("/market-simulation/data/status.json", { cache: "no-store", credentials: "omit" })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (live) { if (live && live.publishedAt) market.asOf = live.publishedAt; return status; })
          .catch(function () { return status; });
      })
      .then(function (status) {
        (status.modules || []).forEach(function (m) {
          m.freshness = m.asOf ? freshness(m.asOf, m.policy) : { state: "unknown", label: m.localOnly ? "本地运行" : "未知", ago: "", ageMs: NaN };
        });
        return status;
      });
    return statusPromise;
  }
  window.TraderHome = window.TraderHome || {};
  window.TraderHome.ago = ago;
  window.TraderHome.freshness = freshness;
  window.TraderHome.loadStatus = loadStatus;
  window.TraderHome.shortDate = shortDate;

  /* ---------- Header ---------- */
  function label(key) {
    for (var i = 0; i < links.length; i++) if (links[i][0] === key) return links[i];
    return null;
  }
  function navLink(key, withBlurb) {
    var item = label(key);
    return '<a href="' + item[1] + '" data-key="' + key + '"' + (key === section ? ' aria-current="page"' : "") + ">"
      + '<span class="th-shell__label">' + item[2] + "</span>"
      + (withBlurb ? '<small>' + blurbs[key] + "</small>" : "")
      + '<i class="th-shell__dot" aria-hidden="true"></i></a>';
  }

  var header = document.createElement("header");
  header.className = "th-shell";
  header.setAttribute("data-traderhome", "shell-v5");
  header.innerHTML = '<div class="th-shell__inner">'
    + '<a class="th-shell__brand" href="/" aria-label="TraderHome 首页"><span class="th-shell__mark">TH</span>'
    + '<span class="th-shell__brandtext"><strong>TraderHome</strong><small>证据驱动的交易工作台</small></span></a>'
    + '<nav class="th-shell__nav" aria-label="TraderHome 产品导航">'
    + groups.map(function (g) {
      return '<div class="th-shell__group" role="group"' + (g.label ? ' aria-label="' + g.label + '"' : "") + ">"
        + (g.label ? '<span class="th-shell__grouplabel">' + g.label + "</span>" : "")
        + g.keys.map(function (k) { return navLink(k, false); }).join("") + "</div>";
    }).join("")
    + "</nav>"
    + '<button class="th-shell__status" type="button" aria-expanded="false" aria-controls="thStatusPanel">'
    + '<i aria-hidden="true"></i><span>数据状态</span></button>'
    + '<button class="th-shell__menu" type="button" aria-label="展开导航" aria-expanded="false" aria-controls="thMenuPanel">'
    + '<span aria-hidden="true"></span></button>'
    + "</div>"
    + '<div class="th-shell__panel" id="thMenuPanel" hidden>'
    + groups.map(function (g) {
      return '<div class="th-shell__panelgroup">' + (g.label ? "<b>" + g.label + "</b>" : "")
        + g.keys.map(function (k) { return navLink(k, true); }).join("") + "</div>";
    }).join("")
    + "</div>"
    + '<div class="th-shell__statuspanel" id="thStatusPanel" hidden><div class="th-shell__statusinner">'
    + '<div class="th-shell__statushead"><strong>各系统数据状态</strong><small>按各自的更新频率判断是否过期</small></div>'
    + '<ol class="th-shell__statuslist"><li class="th-shell__statusempty">读取中…</li></ol></div></div>';
  document.body.insertBefore(header, document.body.firstChild);

  var stage = stages[section];
  if (stage) {
    var bar = document.createElement("section");
    bar.className = "th-stagebar";
    bar.setAttribute("aria-label", "当前工作阶段");
    bar.innerHTML = '<div class="th-stagebar__inner">'
      + '<span class="th-stagebar__step">' + stage.step + " · " + stage.label + "</span>"
      + '<strong class="th-stagebar__title">' + stage.title + "</strong>"
      + '<span class="th-stagebar__chip"><b>输出</b>' + stage.output + "</span>"
      + '<span class="th-stagebar__chip"><b>边界</b>' + stage.boundary + "</span>"
      + '<a class="th-stagebar__next" href="' + stage.next + '">' + stage.nextText + " →</a></div>";
    header.insertAdjacentElement("afterend", bar);
  }

  /* ---------- Menu + status interactions ---------- */
  var menuButton = header.querySelector(".th-shell__menu");
  var menuPanel = header.querySelector("#thMenuPanel");
  var statusButton = header.querySelector(".th-shell__status");
  var statusPanel = header.querySelector("#thStatusPanel");

  function setOpen(button, panel, open) {
    button.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
    header.setAttribute("data-open", String(!menuPanel.hidden || !statusPanel.hidden));
  }
  menuButton.addEventListener("click", function () {
    var open = menuPanel.hidden;
    setOpen(statusButton, statusPanel, false);
    setOpen(menuButton, menuPanel, open);
  });
  statusButton.addEventListener("click", function () {
    var open = statusPanel.hidden;
    setOpen(menuButton, menuPanel, false);
    setOpen(statusButton, statusPanel, open);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (!statusPanel.hidden) { setOpen(statusButton, statusPanel, false); statusButton.focus(); }
    if (!menuPanel.hidden) { setOpen(menuButton, menuPanel, false); menuButton.focus(); }
  });
  document.addEventListener("click", function (event) {
    if (!header.contains(event.target)) {
      setOpen(statusButton, statusPanel, false);
      setOpen(menuButton, menuPanel, false);
    }
  });

  function escapeText(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  loadStatus().then(function (status) {
    var modules = (status.modules || []).filter(function (m) { return !m.localOnly; });
    var bad = modules.filter(function (m) { return m.freshness.state === "stale"; }).length;
    var late = modules.filter(function (m) { return m.freshness.state === "late"; }).length;
    var ok = modules.filter(function (m) { return m.freshness.state === "fresh"; }).length;
    var state = bad ? "stale" : late ? "late" : modules.length ? "fresh" : "unknown";
    statusButton.setAttribute("data-state", state);
    statusButton.querySelector("span").textContent = modules.length
      ? (bad ? bad + " 项已过期" : late ? late + " 项延迟" : "数据 " + ok + "/" + modules.length + " 正常")
      : "数据状态";
    header.querySelectorAll(".th-shell__nav a, .th-shell__panel a").forEach(function (a) {
      var m = (status.modules || []).filter(function (x) { return x.key === a.getAttribute("data-key"); })[0];
      if (m && !m.localOnly) a.setAttribute("data-state", m.freshness.state);
    });
    var list = header.querySelector(".th-shell__statuslist");
    list.innerHTML = (status.modules || []).map(function (m) {
      var f = m.freshness;
      var when = m.asOf ? shortDate(Date.parse(m.asOf)) + " · " + f.ago : (m.localOnly ? "只在你的浏览器内运行" : "尚无数据");
      return '<li><a href="' + escapeText(m.route) + '"><span class="th-shell__statusname">' + escapeText(m.name)
        + "</span><small>" + escapeText(when) + "</small></a>"
        + '<span class="th-fresh" data-state="' + escapeText(m.localOnly ? "unknown" : f.state) + '">' + escapeText(f.label) + "</span></li>";
    }).join("") || '<li class="th-shell__statusempty">状态文件不可用</li>';
  });
})();
