# S1、冲浪筛选、回测与美股资金模型

核验日：2026-11-08（Asia/Singapore）。本章以当前本地源代码和配置为准，不是对当日行情、券商保证金或费率的更新。路径及行号相对于原研究项目；行号在后续修改后可能变化，函数名是更稳定的定位依据。

## 1. 先明确四件事

1. **本项目接收 S1，不生成原版 S1。** 没有取得供应商源码、不可变信号 ID 或完整历史发布流；“S1 等于 ZigZag + RSI”的说法没有被这批代码证明。本项目的 8% 是冲浪筛选的前段下跌阈值之一，不是已验证的 S1 底层参数。
2. **当前回测不是每出现一次 B 就再买一股。** 已实现的是每个归一标的最多持有 +1/0/−1 股的状态机；同方向重复信号忽略。逐次加仓、分批平仓、逐次做空是不同策略，尚未实现，不能沿用当前收益和资金结果。
3. **冲浪筛选与回测是两条不同管线。** 现有回测直接消费 S1 事件，没有将冲浪确认、13 买点或账户风险筛选接入交易模拟。冲浪筛选通过也不代表已完成可交易回测。
4. **历史清单是快照证据，不是当时可见信号的完整证据。** 不能从最终回填到历史 K 线上的 B/S 箭头按该根 K 线价格成交。下一交易日开盘假设只能解决部分执行延迟，不能修复原始信号重绘、撤回、锚点移动或迟到发现。

关键代码：scripts/backtest_s1_one_share.py 顶部规则、simulate_symbol:370；scripts/s1_surf_filter.py 顶部限制、latest_buy_contexts:152。

## 2. 输入、数据来源与输出

| 对象 | 真实输入/来源 | 读取或转换位置 | 主要输出 |
|---|---|---|---|
| S1 日快照 | 用户粘贴、上传或获准同步的 S1 文件；标准表 data/s1/signals.csv | 两个模块各自 load_events / read_signal_rows | 归一事件、别名和同日冲突 |
| 冲浪日线 | Longbridge CLI，日线、前复权；优先区间接口，失败时显式降级最新 100 根 | s1_surf_filter.py:298 fetch_symbol_bars | data/s1/surf/market_data/信号日/代码.json |
| 回测默认日线 | Longbridge CLI historical 日线，前复权 | backtest_s1_one_share.py:146 fetch_symbol | data/backtests/s1_one_share/market_data_日期/代码.json |
| A/H 回测替代日线 | 腾讯证券公开 fqkline；SH/SZ/HK 代码适配，优先 qfqday，缺失时取 day | cache_s1_tencent_bars.py:18、29 | 同一回测缓存目录，来源写入每个文件 |
| 美股回测替代日线 | 经工具取得的 Alpaca IEX 历史 bars，JSON 行导入，不在导入器内主动联网 | cache_s1_alpaca_bars.py:14、26 | 同一回测缓存目录；adjust=none |
| 美股缺失标的兜底 | 经 IBKR 工具取得的历史价格数组，JSON 行导入 | cache_s1_ibkr_bars.py:14 | 同一回测缓存目录；标记 ONE_MONTH、outside_rth=false、adjust=none |
| 公司行动检查 | 已存在的 corporate_actions_check_日期.json，可选；主回测不主动获取 | backtest_s1_one_share.py main:811 | 原样纳入 summary，不能据缺失文件声称无拆股/股息 |
| 回测跨源对照 | 人工/独立流程准备的 longbridge_forward_日期 目录 | crosscheck_against_longbridge:569 | 重叠开/收盘绝对相对差异统计 |
| 待执行价格 | 固定回测缓存；缺失时 ibkr_pending_us_snapshot_日期.json | analyze_s1_us_capital.py:140 | 待执行篮子参考值，不计为已成交 |

