# 美股期权、异常雷达与 S1 3/5 日流量排查

审计日期：2026-11-08（Asia/Singapore）。这是**代码与方法交接**，不是当日行情报告。本次未联网采集，未核实当前订阅权益、价格、费率或供应商故障是否已经修复。下文参数来自本次读取的 `config/workflow.json`；源码是实际行为的控制证据，不能把设计目标误写为已经实现的保证。

适用源码：`scripts/collect_longbridge_options.py`、`scripts/s1_forced_flow.py`、`tests/test_s1_forced_flow.py`。本模块只生成研究数据，不下单、不改单、不撤单；异常度和证据分均不是概率、胜率或收益预测。

## 1. 先理解这条链在回答什么

```text
已入库 S1 Buy/Sell
  → 每个美股代码最近一次信号，限定 5 个近似交易日
  → 全量轻量报价预检
  → 核心/固定观察 + 有数量上限的高优先级候选
  → 多到期期权面、历史成交、日K、HV/IV
  → 有限监测池异常度排序
  → 成交量达门槛的 Top3：一个重点到期的完整标准行权价
  → OI、Greeks、少量代表合约盘口与逐笔、可比归档 ΔOI
  → S1 证据阶段 + Top3 期权进程卡
```

“全量”只指窗口内 S1 代码的报价预检；不是全部代码的完整链，更不是全市场扫描。期权异常雷达 Top3 与 S1 进程卡 Top3 使用不同排序，不能混称同一组候选。

分析逻辑是先发现异常，再寻找价格、成交、IV 和 OI 的延续或反证；不以 Call 多、Put 多直接推断买卖方向。Buy 对应的文字假设是“逼空/新买需求候选”，Sell 对应“多头去杠杆/保护需求候选”，都不是已经证实的机制。

## 2. 数据来源、调用及产物

| 输入 | 当前实现的来源/命令 | 真实用途与限制 |
|---|---|---|
| S1 | `data/s1/signals.csv` | 用户或已校验同步输入；字段 `date,action,symbol,name,market,sector_key,source,note`，不从期权反推 B/S |
| 正股报价 | `longbridge quote SYMBOL.US --format json` | 最新正规时段价格/昨收/高低/量/成交额；同时保存可得扩展时段报价 |
| 期权到期集合 | `longbridge option chain SYMBOL.US` | 从返回集合选 0/7/30 DTE 附近到期 |
| 某到期链 | `longbridge option chain SYMBOL.US --date YYYY-MM-DD` | 标准合约的行权价、最近价、IV、成交量；此处 `--date` 是**到期日** |
| 即时期权成交汇总 | `longbridge option volume SYMBOL.US` | `current_put_call_ratio`，独立于每日历史数据日 |
| 每日聚合成交/OI | `longbridge option volume daily SYMBOL.US --count 60` | 最近数据日、Call/Put 总成交、P/C、聚合 OI 与前序常态 |
| 正股日K | `longbridge kline SYMBOL.US --period day --count 65` | HV20/HV60、S1 事件价格响应；计数为 `max(65, history_days+1)` |
| 抽样/深扫期权报价 | `longbridge option quote CONTRACT...` | OI、合约最新报价及时间等供应商字段 |
| Greeks | `longbridge calc-index CONTRACT... --fields iv,delta,gamma,theta,vega,rho,oi,exp,strike` | 合并到已取得的报价；实际合并仅覆盖 Delta/Gamma/Theta/Vega/Rho，不凭请求字段推断所有字段都有返回 |
| 少量合约盘口 | `longbridge depth CONTRACT` | 抓取时点最佳买卖与深度；不是每笔历史成交时的 NBBO |
| 少量合约逐笔 | `longbridge trades CONTRACT --count 1000` | 有限近期样本；Up/Down 是 tick rule，不是 ask 主买/bid 主卖 |
| ΔOI 基线 | `data/options/equity_history/equity_日期.json` | 最近一个早于本次报告日的全局归档；只比较同代码/到期/行权价/Call-Put 侧 |

