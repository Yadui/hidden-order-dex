// ─── priceFeeds.js ────────────────────────────────────────────────────────────
// Multi-source price feed with automatic fallback chain.
//
// Source priority:
//   1. CoinGecko  — proxied through backend (/coingecko/*) to avoid CORS and
//                   client-side rate limits. Backend caches responses (30-300s).
//   2. Binance    — no API key, very high rate limits, fast
//   3. CoinCap    — open API, good for history / RSI computation
// ─────────────────────────────────────────────────────────────────────────────

const CG = '/coingecko'  // proxied through Vite → FastAPI → coingecko.com

// ── Symbol / ID mappings ──────────────────────────────────────────────────────
const BINANCE_SYMBOL = {
  BTC:  'BTCUSDT', ETH:  'ETHUSDT', SOL:  'SOLUSDT', XRP:  'XRPUSDT',
  AVAX: 'AVAXUSDT', LINK: 'LINKUSDT', ADA: 'ADAUSDT',  DOT: 'DOTUSDT',
}

const COINCAP_ID = {
  BTC:  'bitcoin',   ETH:  'ethereum',  SOL:  'solana',   XRP:  'xrp',
  AVAX: 'avalanche', LINK: 'chainlink', ADA:  'cardano',  DOT:  'polkadot',
}

// Maps CoinGecko coin ID → ticker (for Binance/CoinCap lookups in market data)
const TICKER_BY_CGID = {
  bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP',
  'avalanche-2': 'AVAX', chainlink: 'LINK', cardano: 'ADA', polkadot: 'DOT',
}

// ── Binance interval mapping for detail charts ────────────────────────────────
const BINANCE_INTERVAL = { 1: '1h', 7: '1d', 30: '1d', 90: '1d' }
const BINANCE_LIMIT    = { 1: 24,   7: 7,    30: 30,   90: 90   }

