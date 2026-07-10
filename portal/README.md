# TraderHome integration

The custom domain is built as one public demo with three independent workspaces:

- `/history/` — Kezhou historical evidence.
- `/decision/app.html` — EV Desk pre-trade planning.
- `/review/` — TradeReview OS post-trade showcase.

`python portal/build_site.py` produces `_site/`. The build intentionally publishes
only the TradeReview showcase and never copies its private trade ledger or local
Python API. Shared navigation is injected at build time so the source products can
continue to evolve independently.

Discord and Telegram invitations remain visibly unconfigured until the owner adds
real invite URLs; the build never invents or redirects to an unrelated community.
