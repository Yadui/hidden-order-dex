// ─── HiddenOrder DEX Midnight Service ───────────────────────────────────────────
// Node.js middleware that bridges the React frontend and the Midnight Network.
//
// Why a separate service?
//   The Midnight SDK ships WASM + Node.js-only modules (fs, path, crypto) that
//   cannot be bundled inside a Vite browser build. This service runs in Node.js
//   where those modules are available natively.
//
// Architecture:
//   Browser (frontend:3006)
//     → calls this service (midnight-service:3007)
//   This service
//     → @midnight-ntwrk/* SDK (WASM, Node.js)
//     → Proof server (localhost:6301) — always local, privacy requirement
//     → Midnight testnet or local node
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id'

// ── __dir must be defined before loadZKDeps uses it ───────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT   = resolve(__dir, '..')

// ── Deployed contract address (set by scripts/deploy-contract.mjs) ────────────
function _loadContractAddress() {
  // 1. Prefer env var (set in .env by deploy-contract.mjs)
  if (process.env.CONTRACT_ADDRESS) return process.env.CONTRACT_ADDRESS
  // 2. Fall back to contract/deployed-address.json
  const addrFile = resolve(ROOT, 'contract', 'deployed-address.json')
  if (!existsSync(addrFile)) return null
  try {
    const data = JSON.parse(readFileSync(addrFile, 'utf8'))
    const env  = process.env.MIDNIGHT_ENV ?? 'local'
    return data[env]?.contractAddress ?? null
  } catch { return null }
}
let _contractAddress = _loadContractAddress()

// ── ZK proof imports ──────────────────────────────────────────────────────────
// Loaded lazily to avoid crashing the server if something is missing.
let _zkReady = null  // null=unchecked, true/false after first attempt
let _zkDeps  = null

// ── Inline key-material provider (zkir-v2 needs this to run proofs) ──────────
// getParams(k): fetches SRS params from Midnight's public S3 bucket (96 KB for k=9).
// lookupKey:    returns prover/verifier/ir from compiled contract dist/ on disk.
// Both are cached in-process after first fetch.
const _paramsCache    = new Map()  // k -> Uint8Array

async function _makeKmProvider(keyMaterial) {
  return {
    lookupKey: async (_loc) => ({
      proverKey:   new Uint8Array(keyMaterial.proverKey),
      verifierKey: new Uint8Array(keyMaterial.verifierKey),
      ir:          new Uint8Array(keyMaterial.ir),
    }),
    getParams: async (k) => {
      if (_paramsCache.has(k)) return _paramsCache.get(k)
      const S3 = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com'
      console.log(`[ZK] Fetching SRS params k=${k} from S3…`)
      const resp = await fetch(`${S3}/bls_midnight_2p${k}`, { signal: AbortSignal.timeout(30000) })
      if (!resp.ok) throw new Error(`S3 params fetch failed: ${resp.status}`)
      const buf = new Uint8Array(await resp.arrayBuffer())
      console.log(`[ZK] Cached SRS params k=${k} (${buf.length} bytes)`)
      _paramsCache.set(k, buf)
      return buf
    },
  }
}

async function loadZKDeps() {
  if (_zkReady !== null) return _zkReady
  try {
    const ROOT = resolve(__dir, '..')

    // All three WASM modules must use the same shared WASM heap.
    // compact-runtime (root) re-exports from onchain-runtime-v3 (root).
    // ledger-v8 (midnight-service) re-exports its own WASM.
    // Use the _fs.js variants for Node.js (not the browser _bg.js versions).
    const [runtimeMod, ledgerMod, contractMod, zkirMod] = await Promise.all([
      import(resolve(ROOT, 'node_modules/@midnight-ntwrk/compact-runtime/dist/index.js')),
      import(resolve(ROOT, 'midnight-service/node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_fs.js')),
      import(resolve(ROOT, 'contract/dist/order_proof/contract/index.js')),
      import(resolve(ROOT, 'midnight-service/node_modules/@midnight-ntwrk/zkir-v2/midnight_zkir_wasm_fs.js')),
    ])

    const KEYS = resolve(ROOT, 'contract/dist/order_proof/keys')
    const ZKIR = resolve(ROOT, 'contract/dist/order_proof/zkir')

    _zkDeps = {
      runtime:  runtimeMod,
      ledger:   ledgerMod,
      zkir:     zkirMod,
      Contract: contractMod.Contract,
      keyMaterial: {
        proverKey:   readFileSync(resolve(KEYS, 'submit_order.prover')),
        verifierKey: readFileSync(resolve(KEYS, 'submit_order.verifier')),
        ir:          readFileSync(resolve(ZKIR,  'submit_order.bzkir')),
      },
      settleKeyMaterial: {
        proverKey:   readFileSync(resolve(KEYS, 'settle_order.prover')),
        verifierKey: readFileSync(resolve(KEYS, 'settle_order.verifier')),
        ir:          readFileSync(resolve(ZKIR,  'settle_order.bzkir')),
      },
    }
    console.log('[ZK] ✅ Proof dependencies loaded — submit prover:', _zkDeps.keyMaterial.proverKey.length, 'bytes, settle prover:', _zkDeps.settleKeyMaterial.proverKey.length, 'bytes')
    _zkReady = true
  } catch (e) {
    console.warn('[ZK] Failed to load proof dependencies:', e.message)
    _zkReady = false
  }
  return _zkReady
}
try {
  const envPath = resolve(__dir, '.env')
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = val
  }
} catch { /* no .env is fine */ }

