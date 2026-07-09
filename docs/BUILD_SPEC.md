# 刻舟求剑 · 产品实现与支付接入说明书
### Historical K-Line Pattern SaaS — Build & Integration Handoff

版本 v0.1 · 锚定原型 `app.html` · 面向实现工程师

---

## 0. 这份文档是什么

`app.html` 是一个纯前端高保真原型:三层交互(展示页 → 注册 → 选战场 → 战场仪表盘)、每日额度、中英双语、灰蓝主题、真实历史数据算出的图表。它把**产品形态和交互**定死了,但注册、额度、支付都是浏览器端模拟。

本文说明如何把它落成真正的 SaaS:后端架构、把"刻舟求剑"匹配引擎服务化、数据管线、账户与额度、以及三种支付(Stripe / 支付宝 / 加密)的接入方式。原型里所有 `即将支持` 的占位,这里给出对应的真实实现路径。

一句话定位:用户给一段当前 K 线,系统在历史里找结构最像的片段,统计"其后"的走势分布,给出概率与形态解读。**它是历史相似度的概率描述,不是投资建议**——这条免责必须贯穿产品与法务。

---

## 1. 系统架构总览

建议五个逻辑组件:

1. **Web 前端(SPA)** — 由原型演进。React 或 Vue 重写;把原型里的 `renderScreen / renderAnalysis / 图例 / i18n 词典` 直接迁移为组件与 i18n 资源。图表改为服务端返回的数据 + 前端绘制(见 §3.4)。
2. **API 网关 / BFF** — REST 或 tRPC/GraphQL。负责鉴权、额度校验、把请求转给引擎、拼装前端所需 payload。
3. **匹配引擎(Match Engine)** — 无状态计算服务(Python + numpy,复用原型算法)。输入 `symbol / timeframe / window / horizons`,输出条件分布、基准、匹配片段、季节性、画图序列。
4. **数据管线(Ingestion)** — 定时抓取行情、清洗、复权、落库,给引擎提供只读的历史 K 线。
5. **账务与订阅(Billing)** — 账户、会员档位、每日额度计数、支付回调。

```
[Browser SPA] --HTTPS--> [API/BFF] --> [Match Engine] --> [(OHLCV store)]
                              |
                              +--> [Auth]  [Quota/Entitlements]  [Billing/Webhooks]
                                                                     ^
                              [Ingestion cron] --> [(OHLCV store)]   |
                                                              [Stripe / Alipay / Crypto]
```

技术栈建议(非强制):前端 React + Vite + i18next;后端 Node(NestJS)或 Python(FastAPI);引擎 Python/FastAPI + numpy;存储 Postgres(账户/订阅/额度)+ 列存或 Parquet/ClickHouse(海量 K 线);缓存 Redis(额度计数、匹配结果缓存)。

---

## 2. 匹配引擎规格(核心资产,需精确复刻)

原型里的算法即产品的护城河,后端务必逐条复刻,保证结果可复现、无未来函数。

**输入**:`symbol, timeframe(4h/1d/1wk…), window W(如 60), horizons[](前瞻期,单位=K线根数), topK, minSep, metric∈{corr,dtw}`。

**步骤**:
1. 取该 symbol 的历史收盘价序列 `C`,计算 `logC = ln(C)`。
2. 参考窗口 = 最近 W 根;对其 logC 做 **z-标准化**(减均值除标准差),得形状向量 `refZ`,消除价位与波动量纲。
3. 滑动:对每个结束索引 `e`(满足 `e < 参考起点` 且 `e + max(horizons) ≤ n-1`,**这是"无未来函数"的关键**),取其窗口 z-标准化后:
   - `corr` 度量 = 与 refZ 的皮尔逊相关(等于点积/W);
   - `dtw` 度量 = 带 Sakoe-Chiba 带(半径 ≈ W/6)的 DTW 距离。为控成本,先用 corr 预筛 Top-400,再对这 400 段算 DTW 重排。
4. 选片段:corr 按相关降序 / dtw 按距离升序,贪心选取,要求两两结束索引间隔 ≥ `minSep`(≈ 半窗口),得到 K 个近似独立的历史类比。
5. 统计其"之后":对每个 horizon `h`,收集 `C[e+h]/C[e]-1`;输出上涨概率、均值、中位、p10/p25/p75/p90;并计算这些片段前瞻区间的最大回撤。
6. **基准(baseline)**:对全体合法 `e` 计算同 horizon 的无条件收益分布,与条件分布并列 —— 这是判断"是否有超额"的对照,防止把牛市惯性误当信号。
7. **季节性**:锚定"今天"的日历日,取历史上每年同期最近的 K 线,统计其后 N 天收益(样本少,仅供方向)。
8. **形态拆解**:趋势(累计涨跌)、区间分位、近端动量、最大回撤 → 生成中英文自然语言描述。