所有 CLI 调用附加 `--format json`，认证由本机已授权 `longbridge` CLI 管理。脚本不需要在文档中粘贴任何 token。普通请求默认 75 秒，部分完整链请求 90/120 秒；每次 CLI 调用最多尝试 3 次，间隔 1.5 秒和 3 秒。失败落入 `errors`，有部分数据时返回 `partial`。

日常完整采集：

```bash
python3 scripts/collect_longbridge_options.py --date YYYY-MM-DD
```

输出：

- `data/options/equity_latest.json` 与 `data/options/equity_history/equity_YYYY-MM-DD.json`，当前 `schema_version=6`。
- `data/s1/forced_flow_latest.json` 与 `data/s1/forced_flow_history/forced_flow_YYYY-MM-DD.json`，当前 `schema_version=2`。
- 配置固定观察代码的 `data/options/<slug>/latest.json` 与同目录 `history/`。
- 日报流程再读取进程卡，生成 `outputs/daily-trade-workflow/daily_push_latest.json` / `.md`，由推送摘要引用。

这些输出含券商市场数据，应按本项目发布白名单处理；“用户要 GitHub 文档”不等于授权上传全部行情缓存或账户快照。

### 2.1 参数行为和运行注意

`--symbols ALAB.US AMZN.US` 是显式单标的模式：跳过 S1 上下文，只写每个代码的独立快照，**不覆盖**全局 `equity_latest.json` 或 `forced_flow_latest.json`。必须传供应商可识别的代码；脚本只转大写，不替显式参数自动补 `.US`。

`--core-only` 只采核心代码，但仍会构造近期 S1 上下文，并覆盖全局文件；未取报价的其他 S1 代码会显示预检缺失。它不是可以无感替代完整日报的等价结果。

`--max-candidates N` 覆盖 S1 期权面名额，并不限制全体报价预检；核心/固定观察之外再加 N 个候选。显式 `--symbols` 可绕过通常的候选数量选择，因此操作者须保持有界请求。

**重要：顶层采集脚本的 `--date` 不是历史行情截至日。** 它控制报告标签、到期选择和 S1 窗口，但 `quote`、`kline`、期权链仍请求运行时最新数据。不要用旧日期运行并把结果称为无未来数据的历史重放。

## 3. 当前配置快照

| 配置项 | 本次文件值 | 解释 |
|---|---:|---|
| `options.longbridge_core_symbols` | SPY.US、QQQ.US、NVDA.US | 固定核心代理 |
| `options.longbridge_pinned_symbols` | CRCL.US、SPCX.US | 固定观察；不等于任何推荐 |
| `longbridge_max_candidate_symbols` | 9 | 核心/固定观察之外的 S1 面采集名额；默认最多约 14 只，重合会减少 |
| `longbridge_expiries_per_symbol` | 3 | 目标 DTE 为 `[0,7,30]` |
| `surface_moneyness` | −10%、−5%、−2.5%、0、2.5%、5%、10% | OTM 侧加 ATM 双侧的近似抽样 |
| `history_days` / `max_workers` | 60 / 4 | 历史成交请求条数及面采集线程；代码线程硬界为 1–6 |
| `deep_dive_top_count` | 3 | 完整重点到期深扫数量；代码硬界为 1–5 |
| `deep_dive_min_total_volume` | 3000 张 | 最近聚合成交日总量门槛；不是所有合约的成交门槛 |
| `microstructure_window_pct` | 20% | 代表合约选取的距现价范围；无范围内合约时回退全链 |
| `microstructure_contracts_per_side` | 2 | 每侧最多 2 张，代码硬界为 1–3 |
| `microstructure_trade_count` | 1000 | 每合约请求近期逐笔数，硬界为 20–1000 |
| `large_print_min_contracts` | 50 张 | 大单痕迹阈值之一 |
| `large_print_min_gross_premium_usd` | 100000 美元 | 大单痕迹阈值之二，与张数阈值为“或” |
| `contract_watch_min_volume` / `contract_watch_limit` | 50 / 12 | ΔOI 优先观察合约；limit 硬界为 4–30 |
| `s1_forced_flow.early_window_sessions` / `confirmation_window_sessions` | 3 / 5 | 近似交易日窗口 |
| `precheck_min_directional_move_pct` | 2.5% | 报价点火门槛及部分绝对收益回退阈值 |
| `ignition_atr_multiple` / `ignition_relative_volume` | 1 ATR / 1.5 倍 | 有日K时的点火门槛 |
| `high_priority_score` / `medium_priority_score` | 50 / 30 | 还须同时满足证据覆盖率 |
| `max_push_option_cards` / `contract_hotspot_limit` | 3 / 4 | 最多进程卡数与每卡热点数 |

