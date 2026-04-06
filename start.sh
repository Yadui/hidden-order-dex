#!/bin/bash

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"

echo "Starting HiddenOrder DEX..."

# ── Kill port-holders + close their Terminal tabs ─────────────────────────────
PORTS=(3006 8006 3007 6301)
STALE_TTYS=()

for PORT in "${PORTS[@]}"; do
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null)
  if [[ -n "$PIDS" ]]; then
    echo "  [ports] Killing process(es) on :$PORT → PID $PIDS"
    # Collect controlling TTYs before killing so we can close the tabs
    for PID in $PIDS; do
      TTY=$(ps -p "$PID" -o tty= 2>/dev/null | tr -d ' ')
      [[ -n "$TTY" && "$TTY" != "??" ]] && STALE_TTYS+=("/dev/tty$TTY")
    done
    echo "$PIDS" | xargs kill -9 2>/dev/null
  fi
done

# Close the Terminal tabs that were hosting those killed processes
if [[ ${#STALE_TTYS[@]} -gt 0 ]] && pgrep -qx "Terminal" > /dev/null; then
  AS_LIST=$(printf '"%s",' "${STALE_TTYS[@]}" | sed 's/,$//')
  CLOSED=$(osascript 2>/dev/null <<ASCRIPT
tell application "Terminal"
  set ttyList to {$AS_LIST}
  set tabsToClose to {}
  repeat with w in every window
    repeat with t in every tab of w
      try
        if tty of t is in ttyList then
          set end of tabsToClose to t
        end if
      end try
    end repeat
  end repeat
  set n to count of tabsToClose
  repeat with t in tabsToClose
    try
      close t
    end try
  end repeat
  return n
end tell
ASCRIPT
)
  [[ -n "$CLOSED" && "$CLOSED" -gt 0 ]] && echo "  [cleanup] Closed ${CLOSED} stale Terminal tab(s)"
fi
echo ""

# ── Compile Compact contract if dist is missing or source is newer ─────────────
CONTRACT_SRC="$PROJECT_DIR/contract/src/order_proof.compact"
CONTRACT_DIST="$PROJECT_DIR/contract/dist/order_proof/contract/index.js"

if [[ ! -f "$CONTRACT_DIST" ]] || [[ "$CONTRACT_SRC" -nt "$CONTRACT_DIST" ]]; then
  echo "  [contract] Compiling order_proof.compact → contract/dist/..."
  mkdir -p "$PROJECT_DIR/contract/dist"
  compact compile "$CONTRACT_SRC" "$PROJECT_DIR/contract/dist/order_proof" 2>&1
  if [[ $? -ne 0 ]]; then
    echo "  [contract] ⚠️  Compile failed — midnight-service will fall back to mock ZK proofs"
  else
    echo "  [contract] ✅ Compiled successfully"
  fi
else
  echo "  [contract] ✅ contract/dist/ is up-to-date"
fi
echo ""

osascript <<EOF
tell application "Terminal"
    activate
    -- Window with first tab: FastAPI backend
    do script "cd \"$PROJECT_DIR/backend\" && source .venv/bin/activate && uvicorn main:app --reload --port 8006"
    set win to window 1

    -- Tab 2: Midnight Node.js service
    tell win to set t2 to (do script "cd \"$PROJECT_DIR/midnight-service\" && npm start")

    -- Tab 3: React frontend
    tell win to set t3 to (do script "cd \"$PROJECT_DIR/frontend\" && npm run dev")
end tell
EOF

echo "Done. Services launching in Terminal..."
echo ""

# ── Health checks (poll each service until up or timeout) ─────────────────────
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"
BOLD="\033[1m"

wait_for() {
  local name="$1"
  local url="$2"
  local timeout=30
  local interval=1
  local elapsed=0

  printf "  %-22s" "$name"
  while [[ $elapsed -lt $timeout ]]; do
    if curl -sf --max-time 2 "$url" > /dev/null 2>&1; then
      echo -e "${GREEN}✓ up${RESET}  (${elapsed}s)  ${CYAN}$url${RESET}"
      return 0
    fi
    printf "."
    sleep $interval
    elapsed=$((elapsed + interval))
  done
  echo -e "  ${RED}✗ did not respond after ${timeout}s${RESET}"
  return 1
}

echo -e "${BOLD}Waiting for services...${RESET}"
wait_for "Backend (FastAPI)"     "http://localhost:8006/docs"
wait_for "Midnight service"      "http://localhost:3007/health"
wait_for "Frontend (Vite)"       "http://localhost:3006"
echo ""

# ── Print midnight-service ZK mode from /health ────────────────────────────────
MS_HEALTH=$(curl -sf --max-time 3 "http://localhost:3007/health" 2>/dev/null)
if [[ -n "$MS_HEALTH" ]]; then
  ZK_MODE=$(echo "$MS_HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('zk_mode','unknown'))" 2>/dev/null)
  CONTRACT=$(echo "$MS_HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('contract_compiled', False))" 2>/dev/null)
  if [[ "$ZK_MODE" == "real" ]]; then
    echo -e "  ZK mode: ${GREEN}${BOLD}⚡ On-Chain ZK${RESET}  (contract_compiled=$CONTRACT)"
  else
    echo -e "  ZK mode: ${YELLOW}${BOLD}🔵 Mock ZK${RESET}  — run 'npm run compile:contract' then restart"
  fi
  echo ""
fi

echo "  Frontend:         http://localhost:3006"
echo "  Backend:          http://localhost:8006"
echo "  Midnight service: http://localhost:3007"
echo "  Dark pool order book: GET  http://localhost:8006/api/orderbook"
echo "  Submit order:         POST http://localhost:8006/api/order/submit"
echo "  Settlement feed:      GET  http://localhost:8006/api/trades/public"
