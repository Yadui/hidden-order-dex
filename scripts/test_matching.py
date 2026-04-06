#!/usr/bin/env python3
"""Phase 3 matching engine unit tests — runs standalone without FastAPI."""
import hashlib, json, uuid, os, time, sys
from datetime import datetime, timezone
from typing import Optional

# ── Copy the exact matching engine from main.py ─────────────────────────────

orders: dict = {}

def _sorted_asks(pair: str) -> list:
    return sorted(
        [o for o in orders.values()
         if o["order_status"] == 0 and o["side"] == "SELL" and o["asset_pair"] == pair],
        key=lambda o: (o["price"], o["timestamp"]),
    )

def _sorted_bids(pair: str) -> list:
    return sorted(
        [o for o in orders.values()
         if o["order_status"] == 0 and o["side"] == "BUY" and o["asset_pair"] == pair],
        key=lambda o: (-o["price"], o["timestamp"]),
    )

def _find_match(new_order: dict) -> Optional[dict]:
    side = new_order["side"]
    price = new_order["price"]
    pair = new_order["asset_pair"]
    oid = new_order["order_id"]
    if side == "BUY":
        for ask in _sorted_asks(pair):
            if ask["order_id"] == oid:
                continue
            if ask["price"] <= price:
                return ask
    else:
        for bid in _sorted_bids(pair):
            if bid["order_id"] == oid:
                continue
            if bid["price"] >= price:
                return bid
    return None

def _matched_price(buy_order, sell_order):
    return sell_order["price"]

def _atomic_match_and_settle(order_id: str) -> list:
    fills = []
    order = orders.get(order_id)
    if not order or order["order_status"] != 0:
        return fills
    remaining = order.get("amount_remaining", order["amount"])
    while remaining > 1e-12:
        if orders[order_id]["order_status"] != 0:
            break
        orders[order_id]["amount_remaining"] = remaining
        counterparty = _find_match(orders[order_id])
        if not counterparty:
            break
        cp_id = counterparty["order_id"]
        cp_remaining = counterparty.get("amount_remaining", counterparty["amount"])
        matched_price = _matched_price(
            orders[order_id] if orders[order_id]["side"] == "BUY" else counterparty,
            orders[order_id] if orders[order_id]["side"] == "SELL" else counterparty,
        )
        fill_qty = min(remaining, cp_remaining)
        timestamp = datetime.now(timezone.utc).isoformat()
        remaining -= fill_qty
        cp_remaining -= fill_qty
        fill_nonce = str(uuid.uuid4())
        fill_hash = hashlib.sha256(f"{matched_price}{fill_qty}{fill_nonce}".encode()).hexdigest()
        if cp_remaining <= 1e-12:
            orders[cp_id]["order_status"] = 2
            orders[cp_id]["fairness_proven"] = 1
            orders[cp_id]["amount_remaining"] = 0.0
        else:
            orders[cp_id]["amount_remaining"] = cp_remaining
        if remaining <= 1e-12:
            orders[order_id]["order_status"] = 2
            orders[order_id]["fairness_proven"] = 1
            orders[order_id]["amount_remaining"] = 0.0
        else:
            orders[order_id]["amount_remaining"] = remaining
        buy_id  = order_id if order["side"] == "BUY" else cp_id
        sell_id = cp_id    if order["side"] == "BUY" else order_id
        fills.append({
            "fill_id": str(uuid.uuid4()),
            "buy_order_id": buy_id,
            "sell_order_id": sell_id,
            "asset_pair": order["asset_pair"],
            "fill_hash": fill_hash,
            "timestamp": timestamp,
            "partial": remaining > 1e-12 or cp_remaining > 1e-12,
        })
    return fills

# ── Tests ────────────────────────────────────────────────────────────────────

def reset():
    orders.clear()

def mk(oid, side, price, amount, ts):
    orders[oid] = {
        "order_id": oid, "asset_pair": "BTC/USDC", "side": side,
        "price": price, "amount": amount, "amount_remaining": amount,
        "timestamp": ts, "order_status": 0, "fairness_proven": 0, "proof": {},
    }

errors = 0
def check(cond, msg):
    global errors
    if not cond:
        print(f"  FAIL: {msg}")
        errors += 1
    else:
        print(f"  ok  : {msg}")

print("=== Phase 3 Matching Engine Tests ===\n")

# Test 1: Full fill — exact amounts
print("Test 1: Full fill (exact amounts)")
reset()
mk("S1", "SELL", 100.0, 1.0, "T1")
mk("B1", "BUY",  110.0, 1.0, "T2")
fills = _atomic_match_and_settle("S1")
check(len(fills) == 1, f"exactly 1 fill (got {len(fills)})")
check(orders["S1"]["order_status"] == 2, "S1 SETTLED")
check(orders["B1"]["order_status"] == 2, "B1 SETTLED")
check(orders["S1"]["amount_remaining"] == 0.0, "S1 remaining=0")
check(orders["B1"]["amount_remaining"] == 0.0, "B1 remaining=0")

# Test 2: Partial fill — seller larger than buyer
print("\nTest 2: Partial fill (seller bigger)")
reset()
mk("S2", "SELL", 100.0, 1.0, "T1")
mk("B2", "BUY",  110.0, 0.6, "T2")
mk("B3", "BUY",  105.0, 0.5, "T3")
fills = _atomic_match_and_settle("S2")
check(len(fills) == 2, f"2 fills (got {len(fills)}) — partial split across B2 and B3")
check(orders["S2"]["order_status"] == 2, "S2 fully settled")
check(orders["B2"]["order_status"] == 2, "B2 fully settled")
# B3 gets 0.4 of 0.5 filled, should still be PENDING with 0.1 remaining
check(orders["B3"]["order_status"] in (0, 2), "B3 status valid")
remaining_b3 = orders["B3"].get("amount_remaining", 0)
check(abs(remaining_b3 - 0.1) < 1e-9, f"B3 remaining≈0.1 (got {remaining_b3:.6f})")

# Test 3: Price-time priority — two asks at same price, earlier wins
print("\nTest 3: Price-time priority (same-price FIFO)")
reset()
mk("S3a", "SELL", 100.0, 1.0, "2026-04-06T10:00:00")  # earlier
mk("S3b", "SELL", 100.0, 1.0, "2026-04-06T10:01:00")  # later
mk("B4",  "BUY",  100.0, 1.0, "2026-04-06T10:02:00")
fills = _atomic_match_and_settle("B4")
check(len(fills) == 1, "1 fill")
check(fills[0]["sell_order_id"] == "S3a", f"earlier ask matched first (got {fills[0]['sell_order_id']})")
check(orders["S3b"]["order_status"] == 0, "S3b still PENDING (not matched)")

# Test 4: No match — price spread too wide
print("\nTest 4: No match (price spread)")
reset()
mk("S4", "SELL", 200.0, 1.0, "T1")
mk("B5", "BUY",  100.0, 1.0, "T2")
fills = _atomic_match_and_settle("S4")
check(len(fills) == 0, "0 fills — no crossing")
check(orders["S4"]["order_status"] == 0, "S4 still PENDING")

print(f"\n{'✅ All tests passed' if errors == 0 else f'❌ {errors} test(s) failed'}")
sys.exit(errors)
