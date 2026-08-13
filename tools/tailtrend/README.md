# TailTrend Lab daily refresh

TailTrend Lab is a research-only, daily-close scanner for the unified tail mean-reversion and trend-following framework.

Run from the TraderHome repository root after the regular US session has closed:

```bash
node tools/tailtrend/refresh.mjs
node --test portal/test_tailtrend_engine.mjs
python3 -m unittest portal.test_portal
```

The refresh uses the authenticated local Longbridge CLI and requests 360 forward-adjusted regular-session daily candles for each symbol. It publishes only derived state, tail boundaries, volatility, liquidity, event, management-zone and data-health fields. It does not publish raw OHLCV, account data, broker credentials or orders.

The initial universe is deliberately small and liquid so the shadow test is easy to inspect. Change `universe.json` only as a versioned research decision. A failed refresh can carry the prior derived row as `CACHED` or `STALE`, but cached rows are forced to `newPositionAllowed=false`.

The website is a monitoring and position-sizing aid, not an automatic trading system. Account inputs remain in browser memory and are never sent to TraderHome. The position calculator inherits the selected record's state, freshness, event and short-qualification gates; a blocked state always returns zero shares, and the strategy sleeve is not user-switchable.

`tailtrend-audit.json` is a derived, append-by-trading-day shadow ledger. It starts each symbol with a real baseline and fills the next-session reference plus 1/3/5/10-session MFE/MAE only when later daily bars arrive. It never backfills invented observations and does not contain the source OHLCV rows.
