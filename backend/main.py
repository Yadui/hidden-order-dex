import hashlib
import json
import os
import asyncio
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Literal

from cryptography.fernet import Fernet
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).parent / ".env")

app = FastAPI(title="Hidden Order Dark Pool DEX API")

# Explicit CORS allowlist — never use wildcard in production
_ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3006,http://127.0.0.1:3006,http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# ---------------------------------------------------------------------------
# In-process rate limiters
# ---------------------------------------------------------------------------
_RATE_LIMIT_WINDOW = 60        # seconds
_RATE_LIMIT_MAX    = 20        # requests per IP per window  (/api/order/submit)
_rate_buckets: dict = {}       # ip -> list[float] of timestamps

# Azure OpenAI key protection
_AI_RL_WINDOW      = 60        # seconds
_AI_RL_PER_IP      = 5         # max AI signal requests per IP per window
_AI_RL_GLOBAL      = 20        # max AI signal requests across ALL IPs per window
_ai_ip_buckets: dict = {}      # ip -> list[float]
_ai_global_hits: list = []     # list[float] — global timestamps


def _check_rate_limit(ip: str) -> bool:
    """Return True if the request is allowed, False if rate-limit exceeded."""
    now = time.monotonic()
    window_start = now - _RATE_LIMIT_WINDOW
    hits = [t for t in _rate_buckets.get(ip, []) if t > window_start]
    if len(hits) >= _RATE_LIMIT_MAX:
        return False
    hits.append(now)
    _rate_buckets[ip] = hits
    return True


def _check_ai_rate_limit(ip: str) -> tuple[bool, str]:
    """
    Two-tier rate limit for Azure OpenAI calls.
    Returns (allowed: bool, reason: str).
    Per-IP:  5 req / 60 s  — prevents a single client from draining the quota.
    Global: 20 req / 60 s  — caps total Azure OpenAI spend across all users.
    """
    global _ai_global_hits
    now = time.monotonic()
    window_start = now - _AI_RL_WINDOW

    # Per-IP check
    ip_hits = [t for t in _ai_ip_buckets.get(ip, []) if t > window_start]
    if len(ip_hits) >= _AI_RL_PER_IP:
        return False, f"AI signal rate limit: max {_AI_RL_PER_IP} requests per minute per client"

    # Global check (across all IPs)
    global_hits = [t for t in _ai_global_hits if t > window_start]
    if len(global_hits) >= _AI_RL_GLOBAL:
        return False, f"AI signal rate limit: service at capacity, try again shortly"

    # Admit the request
    ip_hits.append(now)
    _ai_ip_buckets[ip] = ip_hits
    global_hits.append(now)
    _ai_global_hits = global_hits
    return True, ""

# ---------------------------------------------------------------------------
# Encrypted SQLite storage (Phase 4)
# Sensitive fields (price, amount, amount_remaining, nonce) are encrypted
# with Fernet (AES-128-CBC + HMAC-SHA-256) before being written to disk.
# ---------------------------------------------------------------------------
DB_FILE   = Path(__file__).parent / "orders.db"
_ENV_FILE = Path(__file__).parent / ".env"


def _get_or_create_fernet() -> Fernet:
    """Load or auto-generate the Fernet encryption key for order fields."""
    key = os.getenv("ORDERS_ENCRYPTION_KEY", "")
    if key:
        return Fernet(key.encode())
    # No key found — generate one and persist to .env for subsequent restarts
    new_key = Fernet.generate_key().decode()
    existing = _ENV_FILE.read_text() if _ENV_FILE.exists() else ""
    lines = [ln for ln in existing.splitlines() if not ln.startswith("ORDERS_ENCRYPTION_KEY=")]
    lines.append(f"ORDERS_ENCRYPTION_KEY={new_key}")
    _ENV_FILE.write_text("\n".join(lines) + "\n")
    os.environ["ORDERS_ENCRYPTION_KEY"] = new_key
    print("\u26a0\ufe0f  Generated ORDERS_ENCRYPTION_KEY \u2014 saved to backend/.env")
    return Fernet(new_key.encode())


_fernet = _get_or_create_fernet()


def _enc(value: str) -> bytes:
    return _fernet.encrypt(value.encode())