const app = express()
const _MS_ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:3006,http://127.0.0.1:3006,http://localhost:5173,http://127.0.0.1:5173').split(',')
app.use(cors({ origin: _MS_ALLOWED_ORIGINS }))
app.use(express.json())

// ── Network config ────────────────────────────────────────────────────────────
const MIDNIGHT_ENV = process.env.MIDNIGHT_ENV ?? 'preview'
const NETWORK_CONFIGS = {
  preview: {
    networkId:   'preview',
    indexer:     'https://indexer.preview.midnight.network/api/v3/graphql',
    indexerWS:   'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
    node:        'wss://rpc.preview.midnight.network',
    proofServer: process.env.PROOF_SERVER_URL ?? 'http://localhost:6300',
  },
  preprod: {
    networkId:   'preprod',
    indexer:     'https://indexer.preprod.midnight.network/api/v3/graphql',
    indexerWS:   'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    node:        'wss://rpc.preprod.midnight.network',
    proofServer: process.env.PROOF_SERVER_URL ?? 'http://localhost:6300',
  },
}
const netConfig = NETWORK_CONFIGS[MIDNIGHT_ENV]
setNetworkId(netConfig.networkId)

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const zkReady = await loadZKDeps()
  // S3 params availability — quick HEAD check with short timeout
  let paramsReachable = false
  try {
    const r = await fetch('https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p9', {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
    })
    paramsReachable = r.ok
  } catch { /* offline is fine — params are cached after first fetch */ }

  // params_cached = k=9 already in memory (no further S3 calls needed)
  const paramsCached = _paramsCache.has(9)

  res.json({
    status: 'ok',
    midnight_env: MIDNIGHT_ENV,
    network_id: netConfig.networkId,
    contract_compiled: zkReady,
    contract_address: _contractAddress ?? null,
    params_s3_reachable: paramsReachable,
    params_cached: paramsCached,
    // real ZK proofs work if contract is compiled AND (params cached OR S3 reachable)
    zk_mode: zkReady && (paramsCached || paramsReachable) ? 'real' : 'mock',
    proof_server: 'inline (zkir-v2 + S3 params — no external server required)',
  })
})

