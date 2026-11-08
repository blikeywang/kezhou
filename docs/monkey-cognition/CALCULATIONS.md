# 计算逻辑与分析口径

基准：2026-11-08 工作区源码。配置以 `config/workflow.json` 为准，函数位置和哈希见 [SOURCE_INDEX.json](SOURCE_INDEX.json)。本文件描述代码中的计算及人工研究规则，不把经验阈值称为官方标准或统计验证后的胜率。

统一记号：`clip(x)=min(1,max(0,x))`；价格为同一标的、币种、复权和交易时段；百分比与小数分开；分母为零、数据不足或单位未知时输出缺失。下文 `S` 是标的价格，`K` 是行权价，`OI` 是未平仓量，`IV` 默认小数年化波动率。

## 1. 方向支持分：最多三项

代码：`daily_trade.py::alignment/score_signal/build_morning_report`。

冷热映射：沸/热/温 → `+1`，平 → `0`，凉/寒 → `−1`。`alignment(source, action)`：与 Buy/Sell 同向 `+1`，反向 `−1`，未知/中性 `0`。

```text
support = 标的冷热对证券动作的 alignment
        + 大类冷热对经济敞口的 alignment
        + 场外板块/允许的市场背景对经济敞口的 alignment
```

| 支持和 | 分类 |
|---|---|
| 3 | 三支持 |
| 2 | 双支持 |
| 1 | 单支持 |
| 0 | 待确认 |
| <0 | 背离/降级 |

反向 ETF 的证券 Buy 仍是 Buy；配置/备注识别为反向纳指等时，其大类/场外经济敞口按 Sell 对齐。不能把买入反向产品当成看多指数。缺直接覆盖的 Sell 不能仅因大类偏冷就自动确认；直接覆盖由板块、标的冷热或已识别反向敞口提供。场外板块优先，市场背景回退用于 Buy。明确过期、失败、缺失的场外输入不计支持。

Buy 排序先按冲浪状态，再支持分、代码逆序；确认形态优先于形成中/价格待确认，后者优先于非冲浪和缺失。Sell 按支持分、代码逆序。正分各取前 15；负分另列背离，零分另列待确认。**冲浪分和期权分不加到支持分。** 旧 WORKFLOW 中的“两项支持”已不足以描述当前三项实现。

## 2. 场外周期、节点和潜力区

代码：`outputs/otc-chart/build_snapshot.py`、`site/engine.mjs`；历史方法说明来自 `build_history_workbook.mjs::defaultMethods`。上游场外指数本身并非本项目计算。

### 历史质量的人工规则

- 进场周期：以爆破从 200 上方跌回 200 下方为节点，比较同周期相邻节点场外值。持续上升支持较好质量，持平/下降需要降级；单节点可与进场首日比。超过一周无节点、均值不增是人工复核项。
- 退场周期：以爆破负转正为节点，场外节点值持续下降支持较好的做空周期质量；负转正同时提示反弹风险，不能据此追空。
- 优质、偏优、待定、存疑、劣质是周期研究标签，不是基本面评级或每日涨跌评级。**当前图表读取既有 CSV 的质量标签，并未完整自动实现上述人工定级。**

### 图表实际代码

只在相邻**自然日**、相同 `sourceKind`、相同周期内确认节点：进场 `prev.burst > 200 && burst < 200`；退场 `prev.burst < 0 && burst > 0`。恰好等于阈值不满足这里的严格跨越。缺日或来源切换时只保留候选/未确认节点；周五到周一也不算相邻自然日。

另有普通阈值事件：`prev.otc >= 1000 && otc < 1000`，或 `prev.burst >= 200 && burst < 200`。它们和周期质量节点条件不同；阈值穿越不自动升级质量。

原页 Δ 与前一条可用记录差额相差超过 **0.11** 时标告警，保留原值和 `deltaReferenceDate/deltaDays`。参考档案只在同源前值存在时算差额，不冒充跨缺口的一日变化。

图表 `tier` 按顺序判断：

