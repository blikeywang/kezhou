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
