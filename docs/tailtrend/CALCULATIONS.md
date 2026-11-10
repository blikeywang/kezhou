# TailTrend 计算与状态机：实现规格

[返回 README](README.md) · 源码：[引擎](../../portal/vendor/tailtrend/tailtrend-engine.mjs)、[前端](../../portal/vendor/tailtrend/tailtrend-app.mjs)、[刷新器](../../tools/tailtrend/refresh.mjs)

基线与日期见 README。下文描述当前实现，研究意图和待补能力另行标明。金额默认 USD；所有百分号必须与内部小数区分。

## 1. 参数总表

| 配置名 | 值 | 用途 |
|---|---:|---|
| `tailLookback` | 60 | 当前日之前的区间 |
| `tailFraction` | 0.20 | 区间上下各 20% |
| `atrTailWidth` | 1.5 | ATR 尾部影子对照 |
| `atrPeriod` | 20 | Wilder ATR |
| `hvPeriod` | 20 | 对数收益标准差 |
| `hvRankLookback` | 252 | HV 排名最多使用的观测数 |
| `breakoutBufferAtr` | 0.25 | 突破/失败缓冲 |
| `breakoutHoldCloses` | 2 | 接受要求的合格收盘数 |
| `breakoutHoldWindow` | 3 | 从首次突破日起算的接受窗口 |
| `maximumTrendExtensionAtr` | 1.0 | 新趋势仓追入上限 |
| `lowerBoundaryStableSessions` | 5 | 已有下沿锁的稳定计数 |
| `structureResetAtr` | 1.0 | 下沿结构重置 |
| `structureLockMaxSessions` | 40 | 下沿锁年龄上限 |
| `gapQuarantineAtr` | 1.5 | 开盘跳空隔离，严格大于 |
| `eventQuarantineCalendarDays` | 2 | 财报隔离，包含 0 和 2 |
| `eventGapReserveMultiplier` | 2.5 | 已知事件的默认跳空准备金倍数 |
| `eventRiskLookaheadCalendarDays` | 10 | 上述倍数生效的日历日窗口 |

这些参数来自 `TAILTREND_CONFIG`。风险预算、20 日成交额、周线 EMA、10 日退出、排序加减分、前端时效阈值另写在相应函数中，不全在该配置对象内。`analyzeBars()` 没有通用 `params` 覆盖参数；改变规则需要改源码和研究版本。

## 2. 输入标准化与窗口

`normalizeBars(rows)` 接收数组：

- 日期按 `time ?? date ?? timestamp` 取值；优先取字符串前缀 `YYYY-MM-DD`，否则用 JavaScript `Date` 的 UTC 日期。不是交易所日历校验器。
- `open/high/low/close` 经 `Number` 转换；`null/undefined/""` 转为缺失。OHLC 必须有限，`close>0` 且 `high>=low`，否则整行丢弃。
- 同日多行以后出现的行为准，按日期升序输出；`volume/turnover` 可为 `null`。
- 当前未验证 `low<=open/close<=high`、完整日期合法性、交易日缺口、负成交量和所有 OHLC 均为正。
- 引擎最低有效根数是 `60+20+5=85`；网页导入门槛为 90；生产请求 360。85 根不保证已有 24 周或 252 个 HV 观测。

记当前日为 `t`，收盘 `C_t`，开/高/低为 `O_t/H_t/L_t`。常规尾部地图取 `t-60 … t-1`；ATR/HV/成交额取截至 `t` 已完成日线。逐日回放时必须只传入截至该日的前缀。

## 3. 指标公式

### 3.1 60 日地图

```text
RH = max(H[t-60:t-1])
RL = min(L[t-60:t-1])
W  = RH - RL
lowerTailTop    = RL + 0.20W
midpoint        = RL + 0.50W
upperTailBottom = RH - 0.20W
rangePositionPct = clamp((C_t-RL)/W, -0.25, 1.25) × 100
```

`W<=0` 时 `tailMapFromHistory` 返回 null；当前调用方没有完整的退化地图兜底。位置字段最多显示 -25%～125%；网页指示点再裁到 0%～100%。这是高低价幅度位置，不是分位数、统计尾概率、成交量分布或上涨概率。

`tailMap` 总是滚动地图。已有下沿锁时，状态理由、管理区使用锁定的 `signalMap`；二者可能不同，详情必须同时解释。

### 3.2 ATR(20)