配置还保留 `longbridge_aggregate_volume_exclusions["SPCX.US"]`：因代码复用导致历史聚合接口可能对应旧 ETF，聚合 `option volume` 与 `option volume daily` 整层不请求、不补造 P/C/OI 历史。**这是现有配置保护，不是本次重新验证了供应商仍故障。** 接手者必须先核验证券身份与供应商映射，再决定是否解除；不能因为其它期权链能返回就直接解除。

## 4. S1 窗口与报价预检（55 分）

### 4.1 归一、去重与时效

`normalize_us_symbol()` 接受美股/美国ETF/US/USA 等标签及空市场标签；剥离已有 `.US` 再加回。明确拒绝 `.SH/.SZ/.HK` 和首字符为数字的代码。只保留 `buy/sell`、合法日期及不晚于报告日的记录。

每个代码按 `(信号日,原始行位置)` 排序，使用最后一条最新信号。同日若同时存在 B/S，仍保留最后一条作为上下文，但标记 `same_day_conflict`，不能将排序当作哪条信号正确的证明。

`business_session_age(start,end)` 排除信号日、包含结束日，只数周一至周五；**未纳入美股交易所假日或半日市**。年龄 `<=3` 为“3日点火预警”，`4–5` 为“5日延续确认”，`>5` 不进入窗口。最近反向信号与当前信号相隔 `<=3` 个近似交易日即 `rapid_flip=true`。

### 4.2 预检公式

统一定义 `clip(x)=max(0,min(1,x))`，方向 `d=+1`（Buy）或 `−1`（Sell）。

- 报价日涨跌 `r=(last/prev_close−1)×100`，优先使用供应商涨跌字段；同向变化 `m=d×r`。
- 收盘位置 `L=clip((last−low)/(high−low))`，Buy 用 `L`，Sell 用 `1−L`；分母零或字段缺失时为缺失。
- 时效分 `10`（年龄≤3）或 `5`（年龄4–5）。
- 快速反转分 `5`（成立）或 `0`。
- 变化分 `20×clip(max(m,0)/10)`。
- 收盘位置分 `10×clip((L_directional−0.5)/0.4)`。
- 流动性分 `10×clip(log10(max(turnover,1))/10)`。

合计满分 55；覆盖率分母也是 55，其中时效+反转固定计 15 分可用权重，其余按字段存在与否计权重。`status=ready` 仅要求报价字典非空，不代表每一字段完整。

轻量点火门槛：`m>=2.5%`，且同向收盘位置缺失或 `>=0.6`。候选名额依次按“是否过门槛、55分预检得分、成交额”降序挑选，核心与固定观察不消耗这部分候选名额。

## 5. 日K事件响应与 RVOL/ATR

`daily_price_profile()` 对日期不早于信号日的 K 线作为 `active`；基准为首个 active 交易日之前一根日K收盘。若没有之前数据，则回退首个 active 日开盘，并记录 `reference_method`。

```text
原始响应% = (最新收盘 / 基准价 − 1) × 100
同向响应% = d × 原始响应%
TR_t = max(H_t−L_t, |H_t−C_(t−1)|, |L_t−C_(t−1)|)
ATR20_before_signal = 信号前最多20根可用TR的算术平均
ATR20% = ATR20_before_signal / 基准价 × 100
同向响应ATR = 同向响应% / ATR20%
RVOL = 最新日成交量 / 此日前最多20根可用日K成交量的平均
```

