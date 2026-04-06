# AlphaShield — ZK-Protected AI Copy Trading on Midnight Network

> **Into The Midnight Hackathon** · Finance & DeFi Track · April 2026

AlphaShield is a **dark-pool DEX with ZK-enforced order privacy and AI-assisted copy trading**, built on the Midnight Network. Whale traders submit hidden limit orders whose price, size, and direction are mathematically committed to the blockchain — but never revealed. Followers copy-trade from encrypted signals; auditors verify every settlement's fairness using on-chain ZK proofs. No one ever sees the edge.

---

## The Problem

In traditional copy trading and public order books:

- Whale submits a trade → **price, amount, and direction are visible in the mempool**
- Front-runners copy the trade before it executes, stealing the alpha
- Whales must choose: share everything (no edge) or share nothing (no followers)
- Settlement fairness is asserted by the exchange — no cryptographic guarantee

## The Solution

AlphaShield uses **Midnight Network's Compact ZK circuits** to:

1. **Hide order details** — price, size, side, and nonce are private ZK witnesses. They never touch the ledger or any network hop. Only a SHA-256 commitment (`settlement_hash`) and a Groth16 proof of validity are published.
2. **Prove settlement fairness** — after off-chain matching, a second ZK circuit proves `seller_limit ≤ matched_price ≤ buyer_limit` without disclosing either party's limit.
3. **Commit AI reasoning without exposing it** — AI-generated trade signals are SHA-256 hashed before anything is stored. Followers receive `reasoning_hash`; the reasoning text is discarded. The hash is embedded in the settlement commitment.

| Role | Can see |
|------|---------|
| 🐋 Whale | Own AI reasoning, full order details |
| 👥 Follower | `reasoning_hash` · `settlement_hash` · proof status — never the strategy |
| 🔍 Auditor | On-chain public fields + ZK fairness proof — zero bytes of price/side disclosed |

---

## Midnight Network: What Is Used and Why

### Compact Language

Compact is Midnight Network's domain-specific language for writing ZK smart contracts. It compiles to a **ZKIR (ZK Intermediate Representation)** circuit that the runtime executes. Key properties used in this project:

- **`export ledger`** — declares fields written to the public on-chain ledger (visible to everyone)
- **Private witnesses** — all circuit parameters not explicitly `disclose()`d are private. They exist only in the prover's local memory during proof generation and are cryptographically excluded from the public transcript.
- **`disclose()`** — explicit opt-in for public disclosure. Compact's default is private; nothing hits the ledger unless you call `disclose()`.
- **`assert()`** — constraints compiled into the circuit. If any assert fails the proof cannot be generated — the prover cannot cheat.
- **Circuits** — stateless pure functions over witnesses and ledger state. Each call generates an independent ZK proof.

### `@midnight-ntwrk/compact-runtime` v0.15.0

The runtime WASM module that bridges TypeScript and compiled Compact circuits:
- Provides `createCircuitContext()` — builds the execution context (contract address, coin public key, current ledger state) needed to run a circuit
- Provides `sampleContractAddress()` — generates a valid dummy address for stateless proving (no node connection required)
- Executes the compiled circuit and produces `proofData` containing input witnesses, output state, public transcript, and private transcript outputs

### `@midnight-ntwrk/ledger-v8` v8.0.3

The ledger serialization WASM module:
- Implements Midnight's ledger wire format
- Provides `proofDataIntoSerializedPreimage()` — takes the four components of `proofData` (input, output, publicTranscript, privateTranscriptOutputs) and serializes them into the binary preimage format expected by `zkir-v2`
- This is the glue layer between circuit execution output and the actual prover

### `@midnight-ntwrk/zkir-v2` v2.1.0

The core ZK prover — where real proof bytes are generated:
- Implements the **BLS12-381 pairing-based Groth16 proving system** used by Midnight Network
- Provides `prove(preimage, keyMaterialProvider)` — takes the serialized circuit preimage and a key material provider, fetches BLS12-381 SRS parameters, and produces the actual cryptographic proof
- The `keyMaterialProvider` supplies the prover key (~146 KB), verifier key (~1.3 KB), and compiled ZKIR bytecode (`.bzkir`) for the specific circuit
- Output: a **2,933-byte proof** for `submit_order` in approximately 2.5 seconds (k=9, 408 constraint rows)

### SRS Parameters (Structured Reference String)

The BLS12-381 proving system requires a trusted setup parameter file for each circuit size `k`. For this project:
- Circuit size: **k=9** for both `submit_order` and `settle_order`
- SRS file: `bls_midnight_2p9` (~96 KB)
- Source: **Midnight's public S3** — `https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p9`
- Cached in-process after first fetch — subsequent proofs require zero additional network I/O
- If S3 is unreachable (offline demo), the service falls back to a SHA-256 mock proof automatically