**显著性**:用二项近似标注条件涨概率相对基准是否显著(★ p<0.10,★★ p<0.05),但须在 UI 与文档同时声明:窗口部分重叠 → 有效样本小于标注,显著性打折。

**性能**:单次匹配对 ~2 万根 4h 序列是毫秒级(纯 numpy)。用 Redis 按 `(symbol,timeframe,window,交易日)` 缓存结果,当日复用;行情日更后失效。

**参考实现**:原型仓库里的 `ana()`(JS)与 Python 侧 `charts_slate.py / appdata.py` 已是可读的算法蓝本,后端照搬即可。

---

## 3. 数据管线

### 3.1 数据源与教训(来自原型抓取实践)
- **加密**:Binance klines(`/api/v3/klines`,单次≤1000,`endTime` 分页)。**实测坑**:高频抓取会触发 IP 权重封禁(表现为请求挂起/超时);生产必须做**限流 + 退避 + 多域名/多出口**,并优先走官方数据下载(Binance data dumps)做冷启动全量,再用 API 增量。
- **美股/指数/大宗 ETF**:Yahoo chart API(`/v8/finance/chart/<sym>`,`range/interval`,含复权 `adjclose`)。**实测坑**:`range=max` 配 `interval=1wk` 会被降采样成月线;要真周线需用有限区间(如 `range=20y`)。生产建议改用正规数据商(Polygon / Tiingo / EOD / 交易所直连),Yahoo 仅作原型。
- **大宗**:原型用 ETF 代理(GLD/USO/SLV);生产可换期货连续合约或现货指数,注意展期处理。

### 3.2 处理
统一 schema `(symbol, timeframe, ts, open, high, low, close, volume, adj_factor)`;**存复权价**用于形态与收益,保留原始价供展示。做去重、缺口标记、时区统一(UTC)。

### 3.3 落库与更新
冷启动全量回补(交易所 dump / 数据商批量);之后按周期定时增量(4h 每 4 小时、日线每日收盘后、周线每周)。落 ClickHouse/Parquet;引擎只读。

### 3.4 图表
原型是后端用 matplotlib 出 PNG(深/浅两套内嵌)。生产建议**引擎只返回数值序列**(当前窗口归一化、corr/DTW 中位路径、各 horizon 概率、季节性逐年、热力图矩阵),前端用 ECharts/Recharts 绘制 —— 体积小、可交互、主题即时切换、无需为每主题各存一份图。

---

## 4. 账户、额度与权限

### 4.1 账户
邮箱注册 + 密码(建议同时给 OAuth:Google/Apple/微信)。密码用 argon2/bcrypt。会话用短期 JWT + 刷新令牌。

### 4.2 会员档位(与原型一致)
| 档位 | 价格 | 每日品类查询 | 说明 |
|---|---|---|---|
| Free | $0 | **5** | 全战场、corr+DTW、全部图 |
| Pro | **$19/月** | **50** | + 多周期/窗口对照、片段导出、优先接入 |
| Team | 定制 | 不限 | 多席位、API、自定义品类 |

### 4.3 额度(关键:必须服务端强制)
原型用 localStorage 计数——**生产绝不能信前端**。规则:
- "一次查询"= 当日首次打开某个 `(战场, 品类)`。同日重复打开**不再计费**(原型已是此语义,后端照搬)。
- 计数键 `quota:{userId}:{YYYY-MM-DD}`,存已查品类集合;`used = 集合大小`,与档位 `limit` 比较。
- 用户本地时区还是 UTC 归零要产品定义;建议按账户时区当日 0 点重置。
- 超额 → 返回 `402/403 + 需升级`,前端弹升级窗(原型已有 UI)。
- 用 Redis 计数 + 每日过期;并落一条审计到 Postgres 便于分析与风控。

---

## 5. 支付接入(原型中的三个"即将支持")

订阅模型:**Pro $19/月**(建议同时给年付折扣,如 $190/年)。核心是"订阅状态 = 权限来源":任何支付渠道成功后,统一写入 `subscription(status=active, plan=pro, current_period_end)`,额度服务只认这张表,不认渠道。