这里不是 Wilder 平滑 ATR；不足20个可用 TR 时也会用较短平均，不会一律报缺失。RVOL 的基准是**最新K之前**20根，而不是固定在信号前，因此多日观察时可能包含信号后的日K。

Buy 的有利/不利极值以 active 全部最高/最低价相对基准求最大/最小百分比；Sell 取反向计算。最新收盘区间位置仍按 `(C−L)/(H−L)`，Sell 取 `1−位置`。

**事件响应不等于可交易收益。** 以信号前收盘为基准会包含信号当日整段行情。若 S1 在当日收盘后才看到，不能把当天涨跌算成执行这条信号得到的收益。真实策略回测必须另用首次可知时间和之后的可成交价格。

## 6. 期权面与波动率计算

### 6.1 到期与行权价抽样

`choose_expiries()` 对每个 0/7/30 目标 DTE，从尚未选中过的、到期日不早于报告日的集合中选绝对距离最近者；距离相同选较早到期，再按到期排序截断。没有插值成“恒定30天IV”。

仅采用 `standard=true` 的行权价。各 moneyness 目标取最近行权价：负目标选 Put、正目标选 Call、0 选两侧；重复 `(strike,side)` 去重。`chain_volume_15pct` 汇总的是现价±15%内的成交及最高成交行权价，不是所有行权价或全部到期。

### 6.2 HV、IV 与预期波动

```text
log_return_t = ln(C_t/C_(t−1))
HV_n = sample_std(last n log returns, ddof=1) × sqrt(252)
ATM_IV = 最近现价行权价的可用 Call/Put IV 的均值
IV/HV = 最前所采到期 ATM_IV / HV20
预期波动点数 = Spot × ATM_IV × sqrt(max(DTE,1)/365)
预期波动比例 = 预期波动点数 / Spot
```

HV20/HV60 至少分别需要21/61个正的、可解析收盘价。IV 只接受 `[0.005,5]`（0.5%–500%，小数单位），其它值当作缺失。只有单侧 ATM IV 可用时均值就是该侧值，不插造另一侧。

`IV/HV >1.3` 为 `iv_rich`，`<0.8` 为 `iv_cheap`，边界及中间为 `balanced`；这只是项目规则，不是波动率套利结论。IV percentile/rank 留空，原因是没有历史 IV 序列，不能拿历史股价替代。

预期波动是模型观察带，不是 straddle 中价、目标价或保证区间。0DTE 也按至少一天计算。进程卡中 `_selected_expiry_model()` 的文字公式写成 `sqrt(DTE/365)`，但数值源头实际采用 `max(DTE,1)`；接手应统一说明，不能按文字对0DTE复算出零。

### 6.3 期限与 moneyness skew

前端为已采到期中最早者，后端为最晚者。比值 `front_IV/back_IV`：

- `front > back×1.05`：`backwardation`。
- `front < back×0.95`：`contango`。
- 否则（包括部分缺失）：`flat_or_unclear`。

`skew_95p_105c = IV(最接近0.95×Spot的Put) − IV(最接近1.05×Spot的Call)`。使用最近交易 IV，不是25Δ risk reversal；也没有统一的历史分位标准。

### 6.4 聚合成交常态

`parse_volume_history()` 假定供应商 `stats` 已按日期升序，直接取最后一行；将时间戳按 UTC 日期保存为 `latest_date_utc`。

基准 `prior_baseline` 使用除最后一行以外全部已返回行（配置请求60条，通常最多59个基准点）。Call/Put/总量倍数分别为“最后一日值 / 前序对应均值”；P/C 制度倍数为“最后一日P/C / 前序P/C算术均值”。注意 P/C 的算术平均与“合计Put量/合计Call量”不是同一统计量。

异常 z-score `(当前值−基准均值)/样本标准差` 要至少5个基准值，且标准差不为0。Call、Put、总量、P/C 四组均独立计算。另一个展示字段 `volume_put_call_average/zscore` 使用包含最新日的全样本，**异常雷达评分用的是排除最新日的 `*_prior` 口径**，不要混用。

