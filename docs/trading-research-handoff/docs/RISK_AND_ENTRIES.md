# 风险层、13 买点与最终动作：Claude 接手说明

核对日期：2026-11-08（Asia/Singapore）。本文件依据本地源码与 `config/workflow.json` 说明**实际实现**，没有联网刷新行情、读取账户明细或验证现行券商政策。下面的阈值是项目研究参数，不是交易所保证金标准、官方警戒线或收益保证。

本模块只产生研究报告，不创建、修改或撤销订单。账户风险、市场风险、期权异常均不能代替价格结构，也不直接增加 S1 的方向一致度分。

## 1. 代码与产物索引

| 组件 | 主要代码位置（本次快照行号） | 输入 / 输出 |
|---|---|---|
| OKX 只读客户端、账户归一 | `scripts/collect_okx_account.py:137`、`normalize_account:179`、`normalize_position:224` | 环境变量与 OKX GET 接口 → 归一账户/仓位 |
| 资金费、盘前映射 | 同文件 `collect_funding:325`、`normalize_longbridge_quote:366`、`attach_market_references:441` | OKX 公共费率、长桥扩展时段报价 → 每仓位压力代理 |
| 账户评分 | 同文件 `compute_risk:498` | 归一账户/仓位/保护单覆盖 → 风险等级 |
| 账户落盘、失败状态 | 同文件 `main:797` | `data/account/okx_latest.json`、`okx_status.json`、`history/`（均私有） |
| 账户新鲜度 | `scripts/daily_trade.py:411` `account_freshness` | 当前运行时钟，不是回放报告日 → 最新/偏旧/采集失败 |
| 官方宏观序列 | 同文件 `RISK_SERIES_META:444`、`refresh_market_risk_macro:579` | FRED 序列 → `data/risk_watch/macro_latest.json` |
| 反身性代理 | 同文件 `_option_reflexivity_rows:699` | SPY/QQQ 期权面与相对量 |
| 资本开支 / 慢指标 | 同文件 `_capex_watch:755`、`_slow_crowding_rows:803` | `data/risk_watch/slow_latest.json`，目前是外部结构化输入，不是自动财报采集器 |
| 市场风险合成 | 同文件 `build_market_risk_watch:834` | 宏观/期权/慢输入 → `data/risk_watch/latest.json` 与风险倍率上限 |
| 13 买点接入 | `scripts/sync_entry_points.ts:321`、`main:359` | 最新 S1 Buy + 外部引擎 → `data/buy_points/buy_points.csv`、`status.json` |
| 当日点位资格 | `scripts/daily_trade.py:2184`、`current_point_rows_for_gate:2203` | 扫描状态、信号日、点位行 → 当日允许参与门控的行 |
| 最终动作 | 同文件 `make_decision_payload:3248` | 独立体系支持、冲浪、13 买点、账户/市场风险 → `data/decision/latest.json` 和报告 |

行号帮助定位，更新代码后应重新核对函数而不是长期依赖固定行号。

## 2. 账户数据来源与权限边界

### 2.1 OKX

`OkxReadOnlyClient` 只实现签名 **GET**。使用的接口包括：

- `/api/v5/account/balance`：权益、可用权益、初始/维持保证金、保证金率。
- `/api/v5/account/positions`：持仓、名义价值、标记价、预计强平价、浮动盈亏等。
- `/api/v5/trade/orders-pending`：普通挂单数量。
- `/api/v5/trade/orders-algo-pending`：依次查询 `conditional`、`oco`、`trigger`、`move_order_stop` 四类策略单。
- `/api/v5/public/funding-rate`：永续资金费率、资金费时间与下次时间。

凭证只从 `OKX_API_KEY`、`OKX_API_SECRET`、`OKX_API_PASSPHRASE` 读取；`OKX_API_BASE` 可配置地址，`OKX_DEMO_TRADING` 可启用模拟头。严禁把真实值写进 README、报告或 GitHub。客户端没有自动验证 API key 权限范围的步骤，所以“只授予 Read、禁用 Trade/Withdraw”仍是人工配置要求，不能宣称代码已替用户验证。

本地账户快照及历史一律不发布。浏览器导入是显式 `--import-file` 兜底，代码采用字段白名单，不把任意附加字段原样复制。

