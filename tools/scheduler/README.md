# Scheduled data refresh (owner's Mac)

IncomeOS and TailTrend read private Longbridge data through the local `longbridge` CLI, so GitHub Actions cannot refresh them without storing broker credentials in GitHub. Until November 2026 both were refreshed by hand, which is why the public pages stopped at 2026-08-12.

This folder schedules the same refresh on the Mac with launchd:

| Job | Checks | Runs when | Commits |
|---|---|---|---|
| `tailtrend` | every hour at :40 | a US session has closed (16:20 ET) and `latest.json` is older than it | `portal/vendor/tailtrend/data` |
| `incomeos-research` | every hour at :50 | same, compared with `incomeos-full.json`; runs `refresh.mjs --no-archive` so no "临时更新操作单" is added | `portal/vendor/incomeos/data` |
| `incomeos-friday` | every hour at :15 | Friday 10:00–15:30 ET and this Friday's action sheet is not archived yet | `portal/vendor/incomeos/data` |

The runner works in a dedicated clone (`~/.traderhome/refresh-repo`), never in your working copy. It resets that clone to `origin/main`, checks the Longbridge session, runs the refresh plus `portal/test_*` and `portal.test_portal`, commits only the product's data folder and pushes to `main`. On a market holiday the refresh produces no new close; the runner discards the churn and tries again next hour. Times are evaluated on the New York clock, so the schedule survives a time-zone change of the Mac. A run missed while the Mac sleeps starts once on wake; a powered-off Mac misses it until the next hourly check.

## Install

```bash
zsh tools/scheduler/install-macos.sh --run-now   # install and refresh immediately
zsh tools/scheduler/install-macos.sh --uninstall
```

## When something fails

- A macOS notification names the job and the reason.
- `~/.traderhome/logs/refresh-status.json` keeps the last result per job; full output is in `~/.traderhome/logs/refresh-<job>.log`.
- "Longbridge 无法访问或登录已过期": run `longbridge login`; the next hourly check retries automatically.
- Manual run: `node ~/.traderhome/scheduler/refresh-runner.mjs tailtrend --force`.
