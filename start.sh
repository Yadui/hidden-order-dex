#!/bin/bash
# AlphaShield — start all services in separate Terminal windows (macOS)
# Usage: ./start.sh
#        ./start.sh stop   — kill all background services

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"

# ── Stop mode ────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
  for port in 8005 5001 3001; do
    lsof -ti tcp:"$port" | xargs kill -9 2>/dev/null || true
  done
  echo "All services stopped."
  exit 0
fi

# ── Kill any stale processes on our ports ────────────────────────────────────
for port in 8005 5001 3001; do
  lsof -ti tcp:"$port" | xargs kill -9 2>/dev/null || true
done
sleep 1

# ── Close any existing AlphaShield Terminal windows ──────────────────────────
osascript <<'APPLESCRIPT' 2>/dev/null || true
tell application "Terminal"
  set winsToClose to {}
  repeat with w in (every window)
    repeat with t in (every tab of w)
      if (name of t) contains "AlphaShield" then
        set end of winsToClose to w
        exit repeat
      end if
    end repeat
  end repeat
  repeat with w in winsToClose
    close w
  end repeat
end tell
APPLESCRIPT

echo ""
echo "  AlphaShield — opening service windows"
echo "  ──────────────────────────────────────"

# ── Backend (FastAPI) ────────────────────────────────────────────────────────
echo "  [1/3] Backend      → http://localhost:8005"
osascript \
  -e 'tell application "Terminal"' \
  -e '  do script "echo -e \"\\033]0;AlphaShield — Backend\\007\" && cd '"$PROJECT_DIR/backend"' && source .venv/bin/activate && uvicorn main:app --reload --port 8005"' \
  -e '  activate' \
  -e 'end tell'

sleep 0.4

# ── Midnight service (Node.js) ───────────────────────────────────────────────
  echo "  [2/3] Midnight svc → http://localhost:5001"
osascript \
  -e 'tell application "Terminal"' \
  -e '  do script "echo -e \"\\033]0;AlphaShield — Midnight Service\\007\" && cd '"$PROJECT_DIR/midnight-service"' && node index.js"' \
  -e 'end tell'

sleep 0.4

# ── Frontend (Vite) ──────────────────────────────────────────────────────────
  echo "  [3/3] Frontend     → http://localhost:3001"
osascript \
  -e 'tell application "Terminal"' \
  -e '  do script "echo -e \"\\033]0;AlphaShield — Frontend\\007\" && cd '"$PROJECT_DIR/frontend"' && npm run dev"' \
  -e 'end tell'

# ── Health checks ────────────────────────────────────────────────────────────
echo ""
echo "  Waiting for services to be ready..."

check_service() {
  local name="$1" port="$2" path="$3" max_wait=20 interval=1 elapsed=0
  printf "  %-18s" "$name"
  while (( elapsed < max_wait )); do
    if curl -sf --max-time 1 "http://localhost:$port$path" > /dev/null 2>&1; then
      echo "✅  http://localhost:$port"
      return 0
    fi
    sleep "$interval"
    (( elapsed += interval ))
    printf "."
  done
  echo "  ⚠️  timed out after ${max_wait}s"
  return 1
}

check_service "Backend"       8005 "/health"
check_service "Midnight svc"  5001 "/health"
check_service "Frontend"      3001 "/"

echo ""
echo "  Stop: ./start.sh stop"
echo ""
