# IncomeOS retrieval diagnostics (2026-11-10)

This change is additive metadata and bounded request handling, not an execution or publication-gate change. Existing error strings remain compatible. `dataQuality.issues` supplies deduplicated `{symbol,field,code,scopes}` items; `call.quote`, `put.quote`, `call.depth`, and `put.depth` remain distinct. `SOURCE_TIME_MISSING` does not mean the provider never supplies timestamps.

`retrievalStartedAt`, `retrievalFinishedAt`, and `retrievedAt` record the client retrieval window. Each research/execution/options phase records its own window and sanitized request endpoint, symbols, attempt count, outcome and error code. They must never replace market-source timestamps. Failed orchestration must not be advertised as a completed refresh: these fields in an intermediate file only describe phases that actually completed.

Previous research code used four concurrent workers, each launching four requests, up to 16 simultaneous fundamental calls with 1/2-second delays. The shared client now limits active calls to three per process and at most three attempts, with 2/4-second exponential delays plus up to 499ms jitter. Authentication denial, absent CLI and invalid JSON stop immediately. No raw CLI error, stdout or secret is serialized in diagnostics. The SPYM phase now uses the same bounded client. Retries are an operational mitigation, not evidence that intermittent failures were caused by rate limits; codes from the next authenticated run are needed to distinguish timeout/rate-limit/other failures.

## Source-time scope

Current checked historical research snapshot lacks asset quote and option depth source timestamps, while option quote timestamps exist. The parser reads only explicit `timestamp`, `time`, or `trade_time`; numeric epoch strings are now parsed as seconds/milliseconds like numeric epochs. It does not use retrieval time, report period or a SPY reference trading date as per-asset quote freshness. No live provider schema probe has yet been completed for this change. Therefore retain `unknown`/`SOURCE_TIME_MISSING`, not a blanket claim that Longbridge does not provide source timestamps.

## Validation and remaining operational check

39 isolated Node tests pass, including legacy quality gates and manual research/default-deny execution checks. All IncomeOS modules parse with `node --check`. No live credentials, network collection or publication was exercised by the offline tests.

Authenticated verification, in an isolated current checkout only:

1. `node tools/incomeos/refresh.mjs --no-archive`
2. Inspect per-phase diagnostics, 71 assets, option coverage and source-time gaps. Preserve any failed component instead of converting it into complete data.
3. Only after a human/dot review: `node tools/incomeos/prepare-research.mjs --manual-research`.
4. Confirm `research_partial`, `executionAllowed=false`, no operation-history changes; retain source-time gaps. Publish only approved derived data with separate deployment and online read-back verification.

No scheduler, TailTrend, simulation logic, public snapshot, operation history or production service is changed by this patch.