冲浪输出：data/s1/surf/latest.json、data/s1/surf/history/surf_信号日.json。回测输出：s1_one_share_日期_summary.json、s1_one_share_日期_trades.csv，以及 reports/research 下对应 Markdown。组合输出：s1_market_variants_日期_summary.json / trades.csv；资金输出：s1_us_capital_日期_summary.json / timeline.csv。

来源、抓取时间、数据日、复权方式必须逐标的保留。缓存目录相同不代表来源一致；不能只看总报告中的固定文案推断价格口径。

### 缓存适配器的边界

- 腾讯请求端点是 https://web.ifzq.gtimg.cn/appstock/app/fqkline/get ，参数包含 day、起止日期、100、qfq；重试最多 3 次、每次超时 25 秒。若返回 day 而不是 qfqday，现有代码仍写 adjust=qfq，这一口径应在接手时纠正或验证。
- Alpaca 导入器把数据标为 IEX/未复权，但不验证上游实际请求 feed；start 元数据固定为 as_of−26 天，也不从原始请求恢复真实区间。必须保存上游请求与响应证明口径。
- IBKR 导入器把 OHLCV 等数组截到共同最短长度，不检查合约 ID、日期唯一性和证券身份；“exact-match”是预期前置条件，不是导入器完成的校验。
- 默认回测抓取器看见已有 ok 且 bars 非空即复用，不检查请求范围是否完整。缺数据可能被跳到较晚的“下一条现存 K 线”，因此必须单独审查缺失交易日、停牌及覆盖率。
- 上述代码是读取和落盘工具，不包含下单接口；源码中的历史券商/公开接口可用性没有在本次文档核验中联网重验。

## 3. S1 归一与快照连续性

### 3.1 代码归一

冲浪模块 canonical_symbol:106：转大写、去首尾空格；港股数字去前导零，例如 00700.HK、0700.HK、700.HK 合并为 700.HK；已带 .SH/.SZ/.US/.SG 的代码保留；其余追加 .US。

回测 canonical_symbol:57 类似，但只识别 .SH/.SZ/.US/.HK，没有 .SG 专门支持。资金脚本 canonical_symbol:47 只负责常见后缀且不去港股前导零，因为资金分析只取 USD。不能假设三个模块的归一契约完全相同。

### 3.2 去重、冲突、缺失

- 回测按 (归一代码, 信号日期) 分组。同日相同动作只保留一个事件，别名、名称和市场作为集合保留。
- 同日同时有 buy 与 sell，或动作非法，记录 conflicts 并排除该日事件；不自行猜顺序。
- 冲浪也按日建立动作集合；只选最新有效快照中动作恰好为 buy 的标的，同日冲突独立列出。
- CSV 本身没有接收时间、版本号、原始 candle ID。多份同日更新合并后，无法重建先后修订、撤回和首次可见时刻。
- 仅收到 Buy 时，Sell 是“未提供”，不是零；未在新 Buy 清单出现也不自动等于 Sell。覆盖范围标记由上游 intake 保留，不能靠本模块猜完整性。

### 3.3 连续性代理

latest_buy_contexts:152 对不晚于 as_of 的所有有效快照日期排序，取最后一日和紧邻上一份可用快照。只有两份间隔 ≤3 个自然日，且同一归一代码在上一份的动作集合恰好为 {buy}，才设 persistence_confirmed=true；可以向前逐份回溯相同条件，得到 first_seen_date。

这不是交易所日历，也不要求每个交易日都有快照。3 天只是允许缺口，遇长假会重置；周末重复清单可能满足清单连续性，但如果没有新闭合日 K，仍不能完成价格确认。若有一份覆盖范围不同的快照未列该股，连续性会中断，未必代表供应商撤销信号。

## 4. 冲浪结构的精确计算

实现：scripts/s1_surf_filter.py，默认参数 DEFAULT_RULES:43，由 config/workflow.json 的 s1_surf_filter 同名字段覆盖。配置中的 enabled 字段当前不在 build_payload 中作为执行开关读取；不能认为设置 false 会让独立脚本停止扫描。

### 4.1 时间与闭合 K 线

