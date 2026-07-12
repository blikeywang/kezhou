(function () {
  "use strict";
  if (document.querySelector(".th-shell")) return;

  var path = window.location.pathname;
  var section = path.indexOf("/history/") === 0 ? "history"
    : path.indexOf("/decision/") === 0 ? "decision"
    : path.indexOf("/review/") === 0 ? "review"
    : path.indexOf("/standards/") === 0 ? "standards" : "home";
  document.documentElement.setAttribute("data-th-stage", section);

  var links = [
    ["home", "/", "首页"],
    ["history", "/history/", "历史证据"],
    ["decision", "/decision/app.html", "下单前决策"],
    ["review", "/review/", "交易后复盘"],
    ["standards", "/standards/", "证据标准"]
  ];
  var stages = {
    history: {
      step: "01", label: "RESEARCH · 历史研究", title: "先建立一个可证伪的交易假设",
      detail: "比较历史相似片段、基准与置信区间，再决定是否值得进入计划阶段。",
      output: "共识概率 · Edge · 区间 · 稳健性", boundary: "不输出确定走势或买卖指令",
      next: "/decision/app.html", nextText: "进入下单前计划 →"
    },
    decision: {
      step: "02", label: "PLAN · 下单前决策", title: "把方向观点变成有失效点的条件式计划",
      detail: "机会榜只分配注意力；触发、位置、赔率和风险预算必须同时过门槛。",
      output: "触发 · 进场区 · 失效位 · 目标 · R", boundary: "门槛不够时默认空仓",
      next: "/review/", nextText: "查看交易后验证 →"
    },
    review: {
      step: "03", label: "REVIEW · 交易后复盘", title: "找到最贵的重复错误，并验证它是否真的改变",
      detail: "先保留交易员原始判断，再用交易、K线和分级专家证据给出下一阶段唯一动作。",
      output: "成本行为 · 证据单 · 唯一处方 · 成长证明", boundary: "不把相关亏损写成可挽回收益",
      next: "/history/", nextText: "开始下一轮研究 →"
    }
  };

  var header = document.createElement("header");
  header.className = "th-shell";
  header.setAttribute("data-traderhome", "shell-v3");
  header.innerHTML = '<div class="th-shell__inner">'
    + '<a class="th-shell__brand" href="/"><span class="th-shell__mark">TH</span>'
    + '<span class="th-shell__brandtext"><strong>TraderHome</strong><small>Evidence-led trading workspace</small></span></a>'
    + '<button class="th-shell__menu" type="button" aria-label="展开导航" aria-expanded="false">☰</button>'
    + '<nav class="th-shell__nav" aria-label="TraderHome 产品导航">'
    + links.map(function (item) {
      return '<a href="' + item[1] + '"' + (item[0] === section ? ' aria-current="page"' : '') + '>' + item[2] + '</a>';
    }).join("")
    + '</nav><a class="th-shell__community" href="/#community">加入 DC / TG</a></div>';
  document.body.insertBefore(header, document.body.firstChild);

  var stage = stages[section];
  if (stage) {
    var bar = document.createElement("section");
    bar.className = "th-stagebar";
    bar.setAttribute("aria-label", "当前工作阶段");
    bar.innerHTML = '<div class="th-stagebar__inner"><div class="th-stagebar__step">' + stage.step + '</div>'
      + '<div class="th-stagebar__copy"><small>' + stage.label + '</small><strong>' + stage.title + '</strong><span>' + stage.detail + '</span></div>'
      + '<div class="th-stagebar__contract"><span class="th-stagebar__chip"><b>输出</b> ' + stage.output + '</span>'
      + '<span class="th-stagebar__chip"><b>边界</b> ' + stage.boundary + '</span></div>'
      + '<a class="th-stagebar__next" href="' + stage.next + '">' + stage.nextText + '</a></div>';
    header.insertAdjacentElement("afterend", bar);
  }

  var menu = header.querySelector(".th-shell__menu");
  menu.addEventListener("click", function () {
    var open = header.getAttribute("data-open") !== "true";
    header.setAttribute("data-open", String(open));
    menu.setAttribute("aria-expanded", String(open));
  });
})();