def _dec(blob: bytes) -> str:
    return _fernet.decrypt(blob).decode()


def _db_init() -> None:
    with sqlite3.connect(DB_FILE) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS orders (
                order_id           TEXT PRIMARY KEY,
                asset_pair         TEXT NOT NULL,
                side               TEXT NOT NULL,
                price_enc          BLOB NOT NULL,
                amount_enc         BLOB NOT NULL,
                amount_rem_enc     BLOB NOT NULL,
                ts                 TEXT NOT NULL,
                nonce_enc          BLOB NOT NULL,
                settlement_hash    TEXT NOT NULL,
                order_status       INTEGER NOT NULL DEFAULT 0,
                fairness_proven    INTEGER NOT NULL DEFAULT 0,
                reasoning_hash     TEXT,
                proof_hash         TEXT,
                zk_mode            TEXT DEFAULT 'mock',
                contract_address   TEXT,
                tx_hash            TEXT
            );
            CREATE TABLE IF NOT EXISTS used_nonces (
                nonce_hash  TEXT PRIMARY KEY,
                order_id    TEXT NOT NULL,
                created_at  TEXT NOT NULL
            );
        """)


def _db_save_order(order: dict) -> None:
    """Upsert an existing order (updates only — does not register nonce)."""
    proof = order.get("proof") or {}
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                order["order_id"],
                order["asset_pair"],
                order["side"],
                _enc(str(order["price"])),
                _enc(str(order["amount"])),
                _enc(str(order.get("amount_remaining", order["amount"]))),
                order["timestamp"],
                _enc(str(order["nonce"])),
                order["settlement_hash"],
                order["order_status"],
                order["fairness_proven"],
                order.get("reasoning_hash"),
                proof.get("proof_hash"),
                proof.get("zk_mode", "mock"),
                proof.get("contract_address"),
                proof.get("tx_hash"),
            ),
        )


def _db_create_order(order: dict) -> None:
    """
    Insert a new order and register its nonce atomically (single transaction).
    Raises HTTPException(409) if the nonce was already used — replay protection.
    """
    proof = order.get("proof") or {}
    nonce = str(order["nonce"])
    nonce_hash = hashlib.sha256(nonce.encode()).hexdigest()
    ts_now = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DB_FILE) as conn:
        try:
            conn.execute(
                "INSERT INTO used_nonces (nonce_hash, order_id, created_at) VALUES (?,?,?)",
                (nonce_hash, order["order_id"], ts_now),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Nonce already used \u2014 possible replay attack")
        conn.execute(
            "INSERT OR REPLACE INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                order["order_id"],
                order["asset_pair"],
                order["side"],
                _enc(str(order["price"])),
                _enc(str(order["amount"])),
                _enc(str(order.get("amount_remaining", order["amount"]))),
                order["timestamp"],
                _enc(nonce),
                order["settlement_hash"],
                order["order_status"],
                order["fairness_proven"],
                order.get("reasoning_hash"),
                proof.get("proof_hash"),
                proof.get("zk_mode", "mock"),
                proof.get("contract_address"),
                proof.get("tx_hash"),
            ),
        )


def _db_load_all_orders() -> dict:
    """Load and decrypt all orders from the database into an in-memory dict."""
    result: dict = {}
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM orders").fetchall()
    for row in rows:
        oid = row["order_id"]
        result[oid] = {
            "order_id": oid,
            "asset_pair": row["asset_pair"],
            "side": row["side"],
            "price": float(_dec(row["price_enc"])),
            "amount": float(_dec(row["amount_enc"])),
            "amount_remaining": float(_dec(row["amount_rem_enc"])),
            "timestamp": row["ts"],
            "nonce": _dec(row["nonce_enc"]),
            "settlement_hash": row["settlement_hash"],
            "order_status": row["order_status"],
            "fairness_proven": row["fairness_proven"],
            "reasoning_hash": row["reasoning_hash"],
            "proof": {
                "proof_hash": row["proof_hash"],
                "zk_mode": row["zk_mode"],
                "contract_address": row["contract_address"],
                "tx_hash": row["tx_hash"],
            },
        }
    return result


def _migrate_json_if_needed() -> None:
    """One-time migration: orders.json \u2192 orders.db (renames source to .bak)."""
    old = Path(__file__).parent / "orders.json"
    if not old.exists():
        return
    try:
        data = json.loads(old.read_text())
        for order in data.values():
            if "nonce" not in order:
                order["nonce"] = str(uuid.uuid4())
            if "proof" not in order:
                order["proof"] = {"proof_hash": None, "zk_mode": "mock",
                                   "contract_address": None, "tx_hash": None}
            _db_save_order(order)
        old.rename(old.with_suffix(".json.bak"))
        print(f"\u2705  Migrated {len(data)} orders from orders.json \u2192 orders.db")
    except Exception as exc:
        print(f"\u26a0\ufe0f  orders.json migration skipped: {exc}")


# Bootstrap
_db_init()
_migrate_json_if_needed()

# In-memory order book keyed by order_id.
# Sensitive fields (price, amount, nonce) are encrypted at rest in orders.db.
# They are never returned in any public API response.
orders: dict = _db_load_all_orders()

# Serialises concurrent calls to _atomic_match_and_settle, preventing double-fills.
_matching_lock: asyncio.Lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ProofOverride(BaseModel):
    proof_hash: Optional[str] = None
    contract_address: Optional[str] = None
    tx_hash: Optional[str] = None
    settlement_hash: Optional[str] = None
    zk_mode: Optional[str] = "mock"
    proof_bytes: Optional[str] = None
    proof_size_bytes: Optional[int] = None
    proof_generated_ms: Optional[int] = None


_VALID_PAIRS = Literal["BTC/USDC", "ETH/USDC", "SOL/USDC", "MATIC/USDC"]


class OrderRequest(BaseModel):
    asset_pair: _VALID_PAIRS
    side: Literal["BUY", "SELL"]
    price: float = Field(gt=0, le=1_000_000_000)   # limit price -- NEVER returned in any response
    amount: float = Field(gt=0, le=1_000_000)       # order size  -- NEVER returned in any response
    reasoning_hash: Optional[str] = None   # SHA-256 of AI reasoning — committed, never exposed
    proof_override: Optional[ProofOverride] = None


class AISignalRequest(BaseModel):
    asset: str          # e.g. "BTC"
    price_usd: Optional[float] = None


# ---------------------------------------------------------------------------
# AI signal storage (in-memory, append-only public feed)
# ---------------------------------------------------------------------------
ai_signals: list = []


# ---------------------------------------------------------------------------
# Azure OpenAI integration (graceful mock fallback)
# ---------------------------------------------------------------------------

_OPENAI_KEY      = os.getenv("AZURE_OPENAI_API_KEY", "")
_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
_OPENAI_DEPLOY   = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME") or os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
_OPENAI_VERSION  = os.getenv("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")


async def _call_azure_openai(asset: str, price_usd: Optional[float]) -> dict:
    """
    Ask Azure OpenAI to generate a trade signal.
    Returns { signal, confidence, reasoning }.
    Reasoning text is NEVER stored or returned to any caller — only its SHA-256 hash is kept.
    """
    import asyncio
    import urllib.request
    import urllib.error

    price_context = f" Current price: ${price_usd:,.2f}." if price_usd else ""
    prompt = (
        f"You are a demo market data classifier for a trading simulation.{price_context} "
        f"Classify the market for {asset}/USDC. "
        f"Reply in exactly 3 lines, no extra text:\n"
        f"SIGNAL: <BUY|SELL|HOLD>\nCONFIDENCE: <number 0-100>\nREASONING: <one sentence>"
    )

    payload = json.dumps({
        "messages": [{"role": "user", "content": prompt}],
        "max_completion_tokens": 2000,
    }).encode()

    url = (
        f"{_OPENAI_ENDPOINT.rstrip('/')}/openai/deployments/"
        f"{_OPENAI_DEPLOY}/chat/completions?api-version={_OPENAI_VERSION}"
    )

    def _sync_openai_call():
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json", "api-key": _OPENAI_KEY},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read())
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Azure OpenAI unreachable: {exc}")

    body = await asyncio.to_thread(_sync_openai_call)
    text = body["choices"][0]["message"]["content"]

    signal, confidence, reasoning = "HOLD", 50, "No signal parsed."
    for line in text.splitlines():
        line = line.strip()
        if line.upper().startswith("SIGNAL:"):
            val = line.split(":", 1)[1].strip().upper()
            if val in ("BUY", "SELL", "HOLD"):
                signal = val
        elif line.upper().startswith("CONFIDENCE:"):
            try:
                confidence = max(0, min(100, int(line.split(":", 1)[1].strip())))
            except ValueError:
                pass
        elif line.upper().startswith("REASONING:"):
            reasoning = line.split(":", 1)[1].strip()

    return {"signal": signal, "confidence": confidence, "reasoning": reasoning}


def _mock_signal(asset: str, price_usd: Optional[float]) -> dict:
    """Deterministic mock signal — used when Azure OpenAI credentials are absent."""
    import math
    seed = int(hashlib.sha256(f"{asset}{datetime.now(timezone.utc).strftime('%Y%m%d%H')}".encode()).hexdigest(), 16)
    signals = ["BUY", "SELL", "HOLD"]
    signal = signals[seed % 3]
    confidence = 55 + (seed % 30)
    reasoning_map = {
        "BUY":  f"RSI crossed below 30 on {asset}; oversold bounce likely.",
        "SELL": f"Volume spike on {asset} with declining momentum; reduce exposure.",
        "HOLD": f"{asset} consolidating; insufficient edge to enter a new position.",
    }
    return {"signal": signal, "confidence": confidence, "reasoning": reasoning_map[signal]}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _settlement_hash(price: float, amount: float, nonce: str) -> str:
    """SHA-256(price||amount||nonce) -- committed on-chain, values never exposed."""
    raw = f"{price}{amount}{nonce}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _mock_proof_hash(order_id: str, timestamp: str) -> str:
    raw = f"{order_id}{timestamp}MIDNIGHT_ZK"
    return hashlib.sha256(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Phase 3 — Price-time priority matching engine
# ---------------------------------------------------------------------------

def _sorted_asks(pair: str) -> list:
    """Return PENDING SELL orders sorted ascending price, then ascending time (price-time priority)."""
    return sorted(
        [o for o in orders.values()
         if o["order_status"] == 0 and o["side"] == "SELL" and o["asset_pair"] == pair],
        key=lambda o: (o["price"], o["timestamp"]),
    )

def _sorted_bids(pair: str) -> list:
    """Return PENDING BUY orders sorted descending price, then ascending time (price-time priority)."""
    return sorted(
        [o for o in orders.values()
         if o["order_status"] == 0 and o["side"] == "BUY" and o["asset_pair"] == pair],
        key=lambda o: (-o["price"], o["timestamp"]),
    )

def _find_match(new_order: dict) -> Optional[dict]:
    """
    Return the single best counterparty for new_order (price-time priority).
    BUY: cheapest ask where ask_price <= buy_price (then earliest).
    SELL: highest bid where bid_price >= sell_price (then earliest).
    """
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


def _matched_price(buy_order: dict, sell_order: dict) -> float:
    """
    Matched price = sell order's limit (resting order sets the price).
    The buyer always gets price improvement; the seller gets exactly their limit.
    This is classic price-time priority rule.
    """
    return sell_order["price"]


async def _request_settle_proof(
    order_id: str,
    matched_price: float,
    buyer_limit: float,
    seller_limit: float,
) -> dict:
    """
    Call midnight-service /settle-proof to generate a ZK fairness proof.
    The settle_order circuit asserts seller_limit <= matched_price <= buyer_limit
    without disclosing any of the three values on-chain.
    Falls back gracefully if midnight-service is not running.
    """
    import asyncio

    def _sync_call():
        import urllib.request, urllib.error
        payload = json.dumps({
            "order_id": order_id,
            "matched_price_cents": round(matched_price * 100),
            "buyer_limit_cents":   round(buyer_limit  * 100),
            "seller_limit_cents":  round(seller_limit * 100),
        }).encode()
        req = urllib.request.Request(
            "http://localhost:3007/settle-proof",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.URLError:
            return None  # service not running — caller uses mock
        except Exception:
            return None

    return await asyncio.to_thread(_sync_call)


async def _atomic_match_and_settle(order_id: str) -> list:
    """
    Atomically match and partially/fully settle an order against the book.
    Supports partial fills: one order can match against multiple resting counterparties.

    Returns a list of fill dicts (one per matched counterparty).
    Matched_price is committed to settlement hash but NEVER returned in any API response.
    """
    async with _matching_lock:
        fills = []
        order = orders.get(order_id)
        if not order or order["order_status"] != 0:
            return fills

        remaining = order.get("amount_remaining", order["amount"])

        while remaining > 1e-12:
            # Rebuild live snapshot for this order to check current status
            if orders[order_id]["order_status"] != 0:
                break

            # Temporarily set amount_remaining so _find_match can work on live data
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

            # Reduce remaining amounts
            remaining -= fill_qty
            cp_remaining -= fill_qty

            # Commit settlement hash for this fill — matched_price never exposed
            fill_nonce = str(uuid.uuid4())
            fill_hash = hashlib.sha256(
                f"{matched_price}{fill_qty}{fill_nonce}".encode()
            ).hexdigest()

            # Settle counterparty if fully filled
            if cp_remaining <= 1e-12:
                orders[cp_id]["order_status"] = 2     # SETTLED
                orders[cp_id]["fairness_proven"] = 1
                orders[cp_id]["amount_remaining"] = 0.0
            else:
                orders[cp_id]["amount_remaining"] = cp_remaining

            # Settle taker if fully filled
            if remaining <= 1e-12:
                orders[order_id]["order_status"] = 2  # SETTLED
                orders[order_id]["fairness_proven"] = 1
                orders[order_id]["amount_remaining"] = 0.0
            else:
                orders[order_id]["amount_remaining"] = remaining

            buy_id  = order_id if order["side"] == "BUY" else cp_id
            sell_id = cp_id    if order["side"] == "BUY" else order_id

            # ── ZK fairness proof via settle_order circuit ────────────────────────
            # Witnesses: matched_price, buyer_limit, seller_limit (all PRIVATE)
            # Circuit asserts: seller_limit <= matched_price <= buyer_limit
            buy_order  = orders[buy_id]
            sell_order = orders[sell_id]
            settle_result = await _request_settle_proof(
                order_id=buy_id,
                matched_price=matched_price,
                buyer_limit=buy_order["price"],
                seller_limit=sell_order["price"],
            )
            if settle_result and settle_result.get("fairnessProven"):
                settle_proof_hash = settle_result["proofHash"]
                settle_zk_mode    = settle_result.get("mode", "mock")
            else:
                # Midnight-service offline — generate local mock proof commitment
                settle_proof_hash = hashlib.sha256(
                    f"{buy_id}SETTLE{fill_hash}MIDNIGHT_ZK".encode()
                ).hexdigest()
                settle_zk_mode = "mock"

            # Persist settle proof hash on both orders
            orders[buy_id]["proof"]  = {**orders[buy_id].get("proof", {}),  "proof_hash": settle_proof_hash, "zk_mode": settle_zk_mode}
            orders[sell_id]["proof"] = {**orders[sell_id].get("proof", {}), "proof_hash": settle_proof_hash, "zk_mode": settle_zk_mode}

            fill = {
                "fill_id": str(uuid.uuid4()),
                "buy_order_id": buy_id,
                "sell_order_id": sell_id,
                "asset_pair": order["asset_pair"],
                "fill_hash": fill_hash,            # committed; matched_price intentionally omitted
                "settle_proof_hash": settle_proof_hash,
                "settle_zk_mode": settle_zk_mode,
                "timestamp": timestamp,
                "partial": remaining > 1e-12 or cp_remaining > 1e-12,
            }
            fills.append(fill)
            # Track how many fills have occurred on this order for partial_fill detection
            orders[order_id]["fill_count"] = orders[order_id].get("fill_count", 0) + 1
            _db_save_order(orders[order_id])
            _db_save_order(orders[cp_id])

        return fills


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/order/submit")
async def submit_order(req: OrderRequest, request: Request):
    """
    Accept a hidden limit order. Generates a ZK proof (mock or real).
    Price and amount are stored server-side only and never returned.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded — max 20 orders per minute")
    order_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()
    nonce = str(uuid.uuid4())

    settle_hash = _settlement_hash(req.price, req.amount, nonce)

    po = req.proof_override
    if po and po.proof_hash:
        proof_hash = po.proof_hash
        zk_mode = po.zk_mode or "real"
        contract_addr = po.contract_address
        tx_hash = po.tx_hash
    else:
        proof_hash = _mock_proof_hash(order_id, timestamp)
        zk_mode = "mock"
        contract_addr = None
        tx_hash = None

    order = {
        "order_id": order_id,
        "asset_pair": req.asset_pair,
        "side": req.side,
        "price": req.price,            # stored internally, never returned
        "amount": req.amount,          # original size — stored internally
        "amount_remaining": req.amount,  # tracks partial fills — never returned
        "timestamp": timestamp,
        "nonce": nonce,
        "settlement_hash": settle_hash,
        "order_status": 0,             # PENDING
        "fairness_proven": 0,
        "reasoning_hash": req.reasoning_hash,  # AI reasoning hash — committed, never exposed
        "proof": {
            "proof_hash": proof_hash,
            "zk_mode": zk_mode,
            "contract_address": contract_addr,
            "tx_hash": tx_hash,
        },
    }

    orders[order_id] = order
    _db_create_order(order)

    # Atomic match + settle (Phase 3) — fully replaces the two-step match/settle race
    fills = await _atomic_match_and_settle(order_id)

    return {
        "order_id": order_id,
        "asset_pair": req.asset_pair,
        "side": req.side,
        "settlement_hash": settle_hash,
        "order_status": orders[order_id]["order_status"],
        "fill_count": len(fills),
        "proof_hash": proof_hash,
        "zk_mode": zk_mode,
        "timestamp": timestamp,
        # settle_proof_hash is the ZK fairness proof for the matched fill (if any)
        "settle_proof_hash": fills[0]["settle_proof_hash"] if fills else None,
        "settle_zk_mode": fills[0]["settle_zk_mode"] if fills else None,
    }