normalize_bars:269 解析 OHLC、按市场日期去重排序，并排除未来日期、非正价格和 high<low。美股日期使用 America/New_York，其余在 _bar_date 中使用 Asia/Hong_Kong；沪深与港股同 UTC+8，但这不是通用交易所映射。

latest_closed_bar_cutoff:236 对当前市场日额外等待正规收盘后 15 分钟：美股/港股 16:15，沪深 15:15，其他默认新加坡 17:15。截止日不超过 as_of 与当前市场日期较小值；未到宽限时点则退一天。历史 as_of 日期不改写，节假日依赖供应商不返回对应 K 线。半日市没有专门日历：通常会延迟认可，不应把它当精确交易所排期。

分析锚点 i = 最后一个 date≤first_seen_date 的有效日 K，可能是周末信号之前的交易日。不能将“9/12 信号”直接宣称为“9/12 K 线”。至少需 decline_lookback_sessions+base_window_min=25 根；窗口不足会标行情/历史缺失，不判“非冲浪”。

### 4.2 ATR、下跌、震荡

对每个窗口 w∈{5,6,7,8,9}，令起点 s=i−w+1，震荡 B=[s,i]，前段 P=[s−20,s−1]。以下 ATR A 始终是信号 K 线之前最多 14 根 TR 的简单算术平均，不是 Wilder 递推 ATR，且不含信号 K 线本身。

    TR[j] = max(H[j]−L[j], |H[j]−C[j−1]|, |L[j]−C[j−1]|)
    A = mean(TR[max(1,i−14) : i])
    peak = max(H in P)
    reference = median(震荡前两根收盘)
    decline = max(0, peak−reference)
    decline_pct = 100×decline/peak
    decline_atr = decline/A
    base_high = max(H in B); base_low = min(L in B)
    width = base_high−base_low
    range_pct = 100×width/median(C in B)
    range_atr = width/A

每天变动使用绝对收盘差，包含震荡首根相对于其前一根的变化：move[j]=|C[j]−C[j−1]|；分别除以前收盘、A。并计算窗口内最大绝对百分比、最大 ATR 倍数、中位 ATR 倍数。

有色 K 线定义：实体 C−O>0.10A 为 +1；O−C>0.10A 为 −1；其余为十字/无色 0。先去掉 0，再计算相邻颜色翻转次数/(有色数−1)。因此它不是所有相邻日的涨跌符号交替率。收盘斜率为以序号 0..w−1 做 OLS 线性回归的斜率，再除以 A。

### 4.3 七项硬门槛

| 门槛 | 当前默认条件 |
|---|---|
| prior_decline | decline_pct≥8% **或** decline_atr≥2 |
| quiet_range | range_pct≤12% **且** range_atr≤2.5 |
| small_daily_moves | max_move_pct≤6%、max_move_atr≤1.25、median_move_atr≤0.60，全部满足 |
| red_green_alternation | 有色 K 线≥3，交替率≥0.40 |
| flat_base_slope | OLS斜率/A 的绝对值≤0.18/交易日 |
| no_further_breakdown | 信号最低价≥此前震荡最低价−0.25A，且信号收盘位于整个窗口底部20%以上 |
| no_signal_day_chase | 信号当天绝对收盘变动≤6% 且≤1.25A |

信号收盘区间位置=(C[i]−base_low)/width，零宽时取 0.5。no_signal_day_chase 使用的是绝对变化，大跌也会被过滤；字段 signal_day_move_pct / signal_day_move_atr 没有正负号，不能用于报告“当日上涨多少”。有符号日收益应另算 C[i]/C[i−1]−1。

### 4.4 结构分与窗口选择