// ── POST /submit-proof ────────────────────────────────────────────────────────
// Generates a real ZK proof via the local proof server (port 6301).
// Architecture: run circuit locally → serialize preimage → POST /prove → proof bytes
// No wallet, node, or indexer needed — just the compiled contract keys + proof server.
//
// Body: { order_id, asset_pair, side, price_cents, amount_units, timestamp }
// Returns: { proofHash, contractAddress, txHash, mode }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/submit-proof', async (req, res) => {
  const { order_id, asset_pair, side, price_cents, amount_units, timestamp } = req.body

  if (!order_id || !asset_pair || !side) {
    return res.status(400).json({ error: 'order_id, asset_pair, and side are required' })
  }
  if (!price_cents || price_cents <= 0) {
    return res.status(422).json({ error: 'price_cents must be > 0' })
  }
  if (!amount_units || amount_units <= 0) {
    return res.status(422).json({ error: 'amount_units must be > 0' })
  }

  // SHA-256(order_id||asset_pair||timestamp) used as settlement_hash pre-image commitment
  const settlementHash = crypto
    .createHash('sha256')
    .update(`${order_id}${asset_pair}${timestamp ?? new Date().toISOString()}`)
    .digest('hex')

  // ── Real ZK proof via zkir-v2 inline (no separate proof server needed) ──────
  const zkReady = await loadZKDeps()
  if (zkReady) {
    try {
      const { runtime, ledger, zkir, Contract, keyMaterial } = _zkDeps

      // Fresh contract state (stateless proving — we only need the circuit)
      const dummyCoinPubKey = { bytes: new Uint8Array(32) }
      const addr = runtime.sampleContractAddress()
      const contract = new Contract({})
      const { currentContractState } = contract.initialState({
        initialZswapLocalState: { coinPublicKey: dummyCoinPubKey },
        initialPrivateState: {},
      })

      // Build circuit execution context
      const ctx = runtime.createCircuitContext(
        addr,
        dummyCoinPubKey,
        currentContractState.data,
        {}
      )

      // Run the ZK circuit — private witnesses (price_cents, amount_units, side, nonce) never leave this process
      const sideInt    = BigInt(side === 'BUY' ? 0 : 1)
      const priceBig   = BigInt(Math.round(price_cents))
      const amountBig  = BigInt(Math.round(amount_units))
      const nonce      = BigInt('0x' + crypto.randomBytes(8).toString('hex'))
      const ts         = timestamp ?? new Date().toISOString()

      const { proofData } = contract.circuits.submit_order(
        ctx,
        order_id,
        asset_pair,
        ts,
        settlementHash,   // SHA-256 commitment — disclosed publicly
        priceBig,         // PRIVATE — never disclosed
        amountBig,        // PRIVATE — never disclosed
        sideInt,          // PRIVATE — never disclosed
        nonce,            // PRIVATE — never disclosed
      )

      // Serialize to binary preimage format expected by zkir-v2
      const preimage = ledger.proofDataIntoSerializedPreimage(
        proofData.input,
        proofData.output,
        proofData.publicTranscript,
        proofData.privateTranscriptOutputs,
        null
      )

      // Build key-material provider — getParams fetches SRS from Midnight S3 (cached)
      const kmProvider = await _makeKmProvider(keyMaterial)

      // Generate real ZK proof inline — no separate proof server process required
      const t0 = Date.now()
      const proofBytes = await zkir.prove(preimage, kmProvider)
      const ms = Date.now() - t0

      const proofHash = crypto.createHash('sha256').update(proofBytes).digest('hex')

      console.log(`[ZK] Real proof generated ✅ (${proofBytes.length} bytes, ${ms}ms) pair=${asset_pair} side=${side}`)

      return res.json({
        proofHash,
        contractAddress: _contractAddress ?? null,
        txHash: null,
        settlementHash,
        mode: 'real',
        proofBytes: Buffer.from(proofBytes).toString('base64'),
        proofSizeBytes: proofBytes.length,
        proofGeneratedMs: ms,
      })
    } catch (err) {
      console.warn('[ZK] Real proof failed, falling back to mock:', err.message)
    }
  }

  // ── Fallback: SHA-256 mock proof ──────────────────────────────────────────
  const raw = `${order_id}${asset_pair}${side}MIDNIGHT_ZK`
  const proofHash = crypto.createHash('sha256').update(raw).digest('hex')
  return res.json({ proofHash, contractAddress: null, txHash: null, settlementHash, mode: 'mock' })
})