@app.get("/api/orderbook")
async def get_orderbook(asset_pair: Optional[str] = None):
    """
    Returns only depth counts per asset_pair. No prices, no sizes.
    """
    book: dict = {}
    for o in orders.values():
        if o["order_status"] not in (0, 1):  # PENDING or MATCHED only
            continue
        pair = o["asset_pair"]
        if asset_pair and pair != asset_pair:
            continue
        if pair not in book:
            book[pair] = {"bids": 0, "asks": 0}
        if o["side"] == "BUY":
            book[pair]["bids"] += 1
        else:
            book[pair]["asks"] += 1

    return [
        {"asset_pair": pair, "bids": v["bids"], "asks": v["asks"]}
        for pair, v in book.items()
    ]


@app.post("/api/order/match")
async def trigger_match():
    """
    Sweep all PENDING orders through the atomic matching engine.
    Uses Phase 3 price-time priority + partial fill support.
    Returns fill count only — no prices exposed.
    """
    all_fills = []
    # Process oldest PENDING orders first (FIFO sweep)
    pending = sorted(
        [o for o in orders.values() if o["order_status"] == 0],
        key=lambda o: o["timestamp"],
    )
    for order in pending:
        if orders[order["order_id"]]["order_status"] != 0:
            continue  # may have been filled by a prior iteration
        fills = await _atomic_match_and_settle(order["order_id"])
        all_fills.extend(fills)

    return {
        "fills": len(all_fills),
        "fill_ids": [f["fill_id"] for f in all_fills],
    }


