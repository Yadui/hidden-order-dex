// ─── Midnight Wallet Connector ────────────────────────────────────────────────
// Connects to the Lace browser wallet extension via the DApp Connector API.
// Reference: @midnight-ntwrk/dapp-connector-api
//
// The wallet:
//   · holds the user's private keys
//   · runs the proof server locally (port 6301)
//   · signs and submits transactions to Midnight Network
// ─────────────────────────────────────────────────────────────────────────────

const LACE_CONNECTOR_KEY = 'mnLace'

/**
 * @typedef {Object} WalletState
 * @property {'disconnected'|'connecting'|'connected'|'error'} status
 * @property {object|null} api   — the enabled DApp connector API
 * @property {string|null} address
 * @property {string|null} error
 */

/**
 * Check whether the Lace wallet extension is installed in the browser.
 * @returns {boolean}
 */
export function isLaceInstalled() {
  return typeof window !== 'undefined' &&
    window.midnight != null &&
    window.midnight[LACE_CONNECTOR_KEY] != null
}

/**
 * Request wallet access from the user via Lace's DApp connector popup.
 * Returns the enabled API object on success, throws on rejection.
 *
 * @returns {Promise<object>} enabledApi
 */
export async function connectLaceWallet() {
  if (!isLaceInstalled()) {
    throw new Error(
      'Lace wallet not found. Install the Lace browser extension and ' +
      'enable Midnight in Settings → Midnight → Proof Server (localhost:6301).'
    )
  }

  // window.midnight.mnLace.enable() opens the Lace connection popup.
  // The user must approve, then we receive the enabled connector API.
  const api = await window.midnight[LACE_CONNECTOR_KEY].enable()
  return api
}

/**
 * Fetch the user's Midnight address from the connected wallet.
 * @param {object} walletApi — returned by connectLaceWallet()
 * @returns {Promise<string>}
 */
export async function getWalletAddress(walletApi) {
  const addresses = await walletApi.getUsedAddresses()
  return addresses[0] ?? null
}

/**
 * Check proof server health at localhost:6301.
 * Returns true if reachable, false otherwise.
 * @returns {Promise<boolean>}
 */
export async function checkProofServer() {
  try {
    const res = await fetch('http://localhost:6301/health', {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}
