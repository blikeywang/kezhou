#!/usr/bin/env python3
"""Build TraderHome from the three-stage workflow and independent systems."""
from __future__ import annotations

import argparse
import html as html_module
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "portal"
SHELL_CSS = '<link rel="stylesheet" href="/assets/traderhome-shell.css" data-traderhome-shell="v4">'
SHELL_JS = '<script src="/assets/traderhome-shell.js" data-traderhome-shell="v4" defer></script>'
THEME_COLOR = '<meta name="theme-color" content="#070b14">'
FAVICON = (
    '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 '
    'viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2714%27 '
    'fill=%27%23070b14%27/%3E%3Cpath d=%27M12 19h20M22 19v28M38 19v28M38 33h14M52 19v28%27 '
    'stroke=%27%2367e8f9%27 stroke-width=%276%27 stroke-linecap=%27round%27/%3E%3C/svg%3E">'
)
DOMAIN = "https://traderhome-histroy.xyz"
CANONICAL_ROUTES = {
    "index.html": "/",
    "history/index.html": "/history/",
    "decision/index.html": "/decision/",
    "decision/app.html": "/decision/app.html",
    "decision/tos.html": "/decision/tos.html",
    "review/index.html": "/review/",
    "flow/index.html": "/flow/",
    "incomeos/index.html": "/incomeos/",
    "incomeos-whole/index.html": "/incomeos-whole/",
    "tailtrend/index.html": "/tailtrend/",
    "standards/index.html": "/standards/",
}


def _copy_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def _inject_shell(path: Path, output: Path) -> None:
    html = path.read_text(encoding="utf-8")
    if "</head>" not in html.lower() or "</body>" not in html.lower():
        raise ValueError(f"HTML shell anchors missing: {path}")
    rel = path.relative_to(output).as_posix()
    route = CANONICAL_ROUTES.get(rel)
    canonical = DOMAIN + route if route else None
    head_extras = []
    if 'name="theme-color"' not in html.lower():
        head_extras.append(THEME_COLOR)
    if 'rel="icon"' not in html.lower():
        head_extras.append(FAVICON)
    if canonical:
        if 'rel="canonical"' not in html.lower():
            head_extras.append(f'<link rel="canonical" href="{canonical}">')
        html = re.sub(
            r'(<meta\s+property=["\']og:url["\']\s+content=["\'])[^"\']*(["\'])',
            rf"\g<1>{canonical}\2", html, flags=re.I,
        )
    if rel == "history/index.html":
        html = html.replace(f"{DOMAIN}/og.png", f"{DOMAIN}/history/og.png")
    if head_extras:
        head_at = html.lower().rfind("</head>")
        html = html[:head_at] + "  " + "\n  ".join(head_extras) + "\n" + html[head_at:]
    if 'data-traderhome-shell="v4"' in html:
        path.write_text(html, encoding="utf-8")
        return
    lower = html.lower()
    head_at = lower.rfind("</head>")
    html = html[:head_at] + "  " + SHELL_CSS + "\n" + html[head_at:]
    lower = html.lower()
    body_at = lower.rfind("</body>")
    html = html[:body_at] + "  " + SHELL_JS + "\n" + html[body_at:]
    path.write_text(html, encoding="utf-8")


