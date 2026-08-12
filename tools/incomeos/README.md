# IncomeOS weekly refresh

Run from the TraderHome repository root:

```bash
node tools/incomeos/refresh.mjs
node --test portal/test_incomeos_engine.mjs
python3 -m unittest portal.test_portal
```

The refresh scans 71 assets, selects the current investable Top 50, builds the constrained portfolio, refreshes the SPYM whole-share execution proxy, enriches the highest-ranked and benchmark assets with 28–49 DTE Call/Put data, then upserts that day's model action sheet into `operation-history.json`.

It requires an authenticated local Longbridge CLI session. Credentials are never written into the repository or the published site. GitHub Actions therefore validates and deploys the committed snapshot but does not fetch private Longbridge data itself.

The intended schedule is Friday 10:00 America/New_York. The resulting `portal/vendor/incomeos/data/incomeos-full.json` and `portal/vendor/incomeos/data/operation-history.json` must be reviewed, tested, committed, and pushed before they become live. Historical records are model snapshots, not claims of completed IBKR trades.
