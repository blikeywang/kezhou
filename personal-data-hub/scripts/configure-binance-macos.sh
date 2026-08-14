#!/bin/zsh
set -euo pipefail

VENV="$HOME/.traderhome/data-hub-venv"
LABEL="com.traderhome.personal-data-hub"

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Install the Personal Data Hub first: ./personal-data-hub/scripts/install-macos.sh" >&2
  exit 1
fi

read "API_KEY?Binance read-only API key: "
read -s "API_SECRET?Binance secret key: "
echo

if [[ -z "$API_KEY" || -z "$API_SECRET" ]]; then
  echo "Both values are required." >&2
  exit 1
fi

/usr/bin/security add-generic-password -U -a "$USER" -s "com.traderhome.binance-api-key" -w "$API_KEY" -T "$VENV/bin/python"
/usr/bin/security add-generic-password -U -a "$USER" -s "com.traderhome.binance-api-secret" -w "$API_SECRET" -T "$VENV/bin/python"
unset API_KEY API_SECRET

launchctl kickstart -k "gui/$UID/$LABEL"
echo "Binance read-only account access configured. Trading and withdrawal permissions must remain disabled."