```text
TR_0 = H_0-L_0
TR_t = max(H_t-L_t, |H_t-C_(t-1)|, |L_t-C_(t-1)|)
ATR_20 = mean(TR_1 … TR_20)              # 首值不包含 TR_0
ATR_t = (19×ATR_(t-1)+TR_t)/20
atrPct = 100×ATR_t/C_t
```

这是 Wilder 平滑，系数 1/20。不是普通 EMA 的 2/21。状态里的冻结 ATR 来自进入锁的当日 ATR；管理硬止损里的 0.25 ATR 通常使用当前 ATR，二者不能混用。

### 3.3 HV20 与历史百分位

```text
r_t = ln(C_t/C_(t-1))
HV_t = sample_std(r_(t-19)…r_t) × sqrt(252)
hv20 = 100×HV_t
rank = 100×(count(HV < HV_t) + 0.5×count(HV == HV_t))/N
```

标准差分母为 `n-1`。排名集合是最后最多 252 个有效 HV，**包含当前日**；缺失剔除、不足 252 个也照算，相等使用精确数值相等。`hv20` 是年化波动百分比，`hvPercentile` 是相对自身样本的百分位，两者含义不同。

### 3.4 周线环境

`weeklyRegime()` 按 ISO 周聚合，每周保留最后一根可见日线的收盘：

1. 少于 24 个周观测 → `UNKNOWN`。
2. 对周收盘做 EMA20；首值是前 20 周均值，此后系数 `2/21`。
3. 最新周收盘 > 当前 EMA，且当前 EMA > 4 周前 EMA → `UP`。
4. 最新周收盘 < 当前 EMA，且当前 EMA < 4 周前 EMA → `DOWN`。
5. 其余 → `RANGE`。

当前正在形成的周也参与计算。例如周三的快照包含周三收盘所代表的本周值，不能称为“仅用已完成周线”。

### 3.5 成交量、流动性、距离与事件

```text
volumeRatio = V_t / mean(最后20根中的有效volume)
averageTurnover20 = mean(最后20根中的有效turnover)
distanceToLowerTailAtr = (C_t-lowerTailTop)/ATR_t
distanceToUpperTailAtr = (upperTailBottom-C_t)/ATR_t
gapAtr = |O_t-C_(t-1)|/ATR_t
daysToEvent = round((eventDate-currentBarDate)/86400000)
```

均量/均额包含当前日，缺值跳过；字段名中的“20”不保证有 20 个有效值。流动性分档：均额 ≥1 亿为 HIGH，≥2000 万为 MEDIUM，更低为 LOW，无数据为 UNKNOWN。LOW 阻断研究新仓；UNKNOWN 本身不阻断，只在仓位计算里警告且停用容量上限。金额阈值按当前美股 USD 池解释，未实现多币种归一化。

`gapAtr>1.5` 或 `0<=daysToEvent<=2` → 事件隔离。两处采用当前收盘已知数据；不能直接挪到盘前策略中。事件日期差为日历日，不使用盘前/盘后时刻分流。

### 3.6 ATR 尾部影子对照

```text
d = min(1.5×ATR_t, 0.45W)
ATR下尾上界 = RL+d
ATR上尾下界 = RH-d
```

事件隔离、突破候选、趋势接受、突破失败、下沿破位直接沿用正式状态。其余按 ATR 边界重新判断触及收复/上沿拒绝/下沿下落/上沿/中部；收复额外要求 `L_t>=RL`。

这只是同日横向比较，没有独立的 ATR 锁、递推路径或收益回测，不能称为完整的第二策略。输出 `comparisonStates.{pct,atr}` 和 `atrTailMap.shadowOnly=true`，正式动作仍用百分比口径。

<a id="state-machine"></a>
## 4. 状态记忆与严格判断顺序

公开函数为 `analyzeBars(rows, options)`。`options` 支持 symbol/market/name/sector/cluster、eventDate、dataStatus、borrowVerified、previousState。

### 4.1 冷启动与递推

`stateMemory={version:1, lower:null, upper:null, trend:null}`。只有上一记录的 `tradingDate` 恰等于输入倒数第二根日期且有 `stateMemory`，才从该记忆推进一天；否则从输入数组第 60 个索引开始逐日冷回放，来源标记 `PREVIOUS_SNAPSHOT` / `COLD_REPLAY`。

