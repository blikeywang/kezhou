# 数据来源、字段与时点

基准：2026-11-08 本地代码和 `config/workflow.json`。路径均相对于“猴认知分析”项目。这里描述接口和规则，没有采集今日行情。

## 1. 来源清单

| 路由 | 原始来源与入口 | 标准化位置 | 使用边界 |
|---|---|---|---|
| 场外指数 | 用户主动提供的 Notion 原页、文件或文本；`inbox/otc/` | `data/otc/latest.json`、`otc_history.csv`、日期原页归档 | 原值、周期、来源与异常一起保留；禁止同步 Claude 场外表 |
| 每日潜力区 | 同一用户原页的今日潜力观察、市场门控 | `data/otc/potential_zones_latest.json`、`potential_monitor_latest.json` | 先核实产品、交易所和有效期 |
| TrendTrader | 官方 OpenAPI；`daily_trade.py` 的 `TrendTraderClient` | `data/trend/` 历史 CSV、tmId 缓存、本地原始回包 | 大类、温转热组合、S1 相关标的冷热；上游生成算法不在本项目 |
| S1 | 用户 CSV，或获准历史源的清单/HTML | `data/s1/signals.csv`、`data/sync_status.json` | 校验数量、映射、冲突与日期；不重造上游 Buy/Sell 算法 |
| S1 形态价格 | Longbridge 等脚本声明的日线源 | `data/s1/` 下冲浪/forced-flow 派生文件及缓存 | 正常时段、已收盘日线；保留复权与覆盖口径 |
| 13 买点 | 外部只读 `day trade/thirteen-bosses-dashboard/app/lib/` | `data/buy_points/buy_points.csv`、`status.json` | 从本项目执行扫描；外部引擎不包含在本项目 |
| Desk | 用户或获准历史源的摘要 Markdown | `inbox/desk/` → `data/desk/` | 风险背景；付费全文不进入公开报告/仓库 |
| NQ/ES 实际期权 | 授权真实期货期权链；正式 CME bulletin 可做 EOD 实际覆盖 | `inbox/options/` → `data/options/futures_latest.json` 和历史记录 | `actual` / `eod_actual`；合约月、报价日和 OI 日分别记录 |
| NQ/ES 代理 | SPY→ES、QQQ→NQ 的 ETF 期权背景 | `data/options/` 标准化代理记录 | 不能平移 ETF 行权价、Greeks、Gamma flip 或墙位 |
| 美股/ETF 期权 | Longbridge CLI 的 quote、链、IV/Greeks、聚合统计、逐笔/深度 | `data/options/equity_latest.json` 及符号/历史快照 | 有限候选池与到期日；聚合市场数据与抽样链分开 |
| 加密期权 | 已授权输入中的 Deribit 聚合等 | `data/options/crypto_latest.json` | 不冒充 CME 链；保留市场和单位 |
| 官方宏观 | FRED 及原发布机构；流动性追溯 Fed/纽约联储 | `data/risk_watch/` | 阶段位置、公司 capex、慢指标仍需独立输入 |
| OKX 账户 | 只读 API 或明确脱敏的临时浏览器导入 | `data/account/okx_latest.json`、`okx_status.json`、历史 | 全部保持本地私有；外部行情只作缺口压力参考 |
| 场外图表独立价格 | Binance 公开日 K、Yahoo Chart、本地 CSV | `outputs/otc-chart/site/` 的独立价格文件 | USDT 现货 UTC 日线；股票正常时段原始 OHLC；不与不明市场报价拼接 |
| 回测参考 | Yahoo、Alpaca、IBKR、Tencent、Longbridge 专用缓存 | `outputs/` 下各次回测缓存和报告 | 每次标实际源、复权、币种、截止日、缺失与费用模型 |