// ── POST /settle-proof ────────────────────────────────────────────────────────
// Runs the settle_order ZK circuit to prove fairness of a matched trade.
// All price witnesses are PRIVATE — only the proof hash is returned.
//
// Body: {
//   order_id:            string   — buy order UUID (used as circuit oid)
//   matched_price_cents: number   — PRIVATE witness: actual matched price
//   buyer_limit_cents:   number   — PRIVATE witness: buyer's limit price
//   seller_limit_cents:  number   — PRIVATE witness: seller's limit price
// }
// Circuit asserts: seller_limit <= matched_price <= buyer_limit
// Returns: { proofHash, fairnessProven: true, mode }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/settle-proof', async (req, res) => {
  const { order_id, matched_price_cents, buyer_limit_cents, seller_limit_cents } = req.body

  if (!order_id) {
    return res.status(400).json({ error: 'order_id is required' })
  }
  if (!matched_price_cents || matched_price_cents <= 0) {
    return res.status(422).json({ error: 'matched_price_cents must be > 0' })
  }
  if (!buyer_limit_cents || buyer_limit_cents <= 0) {
    return res.status(422).json({ error: 'buyer_limit_cents must be > 0' })
  }
  if (!seller_limit_cents || seller_limit_cents <= 0) {
    return res.status(422).json({ error: 'seller_limit_cents must be > 0' })
  }

  // Validate the fairness constraint before attempting ZK proof
  if (matched_price_cents < seller_limit_cents) {
    return res.status(422).json({ error: 'settle_order: seller price floor not met' })
  }
  if (matched_price_cents > buyer_limit_cents) {
    return res.status(422).json({ error: 'settle_order: buyer price ceiling exceeded' })
  }

  // ── Real ZK proof via settle_order circuit ────────────────────────────────
  const zkReady = await loadZKDeps()
  if (zkReady) {
    try {
      const { runtime, ledger, zkir, Contract, settleKeyMaterial } = _zkDeps

      const dummyCoinPubKey = { bytes: new Uint8Array(32) }
      const addr = runtime.sampleContractAddress()
      const contract = new Contract({})
      const { currentContractState } = contract.initialState({
        initialZswapLocalState: { coinPublicKey: dummyCoinPubKey },
        initialPrivateState: {},
      })

      const ctx = runtime.createCircuitContext(
        addr,
        dummyCoinPubKey,
        currentContractState.data,
        {}
      )

      // All three price values are PRIVATE witnesses — they prove the inequality
      // without disclosing any individual limit or matched price on-chain.
      const { proofData } = contract.circuits.settle_order(
        ctx,
        order_id,                               // disclosed: order identifier
        BigInt(Math.round(matched_price_cents)), // PRIVATE: actual matched price
        BigInt(Math.round(buyer_limit_cents)),   // PRIVATE: buyer's limit
        BigInt(Math.round(seller_limit_cents)),  // PRIVATE: seller's limit
      )

      const preimage = ledger.proofDataIntoSerializedPreimage(
        proofData.input,
        proofData.output,
        proofData.publicTranscript,
        proofData.privateTranscriptOutputs,
        null
      )

      const kmProvider = await _makeKmProvider(settleKeyMaterial)

      const t0 = Date.now()
      const proofBytes = await zkir.prove(preimage, kmProvider)
      const ms = Date.now() - t0

      const proofHash = crypto.createHash('sha256').update(proofBytes).digest('hex')

      console.log(`[ZK] ✅ settle_order proof (${proofBytes.length} bytes, ${ms}ms) order=${order_id}`)

      return res.json({
        proofHash,
        fairnessProven: true,
        mode: 'real',
        proofSizeBytes: proofBytes.length,
        proofGeneratedMs: ms,
      })
    } catch (err) {
      console.warn('[ZK] settle_order proof failed, falling back to mock:', err.message)
    }
  }

  // ── Fallback: mock settle proof ───────────────────────────────────────────
  const raw = `${order_id}SETTLE${matched_price_cents}MIDNIGHT_ZK`
  const proofHash = crypto.createHash('sha256').update(raw).digest('hex')
  return res.json({ proofHash, fairnessProven: true, mode: 'mock' })
})

// ── GET /contract-address ─────────────────────────────────────────────────────
// Returns the deployed contract address (set by scripts/deploy-contract.mjs).
app.get('/contract-address', (_req, res) => {
  // Re-read in case it was updated since startup
  _contractAddress = _loadContractAddress()
  if (!_contractAddress) {
    return res.status(404).json({
      error: 'Contract not deployed yet. Run: node scripts/deploy-contract.mjs',
      network: MIDNIGHT_ENV,
    })
  }
  res.json({ contractAddress: _contractAddress, network: MIDNIGHT_ENV, networkId: netConfig.networkId })
})

