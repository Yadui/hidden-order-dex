import { useState, useEffect, useRef } from 'react'
import { X, RefreshCw } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────
const COIN_IDS   = 'bitcoin,ethereum,solana,matic-network,avalanche-2,chainlink,cardano,polkadot'
const TICKER_MAP = {
  bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', 'matic-network': 'MATIC',
  'avalanche-2': 'AVAX', chainlink: 'LINK', cardano: 'ADA', polkadot: 'DOT',
}
const TIMEFRAMES = [
  { label: '24H', days: 1  },
  { label: '7D',  days: 7  },
  { label: '1M',  days: 30 },
  { label: '3M',  days: 90 },
]

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (Math.abs(n) >= 1e9)  return '$' + (n / 1e9).toFixed(2)  + 'B'
  if (Math.abs(n) >= 1e6)  return '$' + (n / 1e6).toFixed(2)  + 'M'
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function fmtPrice(p) {
  if (p == null) return '—'
  if (p >= 1000) return '$' + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return '$' + p.toFixed(p < 1 ? 4 : 2)
}

// ── Sparkline (row mini chart) ────────────────────────────────────────────────
function Sparkline({ prices, width = 120, height = 38, positive }) {
  if (!prices || prices.length < 2) {
    return <div style={{ width, height }} className="bg-slate-800/50 rounded animate-pulse" />
  }
  const min   = Math.min(...prices)
  const max   = Math.max(...prices)
  const range = max - min || 1
  const pts   = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * width
    const y = height - ((p - min) / range) * (height - 6) - 3
    return [x.toFixed(1), y.toFixed(1)]
  })
  const linePts  = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const areaPts  = `0,${height} ${linePts} ${width},${height}`
  const color    = positive ? '#34d399' : '#f87171'
  const gradId   = `sg-${positive ? 'g' : 'r'}`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0"    />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#${gradId})`} />
      <polyline
        points={linePts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ── Area chart (modal) ────────────────────────────────────────────────────────
function AreaChart({ prices, timestamps, positive }) {
  const [hoverIdx, setHoverIdx] = useState(null)
  const svgRef = useRef(null)

  if (!prices || prices.length < 2) {
    return <div className="h-48 bg-slate-800/30 rounded-xl animate-pulse" />
  }

  const W = 560, H = 180, PL = 8, PR = 8, PT = 16, PB = 22
  const IW = W - PL - PR
  const IH = H - PT - PB
  const min   = Math.min(...prices)
  const max   = Math.max(...prices)
  const range = max - min || 1
  const color = positive ? '#34d399' : '#f87171'
  const gradId = `ac-${positive ? 'g' : 'r'}`

  const pts = prices.map((p, i) => {
    const x = PL + (i / (prices.length - 1)) * IW
    const y = PT + IH - ((p - min) / range) * IH
    return [x, y]
  })

  const linePts = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaPts = `${PL},${PT + IH} ${linePts} ${PL + IW},${PT + IH}`

  // 5 x-axis time labels
  const xLabels = [0, 0.25, 0.5, 0.75, 1].map(frac => {
    const idx = Math.round(frac * (prices.length - 1))
    const [x] = pts[idx]
    const ts  = timestamps?.[idx]
    let label = ''
    if (ts) {
      const d = new Date(ts)
      label = prices.length <= 48
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString([],  { month: 'short', day: 'numeric'   })
    }
    return { x, label }
  })

  // 3 y-axis price labels
  const yLabels = [min, (min + max) / 2, max].map(p => ({
    y: PT + IH - ((p - min) / range) * IH,
    label: fmtPrice(p),
  }))

  const hPt    = hoverIdx != null ? pts[hoverIdx]    : null
  const hPrice = hoverIdx != null ? prices[hoverIdx] : null

  function handleMouseMove(e) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const relX = ((e.clientX - rect.left) / rect.width) * W
    let closest = 0, minDist = Infinity
    pts.forEach(([x], i) => {
      const d = Math.abs(x - relX)
      if (d < minDist) { minDist = d; closest = i }
    })
    setHoverIdx(closest)
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 190 }}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.28" />
            <stop offset="80%"  stopColor={color} stopOpacity="0.04" />
            <stop offset="100%" stopColor={color} stopOpacity="0"    />
          </linearGradient>
        </defs>

        {/* Subtle grid lines */}
        {yLabels.map(({ y }, i) => (
          <line key={i} x1={PL} y1={y} x2={PL + IW} y2={y}
            stroke="#1e293b" strokeWidth="1" />
        ))}

        {/* Area fill */}
        <polygon points={areaPts} fill={`url(#${gradId})`} />

        {/* Price line */}
        <polyline
          points={linePts}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Y-axis labels */}
        {yLabels.map(({ y, label }, i) => (
          <text key={i} x={PL + IW + 2} y={y + 3}
            fontSize="7" fill="#475569" fontFamily="monospace" textAnchor="start">
            {label}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabels.map(({ x, label }, i) => (
          <text key={i} x={x} y={H - 4}
            fontSize="7" fill="#475569" fontFamily="monospace" textAnchor="middle">
            {label}
          </text>
        ))}

        {/* Hover: crosshair + dot */}
        {hPt && (
          <>
            <line
              x1={hPt[0]} y1={PT} x2={hPt[0]} y2={PT + IH}
              stroke={color} strokeWidth="1" strokeDasharray="3,2" opacity="0.5"
            />
            <circle cx={hPt[0]} cy={hPt[1]} r="3.5" fill={color} />
          </>
        )}
      </svg>

      {/* Hover price tooltip */}
      {hPt && hPrice != null && (
        <div
          className="absolute top-1 bg-slate-900/95 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-white pointer-events-none z-10 shadow-lg"
          style={{ left: `${(hPt[0] / W) * 100}%`, transform: 'translateX(-50%)' }}
        >
          {fmtPrice(hPrice)}
        </div>
      )}
    </div>
  )
}

