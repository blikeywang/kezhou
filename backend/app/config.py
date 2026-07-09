"""配置。生产用环境变量 + 密管;此处给默认值便于本地起跑。"""
import os


class Settings:
    APP_NAME = "Kezhou API"
    ENV = os.getenv("ENV", "dev")

    # ===== 运营模式 =====
    # FREE_MODE=1(默认):**全站免费**——无每日额度、无内容付费墙、全字段下发;
    #   付费入口"待上线",加密钱包仅作**打赏/捐赠**(不绑权益、不做核验)。
    # 置 0 才恢复分层收费(需先解决数据商用授权 + 合规,见 PRELAUNCH_CHECKLIST §0)。
    FREE_MODE = os.getenv("FREE_MODE", "1") == "1"

    JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me")
    JWT_TTL_MIN = int(os.getenv("JWT_TTL_MIN", "60"))
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

    # 会员档位 -> 每日品类查询额度
    QUOTA = {"free": 5, "pro": 50, "team": 100000}

    # 免费用户可见字段(其余锁定给 Pro)。服务端裁剪,不下发锁定字段。
    FREE_FIELDS = {"symbol", "verdict", "kpi", "chart", "morphology"}
    PRO_FIELDS = {"prob_table", "seasonality_years", "matches", "multi_timeframe"}

    # 数据源限速(令牌桶,占位)
    SOURCE_QPS = {"binance": 8, "yahoo": 4}

    STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")          # sk_test_.../sk_live_... —— 只从环境读,勿入库
    STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")  # whsec_...
    STRIPE_PRICE_PRO = os.getenv("STRIPE_PRICE_PRO", "price_XXX")   # Pro $19/mo 的 Price ID
    STRIPE_API_VERSION = os.getenv("STRIPE_API_VERSION", "2026-06-24.dahlia")
    STRIPE_ENABLED = os.getenv("STRIPE_ENABLED", "0") == "1"       # 先"即将支持",接好后置 1
    PUBLIC_DOMAIN = os.getenv("PUBLIC_DOMAIN", "http://localhost:5173")  # 前端域名(用于回跳)

    # 档位 -> 每日额度(统一权益的来源)
    TIERS = {"free": 5, "day5": 5, "pro50": 50, "team": 100000}
    TIER_VALID_DAYS = {"day5": 30, "pro50": 30}  # 一次性购买的有效期(你可改)

    # 闲鱼:两个商品链接(你的真实链接替换)
    XIANYU_SKUS = [
        {"tier": "day5", "price_cny": 1, "url": "https://2.taobao.com/item.htm?id=[YOUR_DAY5_ITEM]"},
        {"tier": "pro50", "price_cny": 10, "url": "https://2.taobao.com/item.htm?id=[YOUR_PRO50_ITEM]"},
    ]

    # 加密:多链 USDC + 自建 tx-hash 链上核验
    PAYMENTS_DEMO = os.getenv("PAYMENTS_DEMO", "0") == "1"   # 默认关(真实链上核验);置 1 才放宽(仅联调)
    CRYPTO_QUOTE_TTL_MIN = 20                                # 报价/付款确认窗口(分钟)
    CRYPTO_PRICE_USDC = {"day5": 1, "pro50": 5}             # 各档位应付 USDC(你定)
    # 支持的收款网络(均为你的公开收款地址;USDC 小数位按链不同)
    CRYPTO_NETWORKS = {
        "bnb": {
            "family": "evm", "label": "BNB Chain · USDC",
            "address": "0xf67fa38ccc2a7e3c7b42afd758b0b032df7aa32a",
            "token": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",  # Binance-Peg USDC(18 位小数)
            "decimals": 18, "confirmations": 15,
            "rpc": os.getenv("BNB_RPC", "https://bsc-dataseed.binance.org"),
        },
        "arbitrum": {
            "family": "evm", "label": "Arbitrum · USDC",
            "address": "0xf67fa38ccc2a7e3c7b42afd758b0b032df7aa32a",
            "token": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",  # Arbitrum 原生 USDC(6 位小数)
            "decimals": 6, "confirmations": 20,
            "rpc": os.getenv("ARB_RPC", "https://arb1.arbitrum.io/rpc"),
        },
        "solana": {
            "family": "solana", "label": "Solana · USDC",
            "address": "FDiCD6Kpas8uaH7a2jYxsLFKi121hHa9gpDZ9qZV66Jf",
            "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  # USDC mint(6 位小数)
            "decimals": 6, "rpc": os.getenv("SOL_RPC", "https://api.mainnet-beta.solana.com"),
        },
    }


settings = Settings()