def _prepare_incomeos_whole(output: Path) -> None:
    target = output / "incomeos-whole"
    shutil.copytree(PORTAL / "vendor" / "incomeos", target)
    page = target / "index.html"
    html = page.read_text(encoding="utf-8")
    replacements = {
        '<meta name="description" content="IncomeOS：每周扫描候选池、更新 Top 50、构建动态组合，并生成 Sell Call / Cash-Secured Put 风险闸门与 IBKR 操作单。">': '<meta name="description" content="IncomeOS 整股版：完整保留研究、Top 50、组合、期权和历史模块，只生成 IBKR 可执行的整数股订单。">',
        '<title>IncomeOS · 长期资金与现金流系统 | TraderHome</title>': '<title>IncomeOS 整股版 · 整数股长期资金系统 | TraderHome</title>',
        'href="/incomeos/incomeos.css"': 'href="/incomeos-whole/incomeos.css"',
        '<body class="incomeos">': '<body class="incomeos" data-execution-mode="whole">',
        '<span>TRADERHOME</span><b>INCOMEOS</b>': '<span>TRADERHOME</span><b>INCOMEOS · WHOLE</b>',
        '<h1>不是一只 JPM。<br><span>每周重新找更好的组合。</span></h1>': '<h1>同一套 IncomeOS。<br><span>每一单只买整数股。</span></h1>',
        '<p>候选池从原 50 扩展到 71 个，再按长期复利、盈利预期、质量、估值、风险、股息和流动性选出当期 Top 50。输入本周到账与 IBKR 净值后，系统把当前组合转成今天可执行的美元订单。</p>': '<p>完整复制研究、Top 50、组合、Sell Call、Sell Put、风险和历史记录；唯一变化是执行层只输出完整股数。SPY 核心在小账户阶段用同指数低单价 SPYM 执行，不足一股的目标先停泊。</p>',
        'aria-label="IncomeOS 本周输入"': 'aria-label="IncomeOS 整股版本周输入"',
        '<span>THIS WEEK</span><strong id="weeklyAmountHero">$1,000</strong>': '<span>WHOLE SHARES</span><strong id="weeklyAmountHero">$1,900</strong>',
        '<button type="button" data-tab="report" class="active">周五操作单</button>': '<button type="button" data-tab="report" class="active">整数股操作单</button>',
        'FRIDAY 10:00 ET · ACTION SHEET': 'WHOLE SHARES · ACTION SHEET',
        '<article><span>本周美元买入</span><strong><b id="orderCount">0</b> 笔</strong><small>支持 IBKR 碎股 / 按美元买入</small></article>': '<article><span>本周整数股买入</span><strong><b id="orderCount">0</b> 笔</strong><small>仅输出 IBKR 完整股数订单</small></article>',
        '<div class="io-subhead"><span>IBKR · TODAY</span><h3>按美元下单</h3><p>这是新增资金流向，不会假装知道你现有持仓偏离。</p></div>': '<div class="io-subhead"><span>IBKR · WHOLE SHARES</span><h3>按整数股下单</h3><p>不足一股的小额目标先汇入 SGOV；未使用现金自动留到下次。</p></div>',
        '<div id="orders" class="io-orders"></div>': '<div id="orders" class="io-orders"></div><div class="io-whole-summary" id="wholeShareSummary"></div>',
        '<div><span class="io-label">FRIDAY LEDGER</span><h3 id="operationHistoryTitle">周五操作历史</h3><p>保存每周五系统生成的操作单快照；这是当时的模型建议，不冒充 IBKR 实际成交。</p></div>': '<div><span class="io-label">WHOLE-SHARE LEDGER</span><h3 id="operationHistoryTitle">整股版操作历史</h3><p>共享当期研究与目标比例快照；具体整数股数由每次输入、余款和执行价格重新计算，不冒充 IBKR 实际成交。</p></div>',
        '<div class="io-subhead score-head"><span>THIS WEEK</span><h3>新增资金订单拆分</h3><p>分配到美分并确保总额与本周输入完全一致。</p></div>': '<div class="io-subhead score-head"><span>THIS WEEK</span><h3>新增资金整数股订单</h3><p>目标权重保持不变；无法达到一股的目标先停泊，绝不生成碎股。</p></div>',
        '<th>标的 / 角色</th><th>当前动态权重</th><th>本周金额</th><th>参考价</th><th>估算碎股</th><th>选择理由</th>': '<th>标的 / 角色</th><th>整数股有效权重</th><th>目标 / 预计使用</th><th>参考价</th><th>整数股</th><th>选择理由</th>',
        '<span>IncomeOS · TraderHome 独立长期资金系统</span>': '<span>IncomeOS Whole · TraderHome 独立整数股长期资金系统</span>',
        'src="/incomeos/incomeos-app.mjs"': 'src="/incomeos-whole/incomeos-app.mjs"',
    }
    for old, new in replacements.items():
        if old not in html:
            raise ValueError(f"IncomeOS whole-page transform anchor missing: {old[:80]}")
        html = html.replace(old, new)
    contribution = '<label class="io-input"><span>本周实际到账</span><div><b>$</b><input id="weeklyContribution" type="number" min="0" step="50" inputmode="decimal" value="1000"></div><small>每周按真正进入 IBKR 的净新增现金填写</small></label>'
    whole_contribution = contribution.replace('value="1000"', 'value="1900"')
    carry = whole_contribution + '\n        <label class="io-input"><span>上次未使用现金</span><div><b>$</b><input id="carryCash" type="number" min="0" step="1" inputmode="decimal" value="0"></div><small>只填仍可用于本次整数股订单的美元现金</small></label>'
    carry += '\n        <label class="io-input"><span>成交与手续费缓冲</span><div><b>$</b><input id="cashBuffer" type="number" min="0" step="1" inputmode="decimal" value="15"></div><small>默认保留 $15，防止限价变化或费用导致超额</small></label>'
    if contribution not in html:
        raise ValueError("IncomeOS whole-page carry-cash anchor missing")
    html = html.replace(contribution, carry)
    page.write_text(html, encoding="utf-8")


