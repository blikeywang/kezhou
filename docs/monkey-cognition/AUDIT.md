# 实现核对、验证与待办

核对日：2026-11-08，Asia/Singapore。范围为“猴认知分析”的核心日常流程、S1 研究工具、场外展示模块及本次 S2 图片分析方法；没有重新实现/修改交易逻辑，没有生成今日交易判断。

## 1. 已核对的实现

| 模块 | 入口 | 文档对应 |
|---|---|---|
| 导入/数量/新鲜度/覆盖校验 | `daily_trade.py`、`sync_claude_sources.mjs` | DATA_SOURCES、CLAUDE_HANDOFF |
| 趋势元数据、tmId缓存、限额 | `daily_trade.py::TrendTraderClient/collect_trend` | DATA_SOURCES |
| 三项支持、反向ETF、Buy/Sell排序 | `daily_trade.py::score_signal/build_morning_report` | CALCULATIONS §1 |
| 场外节点、历史回看、条件计划 | `outputs/otc-chart/build_snapshot.py`、`site/engine.mjs` | CALCULATIONS §2 |
| 冲浪结构、连续出现、后续守位 | `s1_surf_filter.py` | CALCULATIONS §3 |
| 13买点扫描、降级、当前门控 | `sync_entry_points.ts` 和 `daily_trade.py` | CALCULATIONS §4 |
| IV/HV、异常、Greeks、逐笔、OI | `collect_longbridge_options.py` | CALCULATIONS §5–7 |
| 信号后价格响应、时序和分阶段证据 | `s1_forced_flow.py` | CALCULATIONS §8 |
| 风险开关与预算 | `daily_trade.py` | CALCULATIONS §9、11 |
| 私有账户风险纯计算 | `collect_okx_account.py` | CALCULATIONS §10 |
| 展示层权重、方向、新鲜度与熵 | `build_mobile_snapshot.py` | CALCULATIONS §12 |
| 一股回测、资金/佣金模型 | `backtest_s1_one_share.py`、`analyze_s1_*` | CALCULATIONS §13 |
| 工作簿、独立公开价格、发布白名单 | `build_history_workbook.mjs`、场外工具、发布脚本 | CALCULATIONS §14、运行手册 |

函数和文件指纹见 [SOURCE_INDEX.json](SOURCE_INDEX.json)。源码路径是本地项目相对路径，不冒充 GitHub `kezhou` 已包含这些可执行文件。`outputs/` 中历史发布 clone、预览副本、一次性回填脚本不作为当前算法真源。外部 13 买点内核和供应商私有模型不在本次内部算法核对范围。

## 2. 实际验证

- 环境：Python **3.13.2**；Node.js **v22.23.1**。
- `python3 -B -m unittest discover -s tests -v`：**40 项通过**。覆盖方向计分、反向ETF、缺失降级、实际期权优先、宏观风险、当前L1门控、冲浪结构和快照确认、forced-flow时序、账户风险纯计算等。
- 已生成32个源码/配置/规则文件指纹；Python AST和4份JavaScript语法检查通过，TypeScript外部环境未运行。文档链接、发布白名单与凭据模式检查见 [VERIFICATION.json](VERIFICATION.json)，不替代线上接口测试。
- 38张S2图片按对话建立文件名/日期索引；原临时路径均已不可访问，**没有生成图片哈希，也未归档原图**。保留明确缺失状态，不伪造校验通过。
- 未执行：今日数据 `validate`、行情/账户采集、付费快照、外部13买点扫描、工作簿生成、网页构建、端到端交易研究回放、定时任务检查或部署。

本次任务是交接文档，测试通过不表示供应商可用、所有数据最新、参数有预测效力或代码没有其他缺陷。特别是 `tests/` 尚无覆盖完整期权采集链和移动端全部派生状态的端到端测试。

## 3. 代码与旧说明的差异、维护顺序

| 优先级 | 当前事实 | 接手处理 |
|---|---|---|
| 高 | 旧流程描述“两项支持”，当前加入标的冷热，最高三支持 | 使用本包三项公式；后续正式修改旧 WORKFLOW 时保留变更记录 |
| 高 | `morning/us-session/evening` 成功退出可能仍有校验/采集失败或缓存回退 | 独立检查 validate、attempt状态与报告警告，不靠 exit 0 判健康 |
| 高 | 移动端 Desk `direction=-1`、部分 headline 是固定叙事 | 改成有日期的结构化输入/证据驱动后再称自动解读；本次没有改业务代码 |
| 高 | 移动端 FOP P/C 空集合可能得到0，再映射+.5；日期取多源最大值 | 分别处理 missing 和每一路新鲜度，不能把展示总相位当交易结论 |
| 高 | `age_status` 可能把未来日期视为最新，business-age只排周末 | 增补未来日期拒绝和交易所日历；历史复核需冻结时点 |
| 高 | `--date` 不自动截断 latest 输入；移动端 anchor 可能来自旧status更新时间 | 区分报告标签、真实当前日与point-in-time输入，禁止前视回测 |
| 高 | SPCX聚合统计存在复用ticker身份问题，配置已排除 | 保持排除，拿到供应商身份修复证据后才讨论恢复 |
| 中 | 宏观/季度capex各叶子项未全部统一执行freshness硬门控 | 逐路核对实际观察日，不把配置存在等于已严守时效 |
| 中 | OI对照按快照匹配，报价/报告日不必等于OI结算日 | 输出实际OI日期与可比覆盖，首次只建立基线 |
| 中 | S2图片无事件ID/时间，重复合约记录不能直接合并累加 | 人工确认或保留观察记录；未来OCR必须保留来源、重复组与置信度 |
| 中 | 13买点依赖外部源码；潜力区/场外定级部分仍人工 | 在运行环境中核实依赖和版本，不承诺仅clone文档即可全自动运行 |
| 中 | 本地`.gitignore`不是充分的公开数据边界 | GitHub仅提交明确文档白名单；不整体上传data/reports/outputs |
| 中 | 回测费用字段`net_pnl_10bps`名固定，费率参数可改；资金脚本有历史固定叙事 | 同时读取参数和实际样本统计，更新报告模板再扩充结论 |

风险阈值的来源也要分层：FRED/Fed/财报是事实数据；`config/workflow.json.market_risk_watch.logic_source` 记录的外部视频是启发式框架来源；准备金、估值、佣金等代码阈值并非本次重新核实的官方实时规则。公开宏观数据和个人分析框架不能混称一个官方预测模型。

## 4. 发布约定

目标为 `blikeywang/kezhou`，新增 `docs/monkey-cognition/`，根 README 追加入口。完整本地项目不迁移，不修改网站UI或调度，不随文档上传原图/账户/付费原文/券商原始行情。提交应保留原仓库树，用最新main作为父提交；分支发生并行变动时重读并重建，不force push。

核对期间本地根 README 出现另一份并行维护的完整交接说明，包含不同发布目标。本次保留它，只加本包入口；本包以用户在本对话指定的 **kezhou** 为目标，不把其他任务的目标当成授权。源码索引中的根 README 哈希仅用于标识当时本地状态。

每次续更至少记录：核对日、实际改动文件、配置/公式变化、已运行和未运行检查、影响的数据日、远端提交链接。数据状态更新与算法版本更新分别记录。

研究用途，非投资建议。