### 5.1 Stripe(国际卡,首选主渠道)
- 用 **Stripe Billing**:建 Product「Pro」+ 两个 Price(月 $19 / 年 $190)。
- 前端走 **Stripe Checkout**(托管页,PCI 负担最小)或 Payment Element。
- 后端建 Checkout Session(`mode=subscription`),成功回跳。
- **以 Webhook 为准**(不要信回跳):监听 `checkout.session.completed`、`customer.subscription.updated/deleted`、`invoice.paid/payment_failed`,据此更新订阅状态与 `current_period_end`。
- 提供 **Customer Portal** 让用户自助改套餐/取消。
- 合规:**不要自建收银台收卡号**(原型的安全边界也是如此)——全程交给 Stripe 托管页。

### 5.2 支付宝(中国大陆用户)
- 跨境可用 **Alipay via Stripe**(把 alipay 作为 Checkout 的一种 payment method,复用上面的一套 Webhook)——最省事。
- 若面向境内主体、需人民币结算,则接**支付宝开放平台**官方 App/网站支付:创建预订单 → 前端唤起/扫码 → 服务端接**异步通知(notify_url)**并验签 → 更新订阅。注意支付宝原生是单次支付,订阅需自建续费(周期扣款用「支付宝周期扣款/代扣」产品,或到期提醒手动续)。
- 需要:企业主体、ICP 备案、商户号、RSA2 密钥对。

### 5.3 加密支付(可选,面向 Web3 用户)
- 用聚合网关(如 Coinbase Commerce / NOWPayments / BTCPay Server 自建)接受 USDT/USDC/BTC/ETH。
- 流程:建 charge(定价锚定 $19,按实时汇率折币)→ 用户转账 → **Webhook 确认到账**(注意确认数与汇率波动窗口)→ 记一期订阅。
- 加密多为**单次到账**,不是自动续费:到期前发提醒,让用户再付一期;或引导其转 Stripe 自动续费。
- 合规:加密收款涉及各地监管与税务,上线前需法务确认;金额、退款、发票流程要清晰。

### 5.4 统一抽象
定义内部 `PaymentProvider` 接口:`createSubscriptionIntent(userId, plan)`、`handleWebhook(event)`。三家各实现一遍,最终都收敛到同一张 `subscription` 表。前端支付区按可用渠道渲染(原型的支付宝/Stripe/加密三枚占位即挂载点)。

---

## 6. 国际化(i18n)
原型的 `T` 词典(128 条,中/英)可直接导出为 i18next 资源。约定:所有面向用户的字符串走 key;数字/日期按 locale 格式化;新增语言只加一列。判断词、周期标签、图例注释都已 key 化,照搬即可。

---

## 7. 安全与合规(不可省)
- **免责声明**必须常驻(落地页、每个分析页、注册勾选):历史相似 ≠ 未来重复,非投资建议,不构成要约。这正是"刻舟求剑"的品牌自省,也是法务底线。
- 金融资讯类产品在部分司法辖区需牌照/披露;上线地区先过法务。
- 不存卡号(交给 Stripe 托管);Webhook 全部验签;额度/权限服务端强制;审计日志。
- 数据源许可:Binance/Yahoo 的使用条款仅适合原型,商用需正规数据商授权。

---

## 8. 建议实施阶段
- **P0 上线可用**:引擎服务化 + 正规数据源(先加密+美股)+ 邮箱账户 + 服务端额度 + Stripe 月付 + 前端由原型改造 + 免责合规。
- **P1**:支付宝(经 Stripe)、年付、Customer Portal、结果缓存、大宗商品、多周期对照(Pro 特权)。
- **P2**:加密支付、Team/API、片段导出、更多品类与市场、告警/自选清单、移动端优化。

---

## 9. 附:原型内已具备、可直接复用的资产
- 交互与信息架构:`app.html`(三层流程、额度语义、升级流、图例系统、深浅+中英)。
- 算法蓝本:`appdata.py`、`charts_slate.py` 中的归一化 / corr / DTW / 基准 / 季节性 / 形态拆解。
- i18n 词典:`app.py` 内 `T`(128 条中英)。
- 真实样例数据:BTC/ETH/SOL(4h+日线)、AAPL/NVDA/SPY/QQQ/DJI/IXIC(日/周线)、GLD/USO/SLV(日线)的已算结果 JSON,可作后端回归测试的基准样本。

> 免责:本产品输出为基于历史相似度的概率描述,不构成任何投资建议。历史相似不代表未来重复。