1. 进场 + 优质 + 场外 ≥1000 + 爆破 >0 → `focus`。
2. 劣质，或场外 <1000，或爆破 <0 → `avoid`。
3. 进场且天数 ≤3、单位“天” → `new`。
4. 其余 `watch`；无记录 `missing`。

`planFor` 始终 `executable:false`，列出行情、止损、独立确认、市场门控等缺失。地产等月度来源保持月度含义。历史回看 `atDate` 只取 `date <= asOf` 的最后记录，不能用后来数据解释较早日期。

潜力区是源页给出的 top/support 水平及门控，不由场外指数反推出价位。当前报告读取已生成的监测状态；本次未核实到统一自动生成所有潜力区状态的完整管线。阈值触发研究需另外确认具名报价、时点、有效期和失效条件。

## 3. S1 Buy 冲浪筛选

代码：`s1_surf_filter.py::latest_buy_contexts/_base_candidate/analyze_surf_structure/classify_candidate`。

### 连续出现与数据准备

同一归一代码在最新及紧邻上一份可用快照都只有 Buy，且日期间隔 ≤3 自然日，记连续出现；可向前追溯连续段首日。此为**清单连续代理**，不能证明供应商标记始终对应同一根 K 线。同日 Buy/Sell 冲突独立列出。

只用已完成正常交易时段的日 K。`TR=max(H−L, |H−prevC|, |L−prevC|)`，ATR14 是信号日前的 TR 简单平均，不是 Wilder 平滑。先检查价格数量、ATR 与交易会话是否可用。

### 5–9 根底部窗口

窗口包含首次信号日。前置回看 20 根：峰值为最高 High，底部参考为窗口最初两根 Close 的中位数；`decline=max(0,peak−reference)`。下跌百分比以峰值为分母，ATR 倍数以 ATR14 为分母。

| 门槛 | 当前条件 |
|---|---|
| 前置下跌 | ≥8% **或** ≥2 ATR |
| 底部振幅 | `(maxH−minL)/medianC ≤12%` **且**振幅 ≤2.5 ATR |
| 单日变化 | 最大绝对收盘变化 ≤6% 且 ≤1.25 ATR；变化中位数 ≤0.6 ATR |
| 红绿交替 | 实体 >0.10 ATR 才算有色，至少 3 根；相邻有色方向变更数/(有色数−1) ≥0.4 |
| 平坦程度 | 收盘对顺序索引 OLS 斜率的绝对值 ≤0.18 ATR/根 |
| 不再破底 | 信号 Low 不低于此前窗口最低 Low −0.25 ATR |
| 信号收盘位置 | `(signal_close−base_low)/(base_high−base_low) ≥0.2`；这里是整个底部窗口，不是信号当日振幅；零振幅时代码用0.5 |

全部结构门槛通过，还需质量分 ≥60：

```text
D = clip(max(decline_pct/8, decline_atr/2)/1.5)
R = clip(1 - range_atr/(2.5*1.2))
M = mean(clip(1-max_move_atr/(1.25*1.2)),
         clip(1-median_move_atr/(0.6*1.2)))
F = clip(1-abs(slope_atr)/(0.18*1.5))
score = 100*(.25D + .20R + .20M + .15clip(alternation)
             + .10F + .05no_further_breakdown + .05no_signal_day_chase)
```

多窗口按“是否通过、分数、较短窗口”取最好。信号之后的 hold 需要后续 Low 不破 `base_low−0.25ATR` 且最新 Close ≥base_low。

| 状态 | 条件 |
|---|---|
| `confirmed_surf` | 结构通过 + 快照连续 + 后续价格守住 |
| `forming_wait_persistence` | 结构通过但快照未连续 |
| `persistence_price_pending` | 结构通过且连续，但后续价格无法确认 |
| `not_surf` | 条件不满足 |
| `missing_price_data` 等 | 数据/过滤结果不可用，不计为结构失败的确定结论 |

质量分不是上涨概率；“确认”不是买入许可。

## 4. 13 买点接入与价格条件

代码：`sync_entry_points.ts::qualityCap/estimatedDailyTurnover` 和主扫描；实际 `buildBossSignals` 来自外部只读 `app/lib/signal-engine.ts`。