该选择没有检查上一记录的 engine/params hash，也不检查其数据状态。输入历史的起点会影响冷启动；360 根滚动窗口不是固定 epoch，不能假定与更长历史回放相同。现有确定性测试只证明固定输入/固定规则下结果一致。

### 4.2 结构递推内部的优先级

`advanceStateMemory()` 按以下顺序，命中分支通常即返回：

1. **已有 trend**：计算此前 10 根低点；收盘严格跌破则清 trend、输出 `BREAKOUT_FAILED / TREND_TRAILING_EXIT`。否则保持 `TREND_ACCEPTED`，年龄加一。
2. **已有 upper**：更新年龄和确认数；先查失败线，再查接受，再查窗口超时，最后继续候选。
3. **已有 lower**：先查结构重置，再更新新低/稳定计数，再查当前地图破位，再查 40 日过期，再查收复，最后继续下落。
4. **没有活动记忆**：先查下沿破位，再查上沿突破，再查下沿锁定，再查当天触及收复。
5. 都没命中，结构结果为 null，由外层补上沿拒绝/上沿/中部。

### 4.3 下沿锁定与收复

新锁保存 `boundary=当时lowerTailTop`、当时 RL/RH、ATR、日期、`ageSessions=0`、`trackedLow=min(RL,L_t)`。如果当日创新低，`stableSessions=0`，否则为 1。

已有下沿锁：

- `C_t < locked.RL - 1×locked.ATR`：用截至当日、包含当日的最近 60 根重建地图和锁，输出下落。这个结构重置是收盘后重建例外，不是常规“当前日参与自身区间”。
- 否则若 `L_t<trackedLow`，更新 trackedLow、稳定数清零；没有新低则稳定数加一。稳定性看低点，不是看收盘。
- `C_t <= 当前滚动RL - 0.25×ATR_t`：输出破位，保留下沿记忆。
- `ageSessions>=40`：若仍触及/位于当前下尾，以当前常规地图重建；否则清锁。
- 其后需同时满足 `C_t>locked.boundary`、`C_t>O_t 或 C_t>C_(t-1)`、稳定数 ≥5 才收复。保存 `signalBoundary` 证据后清 `memory.lower`。

无活动锁时：

- `C_t<=lowerTailTop` → 建 lower 锁，输出下落。
- `L_t<=lowerTailTop` 且 `C_t>lowerTailTop` 且反转确认成立：若 `L_t<RL`，锁定并等待稳定；否则立即 `LOWER_TAIL_RECLAIMED / STABLE_MAP_RECLAIM`，不建立持续 lower 记忆，也不等待 5 日。

因此“所有收复都必须稳定 5 日”不符合实现。收复通常是一次状态事件，下一日可以回中部；系统没有实际持仓状态来决定是否继续持有。

### 4.4 上沿突破、接受、失败与伸展

首次 `C_t >= RH+0.25×ATR_t` 时建立 upper 锁，保存 `boundary=RH`、`threshold=RH+0.25×ATR_t`、锁定 ATR、日期，年龄 0，确认数 1。

后续日：

```text
ageSessions += 1
若 C_t > frozen.threshold，holdCloses += 1
若 C_t < frozen.boundary-0.25×frozen.ATR → BREAKOUT_FAILED，清 upper
否则若 holdCloses>=2 → TREND_ACCEPTED，upper 转 trend，清 upper
否则若 ageSessions>=2 → BREAKOUT_FAILED / ACCEPTANCE_WINDOW_EXPIRED
否则 → BREAKOUT_CANDIDATE
```

首日 `>=`，后续确认严格 `>`；总窗口是首次候选及其后两日，合格收盘不要求连续，不是无限滚动的任意三天。接受后确认数不继续累计，详情的“2/2”是当时接受证据。

```text
extensionAtr = (C_t-frozen.boundary)/frozen.ATR
overextended = state==TREND_ACCEPTED 且 extensionAtr>1
trailingExit = min(L_(t-10)…L_(t-1))
```

伸展阻断新仓，不清 trend；周线变化也不自动清 trend。trend 直到严格跌破此前 10 日低点才退出。当前没有“形成新平衡后自动重置趋势入场边界”的算法，因此很久以前的突破边界可能持续阻断新仓。

### 4.5 外层覆盖与其他状态

`analyzeBars()` 在完成结构递推后决定最终状态：

