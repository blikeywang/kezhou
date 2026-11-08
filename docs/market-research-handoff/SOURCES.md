# 数据来源与历史链接索引

版本：2026-11-08。这是来源目录，不是当日行情快照。页面能打开、读过作者观点、独立核实原始数据，是三种不同状态。

## 1. 取数优先级

| 用途 | 首选来源 | 必须保留的口径 | 不可替代什么 |
|---|---|---|---|
| Desk 解读 | 用户提供的 Bilibili 原页、获授权的文本/截图 | 发布时间、正文所指交易日、作者、已读范围 | 不能用标题代替正文；不能将转述当机构原始模型 |
| 股票/ETF 报价与 K 线 | Longbridge Securities（长桥证券） | 报价时间、时段、币种、复权、已闭合状态 | 不等于 OKX 永续标记价，也不自动等于可成交 NBBO |
| 美股/ETF 期权 | 长桥合约链、逐合约 quote、depth、trades、可用的 calc-index | 精确合约标识、BBO 时间、OI 数据日、IV/Greeks 单位、权限 | 链表不等于完整报价；tick rule 不等于主动买卖方向 |
| NQ/ES 期货期权 | 获授权的 IBKR/CME FOP；其次 CME Daily Bulletin | actual / eod_actual / proxy / missing | QQQ/SPY 不能直接换算 NQ/ES 的行权价或墙位 |
| 财报/资本开支 | 公司 IR、SEC 文件 | 财季、公告时间、GAAP/非 GAAP、现金/含租赁口径 | 新闻摘要不代替原始表格；不同资本开支口径不能直接求二阶变化 |
| 宏观事件 | BLS、Federal Reserve、Treasury、交易所日历 | 发布时区、数据参考期、修订、休市/半日市 | 旧日历截图不是当日核验 |
| 拆股与合约调整 | 发行人公告、SEC、OCC/交易所通知 | 生效日、合约代码、deliverable、乘数、现金部分 | 不能只按股票拆股比例猜调整合约 |
| 趋势冷热 | TrendTrader 官方 OpenAPI | 资产各自 asOfDate、tmId、配额、来源 | 采集时间不是数据日；冷热不是概率 |
| S1 / 13 买点 | 项目获授权输入与只读引擎 | 信号日、原始数量、市场覆盖、行情质量 | 不重新发明供应商底层公式 |
| 场外/潜力区 | 用户主动提供的 Notion 原页、文件或文本 | 原页日期、来源、原文、门控、缺失 | 禁止从 Claude 外部场外表补齐 |

同一事实由多个媒体重复转述，不算多个独立数据源。第三方聚合新闻只作背景，须标出原媒体及发布时间。不能为了复现机构模型而编造未获授权的输入。

## 2. 可长期复用的官方入口

链接用来查方法或查当前资料；除单独注明的历史案例，不把页面中的任何数值视为 2026-11-08 行情。

