import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, RefreshCw } from 'lucide-react'
import ProofDrawer from './ProofDrawer'

export default function SettlementFeed() {
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(false)
  const [proof, setProof] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const fetchTrades = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/trades/public')
      if (res.ok) setTrades(await res.json())
    } catch {
      // backend not running
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTrades()
    const interval = setInterval(fetchTrades, 6000)
    return () => clearInterval(interval)
  }, [fetchTrades])

  function openProof(trade) {
    setProof({
      order_id: null,
      proof_hash: trade.proof_hash,
      settlement_hash: trade.settlement_hash,
      asset_pair: trade.asset_pair,
      timestamp: trade.timestamp,
      fairness_proven: trade.fairness_proven,
      zk_mode: trade.zk_mode ?? 'mock',
      order_status: 2,
      contract_address: null,
      tx_hash: null,
    })
    setDrawerOpen(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(167,139,250,0.04)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <ShieldCheck size={18} className="text-violet-400" />
              Public Settlement Feed
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Trade settled &mdash; price hidden, fairness proven ✓
            </p>
          </div>
          <button
            onClick={fetchTrades}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-[#0f0f22] hover:bg-[#141430] px-3 py-1.5 rounded-lg transition-all"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* What's public callout */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-violet-950/15 px-5 py-3 text-sm text-violet-300 space-y-1">
        <p className="font-bold">What is public on Midnight:</p>
        <ul className="list-disc list-inside text-xs text-slate-400 space-y-0.5">
          <li>Settlement hash &mdash; cryptographic commitment to the trade</li>
          <li>Asset pair and timestamp</li>
          <li>Fairness proof flag (on-chain ZK verification)</li>
        </ul>
        <p className="text-xs text-slate-500 mt-1">
          Price, amount, order IDs, and counterparty identities are never disclosed.
        </p>
      </div>

      {/* Feed */}
      {trades.length === 0 ? (
        <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-12 text-center shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
          <p className="text-4xl mb-3">🌑</p>
          <p className="text-slate-400 text-sm">No settled trades yet.</p>
          <p className="text-slate-600 text-xs mt-1">
            Submit and match orders to see the public settlement feed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {trades.map((trade) => (
            <div
              key={trade.settlement_hash}
              className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-5 space-y-3 hover:border-violet-500/25 transition-colors cursor-pointer"
              onClick={() => openProof(trade)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-violet-900/40 text-violet-300 border border-violet-700/50 px-2 py-0.5 rounded text-xs font-mono font-bold">
                      {trade.asset_pair}
                    </span>
                    {trade.fairness_proven === 1 && (
                      <span className="flex items-center gap-1 bg-emerald-950/50 text-emerald-300 border border-emerald-700/60 px-2 py-0.5 rounded text-xs font-bold">
                        <ShieldCheck size={11} />
                        Fairness Proven
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 font-mono">
                    {new Date(trade.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Settlement hash */}
              <div className="bg-[#0d0d20]/70 border border-white/[0.06] rounded-lg px-4 py-3">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Settlement Hash</p>
                <p className="text-violet-300 font-mono text-xs break-all">{trade.settlement_hash}</p>
              </div>

              {/* Hidden price notice */}
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-2">
                  <span>🔒</span>
                  <span>Trade settled &mdash; price hidden, fairness proven ✓</span>
                </span>
                <span className="text-violet-400 font-medium">View proof →</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProofDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        proof={proof}
      />
    </div>
  )
}
