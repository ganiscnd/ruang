#!/usr/bin/env bash
# Installs (or reinstalls) the always-on Ruang LaunchAgent: copies the plist from the repo into
# ~/Library/LaunchAgents, creates the log folder, builds, and (re)loads the job.
set -euo pipefail

LABEL=com.ganiscnd.ruang
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$REPO/scripts/launchd/$LABEL.plist"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

plutil -lint "$SOURCE" >/dev/null
mkdir -p "$HOME/Library/Logs/ruang"
(cd "$REPO" && npm run build)

# Unload an older copy first so launchd picks up plist changes.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
cp "$SOURCE" "$TARGET"
launchctl bootstrap "$DOMAIN" "$TARGET"
launchctl enable "$DOMAIN/$LABEL"
echo "Installed $LABEL. Check it with: scripts/status.sh"