最新 S1 Buy 只扫描美股/A 股，港股不支持时显式跳过。使用至少 100 根闭合正常时段 5 分钟 K，核对交易状态、停牌、成交额和源项目可交易门槛。估算日成交额为最近约 3 个正常交易日的每根 `amount`（缺时 `close*volume`）均值 × 每正常日根数。

研究 fallback 的任何 L1 降到 L0，分数至多 74；完整量能不足时方法 4/5 的 L1 也降级。候选需非 WAIT 且 entry/stop 非空，按 score 降序、方法 id 升序取一个最佳；`entry_low=entry_high=top.entry`，止损、目标均来自源引擎，不用 S2 行权价补齐。

当前调用不是 13 套规则的独立实现，本文不杜撰源引擎内部指标、模式、R 倍数公式。后续修改先核对外部规则及数据适配器版本。扫描失败、部分市场失败和成功零候选应分开；同日保留记录也必须显式说明是否本轮新候选。

## 5. 期权采集范围与基础统计

代码：`collect_longbridge_options.py::collect_symbol/parse_volume_history/realized_volatility` 及相关函数。

默认核心 SPY/QQQ/NVDA，固定观察 CRCL/SPCX，加最近 S1 候选最多 9；单标的最多 3 到期日，目标 DTE 0/7/30；标准采样 moneyness 为 −10%、−5%、−2.5%、0、2.5%、5%、10%。深查至多 3 个，日聚合成交量门槛 3000。逐笔上限 1000，每侧至多 2 个微观样本合约，范围约 ±20%；不是全市场逐笔抓取。

```text
moneyness = K/S - 1
HV_n = sample_std(ln(C_t/C_(t-1))) * sqrt(252), n=20/60
expected_move = S * ATM_IV * sqrt(max(DTE,1)/365)
P/C_volume = Put_volume / Call_volume
P/C_OI = Put_OI / Call_OI
volume_multiple = current_volume / mean(prior_volumes)
z = (current - mean(prior)) / sample_std(prior)
```

HV 要求 n+1 个有效正收盘价。ATM 取最接近现价行权价的可用 Call/Put IV 平均；当日到期的 expected_move 仍用一天，不能解释成精确剩余分钟区间。初始抽样链量能/持仓峰值的范围并非完整链，不能称为全市场墙位。

历史数组最后一行作 current，其余为 prior。**兼容旧字段 `volume_put_call_zscore` 的均值/标准差包含最后一行；新的 `put_call_zscore_prior` 排除最后一行。** 不能在回测中混用这两个基准。

## 6. IV 曲面、期权异常与假设

95P/105C 代理偏斜：最接近 `0.95*S` Put IV −最接近 `1.05*S` Call IV。它不是实际 25Δ skew。

有实际 Greeks 时，25Δ/10Δ 分别挑最接近目标 delta 的合约，优先有成交或 OI 者，不做曲面插值：

```text
RR_delta = IV_call_delta - IV_put_delta
put_premium = -RR_delta
fly_delta = (IV_call_delta + IV_put_delta)/2 - ATM_IV
```

IV 是小数；显示波动率点需 ×100。期限结构 `front/back`：front >1.05×back 为 backwardation，front <0.95×back 为 contango，其余 flat_or_unclear；不是按天数插值的恒定期限曲线。

异常总分：每项 `weight*clip(raw/saturation)`，缺失项 0 分但保留覆盖：

| 维度 | raw | weight | saturation |
|---|---|---:|---:|
| Call/Put 单边量异常 | max(abs(z_call),abs(z_put)) | 25 | 3 |
| 总量异常 | abs(z_total) | 20 | 3 |
| P/C 异常 | abs(z_pc) | 15 | 3 |
| IV/HV | abs(ln(ATM_IV/HV20)) | 15 | ln(1.5) |
| 期限变化 | abs(ln(front_IV/back_IV)) | 10 | ln(1.2) |
| 偏斜 | abs(IV95P−IV105C) | 15 | 0.12 |

