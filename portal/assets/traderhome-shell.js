(function () {
  "use strict";
  if (document.querySelector(".th-shell")) return;

  var path = window.location.pathname;
  var section = path.indexOf("/history/") === 0 ? "history"
    : path.indexOf("/decision/") === 0 ? "decision"
    : path.indexOf("/review/") === 0 ? "review" : "home";
  var links = [
    ["home", "/", "首页"],
    ["history", "/history/", "历史证据"],
    ["decision", "/decision/app.html", "下单前决策"],
    ["review", "/review/", "交易后复盘"]
  ];

  var header = document.createElement("header");
  header.className = "th-shell";
  header.setAttribute("data-traderhome", "shell-v1");
  header.innerHTML = '<div class="th-shell__inner">'
    + '<a class="th-shell__brand" href="/"><span class="th-shell__mark">TH</span><span>TraderHome</span></a>'
    + '<button class="th-shell__menu" type="button" aria-label="展开导航" aria-expanded="false">☰</button>'
    + '<nav class="th-shell__nav" aria-label="TraderHome 产品导航">'
    + links.map(function (item) {
      return '<a href="' + item[1] + '"' + (item[0] === section ? ' aria-current="page"' : '') + '>' + item[2] + '</a>';
    }).join("")
    + '</nav><a class="th-shell__community" href="/#community" data-th-community>加入 DC / TG</a></div>';
  document.body.insertBefore(header, document.body.firstChild);

  var menu = header.querySelector(".th-shell__menu");
  menu.addEventListener("click", function () {
    var open = header.getAttribute("data-open") !== "true";
    header.setAttribute("data-open", String(open));
    menu.setAttribute("aria-expanded", String(open));
  });

  document.querySelectorAll("[data-th-community]").forEach(function (el) {
    el.addEventListener("click", function (event) {
      if (el.getAttribute("href") !== "/#community" && el.getAttribute("href") !== "#community") return;
      if (section === "home") return;
      event.preventDefault();
      window.location.href = "/#community";
    });
  });
})();