// ── CoinDetailModal ───────────────────────────────────────────────────────────
function CoinDetailModal({ coin, onClose, onSelectAsset, midnightEnabled }) {
  const [timeframe,    setTimeframe]    = useState('7D')
  const [chartData,    setChartData]    = useState(null)
  const [chartLoading, setChartLoading] = useState(false)
  const cacheRef = useRef({})

  async function loadChart(tf) {
    const days    = TIMEFRAMES.find(t => t.label === tf)?.days ?? 7
    const cacheKey = `${coin.id}-${tf}`
    if (cacheRef.current[cacheKey]) {
      setChartData(cacheRef.current[cacheKey])
      return
    }
    setChartLoading(true)
    try {
      const interval = days === 1 ? '' : '&interval=daily'
      const r = await fetch(
        `https://api.coingecko.com/api/v3/coins/${coin.id}/market_chart?vs_currency=usd&days=${days}${interval}`,
        { signal: AbortSignal.timeout(12000) }
      )
      if (!r.ok) return
      const d    = await r.json()
      const data = {
        prices:     d.prices.map(([, p]) => p),
        timestamps: d.prices.map(([t])   => t),
      }
      cacheRef.current[cacheKey] = data
      setChartData(data)
    } catch { /* ignore */ } finally {
      setChartLoading(false)
    }
  }

  // Seed 7D from sparkline_in_7d so the modal opens instantly
  useEffect(() => {
    const spPrices = coin.sparkline_in_7d?.price ?? []
    if (spPrices.length) {
      const now   = Date.now()
      const count = spPrices.length
      const data  = {
        prices:     spPrices,
        timestamps: spPrices.map((_, i) => now - (count - 1 - i) * 3600 * 1000),
      }
      cacheRef.current[`${coin.id}-7D`] = data
      setChartData(data)
    } else {
      loadChart('7D')
    }
  }, [coin.id])

  useEffect(() => { loadChart(timeframe) }, [timeframe])

  const ticker   = TICKER_MAP[coin.id] ?? coin.symbol?.toUpperCase()
  const change24 = coin.price_change_percentage_24h
  const change7d = coin.price_change_percentage_7d_in_currency
  const is24Pos  = (change24 ?? 0) >= 0
  const is7dPos  = (change7d  ?? 0) >= 0
  const chartPos = chartData?.prices?.length >= 2
    ? chartData.prices.at(-1) >= chartData.prices[0]
    : true

  const accentActive = midnightEnabled ? 'bg-violet-700 text-white' : 'bg-red-700 text-white'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-2xl bg-[#0b0b1a] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-800 flex-shrink-0">
          {coin.image && (
            <img src={coin.image} alt={coin.name} className="w-10 h-10 rounded-full" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="text-white font-bold text-xl leading-none">{coin.name}</p>
              <span className="text-slate-500 text-sm font-mono">{ticker}</span>
            </div>
            <div className="flex items-baseline gap-3 mt-0.5">
              <p className="text-white font-mono text-2xl font-bold">
                {fmtPrice(coin.current_price)}
              </p>
              <span className={`text-sm font-mono font-bold ${is24Pos ? 'text-emerald-400' : 'text-red-400'}`}>
                {is24Pos ? '▲' : '▼'} {Math.abs(change24 ?? 0).toFixed(2)}%
                <span className="text-slate-500 font-normal ml-1">24h</span>
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors p-1 flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">
          {/* Chart area */}
          <div className="px-5 pt-4">
            {/* Timeframe tabs */}
            <div className="flex gap-1 mb-3">
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf.label}
                  onClick={() => setTimeframe(tf.label)}
                  className={`px-3 py-1 rounded text-xs font-mono font-bold transition-all ${
                    timeframe === tf.label
                      ? accentActive
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
              {chartLoading && (
                <span className="ml-2 text-xs text-slate-600 font-mono self-center">loading…</span>
              )}
            </div>

            <div className="rounded-xl bg-[#07071a] border border-slate-800/60 px-3 pt-2 pb-1 overflow-hidden">
              {chartData
                ? <AreaChart
                    prices={chartData.prices}
                    timestamps={chartData.timestamps}
                    positive={chartPos}
                  />
                : <div className="h-48 bg-slate-800/30 rounded animate-pulse" />
              }
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2.5 px-5 py-4">
            {[
              { label: 'Market Cap',        value: fmtUsd(coin.market_cap)      },
              { label: '24h Volume',         value: fmtUsd(coin.total_volume)   },
              { label: '7d Change',          value: `${is7dPos ? '▲' : '▼'} ${Math.abs(change7d ?? 0).toFixed(2)}%`,
                color: is7dPos ? 'text-emerald-400' : 'text-red-400'           },
              { label: '24h High',           value: fmtPrice(coin.high_24h)     },
              { label: '24h Low',            value: fmtPrice(coin.low_24h)      },
              { label: 'Circulating Supply', value: coin.circulating_supply
                ? `${(coin.circulating_supply / 1e6).toFixed(2)}M ${ticker}`
                : '—'                                                           },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-900/70 rounded-lg px-3 py-2.5">
                <p className="text-slate-500 text-xs uppercase tracking-wide leading-none">{label}</p>
                <p className={`text-sm font-mono font-bold mt-1.5 ${color ?? 'text-white'}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="px-5 pb-5">
            <button
              onClick={() => { onSelectAsset(ticker); onClose() }}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
                midnightEnabled
                  ? 'bg-violet-700 hover:bg-violet-600 text-white'
                  : 'bg-red-700 hover:bg-red-600 text-white'
              }`}
            >
              Select {ticker} · Trade with ZK Protection →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── MarketOverview (main export) ──────────────────────────────────────────────
export default function MarketOverview({ midnightEnabled, onSelectAsset }) {
  const [coins,       setCoins]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [selectedCoin,setSelectedCoin]= useState(null)

  async function fetchMarkets() {
    try {
      const r = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets` +
        `?vs_currency=usd&ids=${COIN_IDS}&order=market_cap_desc` +
        `&sparkline=true&price_change_percentage=1h,24h,7d`,
        { signal: AbortSignal.timeout(12000) }
      )
      if (!r.ok) return
      setCoins(await r.json())
      setLastUpdated(new Date())
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMarkets()
    const iv = setInterval(fetchMarkets, 60000)
    return () => clearInterval(iv)
  }, [])

  const borderColor = midnightEnabled ? 'border-violet-800/40' : 'border-red-800/40'
  const cardBg      = midnightEnabled ? 'bg-[#10101f]'         : 'bg-[#150808]'

  return (
    <>
      {selectedCoin && (
        <CoinDetailModal
          coin={selectedCoin}
          onClose={() => setSelectedCoin(null)}
          onSelectAsset={onSelectAsset}
          midnightEnabled={midnightEnabled}
        />
      )}

      <div className={`rounded-xl border ${borderColor} ${cardBg} overflow-hidden`}>
        {/* Section header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/60">
          <div className="flex items-center gap-2">
            <span className="text-white text-sm font-bold uppercase tracking-wide">Market Overview</span>
            <span className="text-emerald-500 text-xs font-mono font-bold">● LIVE</span>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-slate-600 text-xs font-mono">
                {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <button
              onClick={fetchMarkets}
              className="text-slate-500 hover:text-slate-300 transition-colors"
              title="Refresh market data"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {/* Column headers */}
        <div className="grid items-center gap-x-3 px-4 py-2 border-b border-slate-800/40"
          style={{ gridTemplateColumns: '1.5rem 1fr 7rem 5rem 5rem 6rem 7.5rem' }}>
          {['#', 'Coin', 'Price', '24h', '7d', '24h Volume', 'Last 7 Days'].map((h, i) => (
            <span
              key={h}
              className={`text-xs text-slate-600 uppercase tracking-wide font-medium ${i >= 2 ? 'text-right' : ''}`}
            >
              {h}
            </span>
          ))}
        </div>

        {/* Skeleton while loading */}
        {loading && (
          <div className="space-y-px">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-14 bg-slate-800/20 animate-pulse" />
            ))}
          </div>
        )}

        {/* Coin rows */}
        {!loading && coins.map((coin, idx) => {
          const ticker   = TICKER_MAP[coin.id] ?? coin.symbol?.toUpperCase()
          const change24 = coin.price_change_percentage_24h
          const change7d = coin.price_change_percentage_7d_in_currency
          const is24Pos  = (change24 ?? 0) >= 0
          const is7dPos  = (change7d  ?? 0) >= 0
          const sparkPrices = coin.sparkline_in_7d?.price ?? []
          const sparkPos    = sparkPrices.length >= 2
            ? sparkPrices.at(-1) >= sparkPrices[0]
            : true

          return (
            <button
              key={coin.id}
              onClick={() => setSelectedCoin(coin)}
              className="w-full grid items-center gap-x-3 px-4 py-3 border-b border-slate-800/30
                         last:border-b-0 hover:bg-slate-800/25 transition-colors text-left group"
              style={{ gridTemplateColumns: '1.5rem 1fr 7rem 5rem 5rem 6rem 7.5rem' }}
            >
              {/* Rank */}
              <span className="text-slate-600 text-xs font-mono">{idx + 1}</span>

              {/* Coin name */}
              <div className="flex items-center gap-2 min-w-0">
                {coin.image
                  ? <img src={coin.image} alt={coin.name}
                      className="w-6 h-6 rounded-full flex-shrink-0" />
                  : <div className="w-6 h-6 rounded-full bg-slate-700 flex-shrink-0" />
                }
                <span className="text-white text-sm font-semibold truncate
                                 group-hover:text-violet-300 transition-colors">
                  {coin.name}
                </span>
                <span className="text-slate-500 text-xs font-mono flex-shrink-0">{ticker}</span>
              </div>

              {/* Price */}
              <span className="text-white text-sm font-mono font-bold text-right">
                {fmtPrice(coin.current_price)}
              </span>

              {/* 24h % */}
              <span className={`text-xs font-mono font-bold text-right ${is24Pos ? 'text-emerald-400' : 'text-red-400'}`}>
                {is24Pos ? '▲' : '▼'} {Math.abs(change24 ?? 0).toFixed(2)}%
              </span>

              {/* 7d % */}
              <span className={`text-xs font-mono font-bold text-right ${is7dPos ? 'text-emerald-400' : 'text-red-400'}`}>
                {is7dPos ? '▲' : '▼'} {Math.abs(change7d ?? 0).toFixed(2)}%
              </span>

              {/* 24h Volume */}
              <span className="text-slate-400 text-xs font-mono text-right">
                {fmtUsd(coin.total_volume)}
              </span>

              {/* Sparkline */}
              <div className="flex justify-end">
                <Sparkline prices={sparkPrices} width={120} height={38} positive={sparkPos} />
              </div>
            </button>
          )
        })}

        {/* Empty state */}
        {!loading && coins.length === 0 && (
          <div className="text-center text-slate-600 py-8 text-sm font-mono">
            Could not load market data — CoinGecko may be rate-limited.{' '}
            <button onClick={fetchMarkets} className="text-slate-500 underline hover:text-white">
              Retry
            </button>
          </div>
        )}
      </div>
    </>
  )
}
