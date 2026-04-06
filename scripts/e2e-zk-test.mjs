#!/usr/bin/env node
// End-to-end ZK proof generation test
// Runs circuit → serializes preimage → fetches k=9 SRS params from S3 → proves
import { resolve } from 'path'
import { readFileSync } from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

console.log('Loading ZK dependencies...')
const [runtimeMod, ledgerMod, contractMod, zkirMod] = await Promise.all([
  import(resolve(ROOT, 'node_modules/@midnight-ntwrk/compact-runtime/dist/index.js')),
  import(resolve(ROOT, 'midnight-service/node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_fs.js')),
  import(resolve(ROOT, 'contract/dist/order_proof/contract/index.js')),
  import(resolve(ROOT, 'midnight-service/node_modules/@midnight-ntwrk/zkir-v2/midnight_zkir_wasm_fs.js')),
])

const { createCircuitContext, sampleContractAddress } = runtimeMod
const { Contract } = contractMod
const { prove } = zkirMod
const KEYS = resolve(ROOT, 'contract/dist/order_proof/keys')
const ZKIR  = resolve(ROOT, 'contract/dist/order_proof/zkir')
const keyMaterial = {
  proverKey:   readFileSync(resolve(KEYS, 'submit_order.prover')),
  verifierKey: readFileSync(resolve(KEYS, 'submit_order.verifier')),
  ir:          readFileSync(resolve(ZKIR,  'submit_order.bzkir')),
}
console.log('✅ Deps loaded — prover key:', keyMaterial.proverKey.length, 'bytes')

// Build circuit context and run submit_order
const dummyCoinPubKey = { bytes: new Uint8Array(32) }
const addr = sampleContractAddress()
const contract = new Contract({})
const { currentContractState } = contract.initialState({
  initialZswapLocalState: { coinPublicKey: dummyCoinPubKey },
  initialPrivateState: {},
})
const ctx = createCircuitContext(addr, dummyCoinPubKey, currentContractState.data, {})
const nonce = BigInt('0x' + crypto.randomBytes(8).toString('hex'))
const { proofData } = contract.circuits.submit_order(
  ctx, 'order-e2e-test', 'BTC/USDC', new Date().toISOString(),
  'abc123settlementhash', BigInt(6420000), BigInt(1000000), 0n, nonce
)

// Serialize to preimage binary
const preimage = ledgerMod.proofDataIntoSerializedPreimage(
  proofData.input, proofData.output, proofData.publicTranscript,
  proofData.privateTranscriptOutputs, null
)
console.log('Preimage:', preimage.length, 'bytes')

// Key material provider — params fetched from Midnight S3 (cached)
const paramsCache = new Map()
const kmProvider = {
  lookupKey: async () => ({
    proverKey:   new Uint8Array(keyMaterial.proverKey),
    verifierKey: new Uint8Array(keyMaterial.verifierKey),
    ir:          new Uint8Array(keyMaterial.ir),
  }),
  getParams: async (k) => {
    if (paramsCache.has(k)) {
      console.log(`  [params] cache hit k=${k}`)
      return paramsCache.get(k)
    }
    const S3 = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com'
    console.log(`  [params] fetching k=${k} from Midnight S3...`)
    const resp = await fetch(`${S3}/bls_midnight_2p${k}`, { signal: AbortSignal.timeout(30000) })
    if (!resp.ok) throw new Error(`S3 params fetch failed: ${resp.status}`)
    const buf = new Uint8Array(await resp.arrayBuffer())
    console.log(`  [params] k=${k}: ${buf.length} bytes downloaded and cached`)
    paramsCache.set(k, buf)
    return buf
  },
}

console.log('Generating real ZK proof (first run downloads SRS params from S3)...')
const t0 = Date.now()
const proofBytes = await prove(preimage, kmProvider)
const ms = Date.now() - t0
const proofHash = crypto.createHash('sha256').update(proofBytes).digest('hex')

console.log()
console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║  ✅ REAL ZK PROOF GENERATED — No Docker proof server needed  ║')
console.log(`║  Proof size : ${String(proofBytes.length).padEnd(10)} bytes                              ║`)
console.log(`║  Generation : ${String(ms).padEnd(10)} ms                                  ║`)
console.log(`║  SHA-256    : ${proofHash.slice(0, 32)}…  ║`)
console.log('╚══════════════════════════════════════════════════════════════╝')
