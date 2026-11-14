# Scheduled data refresh (owner's Mac)

IncomeOS and TailTrend read private Longbridge data through the local `longbridge` CLI, and the 早晚报 come from the owner's local workflow folder, so GitHub Actions cannot refresh them without storing broker credentials or private files in GitHub. Until November 2026 all of them were synced by hand, which is why the public pages stopped in August/September.

This folder schedules the same refresh on the Mac with launchd:

| Job | Checks | Runs when | Commits |
|---|---|---|---|
| `tailtrend` | every hour at :40 | a US session has closed (16:20 ET) and `latest.json` is older than it | `portal/vendor/tailtrend/data` |
| `incomeos-research` | every hour at :50 | same, compared with `incomeos-full.json`; runs `refresh.mjs --no-archive` so no "临时更新操作单" is added | `portal/vendor/incomeos/data` |
| `incomeos-friday` | every hour at :15 | Friday 10:00–15:30 ET and this Friday's action sheet is not archived yet | `portal/vendor/incomeos/data` |
| `daily-trade` | every hour at :25 | the report folder's fingerprint differs from `index.json` `sourceStamp` (new morning/evening report or refreshed data) | `portal/vendor/daily-trade/data` |

`daily-trade` runs `tools/daily-trade/export-public.mjs`: it parses only allowlisted sections of the morning/evening Markdown and a few public JSON files, drops every sentence about the account, OKX, Desk, margin or leverage, and refuses to write anything if a local path or key-like field slips through. It does not need Longbridge. The source folder defaults to `~/Documents/猴认知分析`; set `TRADERHOME_DAILY_SOURCE` before installing to change it.

The runner works in a dedicated clone (`~/.traderhome/refresh-repo`), never in your working copy. It resets that clone to `origin/main`, checks the Longbridge session, runs the refresh plus `portal/test_*` and `portal.test_portal`, commits only the product's data folder and pushes to `main`. NYSE holidays and 1:00 p.m. early closes for 2026–2027 are built in (extend `NYSE_HOLIDAYS` before 2028), so a holiday is never "due". On a trading day with no new close the runner discards the churn and retries hourly; three hours after the close it reports a failure and notifies you instead of calling it a holiday. Times are evaluated on the New York clock, so the schedule survives a time-zone change of the Mac. A run missed while the Mac sleeps starts once on wake; a powered-off Mac misses it until the next hourly check.

## Install

```bash
bash tools/scheduler/install-macos.sh --run-now   # install and refresh immediately
bash tools/scheduler/install-macos.sh --uninstall
```

## When something fails

- A macOS notification names the job and the reason.
- `~/.traderhome/logs/refresh-status.json` keeps the last result per job; full output is in `~/.traderhome/logs/refresh-<job>.log`.
- "Longbridge 无法访问或登录已过期": run `longbridge login`; the next hourly check retries automatically.
- "macOS 不允许后台的 node 读取 …": System Settings → Privacy & Security → Full Disk Access, add the node binary named in the message. launchd jobs do not inherit Terminal's permission to read Documents.
- "… 文件只在 iCloud 上": in Finder, right-click the workflow folder → Keep Downloaded.
- The 早晚报 page only updates when the reports themselves are new. If the workflow's own automations are paused or fail, the page shows how old the latest issue is.
- Manual run: `node ~/.traderhome/scheduler/refresh-runner.mjs tailtrend --force`.

### Install only selected products

`TRADERHOME_REFRESH_JOBS=tailtrend,incomeos-research bash tools/scheduler/install-macos.sh` installs only those jobs; omitted jobs and simulation schedules remain untouched. Duplicate names are deduplicated and unknown names fail before installation. `--run-now` respects normal release windows and records manual (not scheduled) commits.
