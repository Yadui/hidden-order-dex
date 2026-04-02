// ─── Midnight Network configuration ──────────────────────────────────────────
// Switch MIDNIGHT_ENV to 'local' when running midnight-local-dev Docker stack,
// or 'testnet' when targeting the public testnet.
// ─────────────────────────────────────────────────────────────────────────────

export const MIDNIGHT_ENV = import.meta.env.VITE_MIDNIGHT_ENV ?? 'local'

export const NETWORK_CONFIGS = {
  local: {
    networkId: 'undeployed',
    indexer:    'http://127.0.0.1:8088/api/v3/graphql',
    indexerWS:  'ws://127.0.0.1:8088/api/v3/graphql/ws',
    node:       'http://127.0.0.1:9944',
    proofServer:'http://localhost:6300',
  },
  testnet: {
    networkId: 'testnet-02',
    indexer:   'https://indexer.testnet-02.midnight.network/api/v3/graphql',
    indexerWS: 'wss://indexer.testnet-02.midnight.network/api/v3/graphql/ws',
    node:      'wss://rpc.testnet-02.midnight.network',
    proofServer:'http://localhost:6300',   // always local — privacy requirement
  },
}

export const config = NETWORK_CONFIGS[MIDNIGHT_ENV]

// Minimum AI signal confidence required before a trade can be ZK-proven
export const MIN_CONFIDENCE_THRESHOLD = 70
