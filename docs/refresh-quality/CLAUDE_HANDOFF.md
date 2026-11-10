# TailTrend / IncomeOS 数据质量接手说明

日期：2026-11-10。范围：研究数据与网页；不连接真实交易，不改变模拟撮合、保护退出或定时规则。

## 代码入口

- TailTrend：`tools/tailtrend/refresh.mjs` → `portal/vendor/tailtrend/tailtrend-engine.mjs` → `snapshot-store.mjs`；发布检查 `publication-quality.mjs`。
- IncomeOS：`tools/incomeos/refresh.mjs --no-archive` → `build-research.mjs` → `enrich-execution.mjs` → `enrich-options.mjs`；质量检查 `data-quality.mjs`。默认不加 `--no-archive` 会追加操作单，研究测试必须显式使用该参数。
- 既有 Mac runner：`tools/scheduler/refresh-runner.mjs`。此源码存在不代表已安装或成功定时运行。本次不安装、不新增调度。

## 输入、计算与输出

TailTrend 使用已有本地 Longbridge 私密认证获取30标的360根前复权正常交易时段日线、静态资料与21日事件日历。引擎计算结构状态、冻结边界、ATR/HV/周线与风险诊断。只允许发布派生快照，不发布原始OHLCV或账户数据。历史 `snapshots/*.json` 不可修改/删除；缺跑明确MISSING，不补造过去信号。

IncomeOS 使用71资产报价与估值指标、前复权月线、财务报告/预期/共识和估值历史，计算研究排名与组合，再补执行代理和期权链/深度。逐个财务接口独立捕获失败，成功项不会因另一个失败丢失。缺少基本面/预期明确标记。生成时间 `asOf` 不等于数据源时间。`tradingDate` 是完整SPY正常时段日柱的参考交易日，不证明所有报价新鲜；每个资产须另查 `sourceTimestamp`。

## 硬门禁

- TailTrend：预期完整交易日一致，30个唯一标的全部FRESH，健康字段无错误/缓存/过期/缺失，事件日历响应结构有效且无分页/截断，完整覆盖请求标的。持久化后须COMPLETE。发布前再次检查历史文件哈希。
- IncomeOS：参考交易日、资产覆盖、来源时间、期权覆盖、双边市场、期权事件日历和报价/深度各自来源时间均重新验证。缺失、过期、未来时间、不完整数据均不得标记live或自动发布。
- 人工 `--force` 不绕过门禁；成功push只记录“已推送”，不冒充部署及网页读回验证。

## 明确缺口

实测Longbridge普通quote响应没有来源时间；期权quote有时间，但depth仅含bids/asks/symbol，没有深度来源时间。严禁将抓取时间或成交quote时间当作盘口时间。当前这种输入应partial并阻断自动发布；可用于明确注明限制的离线研究，不可称实时可执行盘口。

本地交易日历覆盖2026–2027，超界失败关闭；需在到期前核实官方新日历。事件日历成功响应代表该次接口覆盖，不保证供应商本身绝无遗漏。旧同日不可变快照缺新门禁元数据时不得静默覆盖；应等待新日快照或设计明确版本迁移。

Mac关闭/睡眠/断网会影响本地数据获取。尚需真实定时触发、push、部署和网页JSON读回才能验收持续更新。不要为了UI整洁隐藏partial/缺失/过期信息，或降低门禁以让任务“变绿”。

## 测试

```
node --test portal/test_*.mjs tools/incomeos/test_data_quality.mjs tools/tailtrend/test_publication_quality.mjs tools/scheduler/test_refresh_runner.mjs
python3 -m unittest portal.test_portal
```

合并前已通过158项Node与11项门户Python测试。测试夹具不能替代一次真实行情刷新，手动刷新也不能冒充定时触发。新质量测试已纳入既有daily CI；cron和模拟撮合未修改。

## 一期实测与供应商契约（2026-11-10）

Longbridge财报日历会返回所选标的的下一次事件，即使合法事件超过请求的end。先验证事件symbol、真实日期、非过去日期、分页与原始条数；保留合法未来事件，由TailTrend窗口选择和IncomeOS到期比较决定是否适用。`next_date`非空仍视为未取全并阻断，不能先过滤窗外记录再计算截断。此兼容修正经过独立审查。

参考2026-11-09完整交易日的一期隔离测试：TailTrend30/30新鲜、COMPLETE、错误0；8月12日旧快照未改，后续漏跑明确MISSING。IncomeOS71价格/71基本面/71预期，18标的期权双边市场及日历校验完成；但71现货报价缺来源时间，36个期权盘口缺深度来源时间，MRK/AMZN共识接口失败，故仍partial且禁止自动发布。AVGO/COST/NVDA/MU期权因到期前财报标记WAIT_EARNINGS，而不是可交易信号。

