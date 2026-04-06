// ─── HiddenOrder DEX Contract API (browser layer) ─────────────────────────────
// The browser cannot run the Midnight SDK directly (WASM + Node.js deps),
// so this module calls the midnight-service (Node.js, port 3007) which holds
// the real @midnight-ntwrk packages.
//
// Flow:
//   TraderView → submitOrderProof() → POST midnight-service:3007/submit-proof
//     → Midnight SDK generates ZK proof via local proof server (6301)
//     → Returns { proofHash, txHash, contractAddress, mode: 'real'|'mock' }
// ─────────────────────────────────────────────────────────────────────────────

const MIDNIGHT_SERVICE = import.meta.env.VITE_MIDNIGHT_SERVICE_URL ?? 'http://localhost:3007'

/**
 * Submit an order proof — calls midnight-service which runs the real ZK SDK.
 * Falls back to a client-side mock if the service is unreachable.
 *
 * @param {object|null} _walletApi   — Lace wallet API (reserved for future browser-side signing)
 * @param {{ order_id, asset_pair, side, price_cents, amount_units, timestamp }} orderData
 * @returns {Promise<{ proofHash, contractAddress, txHash, settlementHash, mode }>}
 */
export async function submitOrderProof(_walletApi, orderData) {
  const { order_id, asset_pair, side, price_cents, amount_units, timestamp } = orderData

  // ── Try the Midnight service (Node.js + real SDK) ─────────────────────────
  try {
    const res = await fetch(`${MIDNIGHT_SERVICE}/submit-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id, asset_pair, side, price_cents, amount_units, timestamp }),
      signal: AbortSignal.timeout(90_000),  // ZK proof can take up to 60s
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error ?? `Service error ${res.status}`)
    }
    return await res.json()
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('ZK proof generation timed out (>90s)')
    console.warn('[HiddenOrderDEX] Midnight service unreachable, using client mock:', err.message)
  }

  // ── Client-side mock fallback ─────────────────────────────────────────────
  return generateClientMock(orderData)
}

async function generateClientMock({ order_id, asset_pair, timestamp }) {
  const settlementHash = await sha256(`${order_id}${asset_pair}${timestamp ?? ''}`)
  const proofHash = await sha256(`${order_id}${asset_pair}MIDNIGHT_ZK`)
  return { proofHash, contractAddress: null, txHash: null, settlementHash, mode: 'mock' }
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Check if the Midnight service (and by extension the proof server) is reachable.
 * @returns {Promise<{ serviceUp: boolean, proofServerUp: boolean }>}
 */
export async function checkMidnightService() {
  try {
    const res = await fetch(`${MIDNIGHT_SERVICE}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return { serviceUp: false, proofServerUp: false }
    const data = await res.json()
    return {
      serviceUp: true,
      proofServerUp: data.zk_mode === 'real',
      contractCompiled: data.contract_compiled,
      networkId: data.network_id,
      zkMode: data.zk_mode ?? 'mock',
      contractAddress: data.contract_address ?? null,
    }
  } catch {
    return { serviceUp: false, proofServerUp: false }
  }
}
