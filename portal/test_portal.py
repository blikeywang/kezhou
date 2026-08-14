from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path

from portal.build_site import build


class PortalBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.site = Path(self.tmp.name) / "site"
        self.manifest = build(self.site)

    def tearDown(self):
        self.tmp.cleanup()

    def test_expected_routes_and_shared_shell(self):
        expected = [
            "index.html",
            "history/index.html",
            "decision/index.html",
            "decision/app.html",
            "decision/tos.html",
            "review/index.html",
            "flow/index.html",
            "incomeos/index.html",
            "incomeos-whole/index.html",
            "tailtrend/index.html",
            "daily-trade/index.html",
            "standards/index.html",
        ]
        for rel in expected:
            path = self.site / rel
            self.assertTrue(path.exists(), rel)
            html = path.read_text(encoding="utf-8")
            self.assertIn('data-traderhome-shell="v4"', html, rel)
            self.assertIn('rel="canonical"', html, rel)
            self.assertIn('name="theme-color"', html, rel)
            self.assertIn('rel="icon"', html, rel)

    def test_history_keeps_generated_data(self):
        html = (self.site / "history" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="APPDATA"', html)
        self.assertIn('data-trust-version="2.1"', html)
        self.assertIn('property="og:url" content="https://traderhome-histroy.xyz/history/"', html)
        self.assertIn('content="https://traderhome-histroy.xyz/history/og.png"', html)

    def test_private_review_ledger_is_not_published(self):
        self.assertFalse((self.site / "review" / "data" / "review-data.json").exists())
        manifest = json.loads((self.site / "traderhome-manifest.json").read_text())
        self.assertFalse(manifest["privacy"]["privateTradeLedgerPublished"])
        self.assertEqual(manifest["privacy"]["reviewRuntime"], "browser_local_with_optional_personal_data_hub")
        self.assertEqual(manifest["privacy"]["reviewDemo"], "optional_synthetic")

    def test_professional_product_contracts_and_evidence_standard(self):
        manifest = json.loads((self.site / "traderhome-manifest.json").read_text())
        self.assertEqual(manifest["version"], 7)
        self.assertEqual(manifest["coreWorkflowVersion"], 3)
        self.assertEqual(set(manifest["productContracts"]), {"history", "decision", "review"})
        self.assertEqual(set(manifest["independentSystems"]), {"flow", "incomeos", "incomeosWhole", "tailtrend", "dailyTrade"})
        self.assertNotIn("flow", manifest["productContracts"])
        self.assertNotIn("incomeos", manifest["productContracts"])
        self.assertFalse(manifest["independentSystems"]["flow"]["partOfCoreWorkflow"])
        self.assertFalse(manifest["independentSystems"]["incomeos"]["partOfCoreWorkflow"])
        self.assertFalse(manifest["independentSystems"]["incomeosWhole"]["partOfCoreWorkflow"])
        self.assertFalse(manifest["independentSystems"]["tailtrend"]["partOfCoreWorkflow"])
        self.assertFalse(manifest["independentSystems"]["dailyTrade"]["partOfCoreWorkflow"])
        self.assertEqual(manifest["evidenceLabels"], ["DATA", "DERIVED", "FORWARD", "METHOD_DEMO"])
        home = (self.site / "index.html").read_text(encoding="utf-8")
        self.assertIn("输出契约", home)
        standards = (self.site / "standards" / "index.html").read_text(encoding="utf-8")
        for level in (">A<", ">B<", ">C<", ">D<"):
            self.assertIn(level, standards)
        review = (self.site / "review" / "index.html").read_text(encoding="utf-8")
        self.assertIn("原始记录仅在本页内存处理", review)
        self.assertIn("查看完整教学案例", review)
        self.assertIn("连接自托管 API", review)
        self.assertIn("从券商读取", review)
        self.assertIn("Longbridge", review)
        self.assertIn("Binance", review)
        self.assertTrue((self.site / "assets" / "personal-data-hub.mjs").exists())

    def test_review_runtime_is_published_as_a_local_first_bundle(self):
        expected = [
            "review/review-engine.mjs",
            "review/review-app.mjs",
            "review/review.css",
            "review/review-benchmarks.mjs",
            "review/review-community.mjs",
            "review/sample-trades.csv",
            "review/sample-bars.csv",
        ]
        for rel in expected:
            self.assertTrue((self.site / rel).exists(), rel)

        review = (self.site / "review" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="tradeFile"', review)
        self.assertIn('id="barFile"', review)
        self.assertIn('id="tradeDialog"', review)
        self.assertIn('id="betterPlan"', review)
        self.assertIn("看这笔怎样做得更好", review)
        self.assertIn("教练重做", review)
        self.assertIn("成长对标", review)
        self.assertIn("战友会诊", review)
        self.assertIn('id="coachChart"', review)
        self.assertIn('id="createFeedbackButton"', review)
        self.assertIn('id="connectPersonalHubButton"', review)
        self.assertIn("导出聚合报告", review)
        self.assertNotIn("$420", review)
        app = (self.site / "review" / "review-app.mjs").read_text(encoding="utf-8")
        self.assertIn("normalizeTradeRecords", app)
        self.assertIn("createExportReport", app)
        self.assertIn("credentials: \"omit\"", app)
        self.assertIn("personalHubFetch", app)

    def test_custom_domain_is_preserved(self):
        self.assertEqual((self.site / "CNAME").read_text().strip(), "traderhome-histroy.xyz")

    def test_decision_runtime_is_published_as_a_complete_bundle(self):
        expected = [
            "decision/data/expert-evidence.js",
            "decision/data/coach-training.js",
            "decision/data/index-coach-competition.js",
            "decision/data/index-coach-competition.json",
            "decision/data/intraday-coaches.js",
            "decision/data/plan-gate-model.js",
            "decision/data/market-snapshots/NQ.json",
            "decision/data/market-snapshots/ES.json",
            "decision/data/market-snapshots/MSFT.json",
            "decision/vendor/lightweight-charts.standalone.production.js",
            "decision/arena-worker/src/engine.js",
        ]
        for rel in expected:
            self.assertTrue((self.site / rel).exists(), rel)

        app = (self.site / "decision" / "app.html").read_text(encoding="utf-8")
        self.assertIn("data/intraday-coaches.js", app)
        self.assertIn("data/index-coach-competition.js", app)
        self.assertIn("NQ / ES 过去一年赛", app)
        self.assertIn("验证与留出没有同时过线就不增加下单权", app)
        self.assertIn("function openIndexCompetition(id)", app)
        self.assertIn("NQ 日内计划席", app)
        self.assertIn("forwardStep(symbol,timeframe,ohlc.data,CARDS)", app)
        self.assertIn('id="tourLaunch"', app)
        self.assertIn('id="productTour" hidden', app)
        self.assertIn("EV Desk 使用教程", app)
        self.assertIn("以后不再自动弹出", app)
        self.assertIn("教学示例 · 不是当前交易建议", app)
        self.assertIn("主计划是回踩 98 入场、95 止损、104 目标", app)
        self.assertIn("62分不是 62% 胜率", app)
        self.assertIn("把 NQ 放入等待清单", app)
        self.assertIn('value="ES"', app)
        self.assertIn("个人数据中枢", app)

        competition = json.loads((self.site / "decision" / "data" / "index-coach-competition.json").read_text())
        self.assertEqual(competition["schema"], "ev_desk_index_coach_competition_v1")
        self.assertEqual(competition["summary"]["roster"], 17)
        self.assertEqual(len(competition["leaderboard"]), 17)
        self.assertTrue(competition["meta"]["quality"]["nq_one_minute_path_audit"]["available"])

    def test_flow_is_published_as_an_independent_browser_safe_system(self):
        flow = (self.site / "flow" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="flow-root"', flow)
        self.assertIn("NQ Flow Console", flow)
        self.assertIn("https://nq-flow-console.blikeywang.chatgpt.site", self._flow_javascript())
        self.assertIn("SIMULATED FEED", self._flow_javascript())
        self.assertIn("v1.6.4 BRIDGE", self._flow_javascript())
        self.assertIn("AUTO HIGHER TIMEFRAME", self._flow_javascript())
        self.assertIn("FIBO LEVEL TABLE", self._flow_javascript())
        self.assertIn("nq-flow-font-scale", self._flow_javascript())
        self.assertIn("nq-flow-fibo-table", self._flow_javascript())
        self.assertRegex(flow, r'/flow/assets/flow-app-[^"\']+\.js')
        self.assertRegex(flow, r'/flow/assets/flow-[^"\']+\.css')

        for asset in re.findall(r'(?:src|href)="(/flow/assets/[^"]+)"', flow):
            self.assertTrue((self.site / asset.removeprefix("/")).exists(), asset)

        snapshot = json.loads((self.site / "flow" / "snapshot.json").read_text())
        self.assertEqual(snapshot["strategyVersion"], "1.6.4")
        self.assertEqual(snapshot["bundleMode"], "browser-safe-simulated-preview")
        self.assertEqual(
            snapshot["features"],
            {
                "adaptiveHigherTimeframe": True,
                "fontScalePreference": True,
                "hideableFiboLevelTable": True,
            },
        )
        self.assertEqual(self.manifest["routes"]["flow"], "/flow/")
        self.assertEqual(self.manifest["privacy"]["flowPublicRuntime"], "simulated_preview")

    def test_incomeos_is_published_as_an_independent_browser_local_system(self):
        expected = [
            "incomeos/index.html",
            "incomeos/incomeos.css",
            "incomeos/incomeos-app.mjs",
            "incomeos/incomeos-engine.mjs",
            "incomeos/data/research-snapshot.json",
            "incomeos/data/incomeos-full.json",
            "incomeos/data/operation-history.json",
        ]
        for rel in expected:
            self.assertTrue((self.site / rel).exists(), rel)

        page = (self.site / "incomeos" / "index.html").read_text(encoding="utf-8")
        self.assertIn("IncomeOS", page)
        self.assertIn('id="weeklyContribution"', page)
        self.assertIn('id="accountValue"', page)
        self.assertIn('id="optionReserve"', page)
        self.assertIn('data-font-scale="130"', page)
        self.assertIn('data-font-family="reading"', page)
        self.assertIn('data-color-theme="amber"', page)
        self.assertIn('data-color-theme="daylight"', page)
        self.assertIn('id="incomeosTopbar"', page)
        self.assertIn('id="syncIbkrButton"', page)
        self.assertIn('class="io-wrap io-global-controls"', page)
        self.assertNotIn('class="io-appearance-control"', page)
        self.assertIn('id="operationHistoryRecords"', page)
        self.assertIn('id="historyArchive"', page)
        self.assertIn("每周重新找更好的组合", page)
        self.assertIn('data-tab="overview"', page)
        self.assertIn('data-tab="ranking"', page)
        self.assertIn('data-tab="portfolio"', page)
        self.assertIn('data-tab="calls"', page)
        self.assertIn('data-tab="puts"', page)
        self.assertIn('data-tab="risk"', page)
        self.assertIn('data-tab="backtest"', page)
        self.assertIn('data-tab="data"', page)

        app = (self.site / "incomeos" / "incomeos-app.mjs").read_text(encoding="utf-8")
        self.assertIn("localStorage", app)
        self.assertIn('credentials: "omit"', app)
        self.assertIn("portfolioContributionPlan", app)
        self.assertIn("renderOperationHistory", app)
        self.assertIn("operation-history.json", app)
        self.assertIn('"daylight"', app)
        self.assertIn("syncTopbarOffset", app)
        self.assertIn("syncIbkrAccount", app)
        self.assertNotIn("window.scrollTo", app)

        css = (self.site / "incomeos" / "incomeos.css").read_text(encoding="utf-8")
        self.assertIn(':root[data-income-color="daylight"]', css)
        self.assertIn("--io-topbar-offset", css)

        full_snapshot = json.loads((self.site / "incomeos" / "data" / "incomeos-full.json").read_text())
        self.assertEqual(full_snapshot["universe"]["candidateCount"], 71)
        self.assertEqual(full_snapshot["universe"]["top50Count"], 50)
        self.assertGreaterEqual(full_snapshot["universe"]["challengerCount"], 20)
        self.assertGreaterEqual(full_snapshot["optionDataQuality"]["usable"], 15)
        self.assertEqual(full_snapshot["executionAssets"][0]["ticker"], "SPYM")
        self.assertEqual(full_snapshot["executionAssets"][0]["proxyFor"], "SPY")
        jpm = next(asset for asset in full_snapshot["assets"] if asset["ticker"] == "JPM")
        self.assertEqual(jpm["status"], "VALUATION_WAIT")
        self.assertGreaterEqual(jpm["valuation"]["historicalPercentile"], 95)

        snapshot = json.loads((self.site / "incomeos" / "data" / "research-snapshot.json").read_text())
        self.assertEqual(snapshot["schema"], "traderhome_incomeos_growth_cycle_v1")
        self.assertEqual({row["symbol"] for row in snapshot["benchmarks"]}, {"JPM", "SPY", "SCHD", "BAC", "GS"})
        self.assertEqual(snapshot["jpmEvidence"]["lastEightQuarterEpsBeatRate"], 88)
        self.assertFalse(all(candidate["hasBidAsk"] for candidate in snapshot["puts"]))
        operation_history = json.loads((self.site / "incomeos" / "data" / "operation-history.json").read_text())
        self.assertEqual(operation_history["schema"], "traderhome_incomeos_operation_history_v1")
        self.assertGreaterEqual(len(operation_history["records"]), 1)
        self.assertIn("allocation", operation_history["records"][0])
        self.assertEqual(self.manifest["routes"]["incomeos"], "/incomeos/")
        self.assertEqual(self.manifest["privacy"]["incomeosRuntime"], "browser_local")
        self.assertEqual(self.manifest["privacy"]["incomeosBrokerConnection"], "local_readonly_via_personal_data_hub")
        self.assertIn("ibkr_client_portal_web_api", self.manifest["privacy"]["personalDataHubSources"])
        self.assertNotIn("ibkr_tws_api", self.manifest["privacy"]["personalDataHubSources"])
        self.assertFalse(self.manifest["privacy"]["personalDataHubSecretsPublished"])

    def test_incomeos_whole_is_a_complete_integer_only_copy(self):
        expected = [
            "incomeos-whole/index.html",
            "incomeos-whole/incomeos.css",
            "incomeos-whole/incomeos-app.mjs",
            "incomeos-whole/incomeos-engine.mjs",
            "incomeos-whole/data/incomeos-full.json",
            "incomeos-whole/data/operation-history.json",
        ]
        for rel in expected:
            self.assertTrue((self.site / rel).exists(), rel)

        page = (self.site / "incomeos-whole" / "index.html").read_text(encoding="utf-8")
        self.assertIn('data-execution-mode="whole"', page)
        self.assertIn('id="carryCash"', page)
        self.assertIn('id="cashBuffer"', page)
        self.assertIn('id="weeklyContribution" type="number" min="0" step="50" inputmode="decimal" value="1900"', page)
        self.assertIn("整数股操作单", page)
        self.assertIn("同一套 IncomeOS", page)
        self.assertIn("Sell Call", page)
        self.assertIn("Sell Put", page)
        self.assertIn('data-tab="overview"', page)
        self.assertIn('data-tab="ranking"', page)
        self.assertIn('data-tab="backtest"', page)
        self.assertNotIn("估算碎股", page)
        self.assertIn('src="/incomeos-whole/incomeos-app.mjs"', page)
        self.assertIn('id="syncIbkrButton"', page)

        app = (self.site / "incomeos-whole" / "incomeos-app.mjs").read_text(encoding="utf-8")
        engine = (self.site / "incomeos-whole" / "incomeos-engine.mjs").read_text(encoding="utf-8")
        self.assertIn("wholeShareContributionPlan", app)
        self.assertIn("allocateWholeShareOrders", engine)
        self.assertEqual(self.manifest["routes"]["incomeosWhole"], "/incomeos-whole/")
        self.assertEqual(self.manifest["privacy"]["incomeosWholeRuntime"], "browser_local_whole_shares_only")

    def test_tailtrend_is_a_derived_daily_close_shadow_system(self):
        expected = [
            "tailtrend/index.html",
            "tailtrend/tailtrend.css",
            "tailtrend/tailtrend-app.mjs",
            "tailtrend/tailtrend-engine.mjs",
            "tailtrend/data/tailtrend-snapshot.json",
            "tailtrend/data/latest.json",
            "tailtrend/data/index.json",
            "tailtrend/data/snapshots/2026-08-12.json",
            "tailtrend/data/run-history.json",
            "tailtrend/data/tailtrend-audit.json",
        ]
        for rel in expected:
            self.assertTrue((self.site / rel).exists(), rel)

        page = (self.site / "tailtrend" / "index.html").read_text(encoding="utf-8")
        self.assertIn("TailTrend Lab", page)
        self.assertIn('id="scannerRows"', page)
        self.assertIn('id="riskForm"', page)
        self.assertIn('id="riskModule" disabled', page)
        self.assertIn('id="auditSummary"', page)
        self.assertIn('id="barFile"', page)
        self.assertIn("触及 ≠ 信号", page)
        self.assertIn("不自动下单", page)
        self.assertIn("海龟交易法是趋势跟踪策略", page)
        self.assertIn('data-static-fallback="true"', page)
        self.assertIn("JavaScript 未运行", page)

        app = (self.site / "tailtrend" / "tailtrend-app.mjs").read_text(encoding="utf-8")
        self.assertIn('credentials: "omit"', app)
        self.assertNotIn("localStorage", app)
        self.assertIn("calculateRiskPlan", app)
        self.assertIn("signalGate", app)
        self.assertIn("record.newPositionAllowed", app)
        self.assertIn('/tailtrend/data/latest.json', app)
        self.assertIn('/tailtrend/data/index.json', app)
        self.assertIn("riskConfigFile", app)
        self.assertNotIn('/tailtrend/data/run-history.json', app)
        engine = (self.site / "tailtrend" / "tailtrend-engine.mjs").read_text(encoding="utf-8")
        self.assertIn("LOWER_TAIL_RECLAIMED", engine)
        self.assertIn("TREND_ACCEPTED", engine)
        self.assertIn("EVENT_QUARANTINE", engine)
        self.assertIn("策略袖套与状态机不一致", engine)
        self.assertIn("traderhome_tailtrend_audit_v1", engine)
        self.assertIn("pressureGroup", engine)
        self.assertIn("stateMemory", engine)

        snapshot = json.loads((self.site / "tailtrend" / "data" / "latest.json").read_text())
        self.assertEqual(snapshot["schema"], "traderhome_tailtrend_snapshot_v1")
        self.assertEqual(snapshot["status"], "COMPLETE")
        self.assertEqual(snapshot["version"], 3)
        self.assertFalse(snapshot["engineDirty"])
        self.assertRegex(snapshot["engineVersion"], r"^[0-9a-f]{40}$")
        self.assertRegex(snapshot["paramsHash"], r"^[0-9a-f]{64}$")
        self.assertEqual(snapshot["source"], "Longbridge Securities")
        self.assertEqual(snapshot["signalTimeframe"], "daily_close")
        self.assertFalse(snapshot["privacy"]["rawBarsPublished"])
        self.assertFalse(snapshot["privacy"]["accountDataPublished"])
        self.assertFalse(snapshot["privacy"]["automaticOrders"])
        self.assertNotIn("barsData", snapshot)
        self.assertTrue(all("priorityBreakdown" in row for row in snapshot["records"]))
        self.assertTrue(all("stateReason" in row for row in snapshot["records"]))
        self.assertTrue(all("nextCondition" in row for row in snapshot["records"]))
        self.assertTrue(all("prevState" in row for row in snapshot["records"]))
        self.assertTrue(all("stateMemory" in row for row in snapshot["records"]))
        self.assertTrue(all("comparisonStates" in row for row in snapshot["records"]))
        self.assertTrue(all("riskFactors" in row for row in snapshot["records"]))
        index = json.loads((self.site / "tailtrend" / "data" / "index.json").read_text())
        self.assertEqual(index["schema"], "traderhome_tailtrend_snapshot_index_v1")
        self.assertEqual(index["latestCompleteDataAsOf"], snapshot["dataAsOf"])
        self.assertIsInstance(index["missingDates"], list)
        daily = json.loads((self.site / "tailtrend" / "data" / "snapshots" / f'{snapshot["dataAsOf"]}.json').read_text())
        self.assertEqual(daily, snapshot)
        audit = json.loads((self.site / "tailtrend" / "data" / "tailtrend-audit.json").read_text())
        self.assertEqual(audit["schema"], "traderhome_tailtrend_audit_v1")
        self.assertTrue(audit["activeEpochId"].startswith("0.3.0:"))
        self.assertGreaterEqual(audit["daysCollected"], 1)
        self.assertNotIn("bars", audit)
        css = (self.site / "tailtrend" / "tailtrend.css").read_text(encoding="utf-8")
        self.assertIn(".tt-table tbody tr", css)
        self.assertIn(".tt-detail-open .tt-detail", css)
        self.assertEqual(self.manifest["routes"]["tailtrend"], "/tailtrend/")
        self.assertEqual(self.manifest["privacy"]["tailtrendRuntime"], "derived_snapshot_and_browser_memory_only")
        self.assertFalse(self.manifest["privacy"]["tailtrendRawBarsPublished"])
        self.assertFalse(self.manifest["privacy"]["tailtrendAutomaticOrders"])

    def _flow_javascript(self) -> str:
        return "\n".join(
            path.read_text(encoding="utf-8")
            for path in (self.site / "flow" / "assets").glob("*.js")
        )


if __name__ == "__main__":
    unittest.main()
