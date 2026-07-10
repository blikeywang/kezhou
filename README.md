# 刻舟求剑 · Kezhou — Historical K-Line Pattern Engine

> 给一段当前 K 线,在历史里找出结构最像的片段,统计它们「之后」怎么走——上涨概率、涨跌分布、形态拆解。相关系数(correlation)与 DTW 双重匹配,覆盖加密 / 美股 / 大宗。
>
> **免责:本产品输出为基于历史相似度的概率描述,不构成任何投资建议。历史相似 ≠ 未来重复。** 详见 [`DISCLAIMER.md`](./DISCLAIMER.md)。

当前状态:**已上线的免费静态数据页 + 每日刷新流水线 + 可复现算法说明**。线上页为 [traderhome-histroy.xyz](https://traderhome-histroy.xyz/)。完整来源、计算口径与局限见 [`docs/METHODS_AND_SOURCES.md`](./docs/METHODS_AND_SOURCES.md)。

V2.1 已加入“可信度层”：五秒结论、corr/DTW 共识概率、相对 baseline 的 Edge、Wilson 区间、方法一致度、Top-K 稳健性、上一版变化，以及每个标的的 Fresh/Cached/Stale 数据健康状态。可信度等级是历史证据完整度，不是买卖评级。

---

## 目录结构

```
kezhou/
├── prototype/                # 可直接双击打开的成品原型
│   ├── app.html              # 免费数据仪表盘,中英/深浅主题,逐图讲解与来源说明
│   ├── report.html           # 统一分析报告(深浅切换,交互版)
│   ├── report_dark.html      # 报告 · 深色仪表盘版
│   └── report_light.html     # 报告 · 浅色杂志版
├── data/                     # 已算出的真实结果(可作后端回归测试基准样本)
│   ├── crypto_payload.json   # BTC/ETH/SOL 多配置匹配结果
│   ├── crypto_season.json    # 加密同期季节性
│   ├── stock_payload.json    # AAPL/NVDA/SPY/QQQ/DJI/IXIC
│   └── commodities_payload.json  # GLD/USO/SLV
├── pipeline/                 # 生成原型与图表的 Python 脚本(算法蓝本)
│   ├── appdata.py            # 汇编前端数据 + 判断/季节性/形态拆解
│   ├── charts_slate.py       # 灰蓝主题图表(深/浅两套)
│   ├── app.py                # 由数据+图表拼装 app.html(含 i18n 词典 T)
│   ├── report3.py            # 生成统一报告 report.html
│   ├── report2.py / charts2.py  # 早期双版报告与图表
├── backend/                 # FastAPI + OpenAPI 骨架:匹配引擎(numpy)/内容分层裁剪/额度/埋点collect/检索resolve/收藏/支付Webhook + 引擎回归测试(见 backend/README.md)
└── docs/
    ├── BUILD_SPEC.md         # 产品实现与支付接入说明书(架构/引擎/数据/账务/Stripe·支付宝·加密)
    ├── METHODS_AND_SOURCES.md# 线上图表的数据来源、算法口径、阅读方式与局限
    ├── FEATURES_v2.md        # 功能补充设计:数据刷新 / 检索校验 / 收藏夹 / 逐年季节性 / 讲解层 / 内容分层
    ├── ANALYTICS.md          # 埋点与后台统计:事件字典 / 转化漏斗 / 付费归因 / 存储与隐私
    ├── PAYMENTS.md           # 支付设计:闲鱼卡密 / Stripe / 加密 tx-hash 核验 + 统一权益
    ├── legal/                # 条款草稿(需律师审):TERMS_OF_SERVICE.md / BILLING_REFUND.md
    ├── PRELAUNCH_CHECKLIST.md# 上线前准备清单
    └── PUSH_TO_GITHUB.md     # 如何把本仓库推到 GitHub
```

---

## 快速开始

**只想看产品**:打开 [traderhome-histroy.xyz](https://traderhome-histroy.xyz/) 或直接用浏览器打开 `prototype/app.html`。右上角可切换 `中/EN`、深/浅主题和“讲解”模式；站内全部分析表免费查看。

**重新生成图表与原型**(需 Python 3 + `matplotlib numpy`):

```bash
cd pipeline
pip install matplotlib numpy
python appdata.py        # data/*.json -> appdata.json
python charts_slate.py   # -> charts_slate.json (灰蓝深/浅图)
python app.py            # -> app.html
python report3.py        # -> report.html
```

> 生成的 `appdata.json` / `charts_slate.json` 属可再生中间产物,已在 `.gitignore` 中忽略;仓库以 `data/*.json`(原始计算结果)与脚本为准。

---

## 数据来源与提醒

- 加密:Binance 公开 Klines,当前生产页使用 4 小时线。
- 美股 / 大宗 ETF:Yahoo Finance 日线;GLD、USO 是 ETF 代理,不等于黄金现货或 WTI 连续期货。
- 网页只发布衍生统计,资产字段 `last` 必须保持 `null`,不提供实时价格。
- 免费接口适合研究展示;商用需改用正规数据商并取得授权。
- 完整字段解释、时间换算、corr/DTW、显著性和局限见 [`docs/METHODS_AND_SOURCES.md`](./docs/METHODS_AND_SOURCES.md)。

## 算法一句话

对最近 N 根 K 线的对数收盘价做 z-标准化(只留形状),在全史滑动窗口用相关系数与 DTW 找最像片段,**严格只取当时之前的数据(无未来函数)**,统计其后各前瞻期的上涨概率/分布,并与无条件基准对照。生产口径见 [`docs/METHODS_AND_SOURCES.md`](./docs/METHODS_AND_SOURCES.md),产品规格见 `docs/BUILD_SPEC.md §2`。

## 许可

见 [`LICENSE`](./LICENSE)(默认专有,All Rights Reserved;如需改为开源许可请自行替换)。
