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
