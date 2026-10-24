#!/usr/bin/env bash
# Rebuilds Ruang from the current checkout (no git pull) and restarts the always-on instance.
set -euo pipefail

LABEL=com.ganiscnd.ruang
PORT=3001
REPO="$(cd "$(dirname "$0")/.." && pwd)"

cd "$REPO"
npm run build
launchctl kickstart -k "gui/$(id -u)/$LABEL"

# Wait up to 20 s for the restarted server to answer.
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "Deployed: $(curl -fsS "http://127.0.0.1:$PORT/api/health")"
    exit 0
  fi
  sleep 1
done
echo "Ruang did not answer on port $PORT after the restart. Run scripts/status.sh to see the log." >&2
exit 1
