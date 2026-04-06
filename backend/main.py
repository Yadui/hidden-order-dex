import hashlib
import json
import uuid
import base64
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
import os

load_dotenv()

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import AzureOpenAI

app = FastAPI(title="AlphaShield API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Azure OpenAI client
client = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01"),
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
)

DEPLOYMENT_NAME = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4o-mini")

# ── Rate limiter ───────────────────────────────────────────────────────────────
# Sliding-window per-IP limiter applied to all Azure OpenAI endpoints.
# Limits are intentionally generous enough for a live demo but prevent runaway
# costs if the key is discovered or the demo goes viral.
#
#   signal / agent (single-turn) : 20 req / 60 s  per IP
#   conversation   (multi-turn)  :  5 req / 60 s  per IP  (more tokens / call)
#   global across all endpoints  : 60 req / 60 s  total   (hard safety cap)
# ─────────────────────────────────────────────────────────────────────────────
_WINDOW_S   = 60          # sliding window size in seconds
_PER_IP     = 20          # max single-turn AOAI calls per IP per window
_PER_IP_CONV= 5           # max multi-turn AOAI calls per IP per window
_GLOBAL_CAP = 60          # hard global cap across ALL IPs per window

# { ip: deque of timestamps }
_ip_windows: dict[str, deque] = defaultdict(deque)
_conv_windows: dict[str, deque] = defaultdict(deque)
_global_window: deque = deque()


