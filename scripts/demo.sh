#!/usr/bin/env bash
# =============================================================================
# AlphaShield / HiddenOrderDEX — Hackathon Demo Script
# Run this while ./start.sh is up to walk through the full flow in a terminal.
# =============================================================================
set -euo pipefail

BACKEND="http://localhost:8006"
BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
MAGENTA="\033[35m"
RESET="\033[0m"
DIM="\033[2m"

sep() { echo -e "${DIM}────────────────────────────────────────────────────${RESET}"; }
header() { echo -e "\n${BOLD}${CYAN}▶ $1${RESET}"; sep; }
ok()  { echo -e "  ${GREEN}✓${RESET}  $1"; }
info(){ echo -e "  ${YELLOW}ℹ${RESET}  $1"; }

# ─── 0. Health Check ─────────────────────────────────────────────────────────
header "0. Health Check"

if ! curl -sf "$BACKEND/health" > /dev/null 2>&1 && \
   ! curl -sf "$BACKEND/docs"   > /dev/null 2>&1; then
  echo -e "  ${YELLOW}⚠  Backend not responding at $BACKEND${RESET}"
  echo -e "  Run ./start.sh first, then re-run this script."
  exit 1
fi
ok "Backend is up at $BACKEND"

# ─── 1. Generate AI Signal ───────────────────────────────────────────────────
header "1. AI Signal Generation (Azure OpenAI / gpt-5.2-chat)"
info "POST /api/ai/signal  {asset: BTC, price_usd: 95000}"

SIGNAL=$(curl -sf -X POST "$BACKEND/api/ai/signal" \
  -H 'Content-Type: application/json' \
  -d '{"asset":"BTC","price_usd":95000}')

SIGNAL_VAL=$(echo "$SIGNAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['signal'])")
CONFIDENCE=$(echo "$SIGNAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['confidence'])")
R_HASH=$(echo "$SIGNAL"     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['reasoning_hash'][:20])")
SOURCE=$(echo "$SIGNAL"     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['source'])")

ok "Signal   : $SIGNAL_VAL  (confidence $CONFIDENCE%)"
ok "Source   : $SOURCE"
ok "reasoning_hash (first 20 chars): ${R_HASH}...  <- the ONLY thing stored, reasoning text discarded"

# ─── 2. Submit Hidden BUY Order ──────────────────────────────────────────────
header "2. Submit Hidden BUY Order (price + amount never returned)"
info "POST /api/order/submit  side=BUY  price=95000  amount=0.5"

BUY=$(curl -sf -X POST "$BACKEND/api/order/submit" \
  -H 'Content-Type: application/json' \
  -d '{"asset_pair":"BTC/USDC","side":"BUY","price":95000,"amount":0.5}')

BUY_ID=$(echo "$BUY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['order_id'])")
BUY_HASH=$(echo "$BUY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['settlement_hash'][:20])")
ZK_MODE=$(echo "$BUY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('zk_mode','mock'))")

ok "Order ID   : $BUY_ID"
ok "settlement_hash (first 20): ${BUY_HASH}...  <- committed on-chain"
ok "ZK mode    : $ZK_MODE"
info "Note: zk_mode=mock here is expected — this script calls the backend directly."
info "      Real ZK proofs fire through the UI (midnight-service → proof_override → backend)."
info "      Run 'npm run test:zk' to verify real ZK proof generation independently."
info "Note: price=95000 and amount=0.5 are stored encrypted — NOT in response above"

# ─── 3. Submit Hidden SELL Order (should auto-match) ─────────────────────────
header "3. Submit Hidden SELL Order (price ≤ BUY price → auto-match)"
info "POST /api/order/submit  side=SELL  price=94900  amount=0.5"

SELL=$(curl -sf -X POST "$BACKEND/api/order/submit" \
  -H 'Content-Type: application/json' \
  -d '{"asset_pair":"BTC/USDC","side":"SELL","price":94900,"amount":0.5}')

SELL_ID=$(echo "$SELL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['order_id'])")
FILL_COUNT=$(echo "$SELL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('fill_count',0))")
SELL_STATUS=$(echo "$SELL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['order_status'])")