来源入口：[TrendTrader OpenAPI](https://www.trendtrader.cn/apiData/v3/api-docs)、[Longbridge OpenAPI](https://open.longbridge.com/)、[CME Daily Bulletin](https://www.cmegroup.com/market-data/daily-bulletin.html)、[FRED](https://fred.stlouisfed.org/)、[美联储 H.4.1](https://www.federalreserve.gov/releases/h41/)、[纽约联储市场操作](https://www.newyorkfed.org/markets)、[SEC EDGAR](https://www.sec.gov/edgar/search/)、[OKX API](https://www.okx.com/docs-v5/en/)。这些链接用于标识来源；接口可用性与当前权限接手时另验。

## 2. 时间字段

| 字段 | 必须回答的问题 |
|---|---|
| 数据/信号日 | 哪一个市场日的观察？ |
| 报告日 | 哪一天生成报告？不能替换数据日 |
| 采集时间 | 何时读取到结果？含时区 ISO 时间 |
| 行情时刻 | 盘前、正常时段、盘后还是收盘值？ |
| OI 日期 | 哪次结算或发布？不能默认等于报价日 |
| 到期日 | 当时是否有效？合约交易日历是什么？ |
| 来源更新时间 | 原页实际更新，还是重新下载旧页？ |

日程用 `Asia/Singapore`，美股会话用 `America/New_York` 转换，不用全年固定偏移。默认新鲜度：场外、潜力区、趋势、S1、13 买点、期权 1 天，Desk 2 天；风险每日/每周/每月/每季数据 3/10/45/140 天；OKX 亚洲早间/美股盘前/人工阶段 120/30/45 分钟，行情参考 45 分钟。

**实现边界：** `age_status` 可能把未来日期算作“最新”；`business_age_status` 只排除周末。移动端以状态文件 `updated_at` 为 anchor，旧状态文件下的“最新”不等于相对今天最新。各调用采用自然日或近似工作日，尚非完整交易所节假日日历。

## 3. 输入契约

### S1 与 13 买点

S1 CSV：`date,action,symbol,name,market,sector_key,source,note`。

- `action` 为 `buy` / `sell`；保留原 ticker，再做有交易所后缀的归一映射。
- 原 HTML 宣称的总数、Buy/Sell 数必须与解析结果核对。只收到 Buy 时标 `buy_only_as_received`，不计算完整净宽度。
- 同一代码同日 Buy/Sell 列为冲突。别名、跨页重复和重复导入分别处理。
- `sector_key` 缺失不猜产业链；反向 ETF 区分证券动作和经济敞口。

13 买点 CSV：`date,symbol,entry_low,entry_high,stop,confidence,source,note`。无可靠价格则留空。读取当前扫描 `status.json`；最新扫描失败时，旧 L1 不得继续作为本次有效买点。成功扫描零候选是有效结果，不是缺失。

### 场外与潜力区

保留原页 44 个核心字段、日期、来源、市场门控。缺页、周期天数跳变、差额冲突保留原值并标告警。潜力区至少包含 `data_date/source/source_updated_at/market_gate`，以及 `zones[].asset/symbol/zone_type/level/venue/venue_mapping/valid_through`。类型为 `top` 或 `support`，价位为正数；原文“无”对应空数组。

监测需要具名交易所报价和有效区间。核心报告读取派生监测状态，不等于已具备通用实时潜力区抓取器。`Spcx`、`Openai`、`Anthropic` 等未核实标签不能绑定任意同名上市 ticker。

### 期权

身份键至少含标的/交易所或期货合约、到期日、Call/Put、行权价、乘数；另存报价时间、OI 日、覆盖和来源。现有美股算法按 **100** 乘数计算；调整合约、指数和期货不能无核对沿用。

`coverage` 只有 `actual/eod_actual/proxy/missing`。真实覆盖优先于代理，但旧实际链仍需显示旧日期。“优先”不等于“新鲜”。未知 Gamma 符号、flip、墙位、主动买卖和开平仓保持缺失。聚合 P/C、样本链 P/C、S2 筛选大单三者不拼成同一序列。

`SPCX.US` 的 Longbridge 聚合历史在当前配置被排除：复用 ticker 仍解析到旧 ETF。逐合约链需独立核实身份；不能为填报表而取消排除。

### 宏观与账户

FRED 请求序列 `WRESBAL,WDTGAL,SOFR,IORB,RPONTSYD`。回购非零只触发复核，需追溯纽约联储具体操作。Capex 需官方公告/财报链接、期间、本期/前期值和增长率；阶段位置和慢指标不能从缺失推断。

OKX `mgnRatio` API 比率乘 100 转百分数；浏览器导入已是百分数时走独立路径。采集失败保留最新 attempt，不能用旧成功快照遮住新失败。账户净值、仓位、保证金、保护单保持本地私有。

## 4. 优先级、缓存与失败

- TrendTrader 先查 tmId 缓存，再查找；每批最多 8，唯一 tmId 总数最多 120。`evening --dry-run` 仍联网取元数据/解析代码，只跳过付费快照。
- 同日用户场外原页优先。2026-09-22 获准下载的 Mag 历史仅为独立 `reference_archive`，不是持续订阅授权；不覆盖用户值、不绕过 403。
- `last_success` 与 `latest_attempt` 分开；失败、部分成功、缺失、明确空结果分开。日志不泄露凭据。
- 缺失 OI、价格、Greeks 不填 0。个别求和内部置零不等于实际已知为零，仍需 coverage。
- 先校验后原子替换；不同源、复权、币种、交易所不无说明拼接。旧数据不能改为新报告日期。

## 5. 发布范围

本包公开方法、公式、路径、阈值及源码指纹，不附账户快照、密钥、Desk 原文、券商原始链/K 线或未获准原页附件。TraderHome 早晚报发布器只选获准的早报/晚报 HTML；不能顺带发布最终操作计划、账户页、期权学堂、工作簿或整个移动端数据目录。字符串脱敏不是再分发许可。

研究用途，非投资建议。