### 2.2 Longbridge

命令为 `longbridge quote <symbols...> --format json`。映射只来自 `account_risk.longbridge_symbol_map`；按 OKX `inst_id` 完全相等或前缀加连字符匹配，不自动猜所有美股永续。

在 `pre_market`、`overnight`、`post_market` 中选时间最新者，排除比采集时钟超前超过 5 分钟的项；没有扩展时段时回退到常规 `last/prev_close`，此分支没有报价时间。以最新选中时段的 `prev_close` 为分母，不保证各供应商时段分母完全相同。

长桥价格只用于开盘缺口压力估算，**不用于重算 OKX 保证金和强平价**。

## 3. 账户公式与阈值

令账户总权益为 `E`，每仓位绝对美元名义价值为 `N_i`，多仓方向 `s_i=+1`、空仓 `s_i=-1`。

| 指标 | 实际公式 / 口径 |
|---|---|
| 多/空名义 | 各自方向的 `N_i` 加总 |
| 毛名义 | `G = 多名义 + 空名义` |
| 净名义 | `N = 多名义 - 空名义` |
| 毛 / 净杠杆 | `G/E`、`N/E`；不是各仓位杠杆倍数的加权平均 |
| 可用权益占比 | `available_equity / E × 100%` |
| 前三仓集中度 | 三个最大 `N_i` 之和 / `G × 100%` |
| 多仓强平距离 | `(mark - liquidation) / mark × 100%` |
| 空仓强平距离 | `(liquidation - mark) / mark × 100%` |
| 最近强平缓冲 | 有值仓位强平距离的最小值；不表示组合在该幅度必然强平 |
| 全仓各自逆向 1% 压力 | 美元值 `G×1%`；权益百分数 `(G×1%)/E×100 = G/E` |
| 下一次资金费影响 | `-s_i × N_i × funding_rate`；正值为预计收取，负值为预计付出 |
| 扩展时段涨跌 | `g_i = (extended_price / selected_prev_close - 1) × 100%` |
| 开盘缺口一阶影响 | `s_i × N_i × g_i/100`，对有映射且有涨跌幅的仓位加总 |
| 盘前覆盖 | 能计算缺口影响的仓位名义和 / `G × 100%`，不是标的数量比例 |

REST `mgnRatio` 被视为倍率，乘 100 变为百分数；浏览器导入字段已是百分数，不再乘 100。REST 名义价值采用 `abs(notionalUsd)`，不从“张数×股价”推算；浏览器导入缺少名义时却会以 `quantity×mark_price` 兜底，**不含合约乘数**，不适合未经核验的合约单位。

`account_risk` 当前评分规则如下。同一项的严重/一般档只取其一，跨项累加：

| 条件 | 分值 |
|---|---:|
| 毛杠杆 ≥20 / ≥10 | +2 / +1 |
| 保证金率 ≤200% / ≤350% | +3 / +1 |
| 最小强平缓冲 ≤10% / ≤15% | +2 / +1 |
| 可用权益占比 ≤25% | +1 |
| 已完整核对且至少一仓无保护止损 | +1（不是每仓加一） |
| 缺口一阶影响 ≤权益的 −5% | +1 |

总分 ≥6 为“极高”、≥4 为“高”、≥2 为“中”，否则“低”。这是启发式风险分，未经过概率校准。未知指标不会自动加罚分，因此“低”不必然表示数据完整或风险低；必须连同快照状态和缺失项使用。

额外显示但不直接加分：仓位杠杆 ≥20 的数量、主题毛/净敞口、前三仓集中度。主题可以重叠，同一仓位可能同时属于两个主题，不能把各主题名义相加当总敞口。

盘前标签以估计影响/E为依据：≤−5%明显逆风，≤−1%偏逆风；≥5%明显顺风，≥1%偏顺风；否则按涨跌家数判断分化或影响有限。覆盖不足50%时改为“局部…（覆盖不足）”。涨跌家数以 `g>0.1%` / `<−0.1%` 为边界。

### 3.1 保护单与新鲜度的真实边界