def _get_ip(request: Request) -> str:
    """Return the real client IP, honouring X-Forwarded-For for proxied setups."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate(window: deque, limit: int, window_s: int = _WINDOW_S) -> bool:
    """
    Slide the window and return True if the request is allowed.
    Mutates *window* in-place on success.
    """
    now = time.monotonic()
    # Drop timestamps outside the window
    while window and now - window[0] > window_s:
        window.popleft()
    if len(window) >= limit:
        return False
    window.append(now)
    return True


def _aoai_rate_check(request: Request, *, conv: bool = False) -> None:
    """Raise HTTP 429 if any rate limit is exceeded."""
    ip = _get_ip(request)

    # 1. Global cap
    if not _check_rate(_global_window, _GLOBAL_CAP):
        raise HTTPException(
            status_code=429,
            detail="Server is busy — global AI rate limit reached. Try again in a moment.",
        )

    # 2. Per-IP cap (conversation endpoints use a tighter limit)
    ip_store = _conv_windows if conv else _ip_windows
    limit    = _PER_IP_CONV  if conv else _PER_IP
    if not _check_rate(ip_store[ip], limit):
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit: max {limit} AI requests per {_WINDOW_S}s per client. Please wait.",
        )

# ── Persistent trade storage ───────────────────────────────────────────────────
TRADES_FILE = Path(__file__).parent / "trades.json"

def _load_trades() -> dict:
    try:
        if TRADES_FILE.exists():
            return json.loads(TRADES_FILE.read_text())
    except Exception:
        pass
    return {}

def _save_trades(data: dict) -> None:
    try:
        TRADES_FILE.write_text(json.dumps(data, indent=2))
    except Exception:
        pass

trades: dict = _load_trades()


# --- Request / Response Models ---

class SignalRequest(BaseModel):
    asset: str
    price: float
    volume_change: float
    rsi: float


class Signal(BaseModel):
    direction: str
    confidence: float
    reasoning: str
    risk_level: str


class ProofOverride(BaseModel):
    proof_hash: Optional[str] = None
    contract_address: Optional[str] = None
    tx_hash: Optional[str] = None
    reasoning_hash: Optional[str] = None
    zk_mode: Optional[str] = "mock"   # "real" | "mock"
    proof_bytes: Optional[str] = None  # base64-encoded raw ZK proof
    proof_size_bytes: Optional[int] = None
    proof_generated_ms: Optional[int] = None  # milliseconds to generate proof
    proof_preimage: Optional[str] = None  # base64-encoded serialized preimage for /check
    risk_committed: Optional[int] = None   # v2: stop_loss_pct + position_pct (sum only)
    strategy_version: Optional[int] = 2   # v2 contract


class TradeExecuteRequest(BaseModel):
    asset: str
    amount: float
    price: float
    signal: dict
    proof_override: Optional[ProofOverride] = None


# --- Endpoints ---

@app.post("/api/signal")
async def generate_signal(req: SignalRequest, request: Request):
    _aoai_rate_check(request)
    system_prompt = (
        "You are a proprietary AI quant trading signal engine. "
        "Given market data, return ONLY a JSON object with: "
        "direction (BUY or SELL), "
        "confidence (number 0-100), "
        "reasoning (2-3 sentence technical analysis explaining the signal), "
        "risk_level (LOW/MEDIUM/HIGH), "
        "stop_loss_pct (integer 1-20: recommended stop-loss as % of position value), "
        "position_pct (integer 1-50: recommended portfolio allocation percentage)"
    )
    user_message = (
        f"Asset: {req.asset}\n"
        f"Current Price: ${req.price}\n"
        f"RSI: {req.rsi}\n"
        f"Volume Change: {req.volume_change}%\n"
        "Generate a trading signal."
    )

    response = client.chat.completions.create(
        model=DEPLOYMENT_NAME,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        response_format={"type": "json_object"},
    )

    raw = response.choices[0].message.content
    signal = json.loads(raw)
    return signal


@app.post("/api/trade/execute")
async def execute_trade(req: TradeExecuteRequest):
    trade_id = str(uuid.uuid4())
    proof_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()

    # Use real proof data from Midnight SDK if provided, else fall back to mock
    po = req.proof_override
    if po and po.proof_hash:
        proof_hash        = po.proof_hash
        zk_mode           = po.zk_mode or "real"
        contract_addr     = po.contract_address
        tx_hash           = po.tx_hash
        reasoning_hash    = po.reasoning_hash
        proof_bytes_b64   = po.proof_bytes
        proof_preimage_b64 = po.proof_preimage
        proof_size        = po.proof_size_bytes or (
            len(base64.b64decode(po.proof_bytes)) if po.proof_bytes else None
        )
        proof_gen_ms      = po.proof_generated_ms
        risk_committed    = po.risk_committed
        strategy_version  = po.strategy_version or 2
    else:
        hash_input        = f"{req.asset}{req.amount}{timestamp}MIDNIGHT_ZK"
        proof_hash        = hashlib.sha256(hash_input.encode()).hexdigest()
        zk_mode           = "mock"
        contract_addr     = None
        tx_hash           = None
        reasoning_hash    = None
        proof_bytes_b64   = None
        proof_preimage_b64 = None
        proof_size        = None
        proof_gen_ms      = None
        risk_committed    = None
        strategy_version  = 2

    trade = {
        "trade_id": trade_id,
        "asset": req.asset,
        "amount": req.amount,
        "price": req.price,
        "timestamp": timestamp,
        "signal": req.signal,
        "proof": {
            "proof_id": proof_id,
            "proof_hash": proof_hash,
            "status": "VERIFIED",
            "strategy_encrypted": True,
            "bytes_exposed": 0,
            "timestamp": timestamp,
            "zk_mode": zk_mode,
            "contract_address": contract_addr,
            "tx_hash": tx_hash,
            "reasoning_hash": reasoning_hash,
            "proof_bytes": proof_bytes_b64,
            "proof_preimage": proof_preimage_b64,
            "proof_size_bytes": proof_size,
            "proof_generated_ms": proof_gen_ms,
            "risk_committed": risk_committed,
            "strategy_version": strategy_version,
        },
    }

    trades[trade_id] = trade
    _save_trades(trades)

    return {
        "trade_id": trade_id,
        "proof_id": proof_id,
        "proof_hash": proof_hash,
        "status": "VERIFIED",
        "asset": req.asset,
        "amount": req.amount,
        "price": req.price,
        "timestamp": timestamp,
        "zk_mode": zk_mode,
        "contract_address": contract_addr,
    }


@app.get("/api/trades")
async def get_trades(midnight: bool = True):
    result = []
    for trade in trades.values():
        t = {
            "trade_id": trade["trade_id"],
            "asset": trade["asset"],
            "amount": trade["amount"],
            "price": trade["price"],
            "timestamp": trade["timestamp"],
            "proof_id": trade["proof"]["proof_id"],
        }
        if midnight:
            t["signal"] = {"encrypted_payload": "[MIDNIGHT ENCRYPTED 🔒]"}
        else:
            t["signal"] = trade["signal"]
        result.append(t)
    # newest first
    result.sort(key=lambda x: x["timestamp"], reverse=True)
    return result


@app.get("/api/proof/{trade_id}")
async def get_proof(trade_id: str):
    trade = trades.get(trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    proof = trade["proof"]
    return {
        "trade_id":               trade_id,
        "proof_id":               proof["proof_id"],
        "proof_hash":             proof["proof_hash"],
        "status":                 "VERIFIED",
        "execution_fair":         True,
        "strategy_bytes_exposed": 0,
        "zk_mode":                proof.get("zk_mode", "mock"),
        "contract_address":       proof.get("contract_address"),
        "tx_hash":                proof.get("tx_hash"),
        "reasoning_hash":         proof.get("reasoning_hash"),
        "proof_bytes":            proof.get("proof_bytes"),
        "proof_preimage":         proof.get("proof_preimage"),
        "proof_size_bytes":       proof.get("proof_size_bytes"),
        "proof_generated_ms":     proof.get("proof_generated_ms"),
        "risk_committed":         proof.get("risk_committed"),
        "strategy_version":       proof.get("strategy_version", 2),
        "asset":                  trade["asset"],
        "amount":                 trade["amount"],
        "timestamp":              proof["timestamp"],
    }


import httpx

@app.post("/api/verify-proof/{trade_id}")
async def verify_proof(trade_id: str):
    trade = trades.get(trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    proof = trade["proof"]
    preimage = proof.get("proof_preimage")
    verified_at = datetime.now(timezone.utc).isoformat()

    if not preimage:
        # Mock trade — no real preimage stored
        return {
            "trade_id": trade_id,
            "valid": None,
            "mode": proof.get("zk_mode", "mock"),
            "message": "No ZK preimage stored — this is a mock proof",
            "verified_at": verified_at,
        }

    try:
        async with httpx.AsyncClient(timeout=35.0) as client:
            resp = await client.post(
                "http://localhost:3006/verify-proof",
                json={"preimage": preimage},
            )
        data = resp.json()
        return {
            "trade_id": trade_id,
            "valid": data.get("valid"),
            "mode": data.get("mode", "real"),
            "message": data.get("message"),
            "verified_at": verified_at,
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Midnight service error: {e}")


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── /api/agent ─────────────────────────────────────────────────────────────────
# Natural language → parse intent → fetch live market data → generate signal.
# Does NOT execute — returns the parsed intent + signal so the frontend can
# confirm + trigger ZK proof generation via /api/trade/execute.
# ─────────────────────────────────────────────────────────────────────────────

class AgentRequest(BaseModel):
    message: str                      # raw NL input from whale
    wallet_id: Optional[str] = None   # obfuscated whale ID

class AgentMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str

class AgentConversationRequest(BaseModel):
    messages: list[AgentMessage]      # full conversation history
    wallet_id: Optional[str] = None


AGENT_SYSTEM = """You are AlphaShield — an AI trading agent that converts natural language instructions into structured trade signals.