- [长桥报价文档](https://open.longbridge.com/docs/quote/pull/quote)、[CLI 更新记录](https://open.longbridge.com/docs/cli/release-notes.md)、[文档索引](https://open.longbridge.com/llms.txt)：本次交接核对了 CLI 帮助和权限说明；运行前仍以当前 `--help` 为准。App/Web 与 OpenAPI 行情权限分别核实。
- [OIC Long Call](https://www.optionseducation.org/strategies/all-strategies/long-call)、[Long Put](https://www.optionseducation.org/strategies/all-strategies/long-put)、[Bear Put Spread](https://www.optionseducation.org/strategies/all-strategies/bear-put-spread)：到期损益与风险的基础参考；本包公式另有合成测试。
- [Cboe 0DTE 市场影响研究](https://www.cboe.com/insights/posts/volatility-insights-evaluating-the-market-impact-of-spx-0-dte-options/)：2023 年历史方法资料，不是今日做市商净 Gamma。
- [Cboe VIX 分解框架](https://www.cboe.com/insights/posts/the-vix-index-decomposition-a-heuristic-framework-to-unravel-unexpected-behaviors-in-the-vix-index/)：2025 年方法资料；不能从分解项识别现货投资者身份。
- [Cboe VIX 倒挂讨论](https://www.cboe.com/insights/posts/inside-volatility-trading-is-vix-backwardation-necessarily-a-sign-of-a-future-down-market)：2022 年历史研究，不是本次实测期限曲线。
- [NYSE 时间与日历](https://www.nyse.com/trade/hours-calendars)：核对休市、半日市及产品差异。时区用 `America/New_York`，不要全年固定一个新加坡开盘时间。
- [BLS 发布日历](https://www.bls.gov/schedule/2026/11_sched.htm)、[FOMC 日历](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)：每次更新核对具体事件；历史链接中的事件可能已经结束。
- [Fed H.4.1](https://www.federalreserve.gov/releases/h41/)、[纽约联储 SOFR](https://www.newyorkfed.org/markets/reference-rates/sofr)、[Treasury Fiscal Data](https://fiscaldata.treasury.gov/)：流动性层的原始数据入口。序列参考日、发布日期和后续修订分别保存。
- [TrendTrader OpenAPI](https://www.trendtrader.cn/apiData/v3/api-docs)：访问前读本地配置限额；此链接不是提供 API 密钥。

### 已用于历史口径核查的拆股案例

SOXX 2026-11-05 的 3:1 拆股依据为 [SEC 基金补充文件](https://www.sec.gov/Archives/edgar/data/1100663/000119312526430480/d156277d497.htm)，期权调整依据为 [OCC 通知 60000（交易所托管）](https://www.miaxglobal.com/sites/default/files/alert-files/SOXX_Split_60000.pdf) 和 [MIAX 公司行动提示](https://www.miaxglobal.com/alert/2026/11/04/miax-exchange-group-options-markets-corporate-action-alert-ishares-etf-2)。这是历史单位校正案例，不是价位建议，也不授权推断其他公司的调整方式。

## 3. 用户公开视频链接（17 条）

以下保留用户给出的标题。**索引不声明这 17 条视频均已取得完整字幕并逐段核验。** 后续需要引用某段时，补全实际观看/转录范围、时间码和数据日期；不只从标题推导方向。

| 链接 | 用户提供的标题 |
|---|---|
| [b5i6MbM](https://b23.tv/b5i6MbM) | 等待财报+黄金+SOXX/SMH/GLW/NOK |
| [4bnI62N](https://b23.tv/4bnI62N) | 未见追涨（等待财报落地）+ASML/TSM/USO/XOM/MU |
| [MvtQL1q](https://b23.tv/MvtQL1q) | Mag7 vs SOX + VIX看涨 + MU/SNDK/STX/LITE |
| [ip51p8c](https://b23.tv/ip51p8c) | 资金流+CTA+油价+中期选举走势+FOMC+指数估值+SPY/AAPL/NBIS/USO |
| [51D5VAZ](https://b23.tv/51D5VAZ) | DB 仓位 + BofA CTA |
| [MZ1Z5Ay](https://b23.tv/MZ1Z5Ay) | 风险犹存+SMH/IGV/GOOGL |
| [RsGiF2v](https://b23.tv/RsGiF2v) | 减仓RSP+动量更新+CTA偏空+回购支撑+HF流入+FOMC前瞻+技术面偏空 |
| [ENSBvw5](https://b23.tv/ENSBvw5) | MFST&META点评+韩国杆杠+IWM/SOXX/ASML（原标题拼写保留） |
| [8BJ3Ytf](https://b23.tv/8BJ3Ytf) | 资本周期+资金流+Q2财报+波动率高位+AMZN/SMH/CLS/EWY |
| [oyMHnvZ](https://b23.tv/oyMHnvZ) | FOMO+分散&泡沫化+BTIG看空+SPY/MSFT/MU/MTUM/SOXX/SMH |
| [1OCEebB](https://b23.tv/1OCEebB) | 软件拥挤度+FOMO退潮+ALAB/GOOGL/ANET/META |
| [DKeKw31](https://b23.tv/DKeKw31) | 黄金/材料板块+NDX+NVDA/CBRS |
| [UGksKe9](https://b23.tv/UGksKe9) | 盈利估值+超大规模云服务商+野村波动率+内存多空+MSFT/TSM/GLW |
| [UVRhls6](https://b23.tv/UVRhls6) | 重回AI/硬件（看涨NDX）+GOOGL/COHR/ORCL/DELL/CRWV |
| [jJ3ynoD](https://b23.tv/jJ3ynoD) | 资本开支+仓位出清+波动率压制原因+中期选举+SMH/AMD/LITE/TQQQ |
| [iXfzoOC](https://b23.tv/iXfzoOC) | CTA+企业回购+VIX/TMF/DELL/HPE |
| [eQsH2bn](https://b23.tv/eQsH2bn) | 美债+黄金+AI+等待+EWZ/SMR/CRCL |

## 4. 用户公开图文链接（去重后 37 条）

前 27 条仅收录链接，本包不声明已逐篇全文核验。`1251193629130620928` 和 `1258992834498789384` 在对话中重复发送，索引各保留一次。追踪参数已去掉。

| 序号 | 原页 |
|---|---|
| 1 | [1238216037560746008](https://www.bilibili.com/opus/1238216037560746008) |
| 2 | [1240042223274295296](https://www.bilibili.com/opus/1240042223274295296) |
| 3 | [1241167904161923078](https://www.bilibili.com/opus/1241167904161923078) |
| 4 | [1242668058930053121](https://www.bilibili.com/opus/1242668058930053121) |
| 5 | [1243044143470477335](https://www.bilibili.com/opus/1243044143470477335) |
| 6 | [1243438120812150786](https://www.bilibili.com/opus/1243438120812150786) |
| 7 | [1243760166057279491](https://www.bilibili.com/opus/1243760166057279491) |
| 8 | [1245223611715813396](https://www.bilibili.com/opus/1245223611715813396) |
| 9 | [1245620105923002371](https://www.bilibili.com/opus/1245620105923002371) |
| 10 | [1245998685817405495](https://www.bilibili.com/opus/1245998685817405495) |
| 11 | [1246739357196353539](https://www.bilibili.com/opus/1246739357196353539) |
| 12 | [1247562496259129362](https://www.bilibili.com/opus/1247562496259129362) |
| 13 | [1248207862352576534](https://www.bilibili.com/opus/1248207862352576534) |
| 14 | [1248941528696487939](https://www.bilibili.com/opus/1248941528696487939) |
| 15 | [1251193629130620928](https://www.bilibili.com/opus/1251193629130620928) |
| 16 | [1251544339000066073](https://www.bilibili.com/opus/1251544339000066073) |
| 17 | [1256758772867530758](https://www.bilibili.com/opus/1256758772867530758) |
| 18 | [1257124274610634770](https://www.bilibili.com/opus/1257124274610634770) |
| 19 | [1258226182828064785](https://www.bilibili.com/opus/1258226182828064785) |
| 20 | [1258992834498789384](https://www.bilibili.com/opus/1258992834498789384) |
| 21 | [1259333330898255896](https://www.bilibili.com/opus/1259333330898255896) |
| 22 | [1259741159547207702](https://www.bilibili.com/opus/1259741159547207702) |
| 23 | [1260756863480233990](https://www.bilibili.com/opus/1260756863480233990) |
| 24 | [1261212121420529672](https://www.bilibili.com/opus/1261212121420529672) |
| 25 | [1261596619723243528](https://www.bilibili.com/opus/1261596619723243528) |
| 26 | [1261952960321028097](https://www.bilibili.com/opus/1261952960321028097) |
| 27 | [1262342664137736216](https://www.bilibili.com/opus/1262342664137736216) |

下列 10 条在既有对话中已读取并分析；**本次文档交接未重新抓取正文，未随包保存完整原文**。日期为当时记录的页面日期，不等于其全部底层数据的交易日。

| 页面日期（2026 年） | 原页 | 当时记录标题 |
|---|---|---|
| 10-26 | [1263423557121081361](https://www.bilibili.com/opus/1263423557121081361) | 少操作！ |
| 10-27 | [1263815657534783491](https://www.bilibili.com/opus/1263815657534783491) | 没人买+科技回撤+巴西+CTA&回购+MSFT/AMD/SPCX/META |
| 10-28 | [1264191273925869592](https://www.bilibili.com/opus/1264191273925869592) | 加仓迹象+FOMC+AAPL/GOOGL/AMZN/TSLA |
| 10-29 | [1264554168612290601](https://www.bilibili.com/opus/1264554168612290601) | 谷歌不及预期+Mag7+半导体看跌+医疗对冲+MU/EWY/NBIS |
| 10-30 | [1264934715594375177](https://www.bilibili.com/opus/1264934715594375177) | 动量教训+市场情绪+TMT回撤+BTC |
| 11-01 | [1265756613423136809](https://www.bilibili.com/opus/1265756613423136809) | 底部共识+AI增速黄金+黄金仓位+季节性+痛苦在AI科技+SPY/RSP/SMH/SOXX/INTC |
| 11-03 | [1266408378997932035](https://www.bilibili.com/opus/1266408378997932035) | 风险犹在但暴力反弹开始进入视野+AAPL/SOXX |
| 11-04 | [1266782818557493250](https://www.bilibili.com/opus/1266782818557493250) | 选举+AMD/INTC/MSTR/EWT/WDC |
| 11-05 | [1267147267995860994](https://www.bilibili.com/opus/1267147267995860994) | 数据中心+做空AI迹象？+AMZN/UAL/SOXX/DRAM |
| 11-06 | [1267523859278462981](https://www.bilibili.com/opus/1267523859278462981) | 机构年末业绩压力+波动率爆发+印度反AI？ |

## 5. 未纳入公开包的内容

用户曾提供的 Notion 页链接、个人预算、成交/未成交状态和账户讨论不在公开包中。付费 Desk 原文、机构完整表格、原始市场数据也不随文档上传。需要这些材料时，由用户在获授权环境内另行提供；不能把 GitHub 上“没有文件”解读为“数据为零”。

研究用途，非投资建议。