1. 事件/跳空隔离覆盖为 `EVENT_QUARANTINE`，**底层记忆已经推进，未被冻结**。
2. 若结构是 lower falling，且此前 20 日发生过破位、当日仍在当前下尾、收盘较昨收改善 → `DOWNTREND_COVER_ZONE`。
3. 否则使用结构状态。
4. 无结构状态且 `H_t>=upperTailBottom`、`C_t<upperTailBottom`、`C_t<O_t 或 C_t<C_(t-1)` → 上沿拒绝。
5. 否则 `C_t>=upperTailBottom` → 上沿决策区。
6. 其余 → 区间中部。

`recentBreakdown()` 向前最多 20 日找 `C_i<=当时RL-0.25×ATR_i`。资料不足在上述流程前已返回 `OBSERVE`。

## 5. 管理价位、止损与止盈

以下为 `managementFor()` 输出；下沿活动锁使用锁定 signalMap，其他通常用当前滚动地图。参考入场一律是当前收盘，不是已成交价。

| 状态 | 硬失效参考 | 其他管理字段 |
|---|---|---|
| 下沿收复 | `signalMap.RL - 0.25×当前ATR` | 第一中轴、第二上尾下界 |
| 突破候选/趋势接受 | `min(冻结突破边界, 包含当前日的近3根最低价) - 0.25×当前ATR` | 前 10 日低点退出；无自动固定盈利目标 |
| 上沿拒绝 | `max(H_t, RH)+0.25×当前ATR` | 第一中轴、第二下尾上界 |
| 下沿破位 | `RL+0.25×当前ATR` | 无第一/第二管理区 |
| 其他 | null | 通常展示中轴，仅观察 |

下沿文案“中轴减25%、上尾减50%、余25%仅在趋势接受后继续”是管理意图；趋势文案“下一高周期尾部减1/3”也只是说明。没有代码执行分批止盈、判断订单成交、跟踪实际剩余比例、计算下一高周期尾部或将核心持仓自动转换为趋势仓。

当前没有持仓级单调上移止损，也没有硬止损和收盘退出线的执行优先级服务。页面不应使用户理解为已经托管其止损；回放必须另写明确的执行时点、跳空成交与同日先后规则。

## 6. 复核优先级的全部构成

`priorityAnalysis()` 将分项求和、限制在 0～100 后四舍五入。缺 HV 按 50、缺量比按 1 作为排序默认。

| 状态 | 计算 |
|---|---|
| 下沿收复 | 56 + 周线(UP:+16, RANGE:+8) + `clamp(量比-1,0,1.5)×8` |
| 趋势接受 | 62 + 周线UP:+18 + `min(10,holdCloses×5)`；伸展>1ATR 再减22 |
| 突破候选 | 48 + 周线UP:+15 + `min(9,量比×4)` |
| 上沿拒绝/突破失败 | 55 + 周线(DOWN:+16, RANGE:+8) |
| 下沿破位 | 58 + 周线DOWN:+18 |
| 下沿下落/上沿决策/回补区 | 35 |
| 事件隔离 | 100，优先人工处理 |
| 中部/资料不足 | 0 |

有正分的状态若 HV>90 再减10，事件隔离除外。分项先保留 1 位小数，最终是这些分项的整数和。`priorityBreakdown` 逐项显示原因。

刷新排序先按桶：收复 → 趋势接受 → 突破候选 → 失败/拒绝 → 破位 → 事件 → 观察 → 中部；桶内按优先级降序、symbol 升序。默认详情则从 FRESH 且允许新仓的记录中取最高优先级，没有时退到 FRESH 非中部，最后才取第一行。

`summary.actionable=count(newPositionAllowed)`；`summary.blocked=count(blockers非空)`。后者不包含所有禁止新仓状态，二者不互补。首页“边缘候选”按指定六个桶计数，排除了 `EDGE_OBSERVE`，不等于 actionable。

<a id="risk"></a>
## 7. 压力仓位的实际公式

函数 `calculateRiskPlan(input)`。输入中的 drawdown/heat/cluster/dailyLoss 均为百分比数值，例如 `0.6` 表示 0.6%；内部 heat 等再除以 100。equity、entry、stop、gapReserve、slippageReserve 为金额。

### 7.1 模块和同源压力组

| module | 总想法基准 b | 本袖套 s | 预留 q |
|---|---:|---:|---:|
| `tail_core` | 0.004（0.40%） | 0.60 | 0.40 |
| `pure_trend` | 0.002（0.20%） | 1 | 0 |
| `us_short` | 0.0015（0.15%） | 1 | 0 |
| `event` | 0 | 0 | 0 |

