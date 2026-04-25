# hidden-order-dex

Privacy-preserving transaction system with ZK-enforced order validity, off-chain matching, and verifiable settlement fairness.

---

## What is implemented today

- ZK commitment circuit (`submit_order`) enforcing valid price, size, and direction without disclosure
- ZK settlement circuit (`settle_order`) proving `seller_limit ≤ matched_price ≤ buyer_limit`
- Off-chain price-time priority matching engine
- Encrypted order storage (Fernet AES-128)
- AI-assisted signal generation with hash-committed reasoning
- End-to-end proof pipeline using Groth16 (BLS12-381) via `zkir-v2`
- Frontend demonstrating full lifecycle: signal → order → proof → settlement → audit

System runs locally with real proof generation (~2.5s per proof) or deterministic mock fallback.

## What is non-trivial here

- **Private order enforcement via ZK**  
  Orders are validated without ever exposing price, size, or direction to the ledger or network.
- **Verifiable fairness without price disclosure**  
  Settlement proves matching correctness (`seller ≤ price ≤ buyer`) without revealing either limit.
- **End-to-end proof pipeline integration**  
  Circuit execution -> serialization -> Groth16 proving -> backend persistence runs as a single flow.
- **Separation of execution domains**  
  ZK proving runs in a dedicated Node.js service due to WASM constraints, while matching and storage remain in Python.
- **Hash-committed AI reasoning**  
  AI signals are provably linked to trades without exposing strategy content.
- **Graceful degradation**  
  System maintains identical behavior under real ZK and mock modes with explicit signaling.

## Full System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser  localhost:3006                                       │
│                                                                │
│  TraderView    - Hidden limit order + ZK proof animation       │
│  OrderbookView - Anonymous depth (bid/ask counts only)         │
│  SettlementFeed- Public settlement_hash + fairness_proven feed │
│  WhaleView     - AI signal -> ZK dark-pool trade               │
│  FollowerView  - Live reasoning_hash feed (strategy hidden)    │
│  AuditorView   - ZK proof inspector + Compact contract source  │
└────────────┬────────────────────────┬───────────────────────────┘
             │ REST / JSON             │ REST / JSON
             ▼                         ▼
┌────────────────────────┐  ┌──────────────────────────────────────┐
│  midnight-service      │  │  FastAPI backend  localhost:8006    │
│  localhost:3007        │  │                                      │
│                        │  │  Price-time priority matching engine │
│  compact-runtime 0.15  │  │  Fernet AES-128 encrypted SQLite     │
│  ledger-v8 8.0.3       │  │  Nonce uniqueness enforcement        │
│  zkir-v2 2.1.0         │  │  Azure OpenAI bridge                 │
│  Groth16 prover        │  │  Two-tier rate limiter               │
│                        │  │                                      │
│  POST /submit-proof    │  │  GET  /api/trades/public             │
│  POST /settle-proof    │  │  POST /api/order/submit              │
│  GET  /health          │  │  POST /api/ai/signal                 │
└────────────────────────┘  │  GET  /api/ai/feed                   │
             │               │  GET  /api/proof/:id                │
             ▼               └──────────────────────────────────────┘
  S3 (first run only)
  bls_midnight_2p9
  cached after initial fetch
```

## Failure handling and tradeoffs

- **Off-chain matching trust boundary**  
  Matching engine is not ZK-proven; fairness is enforced only at settlement time.
- **Proof latency (~2.5s)**  
  Limits throughput; system is not optimized for high-frequency execution.
- **SRS dependency (first-run network call)**  
  Requires fetching BLS parameters once; fallback mode avoids hard failure.
- **No front-running resistance at network layer**  
  Privacy is enforced via hidden orders, not mempool-level protection.
- **AI signals are not verified for correctness**  
  Only their linkage to trades is cryptographically committed.
- **Single-node backend**  
  No distributed coordination or consensus layer implemented.

## System boundaries

- ZK circuits enforce:
  - order validity
  - settlement fairness
- Off-chain system handles:
  - order matching
  - storage
  - AI signal generation
- Trusted components:
  - matching engine correctness (partially mitigated by settlement proof)
  - backend execution
- Untrusted / verifiable:
  - order commitments
  - settlement correctness

---

## Quick Start

> No Docker required. ZK proofs run inline in Node.js via `zkir-v2`.

### Prerequisites

| Tool | Min Version | Install / check |
|------|------------|-----------------|
| Node.js | 20+ | `node --version` |
| Python | 3.11+ | `python3 --version` |
| `compact` CLI | 0.30+ | `compact --version` |

### First-time Setup

```bash
# 1. Clone and install Node dependencies
git clone https://github.com/Yadui/hidden-order-dex.git
cd hidden-order-dex
npm install
cd frontend && npm install && cd ..

