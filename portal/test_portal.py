from __future__ import annotations

import json
import hashlib
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
            "review/index.html",
            "incomeos/index.html",
            "tailtrend/index.html",
            "daily-trade/index.html",
            "otc/index.html",
            "market-simulation/index.html",
        ]
        for rel in expected:
            path = self.site / rel
            self.assertTrue(path.exists(), rel)
            html = path.read_text(encoding="utf-8")
            self.assertIn('data-traderhome-shell="v4"', html, rel)
            self.assertIn('rel="canonical"', html, rel)
            self.assertIn('name="theme-color"', html, rel)
            self.assertIn('rel="icon"', html, rel)
            # One shared footer in the static HTML of every page (disclaimer without JavaScript).
            self.assertEqual(html.count("data-traderhome-footer"), 1, rel)
            self.assertIn("不构成投资建议", html, rel)
        # Raw report HTML is never published; daily reports go through the allowlisted JSON only.
        self.assertFalse((self.site / "daily-trade" / "reports").exists())
        status = json.loads((self.site / "assets" / "traderhome-status.json").read_text(encoding="utf-8"))
        names = {m["key"]: m["name"] for m in status["modules"]}
        self.assertEqual(names, {"history": "历史证据", "review": "交易复盘", "incomeos": "IncomeOS", "tailtrend": "TailTrend",
                                 "otc": "场外日线", "marketSimulation": "模拟盘", "dailyTrade": "早晚报"})
        shell = (self.site / "assets" / "traderhome-shell.js").read_text(encoding="utf-8")
        for name in names.values():
            self.assertIn(f'name: "{name}"', shell, name)
        # Editions: a current snapshot that must not be acted on gets its own badge, never "已更新".
        self.assertIn("function chip(m)", shell)
        self.assertIn('state: "research"', shell)
        tokens = (self.site / "assets" / "traderhome-tokens.css").read_text(encoding="utf-8")
        self.assertIn('.th-fresh[data-state="research"]', tokens)
        unify = (self.site / "assets" / "traderhome-unify.css").read_text(encoding="utf-8")
        self.assertIn(".th-notice {", unify)
        income = json.loads((self.site / "incomeos" / "data" / "incomeos-full.json").read_text(encoding="utf-8"))
        income_status = next(m for m in status["modules"] if m["key"] == "incomeos")
        if income.get("publicationMode") == "research_partial":
            self.assertEqual(income_status.get("edition"), "研究版")
            self.assertEqual(income_status.get("note"), "不生成订单")
            self.assertEqual(income_status.get("cadence"), "手动发布")
        else:
            self.assertNotIn("edition", income_status)
        tail = json.loads((self.site / "tailtrend" / "data" / "latest.json").read_text(encoding="utf-8"))
        tail_status = next(m for m in status["modules"] if m["key"] == "tailtrend")
        self.assertEqual(tail_status.get("note"), "事后重算版" if tail.get("revision") else None)

        for retired in ("decision", "incomeos-whole", "flow", "standards"):
            self.assertFalse((self.site / retired).exists(), retired)
        for rel in ("index.html", "otc/index.html", "assets/traderhome-shell.js"):
            contents = (self.site / rel).read_text(encoding="utf-8")
            self.assertNotIn("/decision/", contents, rel)
            self.assertNotIn("/incomeos-whole/", contents, rel)
            self.assertNotIn("/flow/", contents, rel)
            self.assertNotIn("/standards/", contents, rel)

    def test_history_keeps_generated_data(self):
        html = (self.site / "history" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="APPDATA"', html)
        self.assertIn('data-trust-version="2.1"', html)
        self.assertIn('property="og:url" content="https://traderhome-histroy.xyz/history/"', html)
        self.assertIn('content="https://traderhome-histroy.xyz/history/og.png"', html)
        data = json.loads(re.search(r'<script id="APPDATA"[^>]*>(.*?)</script>', html, re.S).group(1))
        self.assertNotIn("data:image/png;base64,", html)
        self.assertLess(len(html.encode()), 1_000_000)
        for theme in ("dark", "light"):
            for source in data["charts"][theme].values():
                self.assertTrue(source.startswith("./charts/"))
                chart = self.site / "history" / source
                self.assertTrue(chart.is_file(), source)
                self.assertTrue(chart.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))

    def test_market_simulation_is_public_readonly(self):
        page = (self.site / 'market-simulation/index.html').read_text()
        script = (self.site / 'market-simulation/workspace.js').read_text()
        self.assertIn('主流市场模拟分析', page)
        self.assertNotIn('<iframe', page)
        self.assertTrue(self.manifest['privacy']['marketSimulationLedgerPublished'])
        self.assertFalse(self.manifest['privacy']['marketSimulationCredentialsPublished'])
        self.assertFalse(self.manifest['privacy']['marketSimulationRealOrders'])
        self.assertIn('data/latest.json', script)
        self.assertIn("credentials:'omit'", script)
        self.assertNotIn("method:'POST'", script)
        for content in (page, script):
            for secret in ('OAI-Sites-Authorization', 'site_token', 'scheduler_secret', '/workspace/data', 'chatgpt.site'):
                self.assertNotIn(secret, content)
        self.assertTrue((self.site / 'market-simulation/model.mjs').exists())

    def test_history_replays_are_lazy_and_content_addressed(self):
        page = self.site / "history/index.html"
        html = page.read_text()
        data = json.loads(re.search(r'<script id="APPDATA"[^>]*>(.*?)</script>', html, re.S).group(1))
        for symbol, asset in data["assets"].items():
            descriptor = asset.get("replay")
            self.assertIsNotNone(descriptor, symbol)
            self.assertNotIn("bars", descriptor)
            payload = (page.parent / descriptor["url"]).read_bytes()
            snapshot = json.loads(payload)
            self.assertEqual(snapshot["symbol"], symbol)
            self.assertEqual(snapshot["asof"], asset["health"]["asofTimestamp"])
            self.assertIn(hashlib.sha256(payload).hexdigest()[:12], descriptor["url"])
            self.assertEqual(snapshot["current"]["end"], len(snapshot["current"]["bars"])-1)
            self.assertEqual(len(asset["profiles"]), 8 if symbol in {"BTC", "ETH"} else 4)
            for key, profile in asset["profiles"].items():
                self.assertNotIn("cases", profile)
                payload = (page.parent / profile["url"]).read_bytes()
                long = json.loads(payload)
                self.assertIn(hashlib.sha256(payload).hexdigest()[:12], profile["url"])
                self.assertEqual((long["symbol"], long["profileKey"], long["asof"], long["window"]),
                                 (symbol, key, profile["asof"], profile["window"]))
        for name in ("history-replay.js", "history-replay-model.js", "history-replay.css",
                     "vendor/lightweight-charts/lightweight-charts.standalone.production.js",
                     "vendor/lightweight-charts/LICENSE", "vendor/lightweight-charts/NOTICE"):
            self.assertTrue((page.parent / name).is_file(), name)
        self.assertNotIn('gate(analogSVG(a)', html)

    def test_private_review_ledger_is_not_published(self):
        self.assertFalse((self.site / "review" / "data" / "review-data.json").exists())
        manifest = json.loads((self.site / "traderhome-manifest.json").read_text())
        self.assertFalse(manifest["privacy"]["privateTradeLedgerPublished"])
        self.assertEqual(manifest["privacy"]["reviewRuntime"], "browser_local_with_optional_personal_data_hub")
        self.assertEqual(manifest["privacy"]["reviewDemo"], "optional_synthetic")

    def test_professional_product_contracts(self):
        manifest = json.loads((self.site / "traderhome-manifest.json").read_text())
        self.assertEqual(manifest["version"], 11)
        self.assertEqual(manifest["coreWorkflowVersion"], 4)
        self.assertEqual(set(manifest["productContracts"]), {"history", "review"})
        self.assertEqual(set(manifest["independentSystems"]), {"incomeos", "tailtrend", "dailyTrade", "otc", "marketSimulation"})
        self.assertNotIn("flow", manifest["productContracts"])
        self.assertNotIn("incomeos", manifest["productContracts"])
        self.assertFalse(manifest["independentSystems"]["incomeos"]["partOfCoreWorkflow"])
        self.assertFalse(manifest["independentSystems"]["tailtrend"]["partOfCoreWorkflow"])
        self.assertFalse(manifest["independentSystems"]["dailyTrade"]["partOfCoreWorkflow"])
        self.assertFalse(manifest["independentSystems"]["otc"]["partOfCoreWorkflow"])
        self.assertEqual(manifest["evidenceLabels"], ["DATA", "DERIVED", "FORWARD", "METHOD_DEMO"])
        home = (self.site / "index.html").read_text(encoding="utf-8")
        self.assertIn("输出契约", home)
        review = (self.site / "review" / "index.html").read_text(encoding="utf-8")
        self.assertIn("原始记录仅在本页内存处理", review)
        self.assertIn("查看完整教学案例", review)
        self.assertIn("连接自托管 API", review)
        self.assertIn("从券商读取", review)
        self.assertIn("Longbridge", review)
        self.assertIn("Binance", review)
        self.assertTrue((self.site / "assets" / "personal-data-hub.mjs").exists())

    def test_otc_public_history_contract(self):
        page = (self.site / "otc/index.html").read_text()
        for name in ("chart.css", "chart.mjs", "engine.mjs", "data/snapshot.json", "data/prices.json", "data/reference-prices.json"):
            self.assertTrue((self.site / "otc" / name).is_file())
        self.assertIn("研究用途，非投资建议", page)
        self.assertIn("https://traderhome-histroy.xyz/otc/", page)
        snapshot = json.loads((self.site / "otc/data/snapshot.json").read_text())
        self.assertEqual(snapshot["schema"], "traderhome_otc_daily_v1")
        self.assertEqual(snapshot["sourceMode"], "user_notion_with_authorized_reference_archive")
        self.assertFalse(any(snapshot["privacy"].values()))
        self.assertEqual(snapshot["recordCount"], sum(len(a["points"]) for a in snapshot["assets"]))
        self.assertEqual(snapshot["dataDate"], max(p["date"] for a in snapshot["assets"] for p in a["points"]))
        raw = json.dumps(snapshot, ensure_ascii=False)
        for disallowed in ("/Users/", "TRENDTRADER_API_KEY", "account_id", "api_secret"):
            self.assertNotIn(disallowed, raw)
        prices = json.loads((self.site / "otc/data/prices.json").read_text())
        reference = json.loads((self.site / "otc/data/reference-prices.json").read_text())
        self.assertEqual(prices["schema"], "traderhome_public_prices_v1")
        self.assertEqual(reference["schema"], "traderhome_reference_prices_v1")
        for bundle in (prices, reference):
            encoded = json.dumps(bundle)
            for forbidden in ("/Users/", "TRENDTRADER_API_KEY", "account_id", "api_secret", "access_token"):
                self.assertNotIn(forbidden, encoded)
            for row in bundle["assets"].values():
                bars = row.get("bars", [])
                if bars:
                    self.assertEqual(row["latestDate"], bars[-1]["date"])
                    self.assertEqual(len(bars), len({bar["date"] for bar in bars}))
        self.assertIn('id="priceMode"', page)
        self.assertIn('id="thresholds"', page)
        self.assertIn('href="/otc/"', (self.site / "index.html").read_text())
        self.assertIn('["otc", "/otc/", "场外日线"]', (self.site / "assets/traderhome-shell.js").read_text())
        self.assertFalse(self.manifest["privacy"]["otcAutomaticOrders"])

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
        # The per-page font/theme switcher was retired: every page shares the site design system.
        self.assertNotIn('data-font-scale=', page)
        self.assertNotIn('data-color-theme=', page)
        self.assertNotIn('io-global-controls', page)
        self.assertIn('id="incomeosTopbar"', page)
        self.assertIn('id="syncIbkrButton"', page)
        self.assertNotIn('class="io-appearance-control"', page)
        self.assertIn('id="operationHistoryRecords"', page)
        self.assertIn('id="historyArchive"', page)
        self.assertIn("每周重新找更好的组合", page)
        # One snapshot notice in the page header. Its static text is the safe reading if the
        # script never runs; the script replaces it with the edition of the published snapshot.
        self.assertEqual(page.count('id="snapshotStatus"'), 1)
        self.assertIn('<div class="th-notice" id="snapshotStatus" role="status"><b>研究展示，不是实时可执行行情</b>', page)
        self.assertNotIn('class="io-wrap io-status', page)
        for hook in ("reportTab", "reportTitle", "ordersTitle", "rankingSourceNote", "callSourceNote", "putSourceNote", "dataGaps", "dataSourceRows"):
            self.assertIn(f'id="{hook}"', page, hook)
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
        # Wording for editions, times and data gaps lives in one pure module (portal/test_site_display.mjs).
        display = (self.site / "incomeos" / "incomeos-display.mjs").read_text(encoding="utf-8")
        self.assertIn("研究版 · 不可执行", display)
        self.assertIn('from "./incomeos-display.mjs"', app)
        self.assertIn("renderExecutionFraming", app)
        self.assertIn("executionSnapshotAllowed", app)
        # Raw ISO timestamps and the per-symbol dump are no longer written straight into the page.
        self.assertNotIn("报价源时间：${", app)
        self.assertNotIn("生成于 ${data.asOf}", app)

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
        if snapshot.get("revision"):
            revision = snapshot["revision"]
            data_dir = self.site / "tailtrend" / "data"
            self.assertEqual(revision["kind"], "RETROSPECTIVE_RESEARCH_REVISION")
            self.assertEqual(revision["originalSnapshot"], f'snapshots/{snapshot["dataAsOf"]}.json')
            self.assertEqual(revision["file"], f'revisions/{snapshot["dataAsOf"]}-{snapshot["engineSourceHash"]}.json')
            original_bytes = (data_dir / revision["originalSnapshot"]).read_bytes()
            self.assertEqual(hashlib.sha256(original_bytes).hexdigest(), revision["originalSnapshotSha256"])
            self.assertEqual(daily["runAt"], revision["originalRunAt"])
            self.assertEqual(daily["engineSourceHash"], revision["originalEngineSourceHash"])
            self.assertNotEqual(daily["engineSourceHash"], snapshot["engineSourceHash"])
            self.assertNotIn("revision", daily)
            self.assertEqual(revision["revisedAt"], snapshot["runAt"])
            self.assertTrue(revision["historicalAuditUnchanged"])
            self.assertEqual(json.loads((data_dir / revision["file"]).read_text()), snapshot)
            self.assertEqual((data_dir / "latest.json").read_bytes(), (data_dir / "tailtrend-snapshot.json").read_bytes())
            self.assertEqual(snapshot["transitions"], [])
            self.assertTrue(all(row["change"] is None and row["prevState"] is None for row in snapshot["records"]))
            self.assertIn("事后新版研究重算，非当时信号", (self.site / "tailtrend" / "tailtrend-app.mjs").read_text())
            self.assertIn('<div id="ttRevisionNote" class="th-notice" role="status">', page)
            self.assertNotIn(snapshot["runAt"], page.split('id="ttRevisionNote"', 1)[1].split("</div>", 1)[0])
            self.assertIn("事后新版研究重算，非当时信号", page)
        else:
            self.assertEqual(daily, snapshot)
        audit = json.loads((self.site / "tailtrend" / "data" / "tailtrend-audit.json").read_text())
        self.assertEqual(audit["schema"], "traderhome_tailtrend_audit_v1")
        self.assertTrue(audit["activeEpochId"].startswith(daily["frameworkVersion"] + ":"))
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