- 回撤乘数：回撤<5% →1；[5%,8%) →0.5；[8%,10%) →0.25；≥10% →0。
- HV 乘数：HV排名<75 →1；[75,90] →0.75；>90 →0.5。HV缺失不自动否决，函数默认1。
- 周线乘数：纯趋势周线不是 UP →0；尾部多头周线 DOWN →0.5；美股空头周线 UP →0.5；其他 →1。

```text
groupA = min(mDrawdown, mHv, mWeekly)
wantedIdeaRisk = b×groupA
stressPerShare = |entry-stop| + gapReserve + slippageReserve
```

### 7.2 组合容量与分配顺序

```text
P = max(0, 0.0125-existingPortfolioHeatPct/100)
K = max(0, 0.006-clusterHeatPct/100)
liquidityCapShares = floor(0.01×averageTurnover20/entry)
Q = liquidityCapShares×stressPerShare / equity / s
finalIdeaRisk = min(wantedIdeaRisk, P, K, Q)
tradeRisk = finalIdeaRisk×s
reservedRisk = finalIdeaRisk×q
budgetedLoss = equity×tradeRisk
shares = floor(budgetedLoss/stressPerShare)
shares = min(shares, liquidityCapShares)       # 有流动性数据时
plannedLoss = shares×stressPerShare
positionValue = shares×entry
```

无有效均额时 Q=Infinity、股数不按均额裁剪，输出警告。容量先限制**整个想法**，再分 60/40；不是把0.24%先算成核心需求后才裁剪组合余额。这样在尾部模块容量紧张时仍给趋势预留份额。

组合正常上限1.25%、硬上限1.50%；同集群正常0.60%、硬上限0.75%。达到正常上限即没有新增容量，不能理解为可继续加到硬上限。没有持仓连接，已有热度/集群余额由用户输入，预留也没有跨记录自动占用或防重复的账户总账。

日内完整止损≥2次，或已实现亏损≥权益1% → Boolean熔断，`finalIdeaRisk=0`。这不是额外的小数乘数。

### 7.3 硬闸门

下列任一命中，最终股数强制0：无效权益/价格、entry=stop、模块与状态不匹配、状态不允许、数据状态不为 FRESH/LOCAL、事件未解除、做空资格未核验、record.blockers、回撤10%、周线趋势否决、日内熔断、容量用尽或不足1股。

网页总是传入 `signalGate` 并锁定模块下拉框。引擎 API 里的 signalGate 仍是可选项；其他调用方若省略，无法继承状态闸门，必须另行约束。价格检查目前没有强制“多头stop<entry、空头stop>entry”，只计算绝对距离。

`bindingConstraint` 优先级：熔断 → `circuit_breaker`；任何硬闸门 → `hard_gate`；否则取最小容量项。同值时保留先出现项（base/pressure、portfolio、cluster、liquidity）。

除行为熔断外，硬闸门不把展示用的 `tradeRiskPct/budgetedLoss` 全清零；`shares/plannedLoss/effectiveTradeRiskPct` 才为0。不能拿理论预算字段宣称获准新仓。

### 7.4 前端默认值与事件准备金

HTML 的 100,000 USD 权益和零回撤/零热度是示例值，不是读取了用户账户。滑点默认每股0.05；选择标的时填入其收盘、硬失效，跳空准备金为 `round(0.25×ATR×eventMultiplier,2)`。

已知事件距数据日0～10日时 eventMultiplier=2.5，否则1；0～2日另有事件硬阻断。用户可编辑准备金，引擎没有强制事件准备金下限。`holdingRule` 是风险前置说明，未自动读取持仓、减仓或下单。

### 7.5 已复算示例

用8月12日历史快照、上述100,000 USD示例、无已有风险、每股滑点0.05及前端默认跳空准备金：

| 标的 | 每股压力 | 本袖套预算 | 整股数 | 计划压力损失 | 最终约束 |
|---|---:|---:|---:|---:|---|
| DIA | 7.696 | 150.00 | 19 | 146.22 | pressure_group |
| COST | 53.428 | 120.00 | 2 | 106.86 | pressure_group |
| WMT | 11.620 | 120.00 | 10 | 116.20 | pressure_group |
| BAC | 10.095 | 理论200.00 | 0 | 0 | hard_gate |