令 clamp(x)=min(1,max(0,x))，参数符号沿用上表：

    D = clamp(max(decline_pct/8, decline_atr/2) / 1.5)
    R = clamp(1−range_atr/(2.5×1.2))
    V = [clamp(1−max_move_atr/(1.25×1.2))
         +clamp(1−median_move_atr/(0.60×1.2))]/2
    F = clamp(1−|slope_atr|/(0.18×1.5))
    score = 100×[0.25D+0.20R+0.20V+0.15clamp(交替率)+0.10F
                 +0.05×I(no_further_breakdown)+0.05×I(no_signal_day_chase)]

只有七项全部为真，且未四舍五入的 score≥60，才 structure_pass。输出分数四舍五入到一位小数。5–9 日候选优先选 structure_pass=true，然后按已四舍五入分数最大、窗口较短；不是先选最短或最长。

这是项目设计的启发式排序分，权重不来自收益训练，也不是胜率或预期收益。修改参数必须保留版本，不能看过当日结果后调到某股“刚好通过”。

### 4.5 后续守位与状态

analyze_surf_structure:623 保持初次连续 Buy 锚点，不用后续 K 线重新优化当时底部。后续价格集为 signal_bar_date<date≤最新信号日；floor=base_low−0.25A。至少有一根后续闭合日 K 时，要求所有后续最低价≥floor，且最后一根收盘≥base_low。

| 输出状态 | 条件 | 意义 |
|---|---|---|
| missing_price_data | 历史不足或无法得到可评估结构 | 不得与“不合格”混为一谈 |
| forming_wait_persistence | 结构通过，清单连续性未确认 | 形成中，不入场 |
| persistence_price_pending | 结构通过，清单连续，但尚无后续闭合 K | 等待价格，不入场 |
| confirmed_surf | 结构通过、清单连续、后续守位均满足 | 只通过冲浪二级筛选 |
| not_surf | 结构不通过或确认后守位不通过 | 不升级原始 B |

confirmed_surf 的 actionable=true 仅是本模块字段，不等于全系统下单许可；完整研究候选还需要独立同向体系、13 买点 L1、流动性、有效失效位和账户风险门控。当前模块会记录 latest_price_date，但没有强制要求它等于最新应有交易日；缓存非空且结构可算可能仍为 ready，接手时必须增加行情时效检查，不能仅看 ready 或信号日。

## 5. 一股翻仓回测

实现：scripts/backtest_s1_one_share.py。

### 5.1 成交状态机

prepare_executions:304：对每个事件，寻找严格晚于 signal_date 的第一条现存日 K，使用该根 open；如果没有更晚 K，则 pending。多个休市日信号落到同一开盘，只执行信号日期最晚的一个，计入 superseded_before_same_open。只有日期、没有发现时刻，所以“收盘后已知”是模型假设。

simulate_symbol:370：每股独立维护状态 q。

| 当前状态 | Buy：两模式 | Sell：long_short | Sell：long_flat |
|---|---|---|---|
| 0 | 开多1股，q=+1 | 开空1股，q=−1 | 继续空仓 |
| +1 | 忽略，不再买 | 同一开盘先平多、再开空1股 | 平多，q=0 |
| −1 | 同一开盘先回补、再开多1股 | 忽略，不再空 | 只多模式不应有该状态 |

一笔 +1→−1 的真实股票数量变化为卖出2股；回测按平仓腿与新空腿记录，资金脚本合并成同日同代码同方向 quantity=2 的估算订单。重复信号没有加仓。

截止时未平仓用最后可用日 K 的 close 标记，status=open，而不是假装已经成交平仓。回测 load_bars:271 不像冲浪模块那样排除当前未闭合日 K，只在报告里按最新抓取时间给出盘中提示；同一批不同标的抓取时刻也可能不一致。

### 5.2 损益、费用与分母

finalize_leg:343 对每段一股持仓、方向 d∈{+1,−1}：

    gross_pnl = d×(exit_or_mark_price−entry_price)
    gross_return = d×(exit_or_mark_price/entry_price−1)
    illustrative_cost = (entry_price+exit_or_mark_price)×cost_bps/10000
    net_pnl = gross_pnl−illustrative_cost

