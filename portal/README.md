# TraderHome integration

The custom domain contains a three-stage core workflow plus three independent systems:

- `/history/` — Kezhou historical evidence.
- `/decision/app.html` — EV Desk pre-trade planning.
- `/review/` — TradeReview OS post-trade showcase.
- `/flow/` — NQ Flow Console browser-safe simulated preview and private-live launch point.
- `/incomeos/` — browser-local weekly contribution allocator, growth-cycle research, and cash-secured-put gate.
- `/incomeos-whole/` — complete IncomeOS workspace with whole-share-only execution and SPYM as the small-account SPY proxy.
- `/standards/` — shared evidence, rights, and editorial standard.

`python portal/build_site.py` produces `_site/`. The build intentionally publishes
only the TradeReview showcase and never copies its private trade ledger or local
Python API. The public Flow bundle contains no paid feed, API key, or live entitlement;
its real-time service remains independently authenticated. Shared navigation is injected
at build time, but only `/history/`, `/decision/`, and `/review/` receive the numbered
workflow stage bar. `/flow/`, `/incomeos/`, and `/incomeos-whole/` deliberately remain outside that sequence.

IncomeOS publishes a derived Longbridge research snapshot, never an OAuth token or IBKR
account ledger. Weekly contribution, account value, put reserve, growth-stock exposure,
and font scale stay in browser local storage. The current option table uses last trades
for research comparison only; missing bid/ask is a hard execution rejection until the
user checks the live IBKR order ticket.
The whole-share route reuses the same read-only research snapshot, keeps a separate
browser-local plan, reserves a configurable cash buffer, and never emits fractional quantities.

Discord and Telegram invitations remain visibly unconfigured until the owner adds
real invite URLs; the build never invents or redirects to an unrelated community.
