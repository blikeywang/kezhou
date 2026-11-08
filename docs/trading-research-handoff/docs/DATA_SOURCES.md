# 数据来源、字段与时间口径

基线2026-11-08。本页的来源说明来自当前源码/配置及用户规则，**不表示这些外部接口在交接当天均已联网测试成功**。本次没有做市场数据刷新。

## 1. 来源矩阵

| 数据层 | 控制来源 / 获取方式 | 标准落点（相对研究根目录） | 必须保留的限制 |
|---|---|---|---|
| S1原始信号 | 用户粘贴；用户文件；获准只读Claude旧HTML | `data/s1/intake/`、`data/s1/signals.csv`、`data/sync_status.json` | 不是供应商源码；回看清单可能重绘；Buy-only不代表无Sell |
| 冲浪日K | Longbridge CLI，前复权、排除未闭合日K | `data/s1/surf/market_data/`、`data/s1/surf/latest.json`、`history/` | 日K只能说明行情；不能证明B首次出现时刻 |
| 历史回测日K | 各缓存采集器：Longbridge、腾讯、IBKR导入、Alpaca导入等 | `data/backtests/s1_one_share/` | 各源时区/复权不同，必须看每个缓存的provider与字段；不拼成虚假的统一源 |
| 趋势冷热 | TrendTrader官方OpenAPI：状态、组合成分、代码搜索、批量快照 | `data/trend/raw/`、`trend_history.csv`、`tmid_cache.csv` | 可能计费；先缓存、每批8、快照总数≤120；温度是来源分类，不是本项目预测 |
| 场外/爆破/周期 | 用户主动提供的Notion原页、文件或文本 | `data/otc/raw/`、`notion_candidate_*.json`、`otc_history.csv`、`latest.json` | 不抓Claude外部场外表；正文日期优先核对，访问日不能代替来源日 |
| 每日潜力区 | 同一用户原页中的今日观察、昨日复盘、市场门控 | `data/otc/potential_zones_latest.json`、`potential_monitor_latest.json` | “无”须写空数组；映射/交易所未确认只观察；不自动续用昨日区间 |
| 13买点 | 外部只读行情适配器与规则引擎，本项目TS接入 | `data/buy_points/buy_points.csv`、`status.json` | 当前原路径缺失，外部完整公式未核验；研究降级最多L0 |
| Desk | 获准只读同步的摘要、用户提供摘要 | `data/desk/latest.json`；原件仅本地参考目录 | 叙事背景，不参与机械下单；付费原文不公开 |
| 美股/ETF期权 | Longbridge CLI + OPRA授权行情，部分项为明确公式派生 | `data/options/equity_latest.json`、`history/`；`data/s1/forced_flow_latest.json` | 有限池不是全市场；聚合量、链报价、OI日期不同；缺NBBO/多腿时不推断主动方向 |
| NQ/ES FOP | 具名授权IBKR/CME链或CME EOD；SPY/QQQ另作proxy | `inbox/options/`、`data/options/futures_latest.json`、`proxy_latest.json` | `actual/eod_actual/proxy/missing`严格分开；ETF行权价不能直接换算期货墙位 |
| BTC/ETH期权 | 导入具名来源文件，当前流程有Deribit字段兼容 | `data/options/crypto_latest.json` | 导入成功不等于本项目重新抓到实时数据；独立保留原数据日 |
| 宏观流动性 | FRED分发的Fed/纽约联储官方序列 | `data/risk_watch/macro_latest.json`、`latest.json`、`status.json` | 日/周频不可混；当前宏观评分新鲜度门控不完整，见限制清单 |
| 资本开支/慢指标 | 官方季报/10-Q、FINRA、Cboe、S&P、SEC等结构化输入 | `data/risk_watch/slow_latest.json` | 当前不是完整自动采集器；没有原始文件和日期就标缺失 |
| 账户风险 | OKX只读账户API；本地脱敏浏览器快照只作临时兜底 | `data/account/okx_latest.json`、`okx_status.json`、`history/` | 本机私有；不发布真实账户；Longbridge价格不能算OKX保证金/强平 |
| 场外网页公开价格 | Binance现货闭合UTC日K；Yahoo股票原始正规时段OHLC | `outputs/otc-chart/site/data/prices.json` | 与券商前复权K线不同；只白名单映射；失败保留原日期 |
| 参考站历史 | 2026-09-22获准的一次性Mag公开归档 | `data/otc/reference_mag_2026-09-22.json`；网页独立参考价文件 | 仅补空白，Notion优先；节点403未绕过；未知时区/复权不能与具名行情拼接 |

## 2. 代码中的外部入口

这些是来源入口/官方说明链接，不包含认证参数；不要把带密钥的最终请求URL保存到日志。

