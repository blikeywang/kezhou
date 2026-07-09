# Stripe 接入指南(Kezhou Pro 订阅)

针对你现有 FastAPI 后端(`app/routers/billing.py` 已实现 Checkout + Customer Portal + Webhook)。用 **Checkout 托管跳转**,最省 PCI、最快上线。

> 你需要的 Stripe 产品:**Billing(订阅)** + 底层 **Payments**;**Invoicing** 由订阅自动产生。**不需要 Connect**(那是给"平台向第三方打款"用的;你卖自己的订阅用不到)。
>
> 🔒 **密钥安全**:`sk_test_…/sk_live_…` 只放进环境变量/密管,**永不提交仓库、不要发给任何人(包括我)**。代码只从 `os.getenv` 读。

## 1. 在 Stripe Dashboard 建产品与价格
1. 先用 **测试模式(Test mode)**。
2. Product catalog → 新建 Product「Kezhou Pro」→ 加一个 **Recurring** Price:$19.00 / **month** → 记下 **Price ID**(`price_...`)。

## 2. 拿密钥与 Webhook 签名密钥
- Developers → API keys → **Secret key**(`sk_test_...`)。
- Developers → Webhooks → Add endpoint:
  - URL:`https://api.你的域名/billing/stripe/webhook`
  - 订阅事件:`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`、`invoice.paid`、`invoice.payment_failed`
  - 保存后复制 **Signing secret**(`whsec_...`)。

## 3. 配置环境变量(勿入库)
```bash
export STRIPE_SECRET_KEY=sk_test_xxx
export STRIPE_WEBHOOK_SECRET=whsec_xxx
export STRIPE_PRICE_PRO=price_xxx
export PUBLIC_DOMAIN=https://你的前端域名     # 用于成功/取消回跳
# 可选:export STRIPE_API_VERSION=2026-06-24.dahlia
pip install -r requirements.txt               # 含 stripe SDK
```

## 4. 打通的流程(已在代码里)
1. 前端点"Stripe 支付" → `POST /billing/stripe/checkout`(带登录令牌)→ 返回 `{url}` → 前端 `window.location = url` 跳转 Stripe 收银页。
2. 付款成功 → Stripe 回跳 `PUBLIC_DOMAIN/billing/success`(仅提示,**不据此发权益**)。
3. **权益由 Webhook 授予**:`customer.subscription.*` / `invoice.paid` → 后端 `_sync_subscription` → 按订阅 `status=active` 与 `current_period_end` 调 `grant_entitlement(uid,'pro50','stripe',until=period_end)`。续费/取消都由后续 Webhook 自动滚动/回收。
4. 自助管理:`POST /billing/stripe/portal` → 返回 Customer Portal URL(改套餐/取消/换卡)。需在 Dashboard → Settings → Billing → Customer portal 启用。

**为什么以 Webhook 为准**:订阅状态会在你不调用 Stripe 时改变(如续费失败转 `past_due`)。回跳只用于用户体验,**真实开通/回收全走 Webhook**。已做:**验签**(`construct_event`)+ **幂等**(按 `event.id` 去重)+ 状态缓存到你的库(避免限流)。

## 5. 本地联调(测试卡)
```bash
stripe login
stripe listen --forward-to localhost:8000/billing/stripe/webhook
# 用返回的 whsec_ 覆盖 STRIPE_WEBHOOK_SECRET 再起服务
```
- 走一遍 checkout,填测试卡 **4242 4242 4242 4242**(任意未来有效期 + 任意 CVC)。
- 失败卡 `4000 0000 0000 0341` 触发 `invoice.payment_failed`。
- 观察后端日志与 `/auth/me` 的 `quota_limit` 应从 5 变 50;取消后应回落。

## 6. 上线(Live)
- 切 **live** 密钥、**live** Price、**live** Webhook(签名密钥不同)。
- 生产用 HTTPS;密钥进密管(不写死)。
- 打开需要的 **税费**(Stripe Tax)与发票邮件(Invoicing 随订阅自动生成,可在 Dashboard 开启客户发票邮件)。
- **自动续费披露/取消入口**要合规(见 `../docs/legal/BILLING_REFUND.md`;美国 ARL/加州自动续费法等)。

## 7. 待你确认后填的占位
- `STRIPE_PRICE_PRO`(建好 Price 后)、`PUBLIC_DOMAIN`、Webhook 事件与密钥。
- 是否加**年付**(再建一个 Price 即可,前端多一个按钮)。
- 是否把**支付宝**挂到 Stripe 的 payment methods(跨境最省事,Checkout 里勾选即可)。

> 我不经手你的密钥;上面所有 `sk_/whsec_/price_` 均由你在自己的环境设置。