@app.post("/api/order/settle")
async def settle_order(order_id: str):
    """
    Manually settle a PENDING order (for testing).
    In production, settlement is atomic inside submit_order.
    """
    order = orders.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["order_status"] not in (0, 1):
        raise HTTPException(status_code=400, detail="Order must be PENDING or MATCHED to settle")

    orders[order_id]["order_status"] = 2    # SETTLED
    orders[order_id]["fairness_proven"] = 1
    _db_save_order(orders[order_id])

    return {
        "order_id": order_id,
        "order_status": 2,
        "fairness_proven": 1,
        "settlement_hash": order["settlement_hash"],
        "asset_pair": order["asset_pair"],
    }


@app.get("/api/trades/public")
async def public_trades():
    """
    Public settlement feed: settlement_hash, asset_pair, timestamp only.
    No prices, no sizes, no counterparty info.
    reasoning_hash is included — it is a commitment to the AI reasoning text,
    but the reasoning text itself is never stored or returned anywhere.
    partial_fill=true when the order was split across multiple counterparties.
    """
    result = []
    for o in orders.values():
        if o["order_status"] != 2:   # SETTLED only
            continue
        result.append({
            "settlement_hash": o["settlement_hash"],
            "asset_pair": o["asset_pair"],
            "timestamp": o["timestamp"],
            "fairness_proven": o["fairness_proven"],
            "reasoning_hash": o.get("reasoning_hash"),
            "partial_fill": o.get("fill_count", 1) > 1,
            "proof_hash": o["proof"]["proof_hash"],
            "zk_mode": o["proof"].get("zk_mode", "mock"),
        })
    result.sort(key=lambda x: x["timestamp"], reverse=True)
    return result