def _prepare_tailtrend(output: Path) -> None:
    target = output / "tailtrend"
    data = target / "data"
    snapshot_path = data / "latest.json"
    if not snapshot_path.exists():
        snapshot_path = data / "tailtrend-snapshot.json"
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    rows = []
    for record in snapshot.get("records", []):
        escape = lambda value: html_module.escape(str(value if value is not None else "—"), quote=True)
        position = record.get("rangePositionPct")
        position_label = f"{position:.1f}%" if isinstance(position, (int, float)) else "—"
        atr = record.get("atrPct")
        atr_label = f"{atr:.2f}%" if isinstance(atr, (int, float)) else "—"
        hv = record.get("hvPercentile")
        hv_label = f"p{hv:.0f}" if isinstance(hv, (int, float)) else "—"
        blocker = (record.get("blockers") or [""])[0]
        rows.append(
            '<tr data-static-fallback="true">'
            f'<td data-label="标的"><div class="tt-symbol"><strong>{escape(record.get("ticker"))}</strong><small>{escape(record.get("name"))}</small></div></td>'
            f'<td data-label="状态"><span class="tt-state tone-muted">{escape(record.get("label"))}</span><small class="tt-cell-sub">复核优先级 {escape(record.get("priority"))}</small></td>'
            f'<td data-label="位置"><small class="tt-cell-sub">60日区间 {escape(position_label)}</small></td>'
            f'<td data-label="周线 / 波动"><b>{escape(record.get("weeklyRegime"))}</b><small class="tt-cell-sub">ATR {escape(atr_label)} · HV {escape(hv_label)}</small></td>'
            f'<td data-label="动作" class="tt-action">{escape(record.get("action"))}<small class="tt-cell-sub">{escape(blocker)}</small></td>'
            f'<td data-label="数据"><span class="tt-fresh">{escape(record.get("dataStatus"))}</span><small class="tt-cell-sub">{escape(record.get("tradingDate"))}</small></td>'
            '</tr>'
        )
    page = target / "index.html"
    page_html = page.read_text(encoding="utf-8")
    anchor = '<tbody id="scannerRows"><tr><td colspan="6" class="tt-empty">正在读取派生快照…</td></tr></tbody>'
    if anchor not in page_html:
        raise ValueError("TailTrend static fallback table anchor missing")
    page_html = page_html.replace(anchor, f'<tbody id="scannerRows">{"".join(rows)}</tbody>')
    notice_anchor = '<div class="tt-board">'
    notice = (
        '<noscript><div class="tt-alert tt-noscript">JavaScript 未运行：以下是构建时冻结的只读日线快照；'
        '仓位计算、本地导入和交互筛选已停用。</div></noscript>'
    )
    page_html = page_html.replace(notice_anchor, notice + notice_anchor, 1)
    page.write_text(page_html, encoding="utf-8")