## 7. 异常雷达（100 分）

每项 `贡献=权重×clip(原始异常强度/饱和值)`，缺失贡献0，不把剩余权重重新归一到100。完整度是“可用项数/6”，不是按权重计。

| 组成 | 权重 | 原始异常强度 | 饱和值 |
|---|---:|---|---:|
| 单侧成交冲击 | 25 | max(abs(Call z), abs(Put z)) | 3 |
| 总成交冲击 | 20 | abs(总量 z) | 3 |
| P/C 制度偏移 | 15 | abs(P/C 前序 z) | 3 |
| IV/HV 错位 | 15 | abs(ln(前端IV/HV20)) | ln(1.5) |
| 期限斜率 | 10 | abs(ln(前端IV/后端IV)) | ln(1.2) |
| 两翼偏斜 | 15 | abs(95P IV−105C IV) | 0.12 |

注意 z-score 取绝对值：**成交异常萎缩也能得高异常分**。高分不是必然放量、看多或看空。分档：`>=70 极端`、`>=50 显著`、`>=30 注意`、其余普通。

方向假设另做投票：

- 看多票：Call量倍数≥1.35且≥Put倍数×1.15；P/C制度倍数≤0.8；skew≤−0.04。
- 看空票：Put量倍数≥1.35且≥Call倍数×1.15；P/C制度倍数≥1.25；skew≥0.04。
- 两侧量倍数都≥1.3，或 IV/HV≥1.25 且 backwardation，优先称“双边波动部署假设”。
- 否则看多票≥2且看空票=0为“上行需求假设”；看空票≥2且看多票=0为“下行保护或看空假设”；两边都有票为冲突；其余未定向。

雷达排序按异常度、最近聚合日总量降序。只有总量≥3000且有可用到期的排名前3进入完整链；即使链有异常，没有聚合成交数据也不能通过该流动性门槛。SPCX 聚合排除因此会限制其默认完整链深扫资格，不能把它解释成“没有期权机会”。

## 8. 完整重点到期、Greeks 与微观结构

### 8.1 “完整”范围

只从前面已采的到期集合中，选最近一个第三个周五（日期15–21号）、DTE7–75的标准月度到期；没有则选最接近30天的到期。抓取**这个到期全部标准行权价的 Call/Put**，不是重新遍历所有到期。

合约初始请求每批500；失败时对半拆分，≤20张的失败子批记录错误并停止拆分。抽样面报价每批45。Greeks 由 `calc-index` 合并；目前若 calc-index 返回缺失，会把该字段写成空，而非继续沿用原报价中的 Greeks。

OI 集中位按 OI 降序取前3；既有全到期行权价集合版，也有现价±20%局部版。局部版 `share_of_side_oi` 的分母仍是该到期全侧 OI，不是局部总 OI。不能把这些位置自动称为支撑、压力、做市商墙。

### 8.2 实际 Delta 翼与无符号敏感度

对10Δ、25Δ，两侧分别寻找实际 Delta 最接近 +0.10/+0.25 或 −0.10/−0.25 的可用合约。优先选有成交或 OI 的合约；距离相同时优先更靠近现价。没有插值；必须展示实际 Delta 和目标差距。

```text
RR25 = IV(25Δ Call) − IV(25Δ Put)
PutPremium25 = −RR25
Fly25 = [IV(25Δ Call)+IV(25Δ Put)]/2 − ATM_IV
RR10 同理

GrossDelta = |Delta| × OI × 100 × Spot
GrossGamma_1pct = |Gamma| × OI × 100 × Spot² × 0.01
GrossVega_1vol = |Vega| × OI × 100
GrossTheta_1day = |Theta| × OI × 100
```

分别按 Call/Put 汇总，并给出各敏感度前5热点及占比。乘数100只适用于本模块过滤的标准美股期权。Vega/Theta 的单位依赖 CLI 约定；现有 payload 将其标注为每股/1vol 与每股/日，迁移供应商时必须重新核对单位。

