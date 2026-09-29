# TraderHome integration

The custom domain contains a research/review workflow plus independent research systems:

- `/history/` — Kezhou historical evidence.
- `/review/` — TradeReview OS post-trade showcase.
- `/incomeos/` — browser-local weekly contribution allocator, growth-cycle research, and cash-secured-put gate.
- `/tailtrend/` — derived daily-close tail/mean-reversion, trend-acceptance, event-quarantine and account-risk shadow board.
- `/daily-trade/` — validated morning and evening research reports.
- `/otc/` — daily OTC history and conditional research.
- `/market-simulation/` — public read-only mainstream market paper dashboard.

`python portal/build_site.py` produces `_site/`. The build intentionally publishes
only the TradeReview showcase and never copies its private trade ledger or local
Python API. Shared navigation is injected at build time, but only `/history/`
and `/review/` receive the numbered workflow stage bar. IncomeOS, TailTrend and
market simulation remain independent systems.

IncomeOS publishes a derived Longbridge research snapshot, never an OAuth token or IBKR
account ledger. Weekly contribution, account value, put reserve, growth-stock exposure,
and font scale stay in browser local storage. The current option table uses last trades
for research comparison only; missing bid/ask is a hard execution rejection until the
user checks the live IBKR order ticket.

TailTrend publishes only derived Longbridge daily-close states and management levels.
Its raw OHLCV never enters the static bundle. Account risk inputs and locally imported
bars remain in browser memory, are not persisted, and cannot create broker orders.

Discord and Telegram invitations remain visibly unconfigured until the owner adds
real invite URLs; the build never invents or redirects to an unrelated community.

`/market-simulation/` renders a public read-only paper ledger without an iframe or visitor login. GitHub Actions reads the existing private cloud ledger and publishes an allowlisted snapshot every ten minutes. Ten-minute execution and hourly model review remain in the existing cloud services. See `docs/MARKET_SIMULATION_PUBLISHING.md`.
