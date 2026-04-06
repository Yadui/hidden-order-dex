import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, BarChart2 } from 'lucide-react'

export default function OrderbookView() {
  const [book, setBook] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchBook = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/orderbook')
      if (res.ok) {
        setBook(await res.json())
        setLastUpdated(new Date())
      }
    } catch {
      // backend not running yet
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBook()
    const interval = setInterval(fetchBook, 5000)
    return () => clearInterval(interval)
  }, [fetchBook])

  const totalBids = book.reduce((s, p) => s + p.bids, 0)
  const totalAsks = book.reduce((s, p) => s + p.asks, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(167,139,250,0.04)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <BarChart2 size={18} className="text-violet-400" />
              Dark Pool Order Book
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Depth counts only &mdash; prices and sizes are hidden by design.
            </p>
          </div>
          <button
            onClick={fetchBook}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-[#0f0f22] hover:bg-[#141430] px-3 py-1.5 rounded-lg transition-all"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Privacy notice */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-violet-950/15 px-5 py-3 text-sm text-violet-300 flex items-start gap-3">
        <span className="mt-0.5">🔒</span>
        <span>
          Order prices and sizes are sealed inside ZK proofs. Only the count of open
          bids and asks is disclosed &mdash; proving liquidity exists without revealing
          any trader&apos;s strategy.
        </span>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Total Bids" value={totalBids} color="emerald" />
        <StatCard label="Total Asks" value={totalAsks} color="rose" />
      </div>

      {/* Per-pair table */}
      {book.length === 0 ? (
        <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-12 text-center shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
          <p className="text-4xl mb-3">🌑</p>
          <p className="text-slate-400 text-sm">
            No open orders yet &mdash; submit a hidden order to light up the dark pool.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left">
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium">Pair</th>
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium text-center">Bids</th>
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium text-center">Asks</th>
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium text-center">Depth Bar</th>
              </tr>
            </thead>
            <tbody>
              {book.map((row, i) => {
                const total = row.bids + row.asks || 1
                const bidPct = Math.round((row.bids / total) * 100)
                const askPct = 100 - bidPct
                return (
                  <tr
                    key={row.asset_pair}
                    className={`border-b border-slate-800/50 hover:bg-violet-950/20 transition-colors ${
                      i % 2 === 0 ? 'bg-slate-900/20' : ''
                    }`}
                  >
                    <td className="px-5 py-4">
                      <span className="bg-violet-900/40 text-violet-300 border border-violet-700/50 px-2 py-0.5 rounded text-xs font-mono font-bold">
                        {row.asset_pair}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="text-emerald-400 font-bold font-mono">{row.bids}</span>
                      <span className="text-slate-600 text-xs ml-1">bids</span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="text-rose-400 font-bold font-mono">{row.asks}</span>
                      <span className="text-slate-600 text-xs ml-1">asks</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex rounded-full overflow-hidden h-2 w-full bg-slate-800">
                        <div
                          className="bg-emerald-600 transition-all duration-500"
                          style={{ width: `${bidPct}%` }}
                        />
                        <div
                          className="bg-rose-700 transition-all duration-500"
                          style={{ width: `${askPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-slate-600 mt-1 font-mono">
                        <span>{bidPct}% buy</span>
                        <span>{askPct}% sell</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {lastUpdated && (
        <p className="text-xs text-slate-600 text-center font-mono">
          Last updated: {lastUpdated.toLocaleTimeString()} &nbsp;&bull;&nbsp; auto-refreshes every 5 s
        </p>
      )}
    </div>
  )
}

function StatCard({ label, value, color }) {
  const colors = {
    emerald: 'border-emerald-500/[0.12] bg-emerald-950/15 text-emerald-400',
    rose: 'border-rose-500/[0.12] bg-rose-950/15 text-rose-400',
  }
  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <p className="text-slate-500 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold font-mono mt-1">{value}</p>
      <p className="text-slate-600 text-xs mt-1">open orders &mdash; prices hidden</p>
    </div>
  )
}