# 2. Python virtual environment
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# 3. Compile the Compact ZK contract
npm run compile:contract

# 4. Azure OpenAI credentials (optional)
cat > backend/.env << 'ENV'
AZURE_OPENAI_API_KEY=your_key_here
AZURE_OPENAI_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5.2-chat
AZURE_OPENAI_API_VERSION=2025-04-01-preview
ENV
```

### Run

```bash
./start.sh
```

Opens three Terminal.app tabs and polls until all services are healthy:

| Tab | Service | Port |
|-----|---------|------|
| 1 | FastAPI backend | `http://localhost:8006` |
| 2 | Midnight ZK bridge | `http://localhost:3007` |
| 3 | React frontend | `http://localhost:3006` |

On startup the script prints a ZK mode badge:

- `⚡ On-Chain ZK` - real BLS12-381 Groth16 proofs (contract compiled + SRS reachable)
- `🔵 Mock ZK` - deterministic fallback (offline or SRS unreachable)

### Verify Everything Works

```bash
npm run demo
npm run test:matching
npm run test:zk
```

`npm run demo` exercises the backend path only, so it reports `zk_mode: mock` by design. Use `npm run test:zk` to verify the proving pipeline directly.

## Demo Flow

1. Open `http://localhost:3006`
2. Pick an asset and generate an AI signal
3. Submit an order and trigger proof generation
4. Watch the order move through proof, storage, and settlement states
5. Inspect settlement output and audit metadata in the UI

## What Is Real vs Mock When Running Locally

| Layer | Status | Condition |
|-------|--------|-----------|
| Fernet AES-128 encrypted SQLite | **Real - always** | - |
| Price-time priority matching engine | **Real - always** | - |
| Nonce uniqueness enforcement | **Real - always** | - |
| Two-tier AI rate limiter | **Real - always** | - |
| ZK proof `⚡ On-Chain ZK` | Real | Contract compiled + internet for SRS params |
| ZK proof `🔵 Mock ZK` | Graceful fallback | Offline or SRS unreachable |
| AI signals `⚡ Azure OpenAI` | Real | `AZURE_OPENAI_API_KEY` set in `backend/.env` |
| AI signals `🔵 Mock AI` | Graceful fallback | No key - documented optional |
| `npm run demo` `zk_mode` | Always `mock` | Expected - backend-only script, no midnight-service |

---

## ZK Smart Contract (`contract/src/order_proof.compact`)

Two circuits compiled with `compact` CLI v0.30+ define the verifiable core of the system.

### `submit_order` - Order Commitment Circuit

Proves an order is valid without revealing price, size, side, or nonce:

```compact
pragma language_version >= 0.22;

export ledger order_id:        Opaque<"string">;
export ledger asset_pair:      Opaque<"string">;
export ledger order_timestamp: Opaque<"string">;
export ledger settlement_hash: Opaque<"string">;
export ledger order_status:    Uint<32>;
export ledger fairness_proven: Uint<32>;

export circuit submit_order(
  oid: Opaque<"string">, pair: Opaque<"string">,
  timestamp: Opaque<"string">, settle_hash: Opaque<"string">,
  price_cents: Uint<64>,
  amount_units: Uint<64>,
  side: Uint<32>,
  nonce: Uint<64>
): [] {
  assert(side < 2, "valid BUY or SELL");
  assert(price_cents > 0, "real limit price");
  assert(amount_units > 0, "real order size");
  order_id = disclose(oid);
  asset_pair = disclose(pair);
  order_timestamp = disclose(timestamp);
  settlement_hash = disclose(settle_hash);
  order_status = disclose(0);
  fairness_proven = disclose(0);
}
```