覆盖率为 6 维中可用维度数/6，并非可用权重占比。≥70 极端、≥50 显著、≥30 关注、否则普通；不是买卖分，也不是胜率。

方向假设投票：Call 倍数 ≥1.35 且 ≥1.15×Put 倍数、P/C 相对旧均值 ≤0.8、skew ≤−0.04 分别支持上行；Put 倍数 ≥1.35 且 ≥1.15×Call、P/C 比值 ≥1.25、skew ≥0.04 分别支持下行。双边倍数均 ≥1.3，或 IV/HV≥1.25 且期限倒挂，优先标双边波动；否则某方向至少两票且另一方零票才单独倾向该方向，两边都有票标冲突，其余未定向。所有标签都保留“可能是卖方、多腿、对冲或平仓”的不可识别性。

## 7. Greeks、合约热点、逐笔和 OI

标准乘数 `m=100` 的当前 gross 计算：

```text
gross_delta_usd = abs(delta) * OI * m * S
gross_gamma_1pct_usd = abs(gamma) * OI * m * S^2 * .01
gross_vega_1vol = abs(vega) * OI * m
gross_theta_1day = abs(theta) * OI * m
turnover_proxy = last_price * day_volume * m
```

这些是绝对敏感度汇总，**不是 dealer 净 GEX**；gamma 项也不是用 `0.5*gamma*dS²` 计算的期权二阶盈亏。Vega/theta 单位按供应商定义复核。`last×全日量` 不是每笔价量求和的真实成交额。

热点 min volume=50，最多 12：

```text
turn = 5（OI=0 且有成交）或 min(volume/OI,5)
watch_score = 20*turn + 4*ln(1+volume) + ln(1+turnover_proxy)
              + 5（OI 可用时）
```

`volume/OI≥1` 标成交超过存量，≥0.5 标高换手；不能证明新增仓位。

逐笔样本：`gross_premium=price*contracts*100`；`tick_imbalance=(up_volume−down_volume)/(up_volume+down_volume)`；没有分母则缺失。Up/Down 是相对前笔价格的涨跌，**不是当时 ask/bid 主动买卖分类**。只描述返回样本的起止时点、覆盖、top prints 和最大单。大单候选要求 volume 可用，且至少 50 张 **或** 毛权利金至少 100,000 美元，排序后至多20条；只覆盖 Top3 深查中每侧最多两张代表合约的最近逐笔样本。

深度摘要：mid=(best_bid+best_ask)/2，spread=best_ask−best_bid，`spread_pct_of_mid=spread/mid` 实际保存的是小数比例，展示百分数需×100。两侧任一存在就可能标 available，不代表双边可成交价都齐全。OI 集中度=某行权价该侧 OI/扫描链该侧 OI 合计，仅返回最高若干档（默认3），不是 dealer 持仓墙。

ΔOI 只匹配相同标的+到期+行权价+Call/Put，合计可比合约的 `OI_current−OI_previous`。首次快照记 baseline_established；无可比合约则不强行确认。报告日期不同仍需核对 OI 结算日期是否真的不同。正 ΔOI 说明该合约总持仓变化，不证明机构方向、某笔开仓或单一交易者行为。

## 8. S1 后价格/期权证据：forced-flow

代码：`s1_forced_flow.py::quote_precheck/daily_price_profile/build_forced_flow_payload` 等。

### 价格归一

参考价优先信号日前一根 Close，缺时用信号日 Open 并标 fallback。`return_pct=(latest/reference−1)*100`，Buy 方向乘 +1，Sell 乘 −1。ATR20 用首次信号前最多 20 个 TR 简单平均，`return_atr=directional_return_pct/ATR_pct`。RVOL 是最新 Volume /此前最多 20 根均量，排除最新根。收盘位置 `(C−L)/(H−L)`，Sell 用 `1−位置`。MFE/MAE 按方向看区间高低价，不当成真实可成交盈亏。

### 55 分预筛

新鲜度 10（≤3 个近似工作日）否则 5；快速翻向 5；方向涨跌 `20*clip(max(return_pct,0)/10)`；收盘位置 `10*clip((pos−.5)/.4)`；流动性 `10*clip(log10(max(turnover,1))/10)`。覆盖分母 55。点火预筛要求方向涨跌 ≥2.5% 且收盘位置缺失或 ≥0.6。预筛用于选择深查对象，不与完整分等价。

