import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, ChevronDown, X } from 'lucide-react'
import coinManifest from '../assets/coinManifest.json'
import { fetchPrice } from '../utils/fetchPrice'

// Merge manifest into POPULAR (adds localIcon + up-to-date mockPrice where available)
function mergeManifest(coin) {
  const m = coinManifest[coin.sym]
  return m
    ? { ...coin, localIcon: m.localIcon, mockPrice: m.mockPrice ?? coin.mockPrice }
    : coin
}

// Popular coins shown before any search query
export const POPULAR = [
  { sym: 'BTC',   id: 'bitcoin',           name: 'Bitcoin',         mockPrice: 64200 },
  { sym: 'ETH',   id: 'ethereum',          name: 'Ethereum',        mockPrice: 3120  },
  { sym: 'SOL',   id: 'solana',            name: 'Solana',          mockPrice: 145   },
  { sym: 'BNB',   id: 'binancecoin',       name: 'BNB',             mockPrice: 580   },
  { sym: 'XRP',   id: 'ripple',            name: 'XRP',             mockPrice: 0.62  },
  { sym: 'ADA',   id: 'cardano',           name: 'Cardano',         mockPrice: 0.45  },
  { sym: 'AVAX',  id: 'avalanche-2',       name: 'Avalanche',       mockPrice: 35    },
  { sym: 'DOT',   id: 'polkadot',          name: 'Polkadot',        mockPrice: 7.2   },
  { sym: 'LINK',  id: 'chainlink',         name: 'Chainlink',       mockPrice: 14    },
  { sym: 'MATIC', id: 'matic-network',     name: 'Polygon',         mockPrice: 0.92  },
  { sym: 'UNI',   id: 'uniswap',          name: 'Uniswap',         mockPrice: 8.5   },
  { sym: 'ATOM',  id: 'cosmos',            name: 'Cosmos',          mockPrice: 9.1   },
  { sym: 'LTC',   id: 'litecoin',          name: 'Litecoin',        mockPrice: 82    },
  { sym: 'NEAR',  id: 'near',              name: 'NEAR Protocol',   mockPrice: 5.4   },
  { sym: 'ARB',   id: 'arbitrum',          name: 'Arbitrum',        mockPrice: 1.1   },
  { sym: 'OP',    id: 'optimism',          name: 'Optimism',        mockPrice: 1.9   },
  { sym: 'INJ',   id: 'injective-protocol',name: 'Injective',       mockPrice: 28    },
  { sym: 'SUI',   id: 'sui',              name: 'Sui',             mockPrice: 1.3   },
  { sym: 'APT',   id: 'aptos',             name: 'Aptos',           mockPrice: 9.0   },
  { sym: 'DOGE',  id: 'dogecoin',          name: 'Dogecoin',        mockPrice: 0.14  },
]

const POPULAR_MAP = Object.fromEntries(POPULAR.map(c => [c.sym, mergeManifest(c)]))
const POPULAR_MERGED = POPULAR.map(mergeManifest)

/**
 * CryptoSearch — searchable crypto picker with live CoinGecko price fetch.
 *
 * Props:
 *   value        {string}   current symbol, e.g. "BTC"
 *   onChange     {function} called with { sym, id, name, mockPrice } + resolved live price
 *   onPriceLoad  {function} called with (livePrice: number | null) after fetch
 *   disabled     {boolean}
 *   pairSuffix   {string}   appended for display only, e.g. "/USDC" (default "")
 */
export default function CryptoSearch({ value, onChange, onPriceLoad, disabled, pairSuffix = '' }) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState(POPULAR_MERGED)
  const [searching, setSearching]   = useState(false)
  const [fetchingPrice, setFetchingPrice] = useState(false)
  const inputRef  = useRef(null)
  const wrapRef   = useRef(null)
  const debounce  = useRef(null)

  const selected = POPULAR_MAP[value] ?? { sym: value, name: value, mockPrice: null }

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults(POPULAR_MERGED)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Debounced CoinGecko search
  const searchCoins = useCallback((q) => {
    clearTimeout(debounce.current)
    if (!q.trim()) { setResults(POPULAR); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`,
          { signal: AbortSignal.timeout(5000) }
        )
        if (!res.ok) throw new Error()
        const data = await res.json()
        const coins = (data.coins ?? []).slice(0, 30).map(c => {
          const sym = c.symbol.toUpperCase()
          const m = coinManifest[sym]
          return {
            sym,
            id:        c.id,
            name:      c.name,
            mockPrice: m?.mockPrice ?? POPULAR_MAP[sym]?.mockPrice ?? null,
            localIcon: m?.localIcon ?? null,
            thumb:     c.thumb,
          }
        })
        setResults(coins.length ? coins : POPULAR)
      } catch {
        setResults(POPULAR)
      } finally {
        setSearching(false)
      }
    }, 350)
  }, [])

  async function fetchLivePrice(coin) {
    setFetchingPrice(true)
    onPriceLoad?.(null)
    const p = await fetchPrice(coin.sym, coin.id)
    onPriceLoad?.(p ?? coin.mockPrice)
    setFetchingPrice(false)
  }

  function pick(coin) {
    setOpen(false)
    onChange(coin)
    fetchLivePrice(coin)
  }

  return (
    <div ref={wrapRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 bg-[#0d0d20] border border-white/[0.07] rounded-lg px-3 py-2.5 text-white text-sm hover:border-violet-500/50 focus:outline-none focus:border-violet-500 disabled:opacity-50 transition-colors"
      >
        <span className="font-mono font-bold">
          {selected.sym}{pairSuffix}
          <span className="text-slate-500 font-normal ml-2 text-xs">{selected.name}</span>
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[260px] bg-[#0d0d20] border border-white/[0.1] rounded-xl shadow-2xl overflow-hidden">
          {/* Search bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.07]">
            <Search size={13} className="text-slate-500 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); searchCoins(e.target.value) }}
              placeholder="Search any coin…"
              className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder-slate-600"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); setResults(POPULAR) }}>
                <X size={13} className="text-slate-500 hover:text-white" />
              </button>
            )}
            {searching && <span className="text-slate-600 text-xs">…</span>}
          </div>

          {/* Results */}
          <ul className="max-h-56 overflow-y-auto">
            {results.map(coin => (
              <li key={coin.id ?? coin.sym}>
                <button
                  type="button"
                  onClick={() => pick(coin)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-violet-950/40 transition-colors text-left ${
                    coin.sym === value ? 'bg-violet-950/30 text-violet-300' : 'text-white'
                  }`}
                >
                  {coin.localIcon
                    ? <img src={coin.localIcon} alt="" className="w-5 h-5 rounded-full shrink-0" />
                    : coin.thumb
                      ? <img src={coin.thumb} alt="" className="w-5 h-5 rounded-full shrink-0" />
                      : <span className="w-5 h-5 rounded-full bg-violet-900/50 shrink-0 flex items-center justify-center text-violet-300 text-[9px] font-bold">{coin.sym[0]}</span>
                  }
                  <span className="font-mono font-bold text-xs">{coin.sym}</span>
                  <span className="text-slate-400 text-xs truncate">{coin.name}</span>
                  {coin.mockPrice != null && (
                    <span className="ml-auto text-slate-600 text-xs font-mono">${coin.mockPrice.toLocaleString()}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fetchingPrice && (
        <p className="text-slate-600 text-xs mt-1">Fetching live price…</p>
      )}
    </div>
  )
}
