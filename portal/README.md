# TraderHome integration

The custom domain contains a three-stage core workflow plus one separate live-flow system:

- `/history/` — Kezhou historical evidence.
- `/decision/app.html` — EV Desk pre-trade planning.
- `/review/` — TradeReview OS post-trade showcase.
- `/flow/` — NQ Flow Console browser-safe simulated preview and private-live launch point.
- `/standards/` — shared evidence, rights, and editorial standard.

`python portal/build_site.py` produces `_site/`. The build intentionally publishes
only the TradeReview showcase and never copies its private trade ledger or local
Python API. The public Flow bundle contains no paid feed, API key, or live entitlement;
its real-time service remains independently authenticated. Shared navigation is injected
at build time, but only `/history/`, `/decision/`, and `/review/` receive the numbered
workflow stage bar. `/flow/` deliberately remains outside that sequence.

Discord and Telegram invitations remain visibly unconfigured until the owner adds
real invite URLs; the build never invents or redirects to an unrelated community.