### 100 分完整证据

| 部分 | 最高权重 | 计分 |
|---|---:|---|
| 信号时效 | 10 | ≤3 日 10，否则 5 |
| 快速翻向 | 5 | 有则 5 |
| 价格响应 | 20 | `20*clip(max(return_atr,0)/3)`；ATR 缺失退回方向涨跌/12 |
| 收盘位置 | 10 | `10*clip((directional_pos−.5)/.4)` |
| 相对成交量 | 15 | `15*clip((RVOL−1)/2)` |
| 同向期权异常 | 20 | `20*clip(option_anomaly/70)`，须同向且时点可用 |
| 次日同向 ΔOI | 15 | `15*clip(max(aligned_delta_OI,0)/5000)`，须可比 ready |
| 借券/解锁/事件 | 5 | 当前缺失，记 0 并列缺口 |

coverage 为可用权重/100。高优先需分数 ≥50 **且** coverage≥0.55；中优先需 ≥30 且 coverage≥0.35；其余观察。默认最多展示 12 条、3 张卡、每卡 4 个合约热点。

阶段按冲突优先：同日信号冲突 → 反证 → 衰竭 → 次日 OI 确认 → 价格+量+期权同向 → 价格+量点火 → 快翻陷阱候选 → 种子。价格点火为 ≥1ATR（无法 ATR 时 ≥2.5%），收盘位置缺失或 ≥0.6；量点火 RVOL≥1.5。反证包括方向收益≤−2.5%、反向期权异常≥40 或同向 ΔOI 为负；衰竭为方向收益≥12% 且位置<0.45。信号之前的期权流不得确认信号之后的阶段。工作日年龄尚非交易所节假日日历。

## 9. 市场风险三开关

代码：`daily_trade.py::build_market_risk_watch/_option_reflexivity_rows/_capex_watch/_slow_crowding_rows`。

### 流动性

`WRESBAL/WDTGAL`（百万美元）÷1,000,000 → 万亿美元；SOFR/IORB（百分数）差 ×100 → bp。利差只比较两序列同日观察，连续为连续可得观察，不自动等于连续自然日。

- 红：准备金 <2.8T，或 SOFR−IORB >3bp，或回购序列 >0（后者需纽约联储复核）。
- 硬限制：准备金 <2.5T，或准备金 <2.8T 且利差 >3bp。
- 黄组合：利差连续至少两次 >0，且准备金 <2.9T，且 TGA≥0.95T。1T 是展示参考。

### 期权反身性代理

SPY/QQQ 优先 DTE≥5 的最近到期，否则最近到期。条件为 `IV95P−IV105C<0` **且**标的涨跌≥0 **且** RVOL<1。两只均触发才形成组合升档项。它不是实际 dealer gamma、25Δ 历史分位或完整市场反身性模型；缺项保留缺口。

### 阶段位置、capex 与慢指标

阶段位置需人工 `ready`、分类、日期、来源与方法，不能由模型自动填“阶段二”。Capex 只接受官方 filing/company filing 及有效链接、期间、本期/前期值和增长率：`absolute_up=current>previous`；`second_derivative=current_qoq_growth−previous_qoq_growth`（百分点）。MSFT/AMZN/GOOGL/META 中有效公司至少 3 家，严格多数“绝对 capex 增但增速下降”才响铃。它是增速差，不是金额的二阶微分。

慢指标按各自频率显示过期；内部人卖/买 >5、NDX forward PE>30 是研究阈值，非官方崩盘线，也不因单项高就自动预测下跌。

### 汇总上限

```text
block_new_risk = 流动性硬限制 OR capex 响铃
elevated = 流动性红/黄组合 OR 两 ETF 反身性代理都触发
coverage_caution = 流动性/期权不足、阶段位置/capex 缺失、慢指标缺失或过期等
cap = 0 if block else .25 if elevated or coverage_caution else None
```

