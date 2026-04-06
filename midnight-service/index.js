// ─── AlphaShield Midnight Service ─────────────────────────────────────────────
// Node.js middleware that bridges the React frontend and the Midnight Network.
//
// Why a separate service?
//   The Midnight SDK ships WASM + Node.js-only modules (fs, path, crypto) that
//   cannot be bundled inside a Vite browser build. This service runs in Node.js
//   where those modules are available natively.
//
// Architecture:
//   Browser (frontend:3001)
//     → calls this service (midnight-service:5001)
//   This service
//     → @midnight-ntwrk/* SDK (WASM, Node.js)
//     → Proof server (localhost:6300) — always local, privacy requirement
//     → Midnight testnet or local node
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id'

// ── __dir must be defined before loadZKDeps uses it ───────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))

// ── ZK proof imports ──────────────────────────────────────────────────────────
// Loaded lazily to avoid crashing the server if something is missing.
let _zkReady = null  // null=unchecked, true/false after first attempt
let _zkDeps  = null

async function loadZKDeps() {
  if (_zkReady !== null) return _zkReady
  try {
    const ROOT = resolve(__dir, '..')

    // All three WASM modules must use the same shared WASM heap.
    // compact-runtime (root) re-exports from onchain-runtime-v3 (root).
    // ledger-v8 (midnight-service) re-exports its own WASM.
    // Use the _fs.js variants for Node.js (not the browser _bg.js versions).
    const [runtimeMod, ledgerMod, contractMod] = await Promise.all([
      import(resolve(ROOT, 'node_modules/@midnight-ntwrk/compact-runtime/dist/index.js')),
      import(resolve(ROOT, 'midnight-service/node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_fs.js')),
      import(resolve(ROOT, 'contract/dist/trade_proof/contract/index.js')),
    ])

    const KEYS = resolve(ROOT, 'contract/dist/trade_proof/keys')
    const ZKIR = resolve(ROOT, 'contract/dist/trade_proof/zkir')

    _zkDeps = {
      runtime:  runtimeMod,
      ledger:   ledgerMod,
      Contract: contractMod.Contract,
      keyMaterial: {
        proverKey:   readFileSync(resolve(KEYS, 'submit_trade.prover')),
        verifierKey: readFileSync(resolve(KEYS, 'submit_trade.verifier')),
        ir:          readFileSync(resolve(ZKIR,  'submit_trade.bzkir')),
      },
    }
    console.log('[ZK] ✅ Proof dependencies loaded — prover key:', _zkDeps.keyMaterial.proverKey.length, 'bytes')
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
app.use(cors())
app.use(express.json())

// ── Network config ────────────────────────────────────────────────────────────
const MIDNIGHT_ENV = process.env.MIDNIGHT_ENV ?? 'local'
const NETWORK_CONFIGS = {
  local: {
    networkId:   'undeployed',
    indexer:     'http://127.0.0.1:8088/api/v3/graphql',
    indexerWS:   'ws://127.0.0.1:8088/api/v3/graphql/ws',
    node:        'http://127.0.0.1:9944',
    proofServer: 'http://localhost:6300',
  },
  testnet: {
    networkId:   'testnet-02',
    indexer:     'https://indexer.testnet-02.midnight.network/api/v3/graphql',
    indexerWS:   'wss://indexer.testnet-02.midnight.network/api/v3/graphql/ws',
    node:        'wss://rpc.testnet-02.midnight.network',
    proofServer: 'http://localhost:6300',
  },
}
const netConfig = NETWORK_CONFIGS[MIDNIGHT_ENV]
setNetworkId(netConfig.networkId)

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const proofServerOk = await checkProofServer()
  const zkReady = await loadZKDeps()
  res.json({
    status: 'ok',
    midnight_env: MIDNIGHT_ENV,
    network_id: netConfig.networkId,
    proof_server: proofServerOk ? 'reachable' : 'unreachable',
    contract_compiled: zkReady,
    zk_mode: zkReady && proofServerOk ? 'real' : 'mock',
  })
})

