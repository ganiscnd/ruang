#!/usr/bin/env bash
# Shows whether the always-on Ruang service is running, its health check, and the last log lines.
set -uo pipefail

LABEL=com.ganiscnd.ruang
PORT=3001
LOG="$HOME/Library/Logs/ruang/ruang.log"

if info="$(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null)"; then
  echo "Service:  $(echo "$info" | awk -F' = ' '/^\tstate = /{print $2; exit}')"
  echo "PID:      $(echo "$info" | awk -F' = ' '/^\tpid = /{print $2; exit}')"
  echo "Runs:     $(echo "$info" | awk -F' = ' '/^\truns = /{print $2; exit}')"
  last="$(echo "$info" | awk -F' = ' '/last exit code = |last terminating signal = /{print $2; exit}')"
  echo "Last exit: ${last:-none recorded}"
else
  echo "Service:  not loaded (install it with scripts/install-service.sh)"
fi

if health="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health" 2>/dev/null)"; then
  echo "Health:   OK $health"
else
  echo "Health:   NOT ANSWERING on 127.0.0.1:$PORT"
fi

echo
echo "Last 20 log lines ($LOG):"
if [ -f "$LOG" ]; then tail -n 20 "$LOG"; else echo "(no log file yet)"; fi