- 四类策略单全部查询成功才称保护单观察完整；部分失败且未发现止损时，仓位 `has_protective_stop=null`，不是 false。
- 止损识别检查 `slTriggerPx`、`slOrdPx`、`stop_price` 或追踪止损类型；当前只按 `instId` 关联策略单，**未核对方向、数量覆盖、reduce-only、触发价合理性及失效状态**。出现 `true` 不能等同完整风险保护。
- 账户快照允许年龄：亚洲早间120分钟、美国盘前30分钟、手工45分钟。比较的是实际运行时钟；不是可回放的历史 as-of 检查。
- 新于上次成功快照的采集尝试若失败，报告明确显示失败并清空账户指标，不冒用旧快照（`daily_trade.py:432`、`:4021`）。采集器本身保留旧文件供审计。
- 扩展报价45分钟以上会标 `stale` 并令快照 partial，但目前仍参与缺口计算。常规回退报价时间未知，也未从缺口计算排除。
- 无映射时，缺口加总可能为0；必须读覆盖率，而不能把0理解为真实零风险。
- `available_equity` 的某些回退使用 Python `or`，真实0可能被后备字段替代；权益≤0的专门风险处置也未实现，应由接手者补边界测试后修复。

## 4. 市场风险三开关的数据来源

实际自动采集只有 FRED bundle：`https://fred.stlouisfed.org/graph/fredgraph.csv?id=WRESBAL,WDTGAL,SOFR,IORB,RPONTSYD`。序列引用如下；本次只核对代码内链接，没有重新获取官方数值：

