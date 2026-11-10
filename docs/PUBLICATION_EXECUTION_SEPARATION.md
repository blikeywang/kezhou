# Publishing without executing paper plans

Ordinary main pushes and daily-refresh completion now only build and publish existing snapshots. They do not call the paper execution endpoint.
The existing schedule and legacy publication-clock dispatch remain responsible for simulated execution and protection, unchanged. No cron was added or modified.
Manual workflow_dispatch can set publish_only=true for read-only publication; false/omitted preserves legacy clock compatibility. Do not use the default to request publication-only.

The policy is tested in test_publication_policy.py. Unknown events/invalid modes fail closed.
The read-only export remains enabled after a skipped cycle, and records executionOutcome=skipped, not success. Publication time is not a market snapshot or fill time.
No stop/risk/position/engine logic, historical trades, credentials, account permissions or real broker integration is changed.

Daily reports publish only the existing allowlisted JSON exporter output. Never copy the private source project, raw morning HTML, account snapshots or paid material.
Before publication: fetch current main; export to an independent candidate; scan; compare all existing days; run exporter, simulation and portal tests; inspect path-limited diff.
After publication: verify commit, workflow/deployment status, public index latest/sourceStamp and original-history continuity. A push is not proof of deployment.
