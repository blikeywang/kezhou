#!/bin/bash
# Install the TraderHome scheduled data refresh on this Mac.
#
#   bash tools/scheduler/install-macos.sh            # install / update the schedule
#   bash tools/scheduler/install-macos.sh --run-now  # …and refresh TailTrend + IncomeOS immediately
#   bash tools/scheduler/install-macos.sh --uninstall
#
# Requirements: node 22+, python3, git with push access to the repo, and the
# Longbridge CLI logged in (`longbridge login`). Credentials stay on this Mac.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
REPO_SRC="$(cd "$SRC/../.." && pwd)"
BASE="${TRADERHOME_BASE:-$HOME/.traderhome}"
CLONE="$BASE/refresh-repo"
BIN="$BASE/scheduler"
LOGS="$BASE/logs"
AGENTS="${TRADERHOME_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
JOBS="tailtrend:40 incomeos-research:50 incomeos-friday:15"

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
[ -n "$LONGBRIDGE" ] || fail "找不到 longbridge CLI。安装并运行 longbridge login 后再执行本脚本"

if ! "$LONGBRIDGE" quote SPY.US --format json >/dev/null 2>&1; then
  fail "Longbridge 无法取数，可能未登录或登录已过期：先运行 longbridge login"
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
PATH_VALUE="$(dirname "$NODE"):$(dirname "$LONGBRIDGE"):$(dirname "$GIT"):$(dirname "$PY3"):/usr/bin:/bin:/usr/sbin:/sbin"

for entry in $JOBS; do
  job="${entry%%:*}"; minute="${entry##*:}"
  plist="$AGENTS/com.traderhome.refresh.$job.plist"
  sed -e "s|__JOB__|$job|g" -e "s|__NODE__|$NODE|g" -e "s|__RUNNER__|$BIN/refresh-runner.mjs|g" \
      -e "s|__PATH__|$PATH_VALUE|g" -e "s|__HOME__|$HOME|g" -e "s|__CLONE__|$CLONE|g" -e "s|__MINUTE__|$minute|g" \
      "$SRC/com.traderhome.refresh.plist.template" > "$plist"
  launchctl bootout "gui/$UID/com.traderhome.refresh.$job" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$plist"
done
say "已安装：TailTrend 每小时 :40、IncomeOS 研究 :50、周五操作单 :15 检查一次（不到时间会自动跳过）"

if [ "${1:-}" = "--run-now" ]; then
  say "立即刷新 TailTrend…"
  "$NODE" "$BIN/refresh-runner.mjs" tailtrend --force || say "TailTrend 这次没有成功，原因见上一行；定时任务会在下一个整点重试"
  say "立即刷新 IncomeOS 研究快照…"
  "$NODE" "$BIN/refresh-runner.mjs" incomeos-research --force || say "IncomeOS 这次没有成功，原因见上一行；定时任务会在下一个整点重试"
fi

say "运行状态：$LOGS/refresh-status.json，日志：$LOGS/refresh-*.log"