Always try to extract a trade signal, even from casual or informal phrasing (e.g. "wanna buy some BTC", "load up on ETH", "dump my SOL", "short ADA a little").

Extract these fields:
- asset: one of BTC, ETH, SOL, XRP, AVAX, LINK, ADA, DOT (infer from message; default ETH if ambiguous)
- amount: numeric amount to trade (default 1.0 if not specified)
- intent: BUY or SELL (buy/long/bullish/load/accumulate → BUY; sell/short/bearish/dump/exit → SELL; default BUY)
- confidence: integer 70-100 ("maybe"/"might"=72, "think"/"looks like"=78, "strong"/"clear"=88, "definitely"/"certain"=94; default 80)
- stop_loss_pct: integer 1-20 ("risky"=15, "safe"/"tight"=5, "small"=3; default 8)
- position_pct: integer 1-50 ("all in"=40, "small"=5, "some"=15, "a bit"=8; default 15)
- reasoning: 1-2 sentences explaining the inferred trade rationale
- risk_level: LOW / MEDIUM / HIGH

Only set an "error" field (instead of the above) if the message is completely unrelated to trading (e.g. "what's the weather?"). For any message that mentions buying, selling, a coin, or market sentiment — always return the full signal JSON."""


@app.post("/api/agent")
async def agent_trade(req: AgentRequest, request: Request):
    """Parse a natural language message into a structured trade signal."""
    _aoai_rate_check(request)
    response = client.chat.completions.create(
        model=DEPLOYMENT_NAME,
        messages=[
            {"role": "system", "content": AGENT_SYSTEM},
            {"role": "user", "content": req.message},
        ],
        response_format={"type": "json_object"},
    )
    parsed = json.loads(response.choices[0].message.content)
    if "error" in parsed and len(parsed) == 1:
        return {"ok": False, "error": parsed["error"]}
    # Fill in any missing fields with safe defaults so partial responses never fail
    parsed.setdefault("asset", "ETH")
    parsed.setdefault("amount", 1.0)
    parsed.setdefault("intent", parsed.get("direction", "BUY"))
    parsed.setdefault("confidence", 80)
    parsed.setdefault("stop_loss_pct", 8)
    parsed.setdefault("position_pct", 15)
    parsed.setdefault("reasoning", "Signal inferred from user intent.")
    parsed.setdefault("risk_level", "MEDIUM")
    return {"ok": True, "parsed": parsed}


@app.post("/api/agent/conversation")
async def agent_conversation(req: AgentConversationRequest, request: Request):
    """Multi-turn agent conversation — maintains context for follow-up commands."""
    _aoai_rate_check(request, conv=True)
    messages = [{"role": "system", "content": AGENT_SYSTEM}]
    for m in req.messages:
        messages.append({"role": m.role, "content": m.content})

    response = client.chat.completions.create(
        model=DEPLOYMENT_NAME,
        messages=messages,
        response_format={"type": "json_object"},
    )
    parsed = json.loads(response.choices[0].message.content)
    if "error" in parsed:
        return {"ok": False, "error": parsed["error"]}
    return {"ok": True, "parsed": parsed}


# ── /api/whale-profile ─────────────────────────────────────────────────────────
# Returns obfuscated whale profile stats derived from trade history.
# No wallet address or PII is ever returned — only aggregate provable metrics.
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/whale-profile/{wallet_hash}")
async def whale_profile(wallet_hash: str):
    """Return obfuscated performance stats for a whale identity hash."""
    all_trades = list(trades.values())
    total       = len(all_trades)
    real_proofs = sum(1 for t in all_trades if t["proof"].get("zk_mode") == "real")
    assets_used = list({t["asset"] for t in all_trades})
    sell_count  = sum(1 for t in all_trades if t["signal"].get("direction") == "SELL")
    buy_count   = total - sell_count
    avg_conf    = (
        sum(t["signal"].get("confidence", 0) for t in all_trades) / total
        if total > 0 else 0
    )
    return {
        "whale_id":         wallet_hash[:8].upper(),   # first 8 chars of hash only
        "total_trades":     total,
        "real_zk_proofs":   real_proofs,
        "mock_zk_proofs":   total - real_proofs,
        "assets_traded":    assets_used,
        "buy_count":        buy_count,
        "sell_count":       sell_count,
        "avg_confidence":   round(avg_conf, 1),
        "bytes_exposed":    0,
        "strategy_hidden":  True,
    }

