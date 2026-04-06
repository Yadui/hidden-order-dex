# HiddenOrderDEX / AlphaShield — Roadmap

> ZK-Protected Dark Pool DEX on Midnight Network  
> Into The Midnight Hackathon · Finance & DeFi Track · April 2026

---

## Phase 1 — Hackathon MVP

> Goal: end-to-end demo running locally with mock ZK proofs.

- [x] Compact contract with `submit_order` / `settle_order` ZK circuits and private witnesses
- [x] FastAPI matching engine — stores price/amount internally, never leaks them in API responses
- [x] Mock ZK fallback (SHA-256 hash) when proof server is unavailable
- [x] Midnight-service bridge (Node.js WASM ↔ Express)
- [x] React frontend: TraderView, OrderbookView, SettlementFeed tabs
- [x] `start.sh` multi-process launcher
- [x] Verify all three services start cleanly and communicate end-to-end
- [x] Smoke-test: submit order → auto-match → settle → appears in public feed

---

## Phase 2 — Real ZK Integration

> Goal: replace mock proofs with actual Midnight Network ZK proof generation.

- [x] Compile `order_proof.compact` → `contract/dist/` via `compact compile` (v0.30.0)
  - Produces `keys/submit_order.prover` (149 KB), `keys/submit_order.verifier`, `zkir/submit_order.bzkir`
  - Both circuits compiled: `submit_order` (k=9, 408 rows) · `settle_order` (k=9, 319 rows)
- [x] Wire `midnight-service` to load compiled contract via `@midnight-ntwrk/compact-runtime` (root `node_modules`) — `loadZKDeps()` reports `✅ contract_compiled: true`
- [x] Real proof path in `midnight-service`: builds circuit context → runs `submit_order` circuit → serializes preimage via `ledger-v8` → POSTs binary to proof server at `:6300` → returns real proof bytes + SHA-256 hash
- [x] `npm run compile:contract` script added to root `package.json`; `start.sh` auto-recompiles when source is newer than dist
- [x] `⚡ On-Chain ZK` vs `🔵 Mock ZK` badge in the frontend driven by `midnight.serviceZkMode` (from `/health`)
- [x] CORS on midnight-service tightened to an explicit allowlist (same `CORS_ORIGINS` env var as backend)
- [x] End-to-end real ZK proof generation — **no Docker proof server required**
  - `ghcr.io/midnight-ntwrk/proof-server` is private (authentication required)
  - Replaced with inline `zkir-v2.prove()` call inside `midnight-service`
  - `getParams(k=9)` fetches 96 KB SRS params from Midnight's public S3 bucket and caches in-process
  - Proof output: **2,933 bytes** in **2.5 seconds** — verified with `npm run test:zk`

---

## Phase 3 — Matching Engine Hardening

> Goal: production-grade order matching semantics.

- [x] Atomic match + settle — `_atomic_match_and_settle()` runs inside `submit_order` in a single db write; race condition eliminated
- [x] Price-time priority queue — `_sorted_asks` / `_sorted_bids` sort by (price, timestamp); FIFO within same price level
- [x] Partial fill support — `amount_remaining` tracked per order; one SELL can fill across multiple BUY orders (and vice versa)
- [x] `matched_price` committed inside `fill_hash` (SHA-256(matched_price||fill_qty||nonce)) — never returned in any API response
- [x] Unit tests: 4 scenarios × 13 assertions — all pass (`npm run test:matching`)

---

## Phase 4 — Security & Privacy Audit

> Goal: close known attack surfaces before testnet deployment.

- [x] Replace `allow_origins=["*"]` CORS with an explicit allowlist (env-configurable via `CORS_ORIGINS`)
- [x] Rate-limit `/api/order/submit` to prevent DoS / order-book spam (20 req/min per IP, in-process)
- [x] Migrate `orders.json` to SQLite with Fernet-encrypted sensitive fields at rest
  - `price`, `amount`, `amount_remaining`, `nonce` encrypted with AES-128-CBC + HMAC via `cryptography.Fernet`
  - Encryption key auto-generated and persisted to `backend/.env` (`ORDERS_ENCRYPTION_KEY`)
  - One-time migration path: `orders.json` → `orders.db` (renamed to `.bak`)
- [x] Enforce nonce uniqueness — `used_nonces` table with UNIQUE constraint; nonce stored as SHA-256 hash; `_db_create_order()` rejects replays with HTTP 409 in a single atomic transaction
- [x] Audit all `disclose()` calls — all private witnesses (`price_cents`, `amount_units`, `side`, `nonce` in `submit_order`; `matched_price_cents`, `buyer_limit`, `seller_limit` in `settle_order`) are provably kept off the ledger; only public fields disclosed

---

## Phase 5 — AlphaShield AI Copy-Trading Layer

> Goal: layer AI signal generation on top of the dark pool for the hackathon narrative.

- [x] `POST /api/ai/signal` — AI signal generation (Azure OpenAI + mock fallback); reasoning hashed, never stored
- [x] `reasoning_hash` ledger field (SHA-256 of AI reasoning text — committed on-chain via `submit_order`, never exposed)
- [x] `GET /api/ai/feed` — public feed of AI signal commitments (reasoning_hash only)
- [x] WhaleView — AI signal generation + ZK trade execution with 6-step proof animation
- [x] FollowerView — live encrypted trade feed with `[MIDNIGHT ENCRYPTED 🔒]` reasoning display
- [x] AuditorView — on-chain ZK proof verification + Compact contract source code inspector
- [x] Wire Azure OpenAI API key via `.env` (`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT_NAME`) — live signals confirmed working
- [x] WhaleView: live price from CoinGecko (`/api/v3/simple/price`) with graceful mock fallback + `● live` badge in UI

---

## Phase 6 — Testnet / Mainnet Deployment

> Goal: move off local Docker network onto Midnight testnet.

- [ ] Deploy to Midnight testnet (`MIDNIGHT_ENV=testnet` in `midnight-service/.env`)
- [ ] Publish `contract_address` in the UI and link to Midnight block explorer
- [ ] Browser wallet integration via the midnight-service bridge
- [ ] Complete `midnight-local-dev` Docker Compose setup and document in README

---

## Phase 7 — Polish & Post-Hackathon

> Goal: open-source quality and long-term maintainability.

- [ ] Unit tests for the matching engine (`_find_match`, partial fills, edge cases)
- [ ] Contract tests using the Midnight testing framework
- [ ] Frontend: responsive mobile layout, dark/light theme toggle
- [ ] Architecture documentation (sequence diagrams, ZK circuit diagrams)
- [ ] Open-source release prep (LICENSE, CONTRIBUTING.md, issue templates)