ok "Order ID   : $SELL_ID"
ok "Fills      : ${FILL_COUNT}  <- matched atomically against the BUY"
ok "Status     : $SELL_STATUS  (2 = SETTLED)"

# ─── 4. Order Book ───────────────────────────────────────────────────────────
header "4. Order Book (depth only — no prices leaked)"
info "GET /api/orderbook?asset_pair=BTC/USDC"

BOOK=$(curl -sf "$BACKEND/api/orderbook?asset_pair=BTC%2FUSDC")
echo -e "  ${MAGENTA}$BOOK${RESET}"
info "Only bid/ask counts are returned — zero price information exposed"

# ─── 5. Public Settlement Feed ───────────────────────────────────────────────
header "5. Public Settlement Feed (ZK fairness proofs)"
info "GET /api/trades/public"

TRADES=$(curl -sf "$BACKEND/api/trades/public")
COUNT=$(echo "$TRADES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
FIRST=$(echo "$TRADES" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d:
    t=d[0]
    print(f\"  asset_pair    : {t['asset_pair']}\")
    print(f\"  fairness_proven: {t['fairness_proven']}\")
    print(f\"  settlement_hash: {t['settlement_hash'][:28]}…\")
    print(f\"  reasoning_hash : {str(t.get('reasoning_hash','null'))[:28]}…\")
")

ok "$COUNT trade(s) in the public feed"
echo -e "$FIRST"
info "No prices, no sizes, no counterparty IDs — only cryptographic commitments"

# ─── 6. ZK Proof for the BUY Order ──────────────────────────────────────────
header "6. ZK Proof Record for BUY Order"
info "GET /api/proof/$BUY_ID"

PROOF=$(curl -sf "$BACKEND/api/proof/$BUY_ID")
PROOF_HASH=$(echo "$PROOF" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['proof_hash'][:28])")
FAIR=$(echo "$PROOF" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['fairness_proven'])")
MODE=$(echo "$PROOF"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('zk_mode','mock'))")

ok "proof_hash (first 28): ${PROOF_HASH}..."
ok "fairness_proven       : $FAIR"
ok "zk_mode               : $MODE"

# ─── 7. AI Signal Feed ───────────────────────────────────────────────────────
header "7. AI Signal Feed (commitments only)"
info "GET /api/ai/feed"

FEED=$(curl -sf "$BACKEND/api/ai/feed")
FEED_COUNT=$(echo "$FEED" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
ok "$FEED_COUNT signal commitment(s) in the feed"
info "Each entry contains reasoning_hash only — the AI's reasoning is never stored"

# ─── Rate Limit Demo ─────────────────────────────────────────────────────────
header "8. Rate Limiter (Azure OpenAI protection)"
info "Firing 6 rapid AI signal requests from the same client…"

blocked=0
for i in $(seq 1 6); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND/api/ai/signal" \
    -H 'Content-Type: application/json' \
    -d '{"asset":"ETH","price_usd":3200}')
  if [[ "$STATUS" == "429" ]]; then
    blocked=$((blocked+1))
    echo -e "  req $i: ${YELLOW}429 Rate Limited${RESET}"
  else
    echo -e "  req $i: ${GREEN}$STATUS OK${RESET}"
  fi
done
ok "$blocked request(s) blocked — Azure key protected"

# ─── Summary ─────────────────────────────────────────────────────────────────
sep
echo -e "\n${BOLD}${GREEN}✅  Full flow complete!${RESET}\n"
echo -e "  Open ${CYAN}http://localhost:3006${RESET} to see the React UI:"
echo -e "    • ${BOLD}Whale${RESET}      — AI signal generation + ZK dark pool trade"
echo -e "    • ${BOLD}Orderbook${RESET}  — Anonymous depth (no prices)"
echo -e "    • ${BOLD}Settlement${RESET} — Tamper-proof public proof feed"
echo -e "    • ${BOLD}Copy Trade${RESET} — Follower sees encrypted reasoning hash only"
echo -e "    • ${BOLD}Auditor${RESET}    — On-chain ZK verification + contract inspector"
echo ""