默认每边 10bp，仅是统一成本敏感性。未平仓也扣除假想退出那一边费用，因此净额是“现在平掉”的估算；不等于账户已扣费用。字段名 net_pnl_10bps 不随 --cost-bps 改变，报告也写死10bp，改变费率时必须同步修正展示。

exposure_stats:458 在全部缓存日期并集上滚动前值，以 entry_date≤日且（open或日<exit_date）判断活跃仓；当日已翻出的旧腿不再计入该日收盘。每股绝对收盘市值相加得到每日 gross，取最大值 peak_eod_gross。

    gross_pnl_over_peak_gross = 全部已实现及未实现毛损益 / 期内最高收盘总名义敞口
    net_pnl_over_peak_gross = 示意净损益 / 同一分母

该比值不是按初始资金算的账户收益率、不是 TWR/IRR、不是日内最大资金需求。gross 市值不对多空抵销。一股策略也不是每股等资金权重，价格高的证券自然占用更多资本。

胜率按交易段等权：毛损益>0 的段数/段数；零收益不算赢。默认总胜率包括未平仓标记，另有 closed_win_rate / open_win_rate。平均和中位 gross_return 也是每段等权，不可当组合资金收益率。USD、HKD、CNY 分账，不直接相加；跨币种段收益率统计只能用于这种等段描述。

### 5.3 数据完整性和研究限制

- 请求默认12并发、45秒、失败重试2次；没有动态停牌、开盘流动性、涨跌停、实际可借券和强制回补检查。
- 只过滤价格 date≤as_of；main 没有先把事件列表截到 as_of，因此历史重跑的事件总数、date_max、pending、别名等元数据可能混入未来信号。价格限制通常阻止其成交，但它仍不是严格点时快照回放。
- 回测没有 OHLC 完整性/非有限数全面校验，没有像冲浪模块一样按日期去重。需要在适配器契约层统一。
- 执行计数器 ignored_sell_while_flat 的命名与当前分支不符：真正空仓遇Sell会先进入 ignored_same_direction；该计数器反而可能计入 long_flat 正常平多的Sell。它不改变交易腿损益，但不宜拿来解释“空仓忽略了几次S”。
- 缺价标的不贡献损益，这可能造成覆盖选择偏差，不能仅报告成功样本胜率。
- 前复权与原始价格混用的“每股”不必然对应真实股数及现金流；拆股、合并、股息、退市和借券代偿未完整模拟。
- A 股/港股每标的1股是研究单位，不保证满足最小交易单位；A 股做空、港股借券、OTC/杠杆 ETF 可交易性均未验证。
- 没有接入 S1 实时发现日志、冲浪确认、13 买点、真实佣金、融资融券资金账；不能把此回测称为全系统可执行收益。
- build_report:642 含固定“空头平均为负”“样本约三周”“A/H差异接近零”“拆股均在首信号前”等旧样本结论，后续应由计算动态生成，不应自动当成新结果。

## 6. 美股/A股两组合比较

实现：scripts/analyze_s1_market_variants.py，VARIANTS:22，summarize:42，main:177。

| 组合 ID | USD交易腿来源 | CNY交易腿来源 | HKD |
|---|---|---|---|
| us_ls_cn_long_no_hk | long_short | long_flat | 不取 |
| us_cn_long_no_hk | long_flat | long_flat | 不取 |

它不重新撮合，而是从基础交易腿 CSV 选择币种和 variant，按前章公式加总；每币种峰值敞口沿用对应基础账本。增量做空收益=多空USD毛损益−只多USD毛损益；净值差、峰值敞口差也类似。峰值增幅=(多空峰值/只多峰值−1)，收益/峰值差以百分点展示。

没有统一汇率、初始资金和两市场资金分配，不存在唯一“美股+A股总账户收益率”。报告当前固定宣称只多更优、美股当日盘中、A股已实现亏损等，不能直接套用于更新后的数据。空账本、缺币种、无空头段没有充分防护，扩展运行前应补单元测试。

## 7. 美股资金需求模型