这些是 OI 加权绝对敏感度集中，不知道任何交易者的持仓正负号。**不是净GEX、Gamma flip、做市商方向或账户风险值。** 代码把缺失 OI 在敏感度求和中按0处理，因此汇总可低估；必须联读 OI 与 Greeks 覆盖率。

### 8.3 合约观察与逐笔

观察表先过滤成交≥50张。`Volume/OI` 分母为0或缺失则空；OI=0且有成交单独标记，不用无穷大代替。

观察排序分：

```text
[OI=0且有成交 ? 5 : min(Volume/OI或0,5)] × 20
  + 4×ln(1+Volume)
  + ln(1+max(Last×Volume×100,0))
  + [OI可用 ? 5 : 0]
```

同分再按成交额代理和成交量排序，留最多12张。`Last×Volume×100` 是最后价乘全天张数的**成交额代理**，不是逐笔加总的真实成交额。

微观结构每侧取“最高成交”和“成交/OI异动”两个角度，去重行权价后补活跃合约；通常每侧最多2张，优先现价±20%。请求每张最近最多1000笔、盘口最多展示10档。价差比例为 `(ask−bid)/((ask+bid)/2)`。

逐笔毛权利金 `print_price×print_volume×100`；若张数≥50 **或**毛权利金≥100000美元即大单痕迹候选。只从各合约按毛权利金排序前10笔中筛，再去重并保留全雷达前20条，不是完整大单普查。

tick失衡 `(UpVolume−DownVolume)/(UpVolume+DownVolume)`；Neutral不在分母。Up/Down仅相对上一笔价格，不能当主动买/卖。盘口抓取时点、逐笔时点及日成交量/OI的统计时点可能不同；缺历史NBBO、多腿标识和账户身份，不能判定“机构埋伏”“净流入”或“新增仓”。

## 9. ΔOI：实际比较的是两个报告快照

`previous_equity_snapshot()` 只读取文件名日期小于本次报告日的最新全局归档，不要求相邻交易日。`attach_open_interest_change()` 找到同一代码且同一到期后，再按行权价与Call/Put侧匹配：

```text
ΔOI_contract = OI_current − OI_previous
同侧总ΔOI = 所有可比合约的ΔOI之和
```

两边OI任意缺失则该合约变化为空，不纳入总量。没有同到期旧链时为 `baseline_established`；找到旧链且至少1张可比合约即 `ready`，无可比合约为 `partial`。输出最大的10个增加与10个减少，以及逐合约变化。

**现有“次日 OI”名称强于代码保证。** 代码未校验两个观测的实际结算日是否相邻、是否重复同一结算日、可比合约覆盖是否足够，亦未校验整个 ΔOI 区间都发生在首次获知S1之后。跨多日报告差也能得到 `ready`。接手修复前只能称“两个报告快照的可比OI变化”，并展示两端日期；不能无条件称为严格次日新增仓确认。

显式单代码快照模式仍使用全局 `equity_history` 寻找旧基线，并不从该代码自己的 `history/` 查找；连续运行 `--symbols` 不保证获得独立链路的 ΔOI。

## 10. S1 证据分（100 分）与阶段判定

这与第7节雷达异常度不同。缺失项记0，证据覆盖率为**可用项目权重之和/100**，不归一重算。当前借券/解禁/事件定位未实现，正常情况下最大可用覆盖率为95%。

| 组成 | 权重 | 得分 |
|---|---:|---|
| 信号时效 | 10 | 年龄≤3得10，否则5 |
| 快速反转 | 5 | 成立得5，否则0；该项始终计为可用 |
| 价格响应 | 20 | `20×clip(max(同向响应ATR,0)/3)`；ATR缺失才回退 `20×clip(max(同向响应%,0)/12)` |
| 收盘位置 | 10 | `10×clip((同向位置−0.5)/0.4)` |
| 相对成交量 | 15 | `15×clip((RVOL−1)/2)` |
| 同向期权异常 | 20 | 聚合流日期可用且方向假设与S1同向时 `20×clip(异常分/70)`，否则0 |
| 同合约ΔOI | 15 | `15×clip(max(同向侧总ΔOI,0)/5000)`；要求OI状态ready |
| 借券/解禁/事件定位 | 5 | 当前固定缺失与0分 |