def build(output: Path) -> dict:
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    _copy_file(PORTAL / "home" / "index.html", output / "index.html")
    _copy_file(PORTAL / "home" / "standards.html", output / "standards" / "index.html")
    shutil.copytree(PORTAL / "assets", output / "assets")

    # Kezhou stays generated by its daily pipeline; only its location changes.
    _copy_file(ROOT / "prototype" / "app.html", output / "history" / "index.html")
    if (ROOT / "prototype" / "og.png").exists():
        _copy_file(ROOT / "prototype" / "og.png", output / "history" / "og.png")

    # Browser-safe snapshots. No private TradeReview trade ledger is published.
    shutil.copytree(PORTAL / "vendor" / "decision", output / "decision")
    shutil.copytree(PORTAL / "vendor" / "review", output / "review")

    # NQ Flow is a fourth, independent system. Its public bundle is a clearly
    # labelled simulated preview; private live access stays on its own service.
    shutil.copytree(PORTAL / "vendor" / "flow", output / "flow")

    # IncomeOS is another independent system. It publishes derived market
    # research and runs account allocation locally in the browser; no broker
    # credential, account ledger, or order permission is copied into the site.
    shutil.copytree(PORTAL / "vendor" / "incomeos", output / "incomeos")
    _prepare_incomeos_whole(output)

    # TailTrend Lab publishes only derived daily-close states. Raw bars,
    # account inputs and broker credentials never enter the static bundle.
    shutil.copytree(PORTAL / "vendor" / "tailtrend", output / "tailtrend")
    _prepare_tailtrend(output)

    for html in output.rglob("*.html"):
        _inject_shell(html, output)

    for name in ("CNAME", "DISCLAIMER.md"):
        source = ROOT / name
        if source.exists():
            _copy_file(source, output / name)

    manifest = {
        "name": "TraderHome",
        "version": 7,
        "coreWorkflowVersion": 3,
        "routes": {
            "home": "/",
            "history": "/history/",
            "decision": "/decision/app.html",
            "review": "/review/",
            "flow": "/flow/",
            "incomeos": "/incomeos/",
            "incomeosWhole": "/incomeos-whole/",
            "tailtrend": "/tailtrend/",
            "standards": "/standards/",
        },
        "productContracts": {
            "history": {"output": "probability_edge_interval_robustness", "rejects": "stale_or_weak_evidence"},
            "decision": {"output": "trigger_entry_invalidation_target_r", "rejects": "direction_location_or_rr_gate"},
            "review": {"output": "costly_behavior_evidence_trade_one_action_growth", "rejects": "insufficient_evidence"},
        },
        "independentSystems": {
            "flow": {
                "input": "nq_mnq_trades_l2_and_v164_bridge",
                "output": "flow_confirmation_and_execution_authority",
                "rejects": "missing_stale_or_version_mismatched_data",
                "route": "/flow/",
                "partOfCoreWorkflow": False,
            },
            "incomeos": {
                "input": "weekly_net_contribution_account_value_option_reserve_and_derived_market_snapshot",
                "output": "dynamic_dollar_allocation_growth_cycle_evidence_and_cash_secured_put_gate",
                "rejects": "stale_missing_untradeable_overvalued_or_concentration_breaching_data",
                "route": "/incomeos/",
                "partOfCoreWorkflow": False,
            },
            "incomeosWhole": {
                "input": "weekly_net_contribution_carry_cash_account_value_option_reserve_and_derived_market_snapshot",
                "output": "whole_share_orders_cash_remainder_growth_cycle_evidence_and_cash_secured_put_gate",
                "rejects": "fractional_orders_stale_missing_untradeable_overvalued_or_concentration_breaching_data",
                "route": "/incomeos-whole/",
                "partOfCoreWorkflow": False,
            },
            "tailtrend": {
                "input": "longbridge_forward_adjusted_regular_session_daily_ohlcv_and_local_browser_risk_inputs",
                "output": "tail_trend_state_bucket_management_zone_and_stress_position_size",
                "rejects": "middle_zone_unconfirmed_breakout_event_gap_stale_data_or_risk_gate_failure",
                "route": "/tailtrend/",
                "partOfCoreWorkflow": False,
            },
        },
        "evidenceLabels": ["DATA", "DERIVED", "FORWARD", "METHOD_DEMO"],
        "privacy": {
            "privateTradeLedgerPublished": False,
            "reviewRuntime": "browser_local",
            "reviewDemo": "optional_synthetic",
            "flowPublicRuntime": "simulated_preview",
            "flowPrivateLiveService": "separate_authenticated_endpoint",
            "incomeosRuntime": "browser_local",
            "incomeosWholeRuntime": "browser_local_whole_shares_only",
            "incomeosBrokerConnection": False,
            "incomeosAccountInputsStored": "browser_local_storage_only",
            "incomeosPublishedData": "derived_read_only_snapshot",
            "tailtrendRuntime": "derived_snapshot_and_browser_memory_only",
            "tailtrendRawBarsPublished": False,
            "tailtrendAccountDataStored": False,
            "tailtrendAutomaticOrders": False,
        },
    }
    (output / "traderhome-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "_site")
    args = parser.parse_args()
    manifest = build(args.output.resolve())
    print(f"Built TraderHome routes: {', '.join(manifest['routes'].values())}")


if __name__ == "__main__":
    main()
