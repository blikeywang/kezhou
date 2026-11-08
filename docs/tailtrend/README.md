# TailTrend Lab：计算逻辑、数据来源与 Claude 接手 README

> 核对日期：2026-11-08（Asia/Singapore）
>
> 源码基线：[`478aa371a87d416e22e746cfe172d35860961808`](https://github.com/blikeywang/kezhou/commit/478aa371a87d416e22e746cfe172d35860961808)
>
> 引擎：`TAILTREND_CONFIG.version = 0.3.0`；站点：[TraderHome /tailtrend/](https://traderhome-histroy.xyz/tailtrend/)
>
> 本目录是 **TailTrend** 的维护交接，不覆盖刻舟求剑 corr/DTW、IncomeOS、场外指数或公开模拟盘的算法。

这份 README 从当前实现反推规格。接手时先读本页，再按任务打开下列文档；历史聊天与 8 月评审稿不能代替当前实现。

| 要解决的问题 | 阅读入口 |
|---|---|
| 为什么做这个系统、应该怎样分析结果 | 本页 |
| 每个指标怎么算、状态按什么顺序转换、股数怎么计算 | [CALCULATIONS.md](CALCULATIONS.md) |
| Longbridge 请求、数据字段、快照/审计结构、调度和部署 | [DATA_AND_OPERATIONS.md](DATA_AND_OPERATIONS.md) |
| Claude 从哪里开始、已知实现缺口、更新验收与优先级 | [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md) |
| 最初目标和两轮评审背景 | [历史交接稿](../TAILTREND_HANDOFF.md)、[v0.3 评审处理记录](../TAILTREND_REVIEW_RESPONSE_V03.md) |

## 1. 先确认当前真实状态

在上述源码基线中，最新 TailTrend 数据仍是 **2026-08-12 收盘**，生成于 `2026-08-13T07:25:32.531Z`。GitHub 仓库每天有新提交，不代表 TailTrend 每天取得新行情。

| 证据 | 当前值与含义 |
|---|---|
| [latest.json](../../portal/vendor/tailtrend/data/latest.json) | `dataAsOf=2026-08-12`、`status=COMPLETE`、30 个派生记录；这是历史快照 |
| [index.json](../../portal/vendor/tailtrend/data/index.json) | 仅 1 个日快照，`missingDates=[]`；不能据此推断之后没有缺跑 |
| [审计账本](../../portal/vendor/tailtrend/data/tailtrend-audit.json) | 活跃 epoch 1 日/30 条，另保留 legacy 30 条；总 60 条不等于 60 笔成交 |
| 快照绑定的代码 | `engineVersion=6eee6c0b9921dff8ab495ae3bbeca81c3d2f89c0`，不同于当前仓库 HEAD |
| 浏览器时效保护 | 加载时计算日龄，超过代码阈值即将全部行设为 `STALE`、禁止新仓 |
| 自动刷新代码 | 已有 [Mac 调度器](../../tools/scheduler/README.md)，本次只核对源码，未验证其在某台 Mac 上的安装和连续运行 |
| 有效性证据 | 无完成的 2–3 年回放、成本回测、walk-forward 或正期望结论 |

本次交接只补文档、复核现有测试和历史示例，没有运行行情刷新、重写历史快照、安装调度或更改参数。未来更新时重新读取上述文件，不把本节日期当作固定配置。

## 2. 分析思路与产品目标

起点来自用户的交易纪律：价格充分回撤后，只在下沿出现收复证据时研究做多；涨到上沿时管理已有仓位或观察拒绝；中间位置接受等待。趋势跟踪补充这套框架：突破旧区间后需要收盘确认，接受后允许趋势持续，退出依赖结构线。

它把以下问题依次处理：

1. **位置**：在前 60 日区间的下尾、中部、上尾，还是已突破？
2. **路径**：只是触及边缘，还是经历下跌后收复、突破后接受、失败或退出？
3. **环境**：周线方向、HV、流动性、财报或大跳空是否改变可承担风险？
4. **资格**：允许新仓吗？数据过期、接受未完成、过度伸展、做空未核验，都可能阻断。
5. **账户容量**：在风险预算、组合/集群余额和流动性约束下，最多能容纳多少整股？
6. **事后证据**：记录实际生成的状态及之后的价格路径，判断规则是否过早、过晚或主动放弃了哪些走势。

系统输出是条件式研究。`priority` 是人工复核顺序，`newPositionAllowed` 是状态层资格，`calculateRiskPlan().allowed` 是给定账户输入下的预算资格；这三者都不是胜率、收益预测或交易指令。当前不读取真实持仓，也没有成交和自动执行模块。

### 2.1 要保留的决策

- 日线正式收盘确认；当前日不进入自己的常规 60 日区间和此前 10 日退出线。
- 下沿下跌锁与上沿突破锁保存边界和 ATR，防止每天重新计算的地图改变确认目标。
- 核心反弹仓和趋势预留属于同一交易想法，合计预算受到限制。
- 状态桶各自有含义，优先级只排复核顺序；不合成一个所谓全市场胜率总分。
- 现金和主动放弃是允许的结果。不能因 SPXC 某次反弹很好看就临时改中部规则。
- 公开网站只接收派生快照；账户表单在浏览器内存计算，行情认证留在可信机器。
- 没有样本外证据前，维持固定参数、30 标的研究池及关闭的盘中探针。

### 2.2 已知会遗漏的行情

V 型急弹可能直接穿过下沿确认区；无回踩突破可能很快超过 1 ATR 的追入上限；慢趋势可能长时间处于区间中部；阶梯式下跌会产生反复反弹；事件跳空可能越过所有预算假设。先记录这些路径的频率、幅度与成本，再判断是否增加状态。新增状态之前，应明确与现有状态的优先级、互斥关系、风险容量与退出规则。

## 3. 状态怎样读

| 状态 | 含义 | 新仓资格的起点 |
|---|---|---|
| `OBSERVE` | 有效数据不足 | 不允许 |
| `LOWER_TAIL_FALLING` | 下沿仍未满足收复条件 | 不允许 |
| `LOWER_TAIL_RECLAIMED` | 下沿收复 | 可研究尾部多头，仍需硬闸门和账户预算 |
| `RANGE_MIDDLE` | 区间中部 | 不允许 |
| `UPPER_TAIL_DECISION` | 上沿决策区 | 不允许；管理已有仓位，等突破或拒绝 |
| `BREAKOUT_CANDIDATE` | 突破出现，接受未完成 | 不允许 |
| `TREND_ACCEPTED` | 接受成立且趋势记忆持续 | 可研究趋势多头；周线非 UP 或过度伸展仍阻断 |
| `BREAKOUT_FAILED` | 突破失败、接受超时或趋势触发退出 | 不允许；不自动转为空头 |
| `UPPER_TAIL_REJECTED` | 上尾触及后收盘拒绝 | 仅美股可研究空头，借券等资格须通过 |
| `LOWER_TAIL_BREAKDOWN` | 下沿缓冲被跌破 | 同上，且需处理原有多头 |
| `DOWNTREND_COVER_ZONE` | 近期破位后回到下尾附近改善 | 不允许；只提示空头管理 |
| `EVENT_QUARANTINE` | 财报临近或开盘缺口过大 | 不允许普通仓位公式 |

所有价格线、比较运算符和转换顺序见 [完整状态机](CALCULATIONS.md#state-machine)。特别注意：未形成下跌锁、当天未创新区间低点的触及收复，有一条立即确认路径；它不等待 5 日。这是当前代码行为。

## 4. 用已有快照理解结果

以下均为 **2026-08-12 历史状态**，只用于复算和理解，不是当前市场判断。

| 标的 | 历史观察 | 分析方式 |
|---|---|---|
| DIA | 收盘 537.150；冻结突破线 533.964；周线 UP；HV p82 | 趋势接受，但波动乘数为 0.75；趋势状态成立和风险缩小可以同时发生 |
| COST | 收盘 949.575；冻结下沿 943.556；稳定 6 日；周线 DOWN | 属于反弹候选，周线使压力乘数降到 0.5；不是已确认长期底部 |
| WMT | 收盘 116.010；下沿 112.463；`STABLE_MAP_RECLAIM` | 当天触及既有下尾并收回、未创新区间低点；走无活动锁的收复分支 |
| BAC | 趋势接受，但原突破边界 55.305，收盘 64.810 | 超过冻结 ATR 伸展上限，新仓被阻断；不否认原趋势仍在持续 |
| TSLA | 收盘 327.510，冻结下沿 343.268 | 滚动地图位置改善不等于已收复冻结线，仍等待 |
| SPXC | 60 日位置 48.2%，HV p98 | 处于中部；即使此前大跌反弹，也不据该段历史追入 |

该日计数是下沿收复 2、趋势接受 7、上沿拒绝 1、边缘观察 6、中部 14；只有 DIA/COST/WMT 通过当时状态级闸门。现在加载时，前端过期保护会覆盖全部新仓资格。

日常阅读顺序：数据日/过期提示 → 状态桶 → `stateReason` → `nextCondition` → `blockers` → 账户预算 → 审计结果。`blockers=[]` 也可能是中部或观察态；必须同时读 `newPositionAllowed`。

## 5. 源码导航

| 文件 | 真正负责的事情 |
|---|---|
| [tailtrend-engine.mjs](../../portal/vendor/tailtrend/tailtrend-engine.mjs) | 数据标准化、ATR/HV/周线、状态递推、管理价位、排序、风险、审计路径、汇总 |
| [refresh.mjs](../../tools/tailtrend/refresh.mjs) | Longbridge 请求、事件解析、日期对齐、版本信息、状态比较、发布文件与审计后续观测 |
| [snapshot-store.mjs](../../tools/tailtrend/snapshot-store.mjs) | 稳定哈希、日快照独占创建、MISSING、index/latest |
| [universe.json](../../tools/tailtrend/universe.json) | 30 标的、人工行业/集群标签、角色 |
| [tailtrend-app.mjs](../../portal/vendor/tailtrend/tailtrend-app.mjs) | 读取 JSON、时效覆盖、表格/详情、仓位表单、本地配置和 K 线导入 |
| [index.html](../../portal/vendor/tailtrend/index.html)、[tailtrend.css](../../portal/vendor/tailtrend/tailtrend.css) | 产品结构、示例账户默认值、桌面/移动端表现 |
| [build_site.py](../../portal/build_site.py) | 同域静态构建、共享导航、无 JS 表格、全站新鲜度清单 |
| [test_tailtrend_engine.mjs](../../portal/test_tailtrend_engine.mjs) | 当前 28 项指标、状态、风险、账本和存储测试 |
| [refresh-runner.mjs](../../tools/scheduler/refresh-runner.mjs) | 可信 Mac 调度与专用 clone 的测试、提交和推送 |
| [daily.yml](../../.github/workflows/daily.yml)、[pages.yml](../../.github/workflows/pages.yml) | 全站其他数据日更及统一 Pages 发布；均不执行 Longbridge TailTrend 抓取 |

## 6. Claude 的第一轮工作

先核对 [已知缺口](CLAUDE_HANDOFF.md#known-gaps)，尤其是数据时效、事件缺失、重跑/epoch、20 根审计观测截断及调度对失败快照的处理。恢复真实数据链路并补齐对应测试，再开始新的连续影子观察。

第二步建立与日线引擎共享代码、明确起点和数据版本的 2–3 年逐日回放。保留公司行动、费用、滑点、事件可知时间及样本外切分；历史重建单独存储，不能伪装成当时已运行的影子记录。之后才讨论尾宽对照、参数或扩池。

可直接把下面这段发给 Claude：

```text
请从 blikeywang/kezhou 的最新 main 开始，先阅读 docs/tailtrend/README.md，
再阅读 CALCULATIONS.md、DATA_AND_OPERATIONS.md、CLAUDE_HANDOFF.md。
以源码与明确的版本/数据日为准。先给出当前数据链路和已知缺口的核对结果，
按交接清单推进更新；修改算法时补边界测试并建立新研究版本，保留旧日快照。
该系统仍处影子研究阶段，未完成收益回测；自动下单不在当前功能范围内。
```
