#!/bin/bash
set -Eeuo pipefail

APP_DIR="/home/wtullos/.openclaw/workspace/briefings-app"
URL="http://localhost:8888"
LOG_FILE="/tmp/briefings-watchdog.log"
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
export PATH

mkdir -p "$(dirname "$LOG_FILE")"
exec >> "$LOG_FILE" 2>&1

echo "=== Watchdog $(date '+%Y-%m-%d %H:%M:%S %Z') ==="

http_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$URL" || true)
if [ "$http_code" = "200" ]; then
  echo "OK: server responded 200"
  exit 0
fi

echo "WARN: server unhealthy (HTTP $http_code), restarting"
pkill -f "node .*briefings-app/server.js" || true
pkill -f "node server.js" || true
cd "$APP_DIR"
nohup /usr/bin/env node server.js >> /tmp/briefings-app.log 2>&1 &
echo "Restarted server with PID $!"