0.25 是相对“常规风险预算”的倍数，不是总资金四分之一。整体缺失保护存在，但并非每个宏观/capex 叶子值都已统一强制 freshness gate；维护时不能把配置天数存在说成所有路径已严格执行。

## 10. OKX 私有账户风险

代码：`collect_okx_account.py::liq_distance_pct/compute_risk`。

```text
gross = long_notional + short_notional
net = long_notional - short_notional
gross_leverage = gross/equity; net_leverage=net/equity
available_pct = available_equity/equity*100
top3_share = 最大三笔名义金额合计/gross*100
adverse_1pct_usd = gross*.01
adverse_1pct_equity_pct = gross/equity
gap_impact = sum(notional * side_sign * extended_change_pct/100)
gap_coverage = 有映射的notional/gross*100
```

`adverse_1pct_equity_pct` 已是百分数表达，例如毛杠杆10对应净值约10%的不利压力。它是假定各仓同时逆向的简化压力，不是净敞口预测。缺口覆盖<50%标局部影响。Longbridge 参考价不替代 OKX 标记价，也不重算其保证金/强平引擎。

强平距离：多头 `(mark−liq)/mark*100`；空头 `(liq−mark)/mark*100`。风险加分：毛杠杆≥20 +2、否则≥10 +1；保证金率≤200% +3、否则≤350% +1；最小强平距离≤10% +2、否则≤15% +1；可用权益占比≤25% +1；明确无止损 +1；缺口影响/净值≤−5% +1。未知保护单不当成“明确没有”。总分≥6极高、≥4高、≥2中、其余低；低也不等于安全认证。

## 11. 最终研究预算

代码：`daily_trade.py::make_decision_payload`。

有效个股条件为：正支持 Buy ∩ 确认冲浪 ∩ 当前可用 L1。防守背景来自美股场外负分或 Desk 摘要包含“谨慎”等现有规则；文字匹配有局限。

按顺序：账户高风险或市场禁止新增 →0；有有效 L1 且无过期项、非防守 →0.50；确认形态与支持交集且非防守 →0.35；有正支持 Buy 且非防守 →0.25；其余防守观察仍采用代码的0.25档，但**不意味着存在可执行买点**。最后与市场风险 cap 取较小值。NQ/ES 方向预算最多 `min(.25,最终预算倍数)`。

预算缺少净值、有效止损、合约乘数和风险单位时不能反推张数。最终报告必须分别写“观察对象”“触发条件”“失效条件”“数据缺口”，不得把预算数字当下单指令。

## 12. 移动端解释性仪表

代码：`build_mobile_snapshot.py`。该脚本顶层即读写文件，不应作为纯函数模块随意 import。

展示冷热映射：沸1、热0.8、温0.5、平0、凉−0.5、寒−1，**不同于方向支持的±1映射**。可靠性常数为场外90、潜力区55、趋势80、S1 70、买点60（缺时0）、Desk65、期权70。它们是解释性权重，未作概率校准。

| 模块 | direction 实际来源 |
|---|---|
| 场外 | 美股 market_bias.score，缺时0 |
| 潜力区 | 首个监测 failed/failed_reclaim 为−1，否则0；focusEligible=false，不进入指数总相位 |
| 趋势 | 美股冷热展示映射 |
| S1 | (Buy−Sell)/(Buy+Sell)；Buy-only 或无总量时0并注明不能计算净宽度 |
| 买点 | 固定0，不贡献方向 |
| Desk | 当前代码固定−1，**并未自动理解当天摘要方向，属于待改项** |
| 期权 | FOP 平均 P/C<.8→+.5、>1.2→−.5，其余0；SPY/QQQ 聚合 P/C均值<.8→+.5、>1.1→−.5，其余0；有指数数据时两方向等权平均 |

期权方向是展示用启发式，不可当主动买卖分类。当前 FOP 平均值在无数据时因分母 `max(1,count)` 得0，可能先产生+.5；后续 failed/freshness 会影响亮度，但不是完整的缺失值防误判。期权展示日期取多路 report_date 最大值，也可能掩盖其中一路过期；需逐路检查。

