# AlphaShield — ZK-Protected AI Copy Trading

> **Into The Midnight Hackathon** · Finance & DeFi Track · April 2026

AlphaShield lets institutional "whale" traders execute AI-generated trades while **cryptographically proving** their strategy is valid — without revealing *what* it is. Followers can copy-trade safely; auditors can verify every trade's fairness on-chain. No one ever sees the edge.

---

## The Problem

In traditional copy trading:
- Whale submits a trade → **everyone can see the reasoning** in the mempool
- Front-runners copy the trade *before* it executes, stealing the alpha
- Whales either share nothing (no followers) or share everything (no edge)

## The Solution

AlphaShield uses **Midnight Network's zero-knowledge proofs** to publish a *commitment* to a trade strategy without revealing the strategy itself.

| Who | What they see |
|-----|--------------|
| 🐋 Whale | Full AI reasoning, own strategy |
| 👥 Follower | Encrypted reasoning hash, verified ZK proof |
| 🔍 Auditor | On-chain proof of valid strategy, 0 bytes of strategy exposed |

---

## Architecture

```
Browser (localhost:3005)
  ├── WhaleView  — Azure OpenAI signal + ZK trade execution
  ├── FollowerView — Live encrypted trade feed
  └── AuditorView  — On-chain ZK proof verification + contract inspector

Backend (localhost:8005)
  └── FastAPI — Azure OpenAI signal generation, trade storage

Midnight Service (localhost:3006)
  ├── @midnight-ntwrk SDK (Node.js WASM)
  ├── Proof server (localhost:6300) — local ZK proof generation
  └── Midnight Network (local or testnet)
```

### Why a Separate Midnight Service?

The Midnight SDK uses WASM + Node.js-only modules (`fs`, `path`) that cannot run inside a Vite browser bundle. The `midnight-service` is a thin Express bridge that:
1. Loads the compiled Compact contract (`contract/dist/trade_proof/`)
2. Calls the proof server at `localhost:6300`
3. Falls back to SHA-256 mock proof gracefully if unavailable

---

## ZK Smart Contract (Compact)

Located at `contract/src/trade_proof.compact`:

```compact
pragma language_version >= 0.22;

export ledger trade_asset:       Opaque<"string">;
export ledger reasoning_hash:    Opaque<"string">;  // SHA-256 — reasoning text never disclosed
export ledger strategy_verified: Uint<32>;
export ledger bytes_exposed:     Uint<32>;          // always 0

export circuit submit_trade(
  asset: Opaque<"string">, timestamp: Opaque<"string">,
  amount: Opaque<"string">, r_hash: Opaque<"string">,
  direction: Uint<32>,    // PRIVATE — never leaves whale's machine
  confidence: Uint<32>    // PRIVATE — never leaves whale's machine
): [] {
  assert(direction < 2, "valid BUY (1) or SELL (0) signal");
  assert(confidence > 0, "whale holds a real position");
  ...
}
```

`direction` and `confidence` are **private witnesses** — the ZK proof guarantees the trade is valid without disclosing them.

---

## Quick Start

### Prerequisites
- Python 3.11+ with virtualenv
- Node.js 20+
- Docker (for Midnight local network)

### 1. Start the Midnight local network
```bash
cd midnight-local-dev
docker compose -f standalone.yml up -d
```

### 2. Start all services at once
```bash
./start.sh
```

This opens three Warp terminal tabs:
- `uvicorn main:app --port 8005` — FastAPI backend
- `node midnight-service/index.js` — Midnight bridge service  
- `npm run dev` — React frontend at http://localhost:3005

### 3. Compile the contract (first time only)
```bash
compact compile contract/src/trade_proof.compact contract/dist/trade_proof
```

---

## Demo Flow

1. **Toggle Midnight OFF** → see how strategies are fully exposed (front-running risk warning)
2. **Toggle Midnight ON** → protection activated
3. **Whale tab** → pick ETH, live price auto-fills from CoinGecko
4. **Generate Signal** → Azure OpenAI analyzes RSI + volume, returns BUY/SELL with reasoning
5. **Execute Trade** → ZK proof generated (6-step animation), submitted to Midnight
6. **Follower tab** → see the trade with encrypted reasoning `[MIDNIGHT ENCRYPTED 🔒]`
7. **Auditor tab** → click "Verify Proof", inspect on-chain fields, read the Compact contract source

---

## Environment Variables

**`backend/.env`**
```
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://...
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5.2-chat
AZURE_OPENAI_API_VERSION=2025-04-01-preview
```

**`midnight-service/.env`**
```
MIDNIGHT_MNEMONIC=abandon abandon ... art   # genesis wallet from accounts.example.json
MIDNIGHT_ENV=local                           # or testnet
```

---

## Key Design Decisions

| Decision | Reasoning |
|----------|-----------|
| Separate `midnight-service` | Midnight SDK WASM incompatible with Vite browser bundles |
| Mock ZK fallback | Demo works even without full Midnight stack; `🔵 Mock ZK` vs `⚡ On-Chain ZK` badge |
| `disclose()` explicit disclosure | Compact default is private; only whitelisted fields hit the ledger |
| SHA-256 reasoning hash | Reasoning text committed on-chain without exposure |
| `useLocalStorage` for all state | Page reloads preserve last signal + trade; Start Over clears everything |
| CSS `hidden` tab switching | All tabs stay mounted; switching preserves scroll + transient state |

---

## Tech Stack

- **Midnight Network** — ZK privacy blockchain (Compact smart contracts, proof server)
- **Azure OpenAI** — `gpt-5.2-chat` trading signal generation
- **FastAPI** — Python backend, trade storage
- **React + Vite + Tailwind** — Frontend
- **CoinGecko API** — Live crypto prices (no API key required)