Compiled artifacts are approximately 146 KB for the prover key, 1.3 KB for the verifier key, and 319 bytes for ZKIR bytecode.

### `settle_order` - Fairness Proof Circuit

Runs after matching and proves `seller_limit ≤ matched_price ≤ buyer_limit` without disclosing either party's limit:

```compact
export circuit settle_order(
  oid: Opaque<"string">,
  matched_price_cents: Uint<64>,
  buyer_limit: Uint<64>,
  seller_limit: Uint<64>
): [] {
  assert(matched_price_cents >= seller_limit, "seller price floor not met");
  assert(matched_price_cents <= buyer_limit, "buyer price ceiling exceeded");
  order_id = disclose(oid);
  order_status = disclose(2);
  fairness_proven = disclose(1);
}
```

Compiled artifacts are approximately 145 KB for the prover key, 1.3 KB for the verifier key, and 213 bytes for ZKIR bytecode.

## Midnight proving details

### Compact language

- `export ledger` declares the public fields written on-chain.
- Witnesses remain private unless explicitly `disclose()`d.
- `assert()` statements become proof constraints, so invalid inputs cannot produce a proof.

### Proof pipeline

- `@midnight-ntwrk/compact-runtime` executes compiled circuits and emits proof data.
- `@midnight-ntwrk/ledger-v8` serializes that proof data into the prover preimage.
- `@midnight-ntwrk/zkir-v2` generates the Groth16 proof over BLS12-381.
- `midnight-service` exists because these WASM modules require a dedicated Node.js runtime.

### SRS parameters

- Both circuits currently use size `k=9`.
- The first real proof fetches `bls_midnight_2p9` (~96 KB) from Midnight's public S3.
- The SRS is cached in-process after the first fetch.
- If the fetch fails, the app drops to deterministic mock mode instead of hard failing.

### Core packages

| Package | Role |
|---------|------|
| `@midnight-ntwrk/compact-runtime` | Circuit execution and proof data generation |
| `@midnight-ntwrk/ledger-v8` | Proof preimage serialization |
| `@midnight-ntwrk/zkir-v2` | Groth16 proof generation |
| `@midnight-ntwrk/midnight-js-network-id` | Network targeting for Midnight services |
| `@midnight-ntwrk/wallet-sdk-node-client` | Node-side RPC integration |

## Environment Variables

`backend/.env`

```env
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://...cognitiveservices.azure.com/
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5.2-chat
AZURE_OPENAI_API_VERSION=2025-04-01-preview
```

`midnight-service/.env`

```env
MIDNIGHT_MNEMONIC=abandon abandon ... art
MIDNIGHT_ENV=local
CONTRACT_ADDRESS=...
```

See `backend/.env.example` for the full local configuration surface.

## Key Design Decisions

| Decision | Reasoning |
|----------|-----------|
| Separate `midnight-service` | Midnight SDK WASM bindings use Node.js-only `fs`/`path`, so proving is isolated from the frontend and Python backend |
| Inline `zkir-v2` proving | No external proof server is required during normal local runs |
| `disclose()` explicitness | Public ledger state is opt-in, which reduces accidental leakage |
| SHA-256 `settlement_hash` | Commits order details without exposing the underlying values |
| Settlement fairness proof | Verifies `seller_limit ≤ matched_price ≤ buyer_limit` without disclosing either bound |
| Hash-committed AI reasoning | Links signals to trades without exposing strategy text |
| Graceful mock fallback | Preserves the full product flow when proving dependencies are unavailable |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| ZK privacy blockchain | Midnight Network |
| ZK prover | `@midnight-ntwrk/zkir-v2` v2.1.0 |
| Circuit runtime | `@midnight-ntwrk/compact-runtime` v0.15.0 |
| Ledger serialization | `@midnight-ntwrk/ledger-v8` v8.0.3 |
| AI signals | Azure OpenAI |
| Backend | FastAPI, SQLite, Fernet AES-128 |
| Frontend | React 18 + Vite + Tailwind CSS |
| ZK bridge | Express.js (`midnight-service`) |

## Context

Built for Midnight Network Hackathon (April 2026)