新鲜度：age=max(0,anchor−数据日)；缺失/失败0，其余 `max(15,100−20*age)`；≤1日ready、2日stale、>2日very_old。anchor优先状态文件更新时间，需另外与真实当前日对照。

```text
light_i = abs(direction_i)*reliability_i*freshness_i/100
signed_i = direction_i*reliability_i*freshness_i/100
temperature = mean(light); force=mean(signed)
coherence = abs(sum(signed))/sum(light)*100
risk_pressure = sum(negative_direction_light)/sum(light)*100
entropy = -sum(p*ln(p))/ln(3)*100
```

参与 focus 的模块需 focusEligible、reliability>0 且 abs(direction)>.01；熵按方向阈值 ±.12 分正/中/负三类。亮度≥50 lit，≥25 glimmer，其余 dim，缺失 dark。相位顺序：temperature<25低能等待；否则熵≥70且force<−10为高分歧防御；否则熵≥70为拉扯；否则force>15顺向升温、<−15防御降温，其余中性蓄能。零总亮度时 coherence/risk_pressure 返回0，不等于低风险证明。熵只描述证据分散，不是市场物理定律或预测模型。

## 13. 一股回测、资金与佣金

代码：`backtest_s1_one_share.py`、`analyze_s1_market_variants.py`、`analyze_s1_us_capital.py`。这是研究工具，不是完整交易系统回测。

每条信号在**严格晚于信号日**的首根可用日线 Open 执行；多个信号落在同一个可用开盘时取最近信号。同向不重复加仓。`long_short`：Buy=+1股、Sell=−1股；`long_only`：Buy=+1、Sell=空仓。反向先平后开；末尾未平仓用最后 Close 标记且 status=open；无后续 K 记 pending。

```text
gross_pnl = direction*(exit-entry)
gross_return = direction*(exit/entry-1)
illustrative_cost=(entry+exit)*cost_bps/10000  # 默认每边10bp
net_pnl=gross_pnl-illustrative_cost
```

字段名 `net_pnl_10bps` 即使传别的 cost_bps 仍保留旧名，应同时阅读参数。未平仓也扣示意退出费用，属于估算。没有自动包括借券可得性/费、融资、股息、全部公司行动、整手/最小单位和成交冲击；A/HK/USD 分币种统计，不能直接加总货币金额。`--as-of` 仍需保证价格缓存的时点与复权，盘中日线另标；一般报告命令的 `--date` 不是历史回测。

资金模型每股空头维护下限：P≤2.5→2.5；2.5<P<5→P；5≤P≤16.67→5；P>16.67→0.30P。多头 maintenance=.25P、regt/short_100=.50P、full_100=P；空头 maintenance=下限、regt=max(.50P,下限)、short_100/full_100=max(P,下限)。这是现有代码的静态假设，不是当日券商实际保证金报价。

IBKR 示例佣金：tiered=min(max(.0035×数量,.35),.01×成交额)；fixed=min(max(.005×数量,1),.01×成交额)。同标的翻向合并为数量2的示意订单，未含转收费、借券费等。逐日所需初始权益=该情景保证金要求−累计已实现及浮动毛盈亏+累计佣金，再取时序最大值。日内每仓最不利价同时发生是保守情景，不是可实现的精确组合路径。采用这些费率作现实预算前需联网核实当前规则。

## 14. 工作簿与不可推导的信息

`build_history_workbook.mjs` 从既有 CSV/JSON 生成工作簿、方法页和覆盖统计，使用 `@oai/artifact-tool`；不是独立场外算法，也不重新确认供应商信号。缺少历史 CSV 时有从旧种子工作簿初始化的路径，必须遵守用户场外来源边界，不能借初始化重新接入禁止同步的外部表。

本项目无法仅凭现有输入得到：S1/S2/冷热供应商私有筛选公式、逐笔真实开平仓、机构身份、净 dealer gamma、期权卖方库存、可靠的未来收益、无授权账户的仓位、缺失市场的精确进场止损。应写“未知/未接入”，不能用经验词替代数据。

研究用途，非投资建议。
