#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
exec "$ROOT/.venv/bin/python" "$ROOT/run.py"
