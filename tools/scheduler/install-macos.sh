#!/bin/bash
# Install the TraderHome scheduled data refresh on this Mac.
#
#   bash tools/scheduler/install-macos.sh            # install / update the schedule
#   bash tools/scheduler/install-macos.sh --run-now  # …and refresh TailTrend, IncomeOS and 早晚报 immediately
#   bash tools/scheduler/install-macos.sh --uninstall
#
# Requirements: node 22+, python3, git with push access to the repo, and the
# Longbridge CLI logged in (`longbridge login`). Credentials stay on this Mac.
# 早晚报 reads the local workflow folder (default ~/Documents/猴认知分析;
# override with TRADERHOME_DAILY_SOURCE=/path bash install-macos.sh).
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
REPO_SRC="$(cd "$SRC/../.." && pwd)"
BASE="${TRADERHOME_BASE:-$HOME/.traderhome}"
CLONE="$BASE/refresh-repo"
BIN="$BASE/scheduler"
LOGS="$BASE/logs"
AGENTS="${TRADERHOME_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
JOBS="tailtrend:40 incomeos-research:50 incomeos-friday:15 daily-trade:25"
DAILY_SOURCE="${TRADERHOME_DAILY_SOURCE:-$HOME/Documents/猴认知分析}"
# Explicit subset keeps unrelated production schedules untouched.
SELECTED_JOBS="${TRADERHOME_REFRESH_JOBS:-tailtrend,incomeos-research,incomeos-friday,daily-trade}"
FILTERED_JOBS=""
for selected in ${SELECTED_JOBS//,/ }; do
  case "$selected" in
    tailtrend) entry="tailtrend:40";;
    incomeos-research) entry="incomeos-research:50";;
    incomeos-friday) entry="incomeos-friday:15";;
    daily-trade) entry="daily-trade:25";;
    *) echo "Unknown refresh job: $selected" >&2; exit 64;;
  esac
  case " $FILTERED_JOBS " in *" $entry "*) ;; *) FILTERED_JOBS="$FILTERED_JOBS $entry";; esac
done
[ -n "$FILTERED_JOBS" ] || { echo "No refresh jobs selected" >&2; exit 64; }
JOBS="$FILTERED_JOBS"

say() { printf '\033[36m›\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  for entry in $JOBS; do
    job="${entry%%:*}"
    launchctl bootout "gui/$UID/com.traderhome.refresh.$job" 2>/dev/null || true
    rm -f "$AGENTS/com.traderhome.refresh.$job.plist"
  done
  say "已移除定时任务（保留 $CLONE 与日志）"
  exit 0
fi

NODE="$(command -v node || true)"
LONGBRIDGE="$(command -v longbridge || true)"
GIT="$(command -v git || true)"
PY3="$(command -v python3 || true)"
[ -n "$NODE" ] || fail "找不到 node（需要 22 以上）"
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail "node 版本需要 22 以上：$("$NODE" -v)"
[ -n "$GIT" ] && [ -n "$PY3" ] || fail "需要 git 和 python3"
if [ -z "$LONGBRIDGE" ]; then
  say "注意：找不到 longbridge CLI。TailTrend / IncomeOS 会失败并发通知，早晚报不受影响"
elif ! "$LONGBRIDGE" quote SPY.US --format json >/dev/null 2>&1; then
  say "注意：Longbridge 现在取不到数（可能需要 longbridge login）。登录后定时任务会自动恢复"
fi
if [ -d "$DAILY_SOURCE/reports/morning" ]; then
  say "早晚报来源：$DAILY_SOURCE"
  say "  如果它在 iCloud 里：访达右键该文件夹 → 保持下载；第一次后台读取时 macOS 可能要求允许 node 访问“文稿”"
else
  say "注意：找不到早晚报文件夹 $DAILY_SOURCE/reports/morning（可用 TRADERHOME_DAILY_SOURCE 指定），早晚报任务会失败并通知"
fi

mkdir -p "$BASE" "$BIN" "$LOGS" "$AGENTS"
chmod 700 "$BASE"

ORIGIN="$("$GIT" -C "$REPO_SRC" remote get-url origin)"
if [ ! -d "$CLONE/.git" ]; then
  say "创建专用副本 $CLONE（不会动你平时用的仓库）"
  "$GIT" clone --quiet --depth 30 --branch main "$ORIGIN" "$CLONE"
  touch "$CLONE/.git/traderhome-refresh-clone"
fi
"$GIT" -C "$CLONE" remote set-url origin "$ORIGIN"
NAME="$("$GIT" -C "$REPO_SRC" config user.name || echo TraderHome)"
EMAIL="$("$GIT" -C "$REPO_SRC" config user.email || echo traderhome@users.noreply.github.com)"
"$GIT" -C "$CLONE" config user.name "$NAME"
"$GIT" -C "$CLONE" config user.email "$EMAIL"

say "检查推送权限（第一次可能需要输入 GitHub 凭据，钥匙串会记住）"
"$GIT" -C "$CLONE" fetch --quiet --depth 30 origin main
"$GIT" -C "$CLONE" push --dry-run --quiet origin origin/main:refs/heads/main || fail "这台 Mac 上的 git 无法推送到 $ORIGIN"

cp "$SRC/refresh-runner.mjs" "$BIN/refresh-runner.mjs"
PATH_VALUE="$(dirname "$NODE"):${LONGBRIDGE:+$(dirname "$LONGBRIDGE"):}$(dirname "$GIT"):$(dirname "$PY3"):/usr/bin:/bin:/usr/sbin:/sbin"

for entry in $JOBS; do
  job="${entry%%:*}"; minute="${entry##*:}"
  plist="$AGENTS/com.traderhome.refresh.$job.plist"
  sed -e "s|__JOB__|$job|g" -e "s|__NODE__|$NODE|g" -e "s|__RUNNER__|$BIN/refresh-runner.mjs|g" \
      -e "s|__PATH__|$PATH_VALUE|g" -e "s|__HOME__|$HOME|g" -e "s|__CLONE__|$CLONE|g" -e "s|__MINUTE__|$minute|g" \
      -e "s|__DAILY_SOURCE__|$DAILY_SOURCE|g" \
      "$SRC/com.traderhome.refresh.plist.template" > "$plist"
  launchctl bootout "gui/$UID/com.traderhome.refresh.$job" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$plist"
done
say "已安装所选任务（名称:每小时分钟）：$JOBS；未选择的任务保持不变"

if [ "${1:-}" = "--run-now" ]; then
  for entry in $JOBS; do
    job="${entry%%:*}"
    say "立即检查 $job（遵守原发布窗口）…"
    "$NODE" "$BIN/refresh-runner.mjs" "$job" || say "$job 这次没有成功，原因见日志；后续定时会重试"
  done
fi

say "运行状态：$LOGS/refresh-status.json，日志：$LOGS/refresh-*.log"
