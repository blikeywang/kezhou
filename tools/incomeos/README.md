# IncomeOS weekly refresh

Run from the TraderHome repository root:

```bash
node tools/incomeos/refresh.mjs
node --test portal/test_incomeos_engine.mjs
python3 -m unittest portal.test_portal
```

The refresh scans 71 assets, selects the current investable Top 50, builds the constrained portfolio, then enriches the highest-ranked and benchmark assets with 28–49 DTE Call/Put data.

It requires an authenticated local Longbridge CLI session. Credentials are never written into the repository or the published site. GitHub Actions therefore validates and deploys the committed snapshot but does not fetch private Longbridge data itself.

The intended schedule is Friday 10:00 America/New_York. The resulting `portal/vendor/incomeos/data/incomeos-full.json` must be reviewed, tested, committed, and pushed before it becomes live.
