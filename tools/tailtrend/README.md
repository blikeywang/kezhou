# TailTrend Lab daily refresh

**完整维护/Claude接手入口：[TailTrend README](../../docs/tailtrend/README.md)。**
公式、状态机与风险请读[计算规格](../../docs/tailtrend/CALCULATIONS.md)；数据字段、时效、MISSING和调度请读[数据与运维](../../docs/tailtrend/DATA_AND_OPERATIONS.md)；已知缺口与更新步骤见[Claude清单](../../docs/tailtrend/CLAUDE_HANDOFF.md)。以下为运行速查。

TailTrend Lab is a research-only, daily-close scanner for the unified tail mean-reversion and trend-following framework.

Run from the TraderHome repository root after the regular US session has closed:

```bash
node tools/tailtrend/refresh.mjs
node --test portal/test_tailtrend_engine.mjs
python3 -m unittest portal.test_portal
```

`tools/scheduler/` supports automatic runs on the owner's Mac when installed and authenticated; source code alone does not prove a successful schedule. At the 2026-11-08 documentation audit, the committed and public TailTrend snapshot still represented the 2026-08-12 close. The refresh uses the authenticated local Longbridge CLI and requests 360 forward-adjusted regular-session daily candles for each symbol. It publishes only derived state, tail boundaries, volatility, liquidity, event, management-zone and data-health fields. It does not publish raw OHLCV, account data, broker credentials or orders.

The initial universe is deliberately small and liquid so the shadow test is easy to inspect. Change `universe.json` only as a versioned research decision. A failed refresh may use a prior derived row while building the attempted run, but the official daily artifact is frozen as `MISSING`; `latest.json` then exposes the most recent complete snapshot only after marking every row `STALE` and forcing `newPositionAllowed=false`.

The website is a monitoring and position-sizing aid, not an automatic trading system. Account inputs remain in browser memory and are never sent to TraderHome. The position calculator inherits the selected record's state, freshness, event and short-qualification gates; a blocked state always returns zero shares, and the strategy sleeve is not user-switchable.

Daily state storage is append-only:

```text
portal/vendor/tailtrend/data/
  snapshots/YYYY-MM-DD.json  # immutable COMPLETE, MISSING or NOT_SCHEDULED record
  latest.json                # mutable safe display pointer
  index.json                 # all dates, health, transitions and version hashes
  tailtrend-audit.json       # separately derived forward outcomes
```

Each immutable snapshot includes `dataAsOf`, `runAt`, engine commit/source hash, parameter hash, explicit previous state, transition reasons, active boundary memory and public risk-factor decomposition. Same-day reruns cannot overwrite it, and missed scheduled sessions receive explicit `MISSING` files (prospective weekly non-run sessions are `NOT_SCHEDULED`).

`tailtrend-audit.json` fills the next-session reference plus 1/3/5/10-session MFE/MAE only when later daily bars arrive and is never silently truncated. Forward outcomes remain separate so historical state snapshots are not mutated. Neither file contains the source OHLCV rows.

Operational limits: missing dates are discovered only on a later run within the visible bar dates, not continuously. A frozen same-day `MISSING` cannot be replaced by a retry. The audit receives the full fetched daily window; continuity gaps fail closed and require explicit repair before interpreting horizons. Event-calendar failures do not yet hard-block publication. Read the handoff before restarting a long-paused pipeline or changing rules.

## Weekly research cadence (effective 2026-11-10)

The owner requested one refresh after the week's final NYSE session closes:
Friday normally, Thursday or another last trading session when Friday is closed.
The existing 20-minute post-close buffer and early-close calendar apply. No Mac
launchd task is installed by this change. `incomeos-friday` (the separate
intraday action window), daily reports, and simulation/publication clocks are
unchanged. An off-window `--force` is an explicit manual override, not scheduled
execution evidence. A missed weekly release must be reported; a later Monday
snapshot must never be passed off as Friday's data.

From the effective date only, newly discovered non-release trading dates receive
immutable `NOT_SCHEDULED` records (`schedule.version=weekly-close-v1`), not
`MISSING`. A missed scheduled date remains `MISSING`. Existing snapshot files,
including historical missing dates, are never rewritten or reclassified. The
index exposes `notScheduledDates`; `missingDates` excludes these. New complete
snapshots expose `observationContext` (previous observation, intervening sessions,
planned non-runs and missing scheduled sessions). Counts cover the supplied
calendar dates, not an invented complete calendar across an arbitrarily long gap.
Display code should read these fields rather than infer intent from gap length.
The four-day signal freshness gate is NOT extended by weekly publication.

Audit `daysCollected` retains its API name but means independent signal-origin
**observations**, not elapsed days. UI copy: “先积累 5–10 期同版本观察，再看结果”
(roughly 5–10 weeks at weekly cadence). Epochs remain separate by framework,
engine source hash and parameter hash. The next normal 0.3.1 observation starts
its own count; prior 0.3.0 and retrospective research revisions do not count as
prospective 0.3.1 signals. Audit metadata declares `sampleUnit` and
`forwardHorizonUnit` explicitly.

1/3/5/10-session outcomes remain **trading days**, not weeks. A weekly refresh
supplies the entire fetched daily-bar window to the audit (previously only 20
bars). Before any normal snapshot write it verifies every subsequent NYSE
session needed by existing entries is present with valid OHLC. Missing history
fails closed with `AUDIT_CONTINUITY_GAP`; restore data before interpreting
outcomes. Backfilled prices update only forward outcome observations, never
historical signals, and do not create Monday–Thursday signal samples. Source
bars stay private. Research revisions still bypass the audit entirely.
