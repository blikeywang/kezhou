# IncomeOS weekly refresh

Run from the TraderHome repository root:

```bash
node tools/incomeos/refresh.mjs
node --test portal/test_incomeos_engine.mjs
python3 -m unittest portal.test_portal
```

The refresh scans 71 assets, selects the current investable Top 50, builds the constrained portfolio, refreshes the SPYM whole-share execution proxy, enriches the highest-ranked and benchmark assets with 28–49 DTE Call/Put data, then upserts that day's model action sheet into `operation-history.json`.

It requires an authenticated local Longbridge CLI session. Credentials are never written into the repository or the published site. GitHub Actions therefore validates and deploys the committed snapshot but does not fetch private Longbridge data itself.

The intended schedule is Friday 10:00 America/New_York. `tools/scheduler/` runs it automatically on the owner's Mac: a research-only refresh (`refresh.mjs --no-archive`) after the last US trading session of each week, and the full refresh with the Friday archive between 10:00 and 15:30 ET. The resulting `portal/vendor/incomeos/data/incomeos-full.json` and `portal/vendor/incomeos/data/operation-history.json` must be reviewed, tested, committed, and pushed before they become live. Historical records are model snapshots, not claims of completed IBKR trades.

### 定时研究发布与执行隔离

`incomeos-research` 可以发布带完整质量披露的 `research_partial` 快照，但必须保留原 71 资产、有效价格与历史、最近已完成交易日及三个阶段的真实新取数证据。缺失行情来源时间不会被抓取时间替代。所有此类快照固定 `executionAllowed=false`，不生成可执行计划，不写入 operation-history。周五操作单仍须通过原完整来源/期权/事件门禁；不能用周末补跑冒充周五运行。
