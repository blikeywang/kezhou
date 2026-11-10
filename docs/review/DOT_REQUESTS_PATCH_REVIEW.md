# Review-only patch: TailTrend entry qualification and duplicate publication

Base: blikeywang/kezhou main d47320345c94abd989647eb04f400bbbd7f96e16.
Prepared in a separate full checkout; no production push, deployment, data fetch,
cron installation, broker connection, or historical snapshot modification.

## TailTrend 0.3.1

Confirmed AMZN 2026-11-09 frozen reclaim with close 266.93 above frozen first
management zone 265.75 and rolling upper tail 264.457, yet newPositionAllowed=true.
New entry eligibility is independent of structural confirmation. It requires
close strictly below min(frozen first zone, rolling midpoint, rolling upper tail).
This is a conservative tightening: it can reject otherwise structurally valid
reclaims after their nearby reward zone has already been reached. Existing holding
management/stop/targets and state-memory transitions remain unchanged. Labels/action,
blockers and nextCondition now distinguish holding management from new entry.
Version/engine-hash epoch separation applies prospectively. Never overwrite the
2026-11-09 immutable snapshot or retrospectively claim improved results.

## Publication trigger

Remove the broad portal/**, README and documentation triggers from daily-refresh;
UI/derived outputs already invoke pages directly. Keep engine/source/test paths and
actual OTC input snapshot.json so refresh dependencies and core push tests remain.
This intentionally does NOT eliminate duplicate publication for every source commit
or an OTC universe update. It removes the high-frequency UI/data case without
adding a workflow/cron or altering paper execution/protection. All existing daily
cron expressions, pages.yml and publication-clock code remain byte-identical.

Independent review caught push-CI loss in an earlier too-narrow candidate; the final
candidate retains explicit engine/test/personal-data-hub paths. Such allowlists need
maintenance when modules/dependencies move. UI-only changes no longer invoke the
full daily suite; existing pages checks still run. No claim of zero publication
latency: GitHub queuing/deployment retries and clock skip-on-busy still exist.

## Verification

Final full-checkout validation on 2026-11-10, against base d473203:

- Node engines, snapshot/publication quality, scheduler and daily exporter: 172 passed.
- Python daily pipeline: 68 passed.
- Python Personal Data Hub: 17 passed.
- Python portal: 11 passed; market simulation: 38 passed; OTC: 4 passed.
- git diff --check: passed.
- Six new TailTrend tests include boundary equality, frozen/rolling target order,
  insufficient stability, risk-plan rejection, and a synthetic regression using
  the published AMZN numbers. These are test fixtures, not a live data refresh.
- Independent review caught loss of source-triggered CI in an early candidate;
  final paths retain engine/test/personal-data-hub coverage. UI-only pushes retain
  existing pages checks, not the complete daily suite.
- The isolated Python environment installs both checked-in requirements files.
  Initial system-environment failures (missing exchange-calendars and an older
  Starlette CORS behavior) disappear with these declared dependencies. pandas
  future-deprecation warnings remain; no production dependency change was made.
- Pipeline tests regenerate docs/HISTORY_COVERAGE_AUDIT.md; that generated-only
  change was restored to the exact base version and excluded from this patch.
- Actual GitHub event triggering, deployment, public webpage and live data refresh
  were NOT run. Passing local tests does not certify production scheduling.

Before merge: review concurrent Claude changes and obtain approval for production
integration. After an approved release, validate future new-version results
separately from unchanged historical snapshots. This patch must not rewrite the
immutable November 9 snapshot to present a corrected historical signal.

## Explicit same-session research revision follow-up

The authorized same-date update uses `--research-revision`, not a replacement
of the original daily snapshot. It preserves snapshots/index/audit/run-history,
adds an exclusive-create revision file, and updates only current display aliases.
Original-byte SHA256, original run time and actual new run time are retained in
provenance; the UI identifies retrospective research rather than original signals.
No reconstructed transitions are added to historical signals or performance.
A same-day normal refresh fails closed instead of silently reverting the display;
a new completed session follows the original workflow. No schedule changes.

Validation: all 180 Node tests and 11 portal Python tests pass. The final readback
check addition was retested with all 29 publication-quality/revision tests passing.
Syntax checks pass for refresh, revision store and UI; diff whitespace check passes.
No raw data/credentials or production data files are included. Real acquisition,
production integration, deployment and browser readback remain the coordinator's
separate authorized steps. A revision and two display aliases are individually
atomic files, not a cross-file transaction; failures require readback before recovery.