| 序列 | 代码解释 | 代码单位/频率 | 来源 |
|---|---|---|---|
| WRESBAL | 银行准备金余额 | USD million，weekly | [Federal Reserve H.4.1 via FRED](https://fred.stlouisfed.org/series/WRESBAL) |
| WDTGAL | 美国财政部一般账户 TGA | USD million，weekly | [Federal Reserve H.4.1 via FRED](https://fred.stlouisfed.org/series/WDTGAL) |
| SOFR | 有担保隔夜融资利率 | percent，daily | [New York Fed via FRED](https://fred.stlouisfed.org/series/SOFR) |
| IORB | 准备金余额利率 | percent，daily | [Federal Reserve via FRED](https://fred.stlouisfed.org/series/IORB) |
| RPONTSYD | 临时回购操作总额代理 | 当前代码标为USD million，daily；接手时须对官方元数据重新核验单位 | [New York Fed via FRED](https://fred.stlouisfed.org/series/RPONTSYD) |

解析器支持CSV或ZIP内多张混合频率CSV，保留不同观测日期。失败只写 `status.json` 的尝试信息，不覆盖最近成功宏观包。`_series_observations` 排除报告日之后的观测；宏观观测日不等于当时已经发布可见的时间，历史回放仍需发布时点版本。

“现在在哪”的价格/筹码结构、资本开支篮子与七项慢指标从 `slow_latest.json` 读取，当前没有自动获取官方财报并计算全套数据的实现。文件存在或 `source_type=official_filing` 只是输入标记，不能代替源文核验。

## 5. 流动性、反身性、资本开支的精确规则

### 5.1 流动性

代码把准备金/TGA的百万美元除以1,000,000得到万亿美元；SOFR和IORB按同一观测日内连接，`spread_bp=(SOFR−IORB)×100`。正值连续天数是连续可用共同观测日数量，不是日历日或交易所日历。

- 准备金 `<2.9T` 黄色、`<2.8T` 红色候选、`<2.5T` 硬风险候选；恰好等于边界不进入较严重档。
- SOFR−IORB `>3bp` 红色；否则连续正值≥2个观测日黄色。
- TGA `≥0.95T` 黄色；1.00T仅展示参考，不单独改变门控。
- 回购代理 `>0` 提示需纽约联储逐项确认，同时进入流动性红色候选；不能自动称为SRF单项使用。
- 黄色组合 = 正差连续≥2 **且** 准备金<2.9T **且** TGA≥0.95T。
- 红色组合 = 准备金<2.8T **或** 差值>3bp **或** 回购代理>0。
- 硬风险 = 准备金<2.5T **或**（准备金<2.8T **且** 差值>3bp）。

这些阈值源于项目保留的外部视频启发，不是央行正式风险线。准备金变化速度仅显示相邻观测差；未加入自动评分。排序依赖采集解析器输出，手工宏观输入应保证有序。

### 5.2 SPY/QQQ 期权反身性代理

每个标的在有 `skew_95p_105c.spread` 的到期日中，优先选DTE≥5的最近到期；没有才选更近到期。

```text
倒挂 = IV(95% moneyness Put) − IV(105% moneyness Call) < 0
缩量抗跌 = 标的 change_pct ≥ 0 且 latest_relative_volume < 1
候选 = 倒挂 且 缩量抗跌
```

两个标的都满足才触发拥挤风险降档；一个为单标的观察。相对量来自该标的 `s1_forced_flow.price_response`，缺失时不能以报价成交量代替。此法不是25Δ风险逆转、全市场偏斜分位或净Gamma；“没有候选”与“覆盖不足”分开显示。没有在该函数内强制对齐期权报价、涨跌幅、相对量的时点，应视为接手修订项。

### 5.3 资本开支二阶导

每个输入公司必须有 `capex_value`、`previous_capex_value`、`qoq_growth_pct`、`prior_qoq_growth_pct`、`period_end`、非空 `source_url`，且 `source_type` 是 `official_filing` 或 `company_filing`。代码计算：

```text
absolute_rising = capex_value > previous_capex_value
second_derivative_pp = qoq_growth_pct − prior_qoq_growth_pct
decelerating = qoq_growth_pct < prior_qoq_growth_pct
铃候选 = 有效记录数≥3 且 (absolute_rising且decelerating)记录数≥floor(有效记录数/2)+1
```

它使用输入提供的环比增速，**没有从金额重新计算QoQ**。当前也没有按公司去重、强制限定MSFT/AMZN/GOOGL/META名单、统一币种/资本开支定义或检查是否最新季度；配置名单仅用于显示缺失公司。因此必须先由接手者做源数据校验，不能把“3条记录”自动宣传为“3家独立公司已核验”。

### 5.4 七项慢指标

依次为FINRA融资、SPX 0DTE份额、S&P500前十权重、总市值/GDP、M2与Nasdaq同比差、内部人卖/买金额比、Nasdaq100未来12个月PE。当前是读输入值和显示状态，不自动计算全部底层分子分母。

仅内部人卖/买比 `>5` 与NDX forward PE `>30`有数值触发阈值。其余有值则观察，不凭空增加阈值。

新鲜度日/周/月/季默认窗口为3/10/45/140个**日历日**；混合频率按字符串首项，例如 `daily/monthly`按daily，`weekly/monthly`按weekly。这里的 `_risk_freshness` 未拒绝未来日期。`threshold_hit` 优先于过期状态，意味着旧的超阈值数据可显示“触发”而不进入 `slow_missing`；这是已知边界，不应描述为全层严格日期门控。

### 5.5 风险倍率上限

```text
block_new_risk = 流动性硬风险 或 资本开支铃候选
elevated = 流动性红色 或 黄色组合 或 SPY与QQQ同时拥挤候选
coverage_caution = 流动性覆盖不足 或 期权代理覆盖不足
                   或 位置分类缺失 或 资本开支覆盖缺失 或 慢指标缺失/偏旧
cap = 0 (block_new_risk)
      0.25 (elevated或coverage_caution)
      null (没有额外上限)
```

`null`不是允许无限风险，而是本层不额外压低别层预算。慢指标超阈值目前只显示，并不直接令 `elevated=true`。宏观、位置分类和资本开支并未完整使用上述频率新鲜度窗口；非空旧输入仍可能影响门控。`latest_data_date`取部分字段最大日期，不能代表所有来源都同样新鲜。

## 6. 13 买点：能验证的接入逻辑与缺失依赖

### 6.1 重要可移植性限制

接入脚本从外部项目 `day trade/thirteen-bosses-dashboard/app/lib/` 导入 `market-providers.ts`、`market-catalog.ts`、`signal-engine.ts`、`types.ts`。**2026-11-08本次文件检查中，该配置路径不存在，当前项目内也没有这些文件的副本。** 因此本次能确认接入、过滤、数据降级、输出和下游门控，但不能重新审计13套方法的内部公式、实际L0/L1分数阈值、源项目成交额数值阈值或具体代理止损算法。

WORKFLOW约定目标是结构代理止损及1R/2R参考位；数学解释为多头 `R=entry−stop`，`target1=entry+R`、`target2=entry+2R`，但本接入层**只是读取**引擎的 `stop/target1/target2`，未自行重新计算验证。不可把该约定写成这次已独立审计的引擎实现。应先恢复用户拥有/获授权的外部项目并记录版本或提交哈希；不能猜测或擅自复制第三方源码。

### 6.2 扫描、行情顺序与准入

1. 从 `data/s1/signals.csv` 找最大日期，只取该日Buy；`market`精确匹配“美股”或“A股”，其他市场写入跳过列表。
2. 每市场先调用外部 `fetchStockBatch`；不足100根的A股再尝试东方财富5分钟前复权研究行情；不足100根的美股再尝试Longbridge5分钟前复权行情。
3. 每标的最多保留320根；至少100根、`tradable !== false`、估算成交额达源项目门槛，才调用 `buildBossSignals`。
4. 估算日成交额 = 最近最多3个正规交易日的**平均每根成交额** × `barsPerRegularDay`。每根优先用 `amount`，缺失才用 `close×volume`；若amount是0则不会触发缺失回退。
5. 行情带 `research_fallback` 时，把所有L1降成L0且分数封顶74。否则量能不是full时，仅方法ID4和5的L1降L0；代码不是“所有依赖成交量的方法自动识别”。
6. 去掉WAIT及entry/stop为空的信号，按分数降序、方法ID升序选每只最高项。`entry_low=entry_high=top.entry`，不伪造价格范围；目标与所有匹配方法保留在status详情。

东方财富把供应商时间视为K线结束时间，减5分钟转换为起始时间，并剔除未闭合K。Longbridge本地分支检查数值、时间解析和high≥low，但**没有自行剔除当前未闭合K或非正规时段K**，也未在CLI命令中指定会话过滤；当前声称“闭合/正规时段”依赖供应商默认行为，接手时须显式核验。

源项目正式行情或Yahoo是否如何降级，由外部`fetchStockBatch`控制，本次外部文件缺失不能独立确认。Longbridge分支标为full并可产生L1，东方财富明确研究降级最高L0。

### 6.3 日期与失败行为

- `scanDate`是**运行时新加坡日期**，不是最后行情K线日期；没有 `--as-of` 参数。最新S1日期单独写 `signal_date`，最后K起始时间写 `lastClosedBar`。
- 扫描成功但无候选是有效结果。全市场失败时写error状态，不覆盖旧CSV；旧last-success字段仍可留作审计。
- 部分市场失败时，CSV可以保留同日该失败市场之前的候选，status记录`carried_same_day_count`；不能把保留行当本次刷新成功。
- `scanned_symbols`是支持市场的输入条目数量，不是成功取数数量；同日别名/重复行没有在本接入层统一去重。
- 报告显示点位要求status ready/partial、尝试日=报告日、成功日=尝试日；执行门控还要求扫描signal_date=当前S1日且last_success_date=S1日。跨日期扫描旧信号时，可能有研究点位但不能进入当前门控。

## 7. 最终动作层：当前实现与意图的差别

候选集合在 `make_decision_payload` 中按如下方式构造：

```text
confirmed_surf = state==confirmed_surf 且 actionable==true 的归一代码
supported = 上游 top_buys 的归一代码
point_actionable = 当前点位行中 confidence.upper()=="L1"
                   且代码属于 (confirmed_surf ∩ supported)
```

**已发现明确接口不一致：** `sync_entry_points.ts:451`写CSV的confidence为`L1 84 · #4 方法名`一类描述串，而`daily_trade.py:3353`要求整个字符串等于`L1`。传入前未见拆分归一化，所以自动扫描产生的L1可能被此条件全部漏掉；手工输入纯`L1`则能通过。交接接手者应先添加端到端回归用例，再通过结构化`level`或显式解析修复；本次只记录问题，未改生产算法。

此外，`point_actionable`的构造本身没有要求账户数据可用或账户风险通过；市场硬风险/账户高风险随后把风险倍率压为0，但股票项state仍可显示conditional。账户缺失时文案要求观察/不算张数，未强制把候选集合清空。这是研究页面状态，不得让下游订单程序只读`conditional`或候选数量就执行。

当前研究倍率决策顺序：

| 优先条件 | stance / 倍率 |
|---|---|
| 账户高/极高，或市场block_new_risk | 风险优先 / 0 |
| 有point_actionable、没有任何过期/缺失体系、不是defensive | 条件参与 / 0.5 |
| 有冲浪确认且独立支持、不是defensive | 观察优先 / 0.35 |
| 有top_buys、不是defensive | 观察优先 / 0.25 |
| 其他 | 防御等待 / 0.25 |

最后再取与市场风险cap的最小值。`defensive`当前只检查美股场外score<0或Desk摘要含“谨慎”；这不是完整的自然语言风险识别。过期来源只阻止0.5档，不会自动让其余档为0。倍率相对于用户另行定义的“标准单笔风险预算”，不是仓位占净值比例，不自动换算张数。

NQ/ES动作中的方向风险文字另设`min(0.25, risk_multiplier)`；开盘时间窗/突破回踩为报告条件模板，不是已实现的订单策略或自动分钟级触发器。BTC/ETH动作页“1h结构与期权冲突时减半”同样是叙述性研究规则，本函数未计算实际1h策略或自动执行减半。

NQ/ES“完整链”布尔当前只检查至少一个actual/eod_actual行、每个行存在任一非空Greek及`bid_ask_available=true`，没有逐合约检查四个Greeks、尺寸、三个到期链或三次盘中快照；相关文案的“完整bid/ask+尺寸+Greeks”强于实现，应按真实字段覆盖核验。

## 8. Claude 的优先接手清单

本轮只制作交接，不自动修复下列行为或修改阈值：

1. 先恢复13买点外部依赖并锁定版本，补完整13方法/流动性/止损算法文档；依赖缺失时报告missing，禁止自造点位。
2. 修复confidence描述串与L1枚举不一致，增加从实际扫描CSV到动作页的端到端测试。
3. 建立独立且默认拒绝的执行资格字段，明确要求账户新鲜/完整、风险非阻断、行情可交易、关键来源同日；保留研究候选与执行资格的区分。没有新增下单授权，不接交易接口。
4. 对宏观、期权代理、资本开支、位置分类、慢指标统一检查未来日期、真实数据日和可获得时间；陈旧字段可展示但不得冒充当日门控。
5. 资本开支按公司唯一键去重、核对超大云厂商名单/来源域名/季度/币种/定义，从金额重新计算QoQ；保留更正与原值审计。
6. 排除过旧/未知时点报价进入“当日”缺口估算；保护单补方向、数量和状态匹配；导入合约补乘数；增加0权益/0可用权益测试。
7. 复核FRED每个序列的官方单位、发布日期、修订机制，尤其RPONTSYD代码元数据，避免单位标签与实际序列不一致。
8. 对账户数据/源码输出采用发布白名单：账户快照、密钥、原始付费内容不能进入GitHub；不得把本研究账户规则当作用户实际美股券商账户的保证金规则。

## 9. 已完成的验证与未完成部分

本次阅读了上述本地函数、配置和现有相关测试；运行 `python3 -B -m unittest discover -s tests -p test_okx_account.py`，4项通过，覆盖多空强平距离、扩展报价选择、毛名义压力计算及导入字段白名单。测试使用合成数据，不读取账户凭证或行情。

另对 `make_decision_payload` 做了不写盘的合成边界调用：相同的已确认冲浪与支持集合下，`confidence="L1 84 · #4 SOS"`产生股票state=`wait`，换为纯`"L1"`则为`conditional`。后者即使账户输入为空也仍保留conditional；在该刻意不提供来源缺失状态的最小函数调用中，倍率为0.5。真实报告上游会提供缺失状态并可能降档，因此这证明的是接口与函数边界问题，不是声称任何真实账户被允许0.5风险。

已核对风险测试中流动性硬组合、期权倒挂且缩量抗跌、慢指标缺失、官方财报类型与多数条件的用例。测试通过不是数据新鲜度/完整性或所有边界已验证的证明。未恢复13引擎、未实时采集账户、未验证真实交易可成交性、未执行任何订单。

研究用途，非投资建议。
