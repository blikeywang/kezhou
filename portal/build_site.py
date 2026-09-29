#!/usr/bin/env python3
"""Build TraderHome from the research/review workflow and independent systems."""
from __future__ import annotations

import argparse
import html as html_module
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "portal"
SHELL_CSS = '<link rel="stylesheet" href="/assets/traderhome-shell.css?v=10" data-traderhome-shell="v4">'
SHELL_JS = '<script src="/assets/traderhome-shell.js?v=10" data-traderhome-shell="v4" defer></script>'
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
    "review/index.html": "/review/",
    "flow/index.html": "/flow/",
    "incomeos/index.html": "/incomeos/",
    "tailtrend/index.html": "/tailtrend/",
    "daily-trade/index.html": "/daily-trade/",
    "otc/index.html": "/otc/",
    "market-simulation/index.html": "/market-simulation/",
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
    shutil.copytree(PORTAL / "vendor" / "review", output / "review")

    # NQ Flow is an independent system. Its public bundle is a clearly
    # labelled simulated preview; private live access stays on its own service.
    shutil.copytree(PORTAL / "vendor" / "flow", output / "flow")

    # IncomeOS is another independent system. It publishes derived market
    # research and runs account allocation locally in the browser; no broker
    # credential, account ledger, or order permission is copied into the site.
    shutil.copytree(PORTAL / "vendor" / "incomeos", output / "incomeos")

    # TailTrend Lab publishes only derived daily-close states. Raw bars,
    # account inputs and broker credentials never enter the static bundle.
    shutil.copytree(PORTAL / "vendor" / "tailtrend", output / "tailtrend")
    _prepare_tailtrend(output)

    # Daily trade reports publish generated research artifacts only. The source
    # workflow remains responsible for data freshness, key protection and account privacy.
    daily_trade_vendor = PORTAL / "vendor" / "daily-trade"
    if daily_trade_vendor.exists():
        shutil.copytree(daily_trade_vendor, output / "daily-trade")

    # User-provided OTC history only. Runtime price comparisons and local CSV
    # imports remain in browser memory; no accounts or broker bars are bundled.
    shutil.copytree(PORTAL / "vendor" / "otc", output / "otc")
    shutil.copytree(PORTAL / "vendor" / "market-simulation", output / "market-simulation")

    for html in output.rglob("*.html"):
        _inject_shell(html, output)

    for name in ("CNAME", "DISCLAIMER.md"):
        source = ROOT / name
        if source.exists():
            _copy_file(source, output / name)

    manifest = {
        "name": "TraderHome",
        "version": 10,
        "coreWorkflowVersion": 4,
        "routes": {
            "home": "/",
            "history": "/history/",
            "review": "/review/",
            "flow": "/flow/",
            "incomeos": "/incomeos/",
            "tailtrend": "/tailtrend/",
            "dailyTrade": "/daily-trade/",
            "otc": "/otc/",
            "marketSimulation": "/market-simulation/",
            "standards": "/standards/",
        },
        "productContracts": {
            "history": {"output": "probability_edge_interval_robustness", "rejects": "stale_or_weak_evidence"},
            "review": {"output": "costly_behavior_evidence_trade_one_action_growth", "rejects": "insufficient_evidence"},
        },
        "independentSystems": {
            "marketSimulation": {"input": "authenticated_private_paper_market_workspace", "output": "ten_minute_execution_hourly_model_review_multiple_horizon_plans", "rejects": "missing_authentication_stale_data_or_suspended_plan_scope", "route": "/market-simulation/", "partOfCoreWorkflow": False},
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
            "tailtrend": {
                "input": "longbridge_forward_adjusted_regular_session_daily_ohlcv_and_local_browser_risk_inputs",
                "output": "tail_trend_state_bucket_management_zone_and_stress_position_size",
                "rejects": "middle_zone_unconfirmed_breakout_event_gap_stale_data_or_risk_gate_failure",
                "route": "/tailtrend/",
                "partOfCoreWorkflow": False,
            },
            "dailyTrade": {
                "input": "codex_trade_reports_after_validation",
                "output": "morning_and_evening_research_snapshot",
                "rejects": "validation_error_missing_report_or_private_account_data",
                "route": "/daily-trade/",
                "partOfCoreWorkflow": False,
            },
            "otc": {
                "input": "user_notion_with_authorized_reference_history_and_independent_public_daily_prices",
                "output": "daily_cycle_quality_review_and_conditional_research_plan",
                "rejects": "missing_stale_unverified_mapping_or_unconfirmed_execution_conditions",
                "route": "/otc/",
                "partOfCoreWorkflow": False,
            },
        },
        "evidenceLabels": ["DATA", "DERIVED", "FORWARD", "METHOD_DEMO"],
        "privacy": {
            "marketSimulationRuntime": "private_authenticated_cloud_workspace",
            "marketSimulationLedgerPublished": False,
            "marketSimulationCredentialsPublished": False,
            "marketSimulationRealOrders": False,
            "privateTradeLedgerPublished": False,
            "reviewRuntime": "browser_local_with_optional_personal_data_hub",
            "reviewDemo": "optional_synthetic",
            "flowPublicRuntime": "simulated_preview",
            "flowPrivateLiveService": "separate_authenticated_endpoint",
            "incomeosRuntime": "browser_local",
            "incomeosBrokerConnection": "local_readonly_via_personal_data_hub",
            "incomeosAccountInputsStored": "browser_local_storage_only; broker credentials stay outside the site",
            "incomeosPublishedData": "derived_read_only_snapshot",
            "tailtrendRuntime": "derived_snapshot_and_browser_memory_only",
            "tailtrendRawBarsPublished": False,
            "tailtrendAccountDataStored": False,
            "tailtrendAutomaticOrders": False,
            "personalDataHubRuntime": "owner_mac_loopback_only",
            "personalDataHubSources": [
                "longbridge_openapi",
                "ibkr_client_portal_web_api",
                "binance_public_and_optional_readonly_account_api",
            ],
            "personalDataHubPermissions": "read_only",
            "personalDataHubSecretsPublished": False,
            "dailyTradePublishedData": "morning_and_evening_html_only",
            "dailyTradeAccountDataPublished": False,
            "dailyTradeAutomaticOrders": False,
            "otcPublishedData": "user_notion_priority_with_user_authorized_reference_archive",
            "otcAccountDataPublished": False,
            "otcRawBrokerBarsPublished": False,
            "otcAutomaticOrders": False,
            "otcPriceRuntime": "scheduled_public_daily_bars_separate_from_unverified_reference_archive_and_memory_only_csv",
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