// ── POST /prove ───────────────────────────────────────────────────────────────
// Proof-server-compatible endpoint: accepts a proving payload (binary) from
// @midnight-ntwrk/wallet-sdk-prover-client and returns raw proof bytes.
// This makes scripts/deploy-contract.mjs's HttpProverClient work against
// this service instead of the external proof-server Docker image.
//
// The payload is created by ledger.createProvingPayload(preimage, overwrite, keys).
// The response is raw proof bytes that the SDK parses back into a proven transaction.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/prove', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const zkReady = await loadZKDeps()
  if (!zkReady) {
    return res.status(503).send('ZK dependencies not loaded')
  }
  try {
    const { ledger, zkir, keyMaterial, settleKeyMaterial } = _zkDeps
    const payloadBytes = new Uint8Array(req.body)

    // Build a combined km provider covering both circuits
    const combinedKm = {
      lookupKey: async (loc) => {
        const isSettle = String(loc).includes('settle')
        const km = isSettle ? settleKeyMaterial : keyMaterial
        return {
          proverKey:   new Uint8Array(km.proverKey),
          verifierKey: new Uint8Array(km.verifierKey),
          ir:          new Uint8Array(km.ir),
        }
      },
      getParams: async (k) => {
        if (_paramsCache.has(k)) return _paramsCache.get(k)
        const S3 = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com'
        const r = await fetch(`${S3}/bls_midnight_2p${k}`, { signal: AbortSignal.timeout(60_000) })
        if (!r.ok) throw new Error(`S3 params fetch failed: ${r.status}`)
        const buf = new Uint8Array(await r.arrayBuffer())
        _paramsCache.set(k, buf)
        return buf
      },
    }

    // Use the WrappedProvingProvider which accepts the proving-payload format
    const provider = zkir.provingProvider(combinedKm)
    // The proving payload bundles preimage + key location; the provider handles parsing
    const proofBytes = await provider.prove(payloadBytes, 'submit_order', null)
    res.set('Content-Type', 'application/octet-stream').send(Buffer.from(proofBytes))
  } catch (err) {
    console.warn('[prove] Failed:', err.message)
    res.status(500).send(err.message)
  }
})

// ── POST /check ───────────────────────────────────────────────────────────────
// Proof-server-compatible check endpoint (pre-prove validation).
// ─────────────────────────────────────────────────────────────────────────────
app.post('/check', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const zkReady = await loadZKDeps()
  if (!zkReady) {
    return res.status(503).send('ZK dependencies not loaded')
  }
  try {
    const { ledger, zkir, keyMaterial } = _zkDeps
    const payloadBytes = new Uint8Array(req.body)

    const combinedKm = {
      lookupKey: async () => ({
        proverKey:   new Uint8Array(keyMaterial.proverKey),
        verifierKey: new Uint8Array(keyMaterial.verifierKey),
        ir:          new Uint8Array(keyMaterial.ir),
      }),
      getParams: async (k) => {
        if (_paramsCache.has(k)) return _paramsCache.get(k)
        const S3 = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com'
        const r = await fetch(`${S3}/bls_midnight_2p${k}`, { signal: AbortSignal.timeout(60_000) })
        if (!r.ok) throw new Error(`S3 params fetch failed: ${r.status}`)
        const buf = new Uint8Array(await r.arrayBuffer())
        _paramsCache.set(k, buf)
        return buf
      },
    }

    const provider = zkir.provingProvider(combinedKm)
    const result = await provider.check(payloadBytes, 'submit_order')
    const responseBytes = ledger.createCheckPayload(new Uint8Array(result))
    res.set('Content-Type', 'application/octet-stream').send(Buffer.from(responseBytes))
  } catch (err) {
    console.warn('[check] Failed:', err.message)
    res.status(500).send(err.message)
  }
})

// ── GET /proof-server-status (kept for backwards compat) ─────────────────────
app.get('/proof-server-status', async (_req, res) => {
  // No external proof server — proving is inline via zkir-v2
  const paramsCached = _paramsCache.has(9)
  res.json({ reachable: true, inline: true, params_cached: paramsCached })
})

const PORT = process.env.PORT ?? 3007
app.listen(PORT, () => {
  const addr = _contractAddress ? `  contract: ${_contractAddress}` : '  contract: (not deployed — run node scripts/deploy-contract.mjs)'
  console.log(`[HiddenOrderDEX] Midnight service running on http://localhost:${PORT}`)
  console.log(`[HiddenOrderDEX] Network: ${MIDNIGHT_ENV} (${netConfig.networkId})`)
  console.log(`[HiddenOrderDEX] ZK proofs: inline via zkir-v2 (no external proof server)`)
  console.log(addr)
})