同向期权方向只认 Buy+“上行需求假设”、Sell+“下行保护或看空假设”；双边/冲突/未定向都不算同向。聚合流日早于信号日或日期缺失时，既不用于确认也不用于反证。该规则只做日期下界判断，没有同日首次出现时刻或报告日期上界校验。

辅助条件：

- `price_ignition`：有同向响应，ATR可用时≥1ATR，否则≥2.5%；同向收盘位置缺失或≥0.6。
- `volume_ignition`：RVOL≥1.5。
- `oi_confirmed`：OI状态ready且同向侧总ΔOI>0。
- `exhausted`：同向响应≥12%且同向收盘位置<0.45；这是固定绝对涨幅条件。
- `contradicted`：同向响应≤−2.5%，或反向期权假设且异常分≥40，或OI状态ready且同向侧总ΔOI<0。

阶段按下列优先级自上而下首次命中：

1. 同日 B/S 冲突 → `signal_conflict`。
2. 反证成立 → `contradicted`。
3. 衰竭条件 → `exhaustion_watch`。
4. OI确认 + 价格点火 + 同向期权 → `oi_roll_confirmed`；**这一分支不额外要求RVOL≥1.5**。
5. 价格点火 + RVOL点火 + 同向期权 → `forced_flow_candidate`。
6. 价格点火 + RVOL点火 → `ignition`。
7. 快速反转 → `trap_watch`。
8. 其它 → `seed`。

优先级独立计算：分≥50且覆盖≥55%为high；否则分≥30且覆盖≥35%为medium；其余watch。阶段为反证/冲突并不会自动把分数或priority清零；消费者必须同时检查阶段，不能只读“high”。

最终按优先级、证据分、覆盖率排序。统计字段 `next_day_oi_confirmations` 数的是 OI状态ready的候选数，**不是ΔOI>0且达到完整阶段确认的数量**；引用时须说明口径。

## 11. 进程卡和报告衔接

`build_option_process_card()` 把信号日期、采集时间、闭合价格日、聚合期权成交日、链报价时间、前次OI报告日分开保存。卡片分别展示价格响应/ATR/RVOL、P/C对常态、三侧量倍数、IV/HV/期限、moneyness skew、热点、ΔOI、支持/反对证据、替代解释、下一确认与失效条件。

没有完整链时可用各到期±15%成交峰值作为“调查位置”，但热点中的OI、Volume/OI、ΔOI等留空。最多4个热点不是完整链。

卡片覆盖有6个布尔层：闭合价格响应、聚合P/C与日期可用性、IV/HV、期限、深扫OI、可比ΔOI。`ratio>=0.8`标ready；有任一期权层而不足时partial；完全无层时missing。当前名为 `sampled_contract_oi_and_greeks` 的检查实际上只检查深扫ready与OI数量，未独立要求Greeks覆盖，应保留限制。

从已经按S1证据分排序的候选里取非missing卡的前3张；不是重新按期权异常度排序。`enrich_existing_forced_flow_payload()` 只是给同次原始结果补卡，不应更改原采集时间、得分、阶段或旧行情来制造“重新验证”。

## 12. 已实现、未保证与优先接手事项

| 状态 | 内容 |
|---|---|
| 已实现 | 有界报价→面→重点到期完整标准链→代表合约逐笔/盘口；失败标记；日期分层；聚合流早于信号时排除；符号复用排除配置；部分可比ΔOI；无符号敏感度；离线单元测试 |
| 未保证 | 美股假日日历；输入日K排序/真实闭合验证；历史 `--date` 截止；同日信号首次可知时刻；供应商各字段最大陈旧度；严格相邻结算日ΔOI；足够的可比合约覆盖 |
| 当前没有 | 借券可得量/费率时序、解禁实际可售流通量、历史NBBO、多腿订单标识、机构身份、具名做市商符号/净GEX、全部到期完整同步盘口、真实历史IV分位、完整实盘交易执行 |

