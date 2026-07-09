# 支付设计 — 咸鱼 / Stripe / 加密

> **⚑ 当前运营模式:全站免费 + 自愿打赏(`FREE_MODE=1`,默认)。**
> - 全部功能免费,无额度、无付费墙。
> - 下述三种付费方式**代码就绪但"待上线"**:`FREE_MODE=1` 时 `/billing/redeem`、`/billing/crypto/quote`、`/billing/crypto/submit` 一律返回 503。
> - 加密钱包改作**打赏**:`GET /billing/tip/wallets` 返回 USDC 收款地址,**不绑权益、不核验、不解锁**(自愿捐赠)。
> - 恢复收费:设 `FREE_MODE=0`,下面这套(卡密 + 链上核验 + Checkout)即全部生效。
>
> 以下为**收费模式**的完整设计,`FREE_MODE=0` 时适用。

---

三种付费方式,统一到**一套权益(entitlement)**。配合 `BUILD_SPEC.md §5`、`backend/app/routers/billing.py`、法务见 `docs/legal/`。

> **当前落地状态**:优先**加密 + 闲鱼**;**Stripe 先"即将支持"**(`STRIPE_ENABLED=0`,代码已就绪,置 1 即启用)。
> 加密改为**多链 USDC + 真实链上核验**(`backend/app/crypto_verify.py`),收款地址(公开)已配置:
> - **BNB Chain / Arbitrum**(EVM · USDC):`0xf67fa38ccc2a7e3c7b42afd758b0b032df7aa32a`(⚠️ BNB 上 USDC 为 18 位小数、Arbitrum 为 6 位,已按链处理)
> - **Solana**(USDC):`FDiCD6Kpas8uaH7a2jYxsLFKi121hHa9gpDZ9qZV66Jf`
> 核验:用户提交 tx_hash → EVM 读回执中的 USDC `Transfer` 日志(收款地址/金额/确认数),Solana 读代币余额增量;hash 去重防重放。USDC 为稳定币,金额=定价,无需汇率换算。

---

## 0. 统一权益模型(三方式都收敛到这里)

```
entitlement { user_id, tier, daily_limit, valid_until, source }
tier:  day5(每日5次) | pro50(每日50次) | team
source: xianyu | stripe | crypto
```
- **权限只认 entitlement**,不认渠道。任何渠道支付成功 → 调同一个 `grant_entitlement(user, tier, days)`。
- **每日额度**由 `entitlement.daily_limit` 决定(过期→回落免费)。额度服务端强制(见 analysis 路由)。
- 价格↔档位↔时长由你配置(示例:day5=¥1、pro50=¥10;时长建议按 30 天/月)。

---

## 1. 咸鱼(闲鱼)—— 兑换码(卡密)方式 【推荐,零支付集成】

**为什么用卡密**:闲鱼没有对外支付 API / 回调,第三方无法自动确认到账。所以走**发码兑换**:

**流程**
1. 前端"咸鱼购买"按钮 → 跳转你的**闲鱼商品链接**(day5 一个链接、pro50 一个链接)。
2. 用户在闲鱼拍下付款;你用闲鱼"**自动发货**"把一串**卡密**发给买家(降低人工)。
3. 用户回站在"兑换"框输入卡密 → `POST /billing/redeem {code}` → 后端校验(存在、未用、未过期、绑定的 tier)→ 激活 entitlement。

**卡密生成/管理**:后台批量生成 `redemption_code{code, tier, valid_days, used, used_by, expires_at}`;一次性、绑定档位。生产入库并防枚举(足够随机、失败限速)。

**优点**:绕开境内支付资质与手续费、上线最快。**缺点**:发货依赖闲鱼(半自动);对账靠卡密。**风险**:平台政策(确认闲鱼是否允许此类虚拟商品)、退款走闲鱼。

**你要定**:day5/pro50 的价格与有效期;卡密时长;是否自动发货。

---

## 2. Stripe 【国际卡,主渠道】

**跳转 vs API**:
- **Checkout(托管跳转)—— 推荐**:`mode=subscription`,Stripe 托管收银页,PCI 负担最小、支持订阅/发票/Customer Portal,几天可上线。
- **Payment Element(API,站内不跳转)**:体验更顺,但要自建更多 UI、承担更多合规;等有余力再上。

**流程(Checkout)**:`POST /billing/stripe/checkout` 建 Session → 前端跳转 → 成功回跳(仅提示)→ **以 Webhook 为准**(`checkout.session.completed`、`customer.subscription.*`、`invoice.*`)更新 entitlement 与 `valid_until`。提供 Customer Portal 自助取消/改套餐。

**你要定**:是否上年付;是否也把**支付宝**挂到 Stripe 的 payment method(跨境最省事)。**必须先备条款**(见 §4)。

---

## 3. 加密支付 —— 自建 tx-hash 链上核验 【你倾向的方式】

**流程**
1. 用户选档位 → `POST /billing/crypto/quote {tier}` → 返回:**收款地址**、**应付金额**(按定价×实时汇率折币)、**链与代币**、**订单号/唯一尾数**、有效期。
2. 用户从自己钱包转账 → 把 **tx hash** 提交:`POST /billing/crypto/submit {tier, tx_hash}`。
3. 后端**链上核验**(用节点 RPC 或浏览器 API):
   - 收款地址 == 我方地址;
   - 金额 ≥ 应付(按汇率 + 容差);
   - 确认数 ≥ N(如 ETH/Base 12、Tron 20);
   - **tx_hash 未被使用过**(去重防重放);
   - 在报价有效期内。
   全部通过 → 激活 entitlement。

**关键难点**
- **金额消歧**(多用户转同一地址无法区分):给每单一个**唯一微额尾数**(如 10.0001/10.0002…),或**每单生成一次性地址/memo**(交易所式);推荐一次性地址或唯一尾数。
- **汇率窗口**:报价锁定汇率 N 分钟;超时重报。
- **链/币种**:建议 **USDT/USDC on Tron 或 Base/Ethereum**(稳定币免汇率波动、手续费低)。
- **到账延迟**:轮询/或让用户提交 hash 后异步核验,确认后回调前端。

**省心替代**:接 **Coinbase Commerce / NOWPayments / BTCPay Server** 网关,由它建 charge + 发 Webhook,少写核验逻辑。

**你要定**:自建核验 vs 网关;支持哪条链/哪些币;钱包地址;确认数阈值;退款政策(加密退款复杂,建议明确"不退或按币退")。

---

## 4. 条款与合规(三方式都要,Stripe 尤其强制)
见 `docs/legal/TERMS_OF_SERVICE.md` 与 `docs/legal/BILLING_REFUND.md`(草稿)。要点:
- 明确"**基于历史相似度的信息服务,非投资建议**"(全站免责)。
- 订阅/一次性、自动续费与取消、**退款政策**(数字商品通常有限退款;加密与卡密另述)。
- 跨境税务、争议处理;加密与金融信息在部分辖区的监管/披露。
- **务必律师审**——尤其金融信息 + 加密 + 跨境。

---

## 5. 待你拍板的决策清单
1. 咸鱼:卡密(推荐)还是人工按订单激活?day5/pro50 价格与有效期?
2. Stripe:Checkout(推荐)还是 API?是否年付?支付宝是否经 Stripe?
3. 加密:自建核验(推荐你已倾向)还是网关?支持链/币?钱包地址?确认数?退款政策?

> 后端已按"卡密 + 自建 tx-hash 核验 + Checkout"这套**推荐路径**搭好可调用骨架(`billing.py`),你确认后填真实密钥/地址/链参数即可。