// ── Helper ────────────────────────────────────────────────────────────────────
async function tryFetch(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), ...opts })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchAssetData(ticker, cgId)
//
// Used by WhaleView to get current price + 14-day history (for RSI + volume %).
// Returns: { price, closes, vols, source } or null if all sources fail.
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchAssetData(ticker, cgId) {
  // 1. CoinGecko — price + 14-day chart in two parallel requests
  try {
    const [priceData, chartData] = await Promise.all([
      tryFetch(`${CG}/simple/price?ids=${cgId}&vs_currencies=usd`),
      tryFetch(`${CG}/coins/${cgId}/market_chart?vs_currency=usd&days=14&interval=daily`),
    ])
    const price = priceData[cgId]?.usd
    if (!price) throw new Error('No price returned')
    return {
      price,
      closes: (chartData.prices ?? []).map(([, p]) => p),
      vols:   (chartData.total_volumes ?? []).map(([, v]) => v),
      source: 'coingecko',
    }
  } catch (e) {
    console.warn(`[PriceFeed] CoinGecko failed (${ticker}): ${e.message}`)
  }

  // 2. Binance — price from 24hr ticker + daily klines for history
  const binSym = BINANCE_SYMBOL[ticker]
  if (binSym) {
    try {
      const [ticker24, klines] = await Promise.all([
        tryFetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binSym}`),
        tryFetch(`https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=1d&limit=15`),
      ])
      const price = parseFloat(ticker24.lastPrice)
      if (!price) throw new Error('No price returned')
      // klines: [openTime, open, high, low, close, volume, ...]
      const closes = klines.map(k => parseFloat(k[4]))
      const vols   = klines.map(k => parseFloat(k[5]))
      return { price, closes, vols, source: 'binance' }
    } catch (e) {
      console.warn(`[PriceFeed] Binance failed (${ticker}): ${e.message}`)
    }
  }

  // 3. CoinCap — asset endpoint + daily history
  const capId = COINCAP_ID[ticker]
  if (capId) {
    try {
      const now   = Date.now()
      const start = now - 15 * 24 * 60 * 60 * 1000
      const [assetData, histData] = await Promise.all([
        tryFetch(`https://api.coincap.io/v2/assets/${capId}`),
        tryFetch(`https://api.coincap.io/v2/assets/${capId}/history?interval=d1&start=${start}&end=${now}`),
      ])
      const price = parseFloat(assetData.data?.priceUsd)
      if (!price) throw new Error('No price returned')
      const closes = (histData.data ?? []).map(d => parseFloat(d.priceUsd))
      return { price, closes, vols: [], source: 'coincap' }
    } catch (e) {
      console.warn(`[PriceFeed] CoinCap failed (${ticker}): ${e.message}`)
    }
  }

  return null // all sources exhausted
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchMarketsData(coinIds, tickerMap)
//
// Used by MarketOverview to fetch the full coin list with sparklines.
// coinIds    — comma-separated CoinGecko IDs, e.g. 'bitcoin,ethereum,...'
// tickerMap  — { 'bitcoin': 'BTC', ... }
// Returns: { coins, source }
//   coins — array in CoinGecko /markets shape (some fields may be null on fallback)
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchMarketsData(coinIds, tickerMap) {
  // 1. CoinGecko /markets — full data including sparkline + market cap
  try {
    const data = await tryFetch(
      `${CG}/coins/markets` +
      `?vs_currency=usd&ids=${coinIds}&order=market_cap_desc` +
      `&sparkline=true&price_change_percentage=1h,24h,7d`
    )
    if (Array.isArray(data) && data.length > 0) {
      return { coins: data, source: 'coingecko' }
    }
    throw new Error('Empty response')
  } catch (e) {
    console.warn(`[PriceFeed] CoinGecko markets failed: ${e.message}`)
  }

  // 2. Binance — batch 24hr stats for all symbols at once
  const symbols = Object.keys(tickerMap)
    .filter(cgId => BINANCE_SYMBOL[tickerMap[cgId]])
    .map(cgId => BINANCE_SYMBOL[tickerMap[cgId]])

  if (symbols.length > 0) {
    try {
      const encoded = encodeURIComponent(JSON.stringify(symbols))
      const data = await tryFetch(
        `https://api.binance.com/api/v3/ticker/24hr?symbols=${encoded}`
      )
      // Build reverse lookup: BTCUSDT → { cgId, ticker }
      const bySymbol = {}
      for (const [cgId, ticker] of Object.entries(tickerMap)) {
        const sym = BINANCE_SYMBOL[ticker]
        if (sym) bySymbol[sym] = { cgId, ticker }
      }
      const coins = data
        .map((item, i) => {
          const mapped = bySymbol[item.symbol]
          if (!mapped) return null
          const price    = parseFloat(item.lastPrice)
          const change24 = parseFloat(item.priceChangePercent)
          return {
            id:                                    mapped.cgId,
            symbol:                                mapped.ticker.toLowerCase(),
            name:                                  mapped.ticker,
            image:                                 null,
            current_price:                         price,
            price_change_percentage_1h_in_currency: null,
            price_change_percentage_24h:           change24,
            price_change_percentage_7d_in_currency: null,
            market_cap:                            null,
            total_volume:                          parseFloat(item.quoteVolume),
            sparkline_in_7d:                       { price: [] },
            market_cap_rank:                       i + 1,
            _fallback:                             true,
          }
        })
        .filter(Boolean)

      if (coins.length > 0) return { coins, source: 'binance' }
    } catch (e) {
      console.warn(`[PriceFeed] Binance markets fallback failed: ${e.message}`)
    }
  }

  // 3. CoinCap — per-asset requests in parallel (last resort)
  try {
    const cgIds  = coinIds.split(',')
    const tickers = cgIds.map(id => tickerMap[id]).filter(Boolean)
    const capIds  = tickers.map(t => COINCAP_ID[t]).filter(Boolean)

    const results = await Promise.allSettled(
      capIds.map(capId => tryFetch(`https://api.coincap.io/v2/assets/${capId}`))
    )
    const coins = results
      .map((r, i) => {
        if (r.status !== 'fulfilled') return null
        const d    = r.value.data
        if (!d) return null
        const ticker = tickers[i]
        const cgId   = cgIds.find(id => tickerMap[id] === ticker)
        return {
          id:                                    cgId,
          symbol:                                ticker.toLowerCase(),
          name:                                  d.name ?? ticker,
          image:                                 null,
          current_price:                         parseFloat(d.priceUsd),
          price_change_percentage_1h_in_currency: null,
          price_change_percentage_24h:           parseFloat(d.changePercent24Hr),
          price_change_percentage_7d_in_currency: null,
          market_cap:                            parseFloat(d.marketCapUsd),
          total_volume:                          parseFloat(d.volumeUsd24Hr),
          sparkline_in_7d:                       { price: [] },
          market_cap_rank:                       parseInt(d.rank),
          _fallback:                             true,
        }
      })
      .filter(Boolean)

    if (coins.length > 0) return { coins, source: 'coincap' }
  } catch (e) {
    console.warn(`[PriceFeed] CoinCap markets fallback failed: ${e.message}`)
  }

  return { coins: [], source: 'error' }
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchCoinChart(cgId, ticker, days)
//
// Used by CoinDetailModal to load price history for a specific timeframe.
// Returns: { prices, timestamps, source } or null.
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchCoinChart(cgId, ticker, days) {
  // 1. CoinGecko
  try {
    const interval = days === 1 ? '' : '&interval=daily'
    const d = await tryFetch(
      `${CG}/coins/${cgId}/market_chart` +
      `?vs_currency=usd&days=${days}${interval}`
    )
    if (d.prices?.length > 0) {
      return {
        prices:     d.prices.map(([, p]) => p),
        timestamps: d.prices.map(([t])   => t),
        source:     'coingecko',
      }
    }
    throw new Error('Empty response')
  } catch (e) {
    console.warn(`[PriceFeed] CoinGecko chart failed (${ticker} ${days}d): ${e.message}`)
  }

  // 2. Binance klines
  const binSym = BINANCE_SYMBOL[ticker]
  if (binSym) {
    try {
      const interval = BINANCE_INTERVAL[days] ?? '1d'
      const limit    = BINANCE_LIMIT[days]    ?? days
      const klines = await tryFetch(
        `https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=${interval}&limit=${limit}`
      )
      if (klines?.length > 0) {
        return {
          prices:     klines.map(k => parseFloat(k[4])),      // close price
          timestamps: klines.map(k => k[0]),                  // open time ms
          source:     'binance',
        }
      }
    } catch (e) {
      console.warn(`[PriceFeed] Binance chart failed (${ticker} ${days}d): ${e.message}`)
    }
  }

  // 3. CoinCap history
  const capId = COINCAP_ID[ticker]
  if (capId) {
    try {
      const now   = Date.now()
      const start = now - days * 24 * 60 * 60 * 1000
      const inter = days === 1 ? 'h1' : 'd1'
      const d = await tryFetch(
        `https://api.coincap.io/v2/assets/${capId}/history?interval=${inter}&start=${start}&end=${now}`
      )
      if (d.data?.length > 0) {
        return {
          prices:     d.data.map(pt => parseFloat(pt.priceUsd)),
          timestamps: d.data.map(pt => pt.time),
          source:     'coincap',
        }
      }
    } catch (e) {
      console.warn(`[PriceFeed] CoinCap chart failed (${ticker} ${days}d): ${e.message}`)
    }
  }

  return null
}

// Source display metadata
export const SOURCE_LABEL = {
  coingecko: { text: 'CoinGecko', color: 'text-emerald-500' },
  binance:   { text: 'Binance',   color: 'text-amber-400'  },
  coincap:   { text: 'CoinCap',   color: 'text-blue-400'   },
  error:     { text: 'Error',     color: 'text-red-500'    },
}

// ─────────────────────────────────────────────────────────────────────────────
// searchCoins(query)
//
// Queries CoinGecko /search and returns up to 8 matching coin entries.
// Used by the search UI to find any coin, not just the hardcoded list.
// Returns an array of { id, name, symbol, thumb, market_cap_rank } objects.
// ─────────────────────────────────────────────────────────────────────────────
export async function searchCoins(query) {
  try {
    const data = await tryFetch(
      `${CG}/search?query=${encodeURIComponent(query.trim())}`
    )
    return (data.coins ?? []).slice(0, 8)
  } catch { return [] }
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchCoinById(id)
//
// Fetches full market data for a single CoinGecko coin ID.
// Used when a search result is clicked for a coin not in the hardcoded list.
// Returns a coin object in CoinGecko /markets shape, or null.
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchCoinById(id) {
  try {
    const data = await tryFetch(
      `${CG}/coins/markets` +
      `?vs_currency=usd&ids=${encodeURIComponent(id)}&sparkline=true&price_change_percentage=1h,24h,7d`
    )
    return Array.isArray(data) && data.length > 0 ? data[0] : null
  } catch { return null }
}
