#!/usr/bin/env node
// ─── deploy-contract.mjs ─────────────────────────────────────────────────────
// Deploys the order_proof contract to the Midnight Preview or Preprod network
// and saves the deployed address to:
//   contract/deployed-address.json
//   midnight-service/.env (CONTRACT_ADDRESS= line)
//
// Prerequisites:
//   1. Proof server running:  cd midnight-local-dev && docker compose -f standalone.yml up -d
//   2. midnight-service running:  cd midnight-service && npm start
//   3. Wallet seed set:       MIDNIGHT_WALLET_SEED="word1 word2 ..." node scripts/deploy-contract.mjs
//      OR add MIDNIGHT_WALLET_SEED to midnight-service/.env
//
// Usage:
//   node scripts/deploy-contract.mjs [--env preview|preprod]
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const ROOT    = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SVC_DIR = resolve(ROOT, 'midnight-service')

// ── Load .env from midnight-service ──────────────────────────────────────────
function loadEnv(dir) {
  const envPath = resolve(dir, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    const val = t.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnv(SVC_DIR)

const MIDNIGHT_ENV = process.env.MIDNIGHT_ENV ?? 'preview'
const WALLET_SEED  = process.env.MIDNIGHT_WALLET_SEED ?? ''

const NETWORK_CONFIGS = {
  preview: {
    networkId:   'preview',
    nodeURL:     'wss://rpc.preview.midnight.network',
    indexerHTTP: 'https://indexer.preview.midnight.network/api/v3/graphql',
    indexerWS:   'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
    proofServer: process.env.PROOF_SERVER_URL ?? 'http://localhost:6300',
  },
  preprod: {
    networkId:   'preprod',
    nodeURL:     'wss://rpc.preprod.midnight.network',
    indexerHTTP: 'https://indexer.preprod.midnight.network/api/v3/graphql',
    indexerWS:   'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    proofServer: process.env.PROOF_SERVER_URL ?? 'http://localhost:6300',
  },
}

const netCfg = NETWORK_CONFIGS[MIDNIGHT_ENV]
if (!netCfg) {
  console.error(`Unknown MIDNIGHT_ENV: ${MIDNIGHT_ENV}`)
  process.exit(1)
}

if (!WALLET_SEED) {
  console.error(`
ERROR: MIDNIGHT_WALLET_SEED is not set.

Set it in midnight-service/.env:
  MIDNIGHT_WALLET_SEED=word1 word2 word3 ... (12 or 24 BIP-39 words)

To generate a fresh seed (NEVER use on mainnet):
  node -e "
    import('@midnight-ntwrk/wallet-sdk-hd').then(m =>
      console.log(m.generateMnemonic())
    ).catch(e => console.error(e))
  "

For Preview, fund the address using: https://faucet.preview.midnight.network/
For Preprod, fund the address using: https://faucet.preprod.midnight.network/
`)
  process.exit(1)
}

// ── Load ZK dependencies ──────────────────────────────────────────────────────
console.log('Loading ZK dependencies…')
const [runtimeMod, ledger, contractMod, zkir, { setNetworkId }] = await Promise.all([
  import(resolve(ROOT, 'node_modules/@midnight-ntwrk/compact-runtime/dist/index.js')),
  import(resolve(SVC_DIR, 'node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_fs.js')),
  import(resolve(ROOT, 'contract/dist/order_proof/contract/index.js')),
  import(resolve(SVC_DIR, 'node_modules/@midnight-ntwrk/zkir-v2/midnight_zkir_wasm_fs.js')),
  import(resolve(SVC_DIR, 'node_modules/@midnight-ntwrk/midnight-js-network-id/dist/index.js')),
])

setNetworkId(netCfg.networkId)
const { Contract } = contractMod

const KEYS_DIR = resolve(ROOT, 'contract/dist/order_proof/keys')
const ZKIR_DIR = resolve(ROOT, 'contract/dist/order_proof/zkir')

const keyMaterials = {
  submit_order: {
    proverKey:   readFileSync(resolve(KEYS_DIR, 'submit_order.prover')),
    verifierKey: readFileSync(resolve(KEYS_DIR, 'submit_order.verifier')),
    ir:          readFileSync(resolve(ZKIR_DIR,  'submit_order.bzkir')),
  },
  settle_order: {
    proverKey:   readFileSync(resolve(KEYS_DIR, 'settle_order.prover')),
    verifierKey: readFileSync(resolve(KEYS_DIR, 'settle_order.verifier')),
    ir:          readFileSync(resolve(ZKIR_DIR,  'settle_order.bzkir')),
  },
}
console.log('✅ ZK keys loaded')

// ── SRS params provider (fetches from Midnight S3, cached) ───────────────────
const _paramsCache = new Map()
async function getParams(k) {
  if (_paramsCache.has(k)) return _paramsCache.get(k)
  const S3 = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com'
  console.log(`  [SRS] Fetching k=${k} from S3…`)
  const r = await fetch(`${S3}/bls_midnight_2p${k}`, { signal: AbortSignal.timeout(60_000) })
  if (!r.ok) throw new Error(`S3 params fetch failed: ${r.status}`)
  const buf = new Uint8Array(await r.arrayBuffer())
  console.log(`  [SRS] k=${k}: ${buf.length} bytes`)
  _paramsCache.set(k, buf)
  return buf
}

// Key-material provider for zkir-v2 (maps circuit ID → keys)
function makeKmProvider(circuitId) {
  const km = keyMaterials[circuitId] ?? keyMaterials.submit_order
  return {
    lookupKey: async (_loc) => ({
      proverKey:   new Uint8Array(km.proverKey),
      verifierKey: new Uint8Array(km.verifierKey),
      ir:          new Uint8Array(km.ir),
    }),
    getParams,
  }
}

// ── ZKConfigProvider ──────────────────────────────────────────────────────────
const { ZKConfigProvider } = await import(
  resolve(SVC_DIR, 'node_modules/@midnight-ntwrk/midnight-js-types/dist/index.js')
)
class FileZKConfigProvider extends ZKConfigProvider {
  async getZKIR(circuitId) {
    const ir = keyMaterials[circuitId]?.ir ?? keyMaterials.submit_order.ir
    return new Uint8Array(ir)
  }
  async getProverKey(circuitId) {
    const key = keyMaterials[circuitId]?.proverKey ?? keyMaterials.submit_order.proverKey
    return new Uint8Array(key)
  }
  async getVerifierKey(circuitId) {
    const key = keyMaterials[circuitId]?.verifierKey ?? keyMaterials.submit_order.verifierKey
    return new Uint8Array(key)
  }
}
const zkConfigProvider = new FileZKConfigProvider()

// ── ProofProvider — inline zkir-v2 proving ────────────────────────────────────
const proofProvider = {
  async proveTx(unprovenTx) {
    // Look up which circuits this tx uses and build a combined km provider
    const multiKmProvider = {
      lookupKey: async (loc) => {
        // loc is the circuit ID string e.g. 'submit_order' or a path
        const circuitId = Object.keys(keyMaterials).find(k => loc.includes(k)) ?? 'submit_order'
        const km = keyMaterials[circuitId]
        return {
          proverKey:   new Uint8Array(km.proverKey),
          verifierKey: new Uint8Array(km.verifierKey),
          ir:          new Uint8Array(km.ir),
        }
      },
      getParams,
    }
    const wrappedProv = zkir.provingProvider(multiKmProvider)
    return unprovenTx.prove(wrappedProv)
  },
}

// ── Wallet + node providers ───────────────────────────────────────────────────
console.log('Initialising wallet…')
const { DustWallet } = await import(
  resolve(SVC_DIR, 'node_modules/@midnight-ntwrk/wallet-sdk-dust-wallet/dist/index.js')
)

let wallet
try {
  wallet = await DustWallet.init({
    seed: WALLET_SEED,
    nodeURL: netCfg.nodeURL,
    indexerURL: netCfg.indexerHTTP,
    indexerWS: netCfg.indexerWS,
    provingServerUrl: netCfg.proofServer,
    networkId: netCfg.networkId,
  })
  console.log(`✅ Wallet initialised — address: ${wallet.address ?? '(syncing…)'}`)
} catch (e) {
  console.error(`ERROR: Failed to initialise wallet: ${e.message}`)
  console.error(`Connecting to ${MIDNIGHT_ENV} network (${netCfg.nodeURL})`)
  console.error('Make sure the proof server is running:')
  console.error('  cd midnight-local-dev && docker compose -f standalone.yml up -d')
  process.exit(1)
}

// Build WalletProvider and MidnightProvider from the DustWallet
const walletProvider = {
  balanceTx: (tx, ttl) => wallet.balanceTx(tx, ttl),
  getCoinPublicKey: () => wallet.coinPublicKey,
  getEncryptionPublicKey: () => wallet.encryptionPublicKey,
}
const midnightProvider = {
  submitTx: (tx) => wallet.submitTx(tx),
}

// ── PrivateStateProvider — in-memory ─────────────────────────────────────────
const _storage = new Map()
const privateStateProvider = {
  get: async (id) => _storage.get(id) ?? null,
  set: async (id, state) => { _storage.set(id, state) },
  getSigningKey: async (addr) => _storage.get(`signing:${addr}`) ?? null,
  setSigningKey: async (addr, key) => { _storage.set(`signing:${addr}`, key) },
}

// ── PublicDataProvider — polls node via wallet ────────────────────────────────
const publicDataProvider = {
  queryContractState: (addr, cfg) => wallet.queryContractState(addr, cfg),
  watchForTxData: (txId) => wallet.watchForTxData(txId),
  watchForDeployTxData: (addr) => wallet.watchForDeployTxData(addr),
  queryZswapState: (addr, cfg) => wallet.queryZswapState(addr, cfg),
  queryAllBlockAttributes: (cfg) => wallet.queryAllBlockAttributes(cfg),
}

// ── Deploy ────────────────────────────────────────────────────────────────────
const { deployContract } = await import(
  resolve(SVC_DIR, 'node_modules/@midnight-ntwrk/midnight-js-contracts/dist/index.mjs')
)

const providers = {
  zkConfigProvider,
  proofProvider,
  walletProvider,
  midnightProvider,
  publicDataProvider,
  privateStateProvider,
}

console.log(`\nDeploying order_proof contract to ${MIDNIGHT_ENV} (${netCfg.networkId})…`)
console.log('(This may take 30–120 seconds while the ZK proof is generated and the tx is included in a block.)\n')

const contract = new Contract({})
let deployed
try {
  deployed = await deployContract(providers, {
    compiledContract: contract,
    initialState: contract.initialState.bind(contract),
  })
} catch (e) {
  console.error(`\n❌ Deployment failed: ${e.message}`)
  if (e.message.includes('balance') || e.message.includes('funds') || e.message.includes('DUST')) {
    console.error('\nHint: Your wallet needs DUST to pay for the deployment transaction.')
    console.error('  • For Preview: https://faucet.preview.midnight.network/')
    console.error('  • For Preprod: https://faucet.preprod.midnight.network/')
  }
  process.exit(1)
}

const contractAddress = deployed.deployTxData.public.contractAddress.toString()
const txHash = deployed.deployTxData.public.txId

console.log(`\n╔══════════════════════════════════════════════════════════════╗`)
console.log(`║  ✅ CONTRACT DEPLOYED TO ${MIDNIGHT_ENV.padEnd(36)} ║`)
console.log(`║  address : ${contractAddress.slice(0, 50)}… ║`)
console.log(`║  tx hash : ${txHash.slice(0, 50)}… ║`)
console.log(`╚══════════════════════════════════════════════════════════════╝`)

// ── Persist ───────────────────────────────────────────────────────────────────
// 1. contract/deployed-address.json
const addrFile = resolve(ROOT, 'contract', 'deployed-address.json')
const existing = existsSync(addrFile) ? JSON.parse(readFileSync(addrFile, 'utf8')) : {}
existing[MIDNIGHT_ENV] = { contractAddress, txHash, deployedAt: new Date().toISOString() }
writeFileSync(addrFile, JSON.stringify(existing, null, 2) + '\n')
console.log(`\n📄 Saved to contract/deployed-address.json`)

// 2. midnight-service/.env — update or append CONTRACT_ADDRESS
const envPath = resolve(SVC_DIR, '.env')
let envContent = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
if (envContent.includes('CONTRACT_ADDRESS=')) {
  envContent = envContent.replace(/^CONTRACT_ADDRESS=.*$/m, `CONTRACT_ADDRESS=${contractAddress}`)
} else {
  envContent += `\nCONTRACT_ADDRESS=${contractAddress}\n`
}
writeFileSync(envPath, envContent)
console.log(`📄 Updated midnight-service/.env  (CONTRACT_ADDRESS)`)
console.log(`\nRestart midnight-service to pick up the new address: cd midnight-service && npm start`)