@app.get("/api/proof/{order_id}")
async def get_proof(order_id: str):
    order = orders.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    proof = order["proof"]
    return {
        "order_id": order_id,
        "proof_hash": proof["proof_hash"],
        "fairness_proven": order["fairness_proven"],
        "reasoning_hash": order.get("reasoning_hash"),
        "zk_mode": proof.get("zk_mode", "mock"),
        "contract_address": proof.get("contract_address"),
        "tx_hash": proof.get("tx_hash"),
        "asset_pair": order["asset_pair"],
        "order_status": order["order_status"],
        "settlement_hash": order["settlement_hash"],
        "timestamp": order["timestamp"],
    }


# ---------------------------------------------------------------------------
# AlphaShield — AI Signal Generation
# ---------------------------------------------------------------------------

@app.post("/api/ai/signal")
async def generate_ai_signal(req: AISignalRequest, request: Request):
    """
    Generate an AI trade signal for a given asset.

    The raw reasoning text is computed here but NEVER stored or returned.
    Only its SHA-256 hash (reasoning_hash) is returned, to be committed
    on-chain via the submit_order circuit.

    This lets followers verify that the whale used a consistent reasoning
    commitment without ever revealing what the reasoning says.
    """
    client_ip = request.client.host if request.client else "unknown"
    allowed, reason = _check_ai_rate_limit(client_ip)
    if not allowed:
        raise HTTPException(status_code=429, detail=reason)

    asset = req.asset.upper().strip()
    if not asset:
        raise HTTPException(status_code=422, detail="asset is required")

    timestamp = datetime.now(timezone.utc).isoformat()

    # Try real Azure OpenAI; fall back to mock if credentials are absent
    if _OPENAI_KEY and _OPENAI_ENDPOINT:
        try:
            raw = await _call_azure_openai(asset, req.price_usd)
            source = "azure_openai"
        except Exception:
            raw = _mock_signal(asset, req.price_usd)
            source = "mock"
    else:
        raw = _mock_signal(asset, req.price_usd)
        source = "mock"

    # Hash the reasoning — this is what gets committed on-chain.
    # The reasoning text itself is discarded after hashing.
    reasoning_hash = hashlib.sha256(
        f"{raw['reasoning']}{timestamp}".encode()
    ).hexdigest()

    record = {
        "signal_id": str(uuid.uuid4()),
        "asset": asset,
        "signal": raw["signal"],
        "confidence": raw["confidence"],
        "reasoning_hash": reasoning_hash,   # committed — NOT the reasoning text
        "timestamp": timestamp,
        "source": source,
        "bytes_exposed": 0,                 # always 0 — Midnight guarantee
    }
    ai_signals.append(record)
    # Keep the last 200 signals in memory
    if len(ai_signals) > 200:
        ai_signals.pop(0)

    return record


@app.get("/api/ai/feed")
async def ai_signal_feed():
    """
    Public feed of AI-generated trade signals.
    Returns reasoning_hash only — the reasoning text is never exposed.
    """
    return list(reversed(ai_signals))


@app.get("/health")
async def health():
    return {"status": "ok"}
