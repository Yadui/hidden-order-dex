/**
 * fetchPrice(sym, cgId) — waterfall price fetch
 *
 * Chain: CoinGecko → Binance → CoinCap → null
 *
 * Each source is tried in order; the first successful response wins.
 * Falls back gracefully — never throws.
 *
 * @param {string} sym   — uppercase ticker symbol, e.g. "BTC"
 * @param {string} cgId  — CoinGecko coin ID, e.g. "bitcoin"
 * @returns {Promise<number|null>}
 */

const TIMEOUT_MS = 5000

function abortAfter(ms) {
  return AbortSignal.timeout(ms)
}

// ── Source 1: CoinGecko ───────────────────────────────────────────────────────
async function fromCoinGecko(cgId) {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
    { signal: abortAfter(TIMEOUT_MS) }
  )
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
  const data = await res.json()
  const price = data[cgId]?.usd
  if (!price) throw new Error('CoinGecko: no price in response')
  return price
}

// ── Source 2: Binance ─────────────────────────────────────────────────────────
// Uses the public ticker endpoint — no API key required.
async function fromBinance(sym) {
  const pair = `${sym}USDT`
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`,
    { signal: abortAfter(TIMEOUT_MS) }
  )
  if (!res.ok) throw new Error(`Binance ${res.status}`)
  const data = await res.json()
  const price = parseFloat(data.price)
  if (!price || isNaN(price)) throw new Error('Binance: no price in response')
  return price
}

// ── Source 3: CoinCap ─────────────────────────────────────────────────────────
// Free, no key, uses the CoinGecko ID as the CoinCap asset ID for major coins.
// Falls back to slugifying the symbol for less popular ones.
async function fromCoinCap(sym, cgId) {
  // CoinCap uses its own IDs but they match cgId for most top coins
  const id = cgId ?? sym.toLowerCase()
  const res = await fetch(
    `https://api.coincap.io/v2/assets/${id}`,
    { signal: abortAfter(TIMEOUT_MS) }
  )
  if (!res.ok) throw new Error(`CoinCap ${res.status}`)
  const data = await res.json()
  const price = parseFloat(data?.data?.priceUsd)
  if (!price || isNaN(price)) throw new Error('CoinCap: no price in response')
  return price
}

// ── Waterfall ─────────────────────────────────────────────────────────────────
export async function fetchPrice(sym, cgId) {
  const sources = [
    { name: 'CoinGecko', fn: () => fromCoinGecko(cgId) },
    { name: 'Binance',   fn: () => fromBinance(sym) },
    { name: 'CoinCap',   fn: () => fromCoinCap(sym, cgId) },
  ]

  for (const source of sources) {
    try {
      const price = await source.fn()
      if (import.meta.env.DEV) console.debug(`[price] ${sym} via ${source.name}: $${price}`)
      return price
    } catch (err) {
      if (import.meta.env.DEV) console.debug(`[price] ${sym} ${source.name} failed: ${err.message}`)
    }
  }

  return null  // all sources exhausted
}