COST/WMT 各还有80 USD想法风险预留。这是当时参数的算术例子；当前页面时效保护覆盖后全部不允许新仓。压力准备金是预算假设，无法保证真实跳空最大损失。

## 8. 审计中的 MFE/MAE、次日参考与漏判计数

`updateAuditLedger(previousLedger, records, latestBars, {updatedAt,epochId})` 是派生路径统计，不是成交回测。每个正式记录建立一个 `epochId:originDate:symbol` 唯一行，包括中部和被阻断候选；同日重跑不重复建行。

令 `p=原始提醒参考价`，来自 management.entryReference，缺失才用 close；后续每根日线：

```text
upPct   = (high-p)/p×100
downPct = (low-p)/p×100
LONG:  favorable=upPct,    adverse=downPct
SHORT: favorable=-downPct, adverse=-upPct
MFE = max(0, 所有favorable)
MAE = min(0, 所有adverse)
maxUpPct = max(0, 所有upPct)
maxDownPct = min(0, 所有downPct)
```

记录保留3位小数；sessions 等于新增可见日线条数。在第1/3/5/10根写入累计路径切片，之后 running 仍继续更新。OBSERVE 的MFE/MAE为空，保留maxUp/maxDown。

第一根可见未来日线的 open 写入 `nextTradableReference`；`slippagePct=(open-p)/p×100`，空头反号。它只是收盘到后续开盘的方向性价差，未使用 bid/ask、成交单或实际提醒可知时间，不能称为真实滑点。

每次仅消费 `date>originDate` 且 `date>lastObservedDate` 的条目。刷新器只传每标的最近20根日线；若停跑更久，中间缺失不会自动补齐，却仍按观察根数累计。因此1/3/5/10“交易日”需要连续性校验后才能成立。

网页“主动放弃后大幅运行”计数为：`direction==OBSERVE` 且 running 的最大绝对上下波动≥5%。它不覆盖所有被阻断的LONG/SHORT，也不限定10日窗口，不能直接当全策略漏判率。

账本保留所有 epoch 不截断；activeEpochId 控制当前计天。`manualOverride=null`、`gates.cluster=null` 是未实现入口，不代表已采集人工覆盖或账户风险审计。窗口MFE/MAE也没有考虑止损/止盈成交先后、手续费、分红、持仓权重或组合资金曲线。

## 9. 输出精度与实现定位

派生价格/ATR/管理线通常保留3位，ATR百分比/量比/跳空距离2位，HV年化1位、HV百分位整数，成交额整数；仓位股数向下取整，风险百分比3位、金额2位。核心状态先用未舍入值判定，之后输出；网页风险计算使用已发布的舍入值，临界复算可能有微小差异。

| 函数族 | 对应本页 |
|---|---|
| normalizeBars / trueRangeSeries / wilderAtrSeries / hvSeries / percentileRank / weeklyRegime | §2–3 |
| tailMapFromHistory / tailMapAt / tailMapEndingAt / atrTailComparison | §3、§4 |
| lowerLock / upperLock / advanceStateMemory / replayStateMemory / recentBreakdown | §4 |
| managementFor / stateExplanation | §5及状态解释文案 |
| priorityAnalysis / summarizeSnapshot | §6 |
| drawdownMultiplier / volatilityMultiplier / calculateRiskPlan | §7 |
| updateAuditLedger / 前端renderAudit | §8 |
| populateRisk / applySnapshotAge / 本地导入 | §7、[数据与运维说明](DATA_AND_OPERATIONS.md) |



## 0.3.1：结构收复与新仓资格分开

冻结下沿确认仍记录 `LOWER_TAIL_RECLAIMED` 和原锁定边界；它描述结构事件，
不保证当前价格还适合新开尾部核心仓。新增风险要求收盘严格低于
`min(冻结地图第一管理区, 当前滚动中轴, 当前滚动上尾下界)`；到达即阻断，
`entryEligibility` 记录限价及是否已延伸，`blockers` 明确只管理已有仓位。
不将已经越过的第一目标继续显示为尚待到达的下一条件；改为等待新的结构。
稳定不足五日仍等待，不因反弹进入区间中部就放行。

本次不改变结构确认、原始止损、目标或持仓退出规则。历史日快照不可重写；
新版未来生成结果使用 0.3.1 版本及已有引擎哈希审计 epoch，不将修正回填成历史收益。
