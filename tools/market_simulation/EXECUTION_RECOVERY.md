# 2026-11-05 execution recovery

The publisher was running every ten minutes, but the underlying paper account
stopped on 2026-11-03 20:51 UTC. Model analysis and review last submitted on
2026-10-08. A current export timestamp did not imply a current ledger.

`pages.yml` now executes `/api/github-run` before the allowlisted export. The
service verifies a signed GitHub OIDC token scoped to this repository's numeric
owner/repository IDs, main branch, exact pages workflow and a dedicated audience.
Only the existing paper engine is available through that endpoint. The existing
private Site read token remains a separate gateway credential; no new static
write secret is stored in GitHub.

Execution failure is exported as `publication.executionOutcome=failure` so a
successful static deployment cannot disguise it. Four independent health cards
age execution, model submissions, hourly review and publication. The engine
deduplicates repeated scheduled calls within a ten-minute slot. Existing D1
locking, fee/risk checks, frozen fills and no-backfill policy remain in force.

Strategy version `rules-3.1-event-auction-10m` adds a separately identified 5M
event-TPO experiment inspired by Session Rejection. It requires confirmed swing
structure, neckline break, a frozen event POC reaction and subsequent confirmation.
Complete event history is required even when previous-session TPO is missing.
One trade per event; original structural targets and net reward/risk checks remain.
It is not the 1M NQ research implementation and does not inherit its results.

The Site exposes owner-only model context and review/plan submission tools. Model
review is a separate cloud connection and schedule, not a label for deterministic
GitHub checks. Use actual saved review IDs and timestamps to verify it. Never
automatically release old review suspensions merely because time passed.

Baseline before recovery: 43 closed singles, 12 profitable, net -$2,109.72;
5 closed pair trades, 3 profitable, net +$531.10. These are separate accounts.
The old 3.0 auction rules had only two closed trades, both losses; that sample
cannot estimate a reliable win rate or validate the new event strategy.

Validation: signed-token trust boundaries and tampering; event prefix/future
invariance; same-event deduplication; original engine/horizon/pair/market and
SQLite ledger tests; public exporter, UI health, and portal checks.

Live verification (2026-11-05): Site version 13, source
`393cc8b932ad388de24981e00d9a870006b3ee24`, restored indexed bounded
archive reads. The previous full-archive JSON ranking exhausted D1's resource
window. Per-symbol batches also avoid D1's compound SELECT term limit.
The OIDC fetch uses manual redirect mode and rejects non-2xx; Workers does not
support the Fetch standard's `redirect: error` mode.

GitHub run `41962518703` returned an actual successful paper result at
03:35:32 UTC: ledger time 03:35:27.418, six fresh symbols, zero open positions,
44 closed singles. Public `latest.json` independently returned that ledger time
and `executionOutcome: success`. The additional close was the existing BTC
position's original stop, located in a past 5M bar during recovery; it was not
a new entry or a contemporaneous fill. Recovered single net P&L: -$2,232.03.

Owner-authenticated model submission `model-recovery-20261105T0338Z` and audit
`audit-recovery-20261105T0340Z` were saved and read back. The NQ pullback plan
has entry 28402–28406, original stop 28420, target 28362 before nearby support,
0.125% risk and a 60-minute expiry; it remains conditional, not a claimed fill.
The audit covered all six active targets and reconsidered old gates with current
evidence. NQ/10M and XAG/1H were explicitly released; pair gates remain held
because nearby leg targets do not support the old projected ratio rewards.

A Site-linked hourly model task was saved and independently read back as enabled,
starting 2026-11-05 12:08 Asia/Singapore and repeating each hour at :08.
The task forms new six-asset model plans, rereads context, reviews all required
targets and old gates, submits, and verifies saved IDs. Its saved state is not
proof of a future scheduled run; the initial owner-authenticated write/readback
above verifies the source and writer. Monitor actual model/review timestamps.

Follow-up execution correction: `rules-3.1.1-event-auction-10m` distinguishes an
hourly model observation from an explicit audit hold. A model wait still replaces
older plans, but does not suppress newer rule evidence for the full hour. An
unconsumed executable model plan retains priority, and explicit suspended gates
remain in force. Regression tests cover each case without changing frozen fills.

The publisher also writes `crypto-flow-review.json`, a compact view of the existing
public OKX 1H pivot evidence. It keeps original A/B times, prices, CVD anchors,
OI, confirmation status and evidence ID; limiting output to 12 comparisons is not
a fixed-hour divergence definition. The Site model context reads this bounded
public evidence without forwarding credentials, separately marks stale/unavailable
data, and points to the full series already published in `latest.json`.

## First unattended hourly run verified — 2026-11-05

The scheduled cloud run started at 12:09:20 Singapore time and completed at
12:17:40. It published `model-flow-20261105T0415Z` at 12:15:38 and
`audit-flow-20261105T0418Z` at 12:17:09, with all six required targets covered.
It reread changing market data after rejected stale-reference submissions.
The next automatic Pages publication, run `41967460717`, exported at 12:23:32
and deployed at 12:24:13. All six model report IDs/hashes and the audit ID/hash/
target IDs were matched against the public files. This is actual scheduled
execution evidence, separate from the initial manual writer verification.

## ICT forward comparison

The new ICT/TPO page compares two independent, simultaneous paper cohorts,
each starting with USD 100,000 and 0.125% per-trade risk. The existing ledger
is preserved. ICT is an explicit mechanical approximation of confirmed swing
sweep, displacement/MSS, three-candle FVG and subsequent retracement, with
nearest known targets and costs. All execution is prospective; no old fills
are regenerated. Empty samples stay unranked. The hourly context includes
both books and asks for per-asset `ictView` analysis; exact 5M submission
references are now separate from 10M report prices. No extra schedule was made.