实现：scripts/analyze_s1_us_capital.py，仅使用组合交易腿中 currency=USD 的部分，不读取券商账户，也不提交股票订单。下述费率/保证金是代码中保存的历史假设，**不是2026-11-08重新核实的IBKR规则**；实盘必须按账户实体、证券与当前券商 Margin Impact 更新。

### 7.1 订单和基础佣金

build_orders:109 把每段入场及真实 closed 退出变成方向事件，按 (日期,代码,BUY/SELL) 合并，价格不同则报错；open 的末端标记不作为真实平仓订单。quantity=2 的翻向只计一个合并订单最低佣金。

order_commission:95，N=股价×数量：

    tiered = min(max(0.0035×数量, 0.35), 0.01×N)
    fixed  = min(max(0.0050×数量, 1.00), 0.01×N)

未计转嫁的交易所、清算和监管费用，也不是全账户阶梯定价模型。资金模型使用毛损益并另计这些佣金，不能再叠加回测 net_pnl_10bps 后重复扣费。

### 7.2 每股保证金假设

short_minimum:79 对价格 p 保存的空头维持下限 f(p)：p≤2.50时2.50；2.50<p<5时p；5≤p≤16.67时5；p>16.67时0.30p。

| 模型 | 多头每股 | 空头每股 |
|---|---:|---:|
| maintenance | 0.25p | f(p) |
| regt | 0.50p | max(0.50p,f(p)) |
| short_100 | 0.50p | max(p,f(p)) |
| full_100 | p | max(p,f(p)) |

requirement:262 把每条活跃一股腿需求相加。不含组合保证金、杠杆ETF倍数、集中度、证券特殊house margin、借券可得性、追保顺序及保证金临时上调；“full_100”也不是所有风险的绝对最坏上界。

### 7.3 重叠持仓、价格压力和初始净值

analyze_variant:300 在缓存交易日并集逐日重建活跃腿；退出日在开盘关闭旧腿，按新腿计算当天持仓。缺当日K会沿用 last_bar，数据缺口必须另行标记。

每天分别计算开盘、收盘、各股最高价的多/空名义市值之和；各股“最高价”通常不是同时出现，因此只是非同时压力。adverse_prices 对多头取日低、空头取日高，也不同时，且不是严格逐笔最大回撤。

    pnl_close = 截至当天已实现毛损益 + 活跃腿按收盘未实现损益
    pnl_adverse = 截至当天已实现毛损益 + 活跃腿按多低/空高未实现损益
    E_required[t] = margin_requirement[t] − pnl[t] + 累计tiered佣金[t]
    历史最低初始净值估计 = max_t(E_required[t])

代码分别报告 Reg T 收盘、Reg T 不利价、short_100 不利价、full_100 不利价。它只覆盖离散日线情景，不证明真实账户任何盘中时刻都不会追保。

### 7.4 只多现金和20%缓冲

从现金0开始，Buy记负现金流、Sell记正现金流，另累计基础佣金。每日所有订单结算后的最低现金取负，得到净结算最低起始现金。另算同日“先买后卖”：从前一日现金先扣当日全部买单及买卖佣金、暂不入卖出所得，取最小值。

此模型没有结算日历、未结算现金限制、外汇/融资、实际成交顺序及部分成交。现金账户不能直接将净结算结果当作实时可用购买力。

    只多 sizing_base = max(先买后卖现金估计, 各股日高总名义峰值)
    多空 sizing_base = full_100不利价下最低初始净值估计
    operational_target = ceil(1.20×sizing_base / 5000)×5000 USD

20%与向上取整5000是研究缓冲，不是券商保证，也没有统计校准。历史峰值不保证覆盖下一批新增信号或跳空。

### 7.5 当日尚待执行篮子

estimate_pending_basket:140 只取 date==as_of 的美股信号。基于当前open腿设目标 +1/−1/0，delta=目标−当前；重复同向 delta=0，翻向 |delta|=2。价格先取已有缓存最后收盘，缺失再用IBKR待执行快照；未取得价格的代码明示 missing，不猜价格。

