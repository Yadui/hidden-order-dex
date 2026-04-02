#!/bin/bash
# AlphaShield — start all services
# Works in any terminal (macOS / Linux). No Warp required.
# Usage: ./start.sh
#        ./start.sh stop   — kill all background services

set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
LOG_DIR="$PROJECT_DIR/.logs"
mkdir -p "$LOG_DIR"

BACKEND_PID_FILE="$LOG_DIR/backend.pid"
MIDNIGHT_PID_FILE="$LOG_DIR/midnight.pid"
FRONTEND_PID_FILE="$LOG_DIR/frontend.pid"

# ── Stop mode ────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
  for pidfile in "$BACKEND_PID_FILE" "$MIDNIGHT_PID_FILE" "$FRONTEND_PID_FILE"; do
    if [[ -f "$pidfile" ]]; then
      pid=$(cat "$pidfile")
      kill "$pid" 2>/dev/null && echo "Stopped PID $pid" || true
      rm -f "$pidfile"
    fi
  done
  echo "All services stopped."
  exit 0
fi

# ── Kill any stale processes on our ports ────────────────────────────────────
for port in 8005 3006 3005; do
  lsof -ti tcp:"$port" | xargs kill -9 2>/dev/null || true
done
sleep 1

echo ""
echo "  AlphaShield — starting services"
echo "  ─────────────────────────────────"

# ── Backend (FastAPI) ────────────────────────────────────────────────────────
echo "  [1/3] Backend      → http://localhost:8005"
(
  cd "$PROJECT_DIR/backend"
  source .venv/bin/activate
  uvicorn main:app --port 8005 > "$LOG_DIR/backend.log" 2>&1
) &
echo $! > "$BACKEND_PID_FILE"

# ── Midnight service (Node.js) ───────────────────────────────────────────────
echo "  [2/3] Midnight svc → http://localhost:3006"
(
  cd "$PROJECT_DIR/midnight-service"
  npm start > "$LOG_DIR/midnight.log" 2>&1
) &
echo $! > "$MIDNIGHT_PID_FILE"

# ── Frontend (Vite) ──────────────────────────────────────────────────────────
echo "  [3/3] Frontend     → http://localhost:3005"
(
  cd "$PROJECT_DIR/frontend"
  npm run dev > "$LOG_DIR/frontend.log" 2>&1
) &
echo $! > "$FRONTEND_PID_FILE"

# ── Wait for services ────────────────────────────────────────────────────────
echo ""
echo "  Waiting for services to be ready..."
sleep 4

all_ok=true
for port_name in "8005:Backend" "3006:Midnight" "3005:Frontend"; do
  port="${port_name%%:*}"
  name="${port_name##*:}"
  if curl -s --max-time 2 "http://localhost:$port/health" > /dev/null 2>&1 || \
     curl -s --max-time 2 "http://localhost:$port" > /dev/null 2>&1; then
    echo "  ✅ $name ready"
  else
    echo "  ⚠️  $name not yet responding (may still be starting)"
    all_ok=false
  fi
done

echo ""
echo "  Logs: $LOG_DIR/"
echo "  Stop: ./start.sh stop"
echo ""
if $all_ok; then
  echo "  ✅ All services running — open http://localhost:3005"
else
  echo "  ⚠️  Some services still starting — check .logs/ if issues persist"
fi
echo ""