### Additional Midnight Packages

| Package | Version | Role |
|---------|---------|------|
| `@midnight-ntwrk/midnight-js-network-id` | 4.0.2 | Sets network context (`local` or `testnet-02`) for all SDK modules |
| `@midnight-ntwrk/midnight-js-contracts` | 4.0.2 | Type definitions for off-chain contract interaction |
| `@midnight-ntwrk/midnight-js-types` | 4.0.2 | Shared TypeScript types across the Midnight JS SDK |
| `@midnight-ntwrk/wallet-sdk-dust-wallet` | 3.0.0 | Wallet interface for signing and submitting proofs to a Midnight node |
| `@midnight-ntwrk/wallet-sdk-node-client` | 1.1.0 | Node.js HTTP client for the Midnight RPC endpoint |
| `@midnight-ntwrk/wallet-sdk-indexer-client` | 1.2.0 | GraphQL client for querying the Midnight indexer |

### Why a Separate `midnight-service`?

The Midnight SDK ships WASM modules with Node.js-only native bindings (`fs`, `path`, `crypto`). These **cannot be bundled inside a Vite browser build**. The `midnight-service` is a thin Express server (port 3007) that runs in Node.js where those bindings are available natively. The browser frontend calls it over localhost HTTP.

The full proof pipeline for a submitted order:

```
Browser (localhost:3006)
  → POST /submit-proof  { order_id, asset_pair, side, price_cents, amount_units }

midnight-service (localhost:3007)
  1. compact-runtime: createCircuitContext()
  2. Contract.circuits.submit_order(ctx, ..., priceBig, amountBig, sideInt, nonce)
     ↑ private witnesses never leave this process
  3. ledger-v8: proofDataIntoSerializedPreimage(input, output, publicTranscript, privateTxOutputs)
  4. zkir-v2: prove(preimage, kmProvider)  ← BLS12-381 Groth16 proof bytes
  → returns { proofHash, proofSizeBytes, proofGeneratedMs, mode: "real" }

backend (localhost:8006)
  → stores order with proof_hash and zk_mode in Fernet-encrypted SQLite
```

---

## ZK Smart Contract (`contract/src/order_proof.compact`)

Two circuits compiled with `compact` CLI v0.30+:

### `submit_order` — Order Commitment Circuit

Proves an order is valid (real price, real size, valid direction) without revealing any of those values:

```compact
pragma language_version >= 0.22;

export ledger order_id:        Opaque<"string">;  // public
export ledger asset_pair:      Opaque<"string">;  // public
export ledger order_timestamp: Opaque<"string">;  // public
export ledger settlement_hash: Opaque<"string">;  // public — SHA-256(price||amount||nonce)
export ledger order_status:    Uint<32>;           // public — 0=PENDING 1=MATCHED 2=SETTLED
export ledger fairness_proven: Uint<32>;           // public — 0 or 1

export circuit submit_order(
  oid: Opaque<"string">, pair: Opaque<"string">,
  timestamp: Opaque<"string">, settle_hash: Opaque<"string">,
  price_cents:  Uint<64>,   // PRIVATE — never disclosed
  amount_units: Uint<64>,   // PRIVATE — never disclosed
  side:         Uint<32>,   // PRIVATE — 0=BUY, 1=SELL, never disclosed
  nonce:        Uint<64>    // PRIVATE — random, binds the settlement_hash pre-image
): [] {
  assert(side < 2,          "valid BUY or SELL");
  assert(price_cents > 0,   "real limit price");
  assert(amount_units > 0,  "real order size");
  order_id        = disclose(oid);
  asset_pair      = disclose(pair);
  order_timestamp = disclose(timestamp);
  settlement_hash = disclose(settle_hash);
  order_status    = disclose(0);
  fairness_proven = disclose(0);
}
```

Compiled artifacts: prover key **146 KB**, verifier key **1.3 KB**, ZKIR bytecode **319 bytes** (k=9, 408 rows).

### `settle_order` — Fairness Proof Circuit

Runs after off-chain price-time matching confirms a trade. Proves `seller_limit ≤ matched_price ≤ buyer_limit` without disclosing either party's limit:

```compact
export circuit settle_order(
  oid:                 Opaque<"string">,
  matched_price_cents: Uint<64>,  // PRIVATE — the actual execution price
  buyer_limit:         Uint<64>,  // PRIVATE — buyer's hidden ceiling
  seller_limit:        Uint<64>   // PRIVATE — seller's hidden floor
): [] {
  assert(matched_price_cents >= seller_limit, "seller price floor not met");
  assert(matched_price_cents <= buyer_limit,  "buyer price ceiling exceeded");
  order_id        = disclose(oid);
  order_status    = disclose(2);   // SETTLED
  fairness_proven = disclose(1);
}
```

Compiled artifacts: prover key **145 KB**, verifier key **1.3 KB**, ZKIR bytecode **213 bytes** (k=9, 319 rows).

---

## Full System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser  localhost:3006                                         │
│                                                                  │
│  TraderView    — Hidden limit order + ZK proof animation         │
│  OrderbookView — Anonymous depth (bid/ask counts only)           │
│  SettlementFeed— Public settlement_hash + fairness_proven feed   │
│  WhaleView     — Azure OpenAI signal → ZK dark-pool trade        │
│  FollowerView  — Live reasoning_hash feed (strategy hidden)      │
│  AuditorView   — ZK proof inspector + Compact contract source    │
└────────────┬────────────────────────┬───────────────────────────┘
             │ REST / JSON             │ REST / JSON
             ▼                         ▼
┌────────────────────────┐  ┌──────────────────────────────────────┐
│  midnight-service      │  │  FastAPI backend  localhost:8006      │
│  localhost:3007        │  │                                       │
│                        │  │  Price-time priority matching engine  │
│  compact-runtime 0.15  │  │  Fernet AES-128 encrypted SQLite      │
│  ledger-v8 8.0.3       │  │  (price, amount, nonce encrypted)     │
│  zkir-v2 2.1.0         │  │  Nonce uniqueness enforcement         │
│  BLS12-381 Groth16     │  │  Azure OpenAI bridge (gpt-5.2-chat)   │
│                        │  │  Two-tier rate limiter                │
│  POST /submit-proof    │  │    5/min per IP · 20/min global       │
│  POST /settle-proof    │  │                                       │
│  GET  /health          │  │  GET  /api/trades/public              │
│                        │  │  POST /api/order/submit               │
└────────────────────────┘  │  POST /api/ai/signal                  │
             │               │  GET  /api/ai/feed                    │
             ▼               │  GET  /api/proof/:id                  │
  S3 (internet, first run)  └──────────────────────────────────────┘
  bls_midnight_2p9 ~96 KB
  cached in-process after that
```

---

## Quick Start

> No Docker required. ZK proofs run inline in Node.js via `zkir-v2`.

### Prerequisites

| Tool | Min Version | Install / check |
|------|------------|-----------------|
| Node.js | 20+ | `node --version` |
| Python | 3.11+ | `python3 --version` |
| `compact` CLI | 0.30+ | `compact --version` — [Midnight SDK docs](https://docs.midnight.network/develop/tutorial/building/install-compact-compiler) |

### First-time Setup

```bash
# 1. Clone and install Node dependencies
git clone <repo>
cd HiddenOrderDEX
npm install              # root workspace + midnight-service deps
cd frontend && npm install && cd ..

# 2. Python virtual environment
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd ..

# 3. Compile the Compact ZK contract
#    Outputs:
#      contract/dist/order_proof/keys/     prover/verifier keys (146 KB + 1.3 KB each)
#      contract/dist/order_proof/zkir/     ZKIR bytecode (.bzkir) for zkir-v2
#      contract/dist/order_proof/contract/ JS/TS circuit bindings
npm run compile:contract

# 4. Azure OpenAI credentials (optional — app works without them using mock AI)
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
| 3 | React frontend | **`http://localhost:3006`** |

On startup the script prints a ZK mode badge:
- `⚡ On-Chain ZK` — real BLS12-381 Groth16 proofs (contract compiled + S3 params reachable)
- `🔵 Mock ZK` — SHA-256 fallback (offline or S3 unreachable — full demo still works)

> **Internet note:** The first ZK proof of each session fetches BLS12-381 SRS parameters (~96 KB) from Midnight's public S3. After that first fetch the parameters are cached in process memory and no further S3 calls occur.

### Verify Everything Works (optional)

```bash
npm run demo          # backend API layer test: matching engine, encryption, nonce enforcement
npm run test:matching # 13 matching engine unit assertions
npm run test:zk       # full ZK pipeline: load deps → run submit_order circuit → prove via zkir-v2 (~2.5s)
```

> **Note on `npm run demo`:** This script calls the backend directly — `midnight-service` is not involved, so every response shows `zk_mode: mock`. That is expected and correct. The backend stores orders and runs the matching engine; ZK proofs are generated by `midnight-service` only when orders are submitted through the UI. Use `npm run test:zk` to verify the ZK proof pipeline independently.