Claude 优先处理以下问题，但应先提出范围并补测试，不要为了交接悄悄改掉研究阈值：

1. 为采集增加真实 `observed_at/available_at/as_of` 契约、市场时区和闭合K校验；历史标签不再请求未来数据。
2. 把事件响应与可交易策略收益命名分离，并保留信号首次看到的时间及原始版本。
3. 用实际结算日、交易所日历、证券唯一身份和足够合约覆盖约束ΔOI；不满足时降为跨期变化，不能叫“次日确认”。
4. 对 `option_flow_timing` 增加未来日期、最大陈旧度、同日先后顺序检查；缺失不要补零。
5. 对历史成交和K线先排序/去重，再算HV/ATR/RVOL；字段单位与复权方式显式化。当前期权采集的日K命令没有显式指定复权方式，不可沿用冲浪模块“前复权”的描述。
6. 核查进程卡0DTE公式文字、OI/Greeks覆盖字段、`next_day_oi_confirmations`计数名；把高优先级但反证/冲突的行展示为明确警告。
7. 逐次归档增加运行ID与不可变时间戳；目前同报告日期文件会原子替换，不保留一天内每次采集版本。
8. 针对证券代码复用、带点类别股、供应商返回真实合约代码与本地拼接代码的差异建立身份测试；不要只靠ticker字符串认为是同一证券。

## 13. 验证与代码导航

本次执行了以下**离线**测试，6项通过；未做实时CLI/OPRA权限/全量历史数据验证，也未改生产代码：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_s1_forced_flow.py -v
```

现有6项覆盖：短窗反转识别、Buy/Sell对称预检、前收盘基准、信号前ATR归一、完整证据阶段升级及信号前/无日期流排除、进程卡Volume与ΔOI分离。通过这些测试不等于已经覆盖本节所有限制。期权面/异常度/ΔOI相邻性需补独立测试。

| 项目相对文件 | 关键函数起始行（本次快照） |
|---|---|
| `scripts/s1_forced_flow.py` | `option_flow_timing:49`、`normalize_us_symbol:89`、`business_session_age:105`、`recent_signal_contexts:119`、`quote_precheck:198`、`daily_price_profile:275` |
| 同上 | `_deep_contract_hotspots:390`、`_selected_expiry_model:478`、`build_option_process_card:504`、`enrich_existing_forced_flow_payload:728`、`build_forced_flow_payload:783`、`write_forced_flow_snapshots:1039` |
| `scripts/collect_longbridge_options.py` | `choose_symbols:208`、`choose_expiries:231`、`realized_volatility:251`、`sample_chain:273`、`enrich_quotes:374`、`parse_volume_history:427`、`collect_symbol:489`、`anomaly_profile:657` |
| 同上 | `choose_deep_dive_expiry:772`、`summarize_option_depth:867`、`summarize_option_trades:889`、`option_side_record:956`、`build_delta_surface:1026`、`build_gross_sensitivity:1073`、`build_contract_watchlist:1121` |
| 同上 | `choose_microstructure_contracts:1155`、`full_chain_deep_dive:1270`、`previous_equity_snapshot:1494`、`attach_open_interest_change:1512`、`build_opportunity_radar:1584`、`main:1827` |
| `config/workflow.json` | `options` 与 `s1_forced_flow`；运行前读取当前值，不以本交接快照覆盖后续用户修改 |
| `tests/test_s1_forced_flow.py` | `S1ForcedFlowTests:14` |

核验顺序：保留输入版本 → 核对证券身份/日期/单位 → 检查采集覆盖 → 单独复算关键公式 → 对齐评分与阶段 → 保留缺失及反证 → 再生成报告与经过授权的公开快照。外部CLI或字段契约变更后，先更新接口适配和测试，再更新这份文档。

研究用途，非投资建议。