兼容修正后全套Node160/160通过；此前门户Python11/11通过。这些是手动隔离测试，不是定时触发回执。本期候选行情未随源码上传或发布，不能据此声称网页行情已更新。先完整验证，再确定是否启用任何新定时；本次没有创建或修改定时。

## 用户另行授权的正式 TailTrend 数据发布

2026-11-10，用户明确同意发布最新验证通过的TailTrend派生结果。随后从干净main `96be950` 重新获取并校验，而非直接使用先前临时测试文件：

- 最新完整美股交易日：2026-11-09；生成时间：2026-11-10T03:15:09.840Z。
- 30/30 FRESH、COMPLETE，缓存/过期/缺失/错误均0；30标的事件日历验证通过。
- 原2026-08-12不可变快照逐字不变；2026-08-13至2026-11-06共61个漏跑交易日明确MISSING，不补造信号或收益。
- 仅发布 `portal/vendor/tailtrend/data/` 派生JSON；不含原始OHLCV、账户、凭证，不发送订单。
- IncomeOS本次不发布，继续保留源时间缺失阻断。不能把其旧历史快照或有bid/ask的无时间盘口当作最新实时行情。
- 未新建或修改任何定时；本次是明确授权的人工端到端验收，不是定时成功证据。

Claude后续可整理UI和代码，但须保留缺失/过期/partial提示、冻结历史和数据门禁；移动模块路径须同步验证import与现有CI。请先读本说明和两个模块的计算文档，再改界面，不将“可复核研究候选”改名为“可自动执行交易”。正式网页及日戳应从[页面](https://traderhome-histroy.xyz/tailtrend/)与[latest.json](https://traderhome-histroy.xyz/tailtrend/data/latest.json)核验，部署结果查看[现有Pages工作流](https://github.com/blikeywang/kezhou/actions/workflows/pages.yml)。

## IncomeOS explicit manual research channel (2026-11-10)

- User requested a current research result for feedback, not a live executable signal. `refresh.mjs --no-archive` performs the existing 71-asset scan, fundamentals/history/expectations, rankings, portfolio weights and 18-option-pair enrichment. `prepare-research.mjs --manual-research` is a separate opt-in display step, never called by the automatic refresh runner.
- Display eligibility is NOT live eligibility: `mode=partial`, `publicationMode=research_partial`, `executionAllowed=false`, `dataQuality.publicationReady=false`. The separate `researchPublicationReady` flag only means the explicit manual research output can be shown. Live publication errors remain intact.
- All 71 original symbols must remain visible with finite positive price and valid history length. Missing source timestamps stay null; `asOf`, `retrievedAt`, and `researchPreparedAt` are computation/retrieval times, never market-source timestamps. Future source timestamps block even research publication. Quotes and depth have separate disclosures. Financial report period is not a verified release timestamp; expectations, market-temperature and monthly forming-period limitations remain visible.
- Original model options conditions remain `researchAction` for explanation only. Public action is `RESEARCH_ONLY`; public evaluation and plan entrypoints deny execution by default. No dollar/whole-share/put order sheet is generated. Partial or missing execution flags cannot append operation-history. Historical records remain historical, not current advice.
- The SPYM execution-proxy quote now uses actual `sourceTime(quote)` or null, rather than falsely using fetch time. Retrieval time is recorded separately.
- Source map: `tools/incomeos/research-publication.mjs` (validation and disclosures), `prepare-research.mjs` (manual-only conversion), `data-quality.mjs` (unchanged strict live checks), `portal/vendor/incomeos/incomeos-engine.mjs` (math plus default-deny public execution boundary), `incomeos-app.mjs` / `index.html` (research labels and no-order presentation). `test_research_publication.mjs` covers explicit manual opt-in, universe integrity, invalid/missing/future timestamps, history validation and execution denial.
- Pure portfolio weighting and hypothetical allocation calculations are not proof of executable orders or realized income. Annualized premiums remain snapshot proxies, not realized returns. UI refactoring must preserve all these labels and independent source timestamps.
- No new schedule, no broker operation, no simulation matching change, no reconstructed missing history. Production receipts belong in the release record after deployment verification, not merely after saving this document.

### Research candidate verification receipt

Fresh fetch generated `2026-11-10T05:32:21.593Z`, reference closed session `2026-11-09`, manually prepared `05:34:57.346Z`. 71 assets and 18 option pairs retained; 71 asset quote timestamps, SPYM quote timestamp and 36 depth timestamps unavailable. Option quote source times are 2026-11-09 21:00/21:15 UTC and are not depth timestamps. MSFT consensus, NFLX forecast and UNH financial requests failed; UNH fundamentals remain missing. 167 Node tests and 11 portal tests passed. Both dollar and whole-share renderAll DOM-stub smoke checks passed, with no order output and visible source-time gaps. Operation-history unchanged. Deployment verification remains separate from this candidate receipt.