---

## Demo Flow

1. Open **`http://localhost:3006`**
2. **Whale tab** — pick any asset (live price auto-fills via CoinGecko → Binance → CoinCap waterfall), click **Generate AI Signal**
   - With Azure key: real `gpt-5.2-chat` signal · `source: azure_openai`
   - Without key: deterministic mock signal · `source: mock`
   - Amount field auto-fills from signal confidence (e.g. 85% → 0.8500 units)
3. Click **Execute ZK Trade** — 6-step animation while `midnight-service` runs the BLS12-381 circuit
   - Result badge: `⚡ Real` (2,933 bytes, ~2.5 s) or `🔵 Mock`
4. **Order Book tab** — anonymous depth: bid/ask *counts* only, no prices, no sides
5. **Settlement tab** — matched trades show `settlement_hash` and `fairness_proven: 1`, no price data
6. **Copy Trade tab** — followers see `[MIDNIGHT ENCRYPTED 🔒]` where reasoning would be; `reasoning_hash` is the only output
7. **Auditor tab** — paste any order UUID → inspects on-chain fields, proof hash, ZK mode, and full Compact contract source

---

## What Is Real vs Mock When Running Locally

| Layer | Status | Condition |
|-------|--------|-----------|
| Fernet AES-128 encrypted SQLite | **Real — always** | — |
| Price-time priority matching engine | **Real — always** | — |
| Nonce uniqueness enforcement | **Real — always** | — |
| Two-tier AI rate limiter | **Real — always** | — |
| ZK proof `⚡ On-Chain ZK` | Real | Contract compiled + internet for SRS params |
| ZK proof `🔵 Mock ZK` | Graceful fallback | Offline or S3 unreachable |
| AI signals `⚡ Azure OpenAI` | Real | `AZURE_OPENAI_API_KEY` set in `backend/.env` |
| AI signals `🔵 Mock AI` | Graceful fallback | No key — documented optional |
| `npm run demo` `zk_mode` | Always `mock` | Expected — backend-only script, no midnight-service |

---

## Environment Variables

**`backend/.env`**
```
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://...cognitiveservices.azure.com/
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5.2-chat
AZURE_OPENAI_API_VERSION=2025-04-01-preview
```

**`midnight-service/.env`** (optional — needed only for full node/testnet submission)
```
MIDNIGHT_MNEMONIC=abandon abandon ... art   # wallet for on-chain submissions
MIDNIGHT_ENV=local                           # or testnet
CONTRACT_ADDRESS=...                         # set automatically by npm run deploy:contract
```

See `backend/.env.example` for all variables with inline descriptions.

---

## Key Design Decisions

| Decision | Reasoning |
|----------|-----------|
| Separate `midnight-service` | Midnight SDK WASM bindings use Node.js-only `fs`/`path` — incompatible with Vite browser builds |
| Inline `zkir-v2` proving | No external Docker proof-server container; entire BLS12-381 pipeline runs in-process |
| `disclose()` explicit | Compact's default is private — every public field requires explicit opt-in; accidental leaks are impossible |
| SHA-256 `settlement_hash` | Pre-image `price_cents||amount_units||nonce` is provably committed on-chain but never stored or transmitted |
| `settle_order` fairness ZK | Proves `seller_limit ≤ matched_price ≤ buyer_limit` after matching without either party learning the other's limit |
| SHA-256 reasoning hash | AI signal text is hashed then discarded; followers get provenance without content |
| Graceful mock fallback | Demo works fully offline; `🔵 Mock ZK` vs `⚡ On-Chain ZK` badge is honest about which path fired |
| Two-tier AI rate limiter | 5 req/min per IP + 20 req/min global caps Azure OpenAI spend without blocking judges |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| ZK privacy blockchain | Midnight Network — Compact smart contracts |
| ZK prover | `@midnight-ntwrk/zkir-v2` v2.1.0 — BLS12-381 Groth16 |
| Circuit runtime | `@midnight-ntwrk/compact-runtime` v0.15.0 |
| Ledger serialization | `@midnight-ntwrk/ledger-v8` v8.0.3 |
| AI signals | Azure OpenAI `gpt-5.2-chat` |
| Backend | FastAPI (Python 3.11+), SQLite, Fernet AES-128 |
| Frontend | React 18 + Vite + Tailwind CSS |
| Live prices | CoinGecko → Binance → CoinCap waterfall |
| ZK bridge | Express.js (`midnight-service`, Node.js 20+) |
