// ─── Midnight Network configuration ──────────────────────────────────────────
// Set VITE_MIDNIGHT_ENV in frontend/.env to 'preview' (default) or 'preprod'.
// The proof server runs locally via Docker — see midnight-local-dev/standalone.yml.
// ─────────────────────────────────────────────────────────────────────────────

export const MIDNIGHT_ENV = import.meta.env.VITE_MIDNIGHT_ENV ?? 'preview'

export const NETWORK_CONFIGS = {
  preview: {
    networkId:  'preview',
    indexer:    'https://indexer.preview.midnight.network/api/v3/graphql',
    indexerWS:  'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
    node:       'wss://rpc.preview.midnight.network',
    proofServer: 'http://localhost:6300',   // always local — privacy requirement
    faucet:     'https://faucet.preview.midnight.network/',
    explorer:   'https://explorer.preview.midnight.network',
  },
  preprod: {
    networkId:  'preprod',
    indexer:    'https://indexer.preprod.midnight.network/api/v3/graphql',
    indexerWS:  'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    node:       'wss://rpc.preprod.midnight.network',
    proofServer: 'http://localhost:6300',   // always local — privacy requirement
    faucet:     'https://faucet.preprod.midnight.network/',
    explorer:   null,
  },
}

export const config = NETWORK_CONFIGS[MIDNIGHT_ENV]
