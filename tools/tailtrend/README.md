# TailTrend Lab daily refresh

TailTrend Lab is a research-only, daily-close scanner for the unified tail mean-reversion and trend-following framework.

Run from the TraderHome repository root after the regular US session has closed:

```bash
node tools/tailtrend/refresh.mjs
node --test portal/test_tailtrend_engine.mjs
python3 -m unittest portal.test_portal
```

The refresh uses the authenticated local Longbridge CLI and requests 360 forward-adjusted regular-session daily candles for each symbol. It publishes only derived state, tail boundaries, volatility, liquidity, event, management-zone and data-health fields. It does not publish raw OHLCV, account data, broker credentials or orders.

The initial universe is deliberately small and liquid so the shadow test is easy to inspect. Change `universe.json` only as a versioned research decision. A failed refresh may use a prior derived row while building the attempted run, but the official daily artifact is frozen as `MISSING`; `latest.json` then exposes the most recent complete snapshot only after marking every row `STALE` and forcing `newPositionAllowed=false`.

The website is a monitoring and position-sizing aid, not an automatic trading system. Account inputs remain in browser memory and are never sent to TraderHome. The position calculator inherits the selected record's state, freshness, event and short-qualification gates; a blocked state always returns zero shares, and the strategy sleeve is not user-switchable.

Daily state storage is append-only:

```text
portal/vendor/tailtrend/data/
  snapshots/YYYY-MM-DD.json  # immutable COMPLETE or MISSING record
  latest.json                # mutable safe display pointer
  index.json                 # all dates, health, transitions and version hashes
  tailtrend-audit.json       # separately derived forward outcomes
```

Each immutable snapshot includes `dataAsOf`, `runAt`, engine commit/source hash, parameter hash, explicit previous state, transition reasons, active boundary memory and public risk-factor decomposition. Same-day reruns cannot overwrite it, and missing trading sessions receive explicit `MISSING` files.

`tailtrend-audit.json` fills the next-session reference plus 1/3/5/10-session MFE/MAE only when later daily bars arrive and is never silently truncated. Forward outcomes remain separate so historical state snapshots are not mutated. Neither file contains the source OHLCV rows.
