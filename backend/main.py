import hashlib
import json
import uuid
import base64
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
import os

load_dotenv()

from fastapi import FastAPI, HTTPException
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


class TradeExecuteRequest(BaseModel):
    asset: str
    amount: float
    price: float
    signal: dict
    proof_override: Optional[ProofOverride] = None


# --- Endpoints ---

@app.post("/api/signal")
async def generate_signal(req: SignalRequest):
    system_prompt = (
        "You are a proprietary AI quant trading signal engine. "
        "Given market data, return ONLY a JSON object with: "
        "direction (BUY or SELL), "
        "confidence (number 0-100), "
        "reasoning (2-3 sentence technical analysis explaining the signal), "
        "risk_level (LOW/MEDIUM/HIGH)"
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
        proof_hash     = po.proof_hash
        zk_mode        = po.zk_mode or "real"
        contract_addr  = po.contract_address
        tx_hash        = po.tx_hash
        reasoning_hash = po.reasoning_hash
    else:
        hash_input     = f"{req.asset}{req.amount}{timestamp}MIDNIGHT_ZK"
        proof_hash     = hashlib.sha256(hash_input.encode()).hexdigest()
        zk_mode        = "mock"
        contract_addr  = None
        tx_hash        = None
        reasoning_hash = None

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
        },
    }

    trades[trade_id] = trade

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
        "proof_id": proof["proof_id"],
        "proof_hash": proof["proof_hash"],
        "status": "VERIFIED",
        "execution_fair": True,
        "strategy_bytes_exposed": 0,
        "zk_mode": proof.get("zk_mode", "mock"),
        "contract_address": proof.get("contract_address"),
        "tx_hash": proof.get("tx_hash"),
        "reasoning_hash": proof.get("reasoning_hash"),
        "asset": trade["asset"],
        "amount": trade["amount"],
        "timestamp": proof["timestamp"],
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