待执行篮子只输出参考买/卖名义、净现金购买、目标保证金和预计订单，不写入历史已成交收益。资金 operational_target 在此前按历史情景计算，待执行篮子没有自动并入该目标，报告不得宣称该缓冲必定足够。

另一个待修边界：pending输出的 target_short_100_reference=0.5×多头名义+空头名义，target_full_100_reference=总名义，未像历史 requirement 一样对低价空头应用 max(p,f(p))。低价空头场景下可能低估，更新前应统一。

### 7.6 批量下单的状态

这里没有可执行 BasketTrader CSV 生成器或 IBKR 下单客户端；orders_detail 是研究数据。旧报告讨论了 BasketTrader/API路径，但不能据此声称“一键下单功能已经完成”。有关接口限制、费率和保证金的旧报告链接只作历史来源，接手实现时须重新读当前官方文档并获得单独交易授权。

## 8. 可复现命令与顺序

在原研究项目根目录、准备好既有输入后运行；文档核验没有替用户执行下述在线抓取或旧报告重算。

~~~bash
# 日常冲浪：仅用不晚于指定日的信号，offline不联网
python3 scripts/s1_surf_filter.py --as-of YYYY-MM-DD --offline
# 必要时显式刷新行情（需Longbridge授权）
python3 scripts/s1_surf_filter.py --as-of YYYY-MM-DD --refresh

# 回测：先检查不可变信号/行情覆盖和缓存，再离线重算
python3 scripts/backtest_s1_one_share.py --as-of YYYY-MM-DD --offline --cost-bps 10
python3 scripts/analyze_s1_market_variants.py --as-of YYYY-MM-DD
python3 scripts/analyze_s1_us_capital.py --as-of YYYY-MM-DD

# 现有冲浪单元测试；不触发市场请求
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_s1_surf_filter.py -v
~~~

同日期输出会被覆盖。严肃历史复现应先复制/哈希输入、配置、源代码与旧产物，使用隔离运行目录；不要一边更新日线缓存一边把结果叫不可变回放。默认 --as-of 在回测里使用运行主机 date.today()，自动化应显式传入用户时区日期。

## 9. 本次文档核验与后续优先级

2026-11-08完成：逐函数阅读本章列出的7个脚本和冲浪测试，核对 config/workflow.json 的参数；现有冲浪5项单元测试全部通过。另作无文件写入的合成算例：B后110开多、重复B被忽略、S后130平多并开空、末端140标记；得到多头毛利20、空头浮亏10、每边10bp合计示意成本0.51；并独立核对佣金与2.50/5/16.67价格边界。这些是实现检查，不是策略有效性证明。

优先完成以下事项，未完成前不要发布“策略已可靠验证”的结论：

1. 与用户确定“固定±1股翻仓”和“每次信号加1股”究竟要跑哪个，分别命名与回测，不混报。
2. 建立 append-only 发布日志：received_at、source_snapshot_id、signal_date、symbol、action、candle_anchor、revision/撤回关系、原图/文本哈希；以实际可见时点重放。仅有今日历史图无法恢复过去被删除的信号。
3. 先修复三份回测/资金报告里的硬编码日期、数量、费用和结论；把当前已计算事实与历史解释分开。
4. 统一点时过滤、闭合K、交换所节假日、行情覆盖、公司行动及复权契约；特别处理数据缺口被当成下一交易日的问题。
5. 为回测状态机、同开盘覆盖、同日冲突、空账本、未来事件、低价空头、结算现金和待执行保证金补测试；目前本章发现的回测/资金边界尚无对应专用测试文件。
6. 把冲浪/13买点条件接入新的、事前固定参数的策略模拟；输出同一成交假设下原始S1与筛选后样本的覆盖、费用、换手、回撤和样本外表现，避免只展示筛完后的胜率。

研究用途，非投资建议。