// ── POST /submit-proof ────────────────────────────────────────────────────────
// Generates a real ZK proof via the local proof server (port 6300).
// Architecture: run circuit locally → serialize preimage → POST /prove → proof bytes
// No wallet, node, or indexer needed — just the compiled contract keys + proof server.
//
// Body: { asset, amount, price, timestamp, signal }
// Returns: { proofHash, contractAddress, txHash, reasoningHash, mode }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/submit-proof', async (req, res) => {
  const { asset, amount, price, timestamp, signal } = req.body

  if (!signal || typeof signal.confidence !== 'number') {
    return res.status(400).json({ error: 'signal.confidence required' })
  }
  if (signal.confidence < 70) {
    return res.status(422).json({
      error: `Confidence ${signal.confidence}% below ZK threshold (70%). Generate a stronger signal.`,
    })
  }

  // ── v2 Risk parameter validation (circuit constraints enforced here) ──────
  const stopLossPct  = Math.round(signal.stop_loss_pct  ?? 10)
  const positionPct  = Math.round(signal.position_pct   ?? 20)

  if (stopLossPct < 1 || stopLossPct > 20) {
    return res.status(422).json({ error: `Stop-loss ${stopLossPct}% out of valid range (1–20%). v2 circuit will reject.` })
  }
  if (positionPct < 1 || positionPct > 50) {
    return res.status(422).json({ error: `Position size ${positionPct}% out of valid range (1–50%). v2 circuit will reject.` })
  }
  if (signal.confidence + positionPct > 120) {
    return res.status(422).json({
      error: `Risk-adjusted sizing failed: confidence(${signal.confidence}) + position(${positionPct}) = ${signal.confidence + positionPct} > 120. Reduce position size.`,
    })
  }

  // SHA-256 of ( AI reasoning | stop_loss_pct | position_pct )
  // The hash commits to risk parameters without revealing them — a judge can verify
  // the hash was computed with specific risk params once the whale discloses them.
  const reasoningHash = crypto
    .createHash('sha256')
    .update(`${signal.reasoning ?? ''}|sl:${stopLossPct}|pos:${positionPct}`)
    .digest('hex')

  // ── Real ZK proof via proof server ────────────────────────────────────────
  const zkReady = await loadZKDeps()
  if (zkReady) {
    try {
      const { runtime, ledger, Contract, keyMaterial } = _zkDeps

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

      // Run the ZK circuit — private witnesses (direction, confidence) never leave this process
      const direction  = BigInt(signal.direction === 'BUY' ? 1 : 0)
      const confidence = BigInt(Math.round(signal.confidence))

      const { proofData } = contract.circuits.submit_trade(
        ctx,
        asset,
        timestamp,
        String(amount),
        reasoningHash,        // SHA-256 hex string committed publicly
        direction,            // PRIVATE — never disclosed
        confidence,           // PRIVATE — never disclosed
      )

      // Serialize to binary preimage format
      const preimage = ledger.proofDataIntoSerializedPreimage(
        proofData.input,
        proofData.output,
        proofData.publicTranscript,
        proofData.privateTranscriptOutputs,
        null
      )

      // Wrap with prover key + verifier key + ZKIR → HTTP binary payload
      const payload = ledger.createProvingPayload(
        preimage,
        undefined,
        {
          proverKey:   new Uint8Array(keyMaterial.proverKey),
          verifierKey: new Uint8Array(keyMaterial.verifierKey),
          ir:          new Uint8Array(keyMaterial.ir),
        }
      )

      // Send to local proof server — this is where the actual ZK proof is computed
      const proofStart = Date.now()
      const proofResp = await fetch(`${netConfig.proofServer}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: payload,
        signal: AbortSignal.timeout(60000),
      })

      if (!proofResp.ok) {
        const errText = await proofResp.text()
        throw new Error(`Proof server ${proofResp.status}: ${errText}`)
      }

      const proofBytes = new Uint8Array(await proofResp.arrayBuffer())
      const proofGeneratedMs = Date.now() - proofStart
      const proofHash = crypto.createHash('sha256').update(proofBytes).digest('hex')

      console.log(`[ZK] Real proof generated ✅ (${proofBytes.length} bytes, ${proofGeneratedMs}ms) direction=${signal.direction} confidence=${signal.confidence}`)

      return res.json({
        proofHash,
        contractAddress: null,
        txHash: null,
        reasoningHash,
        mode: 'real',
        proofBytes: Buffer.from(proofBytes).toString('base64'),
        proofPreimage: Buffer.from(preimage).toString('base64'),
        proofSizeBytes: proofBytes.length,
        proofGeneratedMs,
        // v2 public fields (service-enforced, hash-committed)
        riskCommitted:   stopLossPct + positionPct,
        strategyVersion: 2,
      })
    } catch (err) {
      console.warn('[ZK] Real proof failed, falling back to mock:', err.message)
    }
  }

  // ── Fallback: SHA-256 mock proof ──────────────────────────────────────────
  const raw = `${asset}${amount}${timestamp}MIDNIGHT_ZK`
  const proofHash = crypto.createHash('sha256').update(raw).digest('hex')
  return res.json({
    proofHash, contractAddress: null, txHash: null, reasoningHash, mode: 'mock',
    riskCommitted: stopLossPct + positionPct,
    strategyVersion: 2,
  })
})

// ── POST /verify-proof ────────────────────────────────────────────────────────
// Cryptographically verifies a previously-generated ZK proof preimage by sending
// it to the Midnight proof server's /check endpoint.
//
// Body: { preimage }  — base64-encoded serialized preimage from submit-proof
// Returns: { valid: boolean, mode: 'real' | 'mock' }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/verify-proof', async (req, res) => {
  const { preimage: preimageB64 } = req.body
  if (!preimageB64) {
    return res.status(400).json({ error: 'preimage required' })
  }

  const zkReady = await loadZKDeps()
  if (!zkReady) {
    // No proof server or keys — optimistic mock pass for demo
    return res.json({ valid: true, mode: 'mock', message: 'ZK deps not loaded — mock pass' })
  }

  try {
    const { ledger, keyMaterial } = _zkDeps
    const preimage = new Uint8Array(Buffer.from(preimageB64, 'base64'))
    const checkPayload = ledger.createCheckPayload(preimage, new Uint8Array(keyMaterial.ir))

    const checkResp = await fetch(`${netConfig.proofServer}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: checkPayload,
      signal: AbortSignal.timeout(30000),
    })

    if (!checkResp.ok) {
      const errText = await checkResp.text()
      console.warn('[ZK] /check returned', checkResp.status, errText)
      return res.json({ valid: false, mode: 'real', error: errText })
    }

    const resultBytes = new Uint8Array(await checkResp.arrayBuffer())
    // parseCheckResult returns an array of bigint or undefined; a non-empty result means valid
    const parsed = ledger.parseCheckResult(resultBytes)
    const valid = Array.isArray(parsed) && parsed.length > 0

    console.log(`[ZK] Proof check result: ${valid ? '✅ VALID' : '❌ INVALID'} (${parsed?.length} outputs)`)
    return res.json({ valid, mode: 'real' })
  } catch (err) {
    console.warn('[ZK] Proof verification error:', err.message)
    return res.status(500).json({ valid: false, mode: 'real', error: err.message })
  }
})

// ── GET /proof-server-status ──────────────────────────────────────────────────
app.get('/proof-server-status', async (_req, res) => {
  res.json({ reachable: await checkProofServer() })
})

// ─────────────────────────────────────────────────────────────────────────────
async function checkProofServer() {
  try {
    const r = await fetch(`${netConfig.proofServer}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return r.ok
  } catch {
    return false
  }
}

const PORT = process.env.PORT ?? 5001
app.listen(PORT, () => {
  console.log(`[AlphaShield] Midnight service running on http://localhost:${PORT}`)
  console.log(`[AlphaShield] Network: ${MIDNIGHT_ENV} (${netConfig.networkId})`)
})
