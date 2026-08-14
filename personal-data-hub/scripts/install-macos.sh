#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
APP="$HOME/.traderhome/data-hub-app"
VENV="$HOME/.traderhome/data-hub-venv"
PLIST="$HOME/Library/LaunchAgents/com.traderhome.personal-data-hub.plist"
IBKR_PLIST="$HOME/Library/LaunchAgents/com.traderhome.ibkr-client-portal.plist"
IBKR_GATEWAY="$HOME/.traderhome/ibkr-client-portal"
IBKR_ARCHIVE="$HOME/.traderhome/clientportal.gw.zip"
LOG_DIR="$HOME/.traderhome/logs"

mkdir -p "$HOME/.traderhome" "$LOG_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$HOME/.traderhome"
mkdir -p "$APP"
/usr/bin/ditto "$ROOT/traderhome_hub" "$APP/traderhome_hub"
/usr/bin/ditto "$ROOT/run.py" "$APP/run.py"
/usr/bin/ditto "$ROOT/requirements.txt" "$APP/requirements.txt"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --disable-pip-version-check -r "$APP/requirements.txt"

if [[ ! -x "$IBKR_GATEWAY/bin/run.sh" ]]; then
  echo "Installing the official IBKR Client Portal Gateway..."
  /usr/bin/curl -L --fail --silent --show-error \
    https://download2.interactivebrokers.com/portal/clientportal.gw.zip \
    -o "$IBKR_ARCHIVE"
  TEMP_GATEWAY="$(mktemp -d)"
  trap 'rm -rf "$TEMP_GATEWAY"' EXIT
  /usr/bin/unzip -q "$IBKR_ARCHIVE" -d "$TEMP_GATEWAY"
  mkdir -p "$IBKR_GATEWAY"
  /usr/bin/ditto "$TEMP_GATEWAY" "$IBKR_GATEWAY"
  chmod 700 "$IBKR_GATEWAY/bin/run.sh"
fi

# macOS Control Center commonly occupies 5000, so TraderHome uses 5001.
sed -E -i '' 's/^([[:space:]]*listenPort:).*/\1 5001/' "$IBKR_GATEWAY/root/conf.yaml"
# This browser hop never leaves the Mac. HTTP avoids the bundled self-signed
# certificate warning; the Gateway-to-IBKR connection remains HTTPS.
sed -E -i '' 's/^([[:space:]]*listenSsl:).*/\1 false/' "$IBKR_GATEWAY/root/conf.yaml"
sed -E -i '' '/192\.\*/d' "$IBKR_GATEWAY/root/conf.yaml"
sed -E -i '' '/131\.216\.\*/d' "$IBKR_GATEWAY/root/conf.yaml"

sed \
  -e "s|__PYTHON__|$VENV/bin/python|g" \
  -e "s|__ROOT__|$APP|g" \
  -e "s|__HOME__|$HOME|g" \
  "$ROOT/launchd/com.traderhome.personal-data-hub.plist.template" > "$PLIST"

sed \
  -e "s|__GATEWAY__|$IBKR_GATEWAY|g" \
  -e "s|__HOME__|$HOME|g" \
  "$ROOT/launchd/com.traderhome.ibkr-client-portal.plist.template" > "$IBKR_PLIST"

if launchctl print "gui/$UID/com.traderhome.ibkr-client-portal" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID/com.traderhome.ibkr-client-portal"
  sleep 1
fi
if ! launchctl bootstrap "gui/$UID" "$IBKR_PLIST"; then
  sleep 2
  launchctl bootstrap "gui/$UID" "$IBKR_PLIST"
fi
launchctl kickstart -k "gui/$UID/com.traderhome.ibkr-client-portal"

if launchctl print "gui/$UID/com.traderhome.personal-data-hub" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID/com.traderhome.personal-data-hub"
  sleep 1
fi
if ! launchctl bootstrap "gui/$UID" "$PLIST"; then
  sleep 2
  launchctl bootstrap "gui/$UID" "$PLIST"
fi
launchctl kickstart -k "gui/$UID/com.traderhome.personal-data-hub"

echo "TraderHome Personal Data Hub installed at http://127.0.0.1:8765"
echo "IBKR Web API login is available at http://127.0.0.1:5001"
