# Kezhou 后端骨架 (FastAPI + OpenAPI)

覆盖你要的五块:**匹配引擎 / 内容分层裁剪 / 埋点 collect / 检索 resolve / 收藏 watchlists**,外加账户、额度、订阅(Stripe·支付宝·加密的 Webhook 骨架)、后台统计。这是**可跑的骨架**:存储是内存版,支付/数据源是占位 TODO,便于你在此基础上接真实基础设施与 Stripe/加密钱包。

## 快速起跑
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload            # 交互文档: http://127.0.0.1:8000/docs
pytest -q                                # 引擎回归测试(含"无未来函数"断言)
python scripts/export_openapi.py         # 导出 openapi.json
```

## 结构
```
backend/
├── app/
│   ├── main.py            # FastAPI 应用 + CORS + 路由挂载 + /health
│   ├── config.py          # 配置(额度、免费/Pro 字段、限速、密钥占位)
│   ├── schemas.py         # Pydantic 模型 = OpenAPI 契约
│   ├── deps.py            # 鉴权(HMAC 令牌)、口令哈希(PBKDF2)—— 生产换 JWT+argon2
│   ├── store.py           # 内存存储 + 额度 + 标的字典 + resolve —— 生产换 PG/Redis
│   ├── data.py            # 预算结果加载 + 内容分层裁剪 —— 生产换引擎缓存/现算
│   ├── engine/matcher.py  # ★ 匹配引擎(numpy):z-标准化 + corr + DTW + 基准 + 季节性(无未来函数)
│   └── routers/           # auth / symbols / analysis / watchlists / collect / billing / admin
├── tests/test_matcher.py  # 引擎性质与回归测试
└── scripts/export_openapi.py
```

## 关键端点
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/signup` `/auth/login` | 邮箱注册/登录 → 令牌 |
| GET | `/auth/me` | 用户 + 当日额度 |
| GET | `/symbols/search?q=` | 自动补全 |
| POST | `/symbols/resolve` | 存在性校验 + 消歧(前端"确认这个标的") |
| GET | `/analysis/{symbol}` | **双闸**:每日额度(402 超额)+ 内容分层(免费裁剪,锁定字段不下发) |
| GET/POST/PATCH/DELETE | `/watchlists…` | 多命名列表收藏 |
| POST | `/collect` | 埋点批量上报 |
| GET | `/billing/subscription`,POST `/billing/stripe/*` `/alipay/notify` `/crypto/webhook` | 订阅 + 三渠道 Webhook 骨架 |
| GET | `/admin/stats` | 漏斗/转化/付费归因/热门标的 |

## 设计要点(与文档一致)
- **无未来函数**:`engine.matcher.analyze` 的候选片段结束点严格早于当前窗口,前瞻收益全为已实现历史;`tests/test_matcher.py::test_no_lookahead` 守护。
- **内容分层服务端裁剪**:免费用户 `/analysis` 的 `prob_table/seasonality_years/matches` 字段**不下发**(=None),不能靠前端隐藏。见 `data.build_analysis`。
- **额度服务端强制**:同日重复品类不重复计费;超额 402。生产用 Redis 计数 + 每日过期。
- **支付以 Webhook 为准**:权限只认 `subscription` 状态,不认渠道;Stripe/支付宝/加密统一收敛。**不自建收银台收卡号**。
- 详见 `../docs/BUILD_SPEC.md`(架构/引擎/支付)、`../docs/ANALYTICS.md`(埋点)、`../docs/FEATURES_v2.md`(刷新/检索/收藏/分层)。

## 待接入(你的下一步)
- 正规数据源 + 冷启动全量 + 按需 fetch 限速(令牌桶,`config.SOURCE_QPS`)。
- Postgres(账户/订阅/收藏)、Redis(额度)、ClickHouse/PostHog(埋点)。
- Stripe Billing(Product「Pro」$19/mo + Checkout + Customer Portal)、支付宝、加密钱包 —— 你来搞定密钥与商户配置。