- TrendTrader：配置 `api_base=https://www.trendtrader.cn/apiData/data`；接口定义入口为 [TrendTrader OpenAPI](https://www.trendtrader.cn/apiData/v3/api-docs)。实现见 `daily_trade.py::TrendTraderClient`。
- Longbridge：本地 `longbridge` CLI；先使用 `--help` 核对已安装版本。授权和OPRA权限由用户在本机配置，本交接包不转移凭据。开发资料入口：[Longbridge OpenAPI](https://open.longbridge.com/)。
- OKX：[OKX API文档](https://www.okx.com/docs-v5/en/)。账户接口读取凭证环境变量；公共资金费接口不需要账户授权。参数与计算以 `collect_okx_account.py` 为准。
- 宏观：FRED序列 [WRESBAL](https://fred.stlouisfed.org/series/WRESBAL)、[WDTGAL](https://fred.stlouisfed.org/series/WDTGAL)、[SOFR](https://fred.stlouisfed.org/series/SOFR)、[IORB](https://fred.stlouisfed.org/series/IORB)、[RPONTSYD](https://fred.stlouisfed.org/series/RPONTSYD)。注意FRED是分发层，不把RPONTSYD当作SRF单项。
- 风险日历按事件查询 [Fed FOMC](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)、[BLS发布日历](https://www.bls.gov/schedule/)、公司IR/SEC等。日历事件不能靠历史报告复制到今天。
- 公开K线：代码调用 `data-api.binance.vision/api/v3/klines` 和 `query1.finance.yahoo.com/v8/finance/chart/{symbol}`。Yahoo为研究降级来源，不能宣称具有券商数据质量保证。
- 一次性参考站归档：[Mag场外图表](https://magtrading.surfers.cc/chart)。只使用已授权归档，不把该链接视为无限期爬取授权。

## 3. 时间字段的含义

| 字段 | 应表达什么 | 常见错误 |
|---|---|---|
| `data_date` / `asOfDate` | 来源所对应的交易日/观察日 | 用抓取日期替代 |
| `report_date` / `checked_for_date` | 本次报告为哪天准备 | 把旧数据重新贴当天标签 |
| `collected_at` / `source_checked_at` | 实际取得/核验时间，带时区 | 认为抓取成功就等于数据新鲜 |
| `signal_date` | 用户清单声明日期 | 自动等同于美东K线日期或首次可知时间 |
| `received_at` / intake记录时间 | 本系统何时收到 | 从后来图片反推到历史最低价 |
| `signal_bar_date` | 策略关联的K线日期 | 没有信号ID/图锚点仍认定完全相同 |
| `oi_date` / 前一归档日 | OI统计或比较基线 | 把任意前一报告都叫“次日ΔOI” |
| `price_as_of` / bar timestamp | 报价或K线开始/结束时间 | 把未闭合K线当闭合，或混淆纽约与新加坡日期 |

报告时区为Asia/Singapore。美股会话必须用America/New_York处理夏令时；A股和港股用各自市场时区。周末收到S1不能自动生成新的美股日K。工作日计数不等于交易所交易日计数。

## 4. S1标准契约

CSV列：`date,action,symbol,name,market,sector_key,source,note`；`action∈{buy,sell}`。

建议保留原始intake：声明日期、模式、原文Buy/Sell、接收时间、来源、版本、覆盖说明、代码身份核验。当前intake的具体字段不是统一强制数据库schema，修改前先查看既有文件。

- 完整清单可以报告Buy/Sell数量，但模式 `all` 本身并不能证明用户确实发了Sell部分。
- 只收到Buy：`sell=null`、`coverage=buy_only_as_received`；净宽度不可计算。
- 同日多份清单应保留各原文版本；最终分析用哪版必须可追溯。现有CSV的去重键不能替代不可变版本日志。
- 港股前导零、`.US`别名在各计算模块做归一，原始写法仍保留；不要把ADR与港股上市股票误当同一可交易合约。
- 同日同一代码Buy与Sell是冲突，不以排序先后悄悄选一个。

## 5. 新鲜度与授权不等于“现在可交易”

现有通用报告的默认日数阈值为：场外/潜力区/趋势/S1/13买点/期权1天，Desk2天。账户另用分钟阈值：早间120、盘前30、manual45。宏观各频率阈值见风险文档。

这些阈值的实现并不完全统一：有自然日、仅排周末工作日、以报告日代替交易日的页面显示；未来日期的部分辅助函数还会被视为最新。接手者必须逐层核对，不能认为一个绿色“最新”标签已经证明全链路时序正确。

发布前明确区分三类材料：方法与参数可以公开；经用户授权的脱敏派生快照按白名单公开；凭据、账户、券商原始数据和付费原文不得随README一起上传。数据商授权不会因为把文件叫“研究”而自动扩大。

研究用途，非投资建议。
