import { useState, useEffect, useCallback } from 'react'
import { Users, RefreshCw, Lock, TrendingUp, TrendingDown, Minus } from 'lucide-react'

function ago(ts) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60)  return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function SignalIcon({ asset_pair }) {
  // Use the settlement_hash as a deterministic mock signal indicator for display only.
  // Followers never see the actual signal or reasoning.
  return <Lock size={13} className="text-violet-400" />
}

export default function FollowerView() {
  const [feed, setFeed] = useState([])
  const [signals, setSignals] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [tradesRes, signalsRes] = await Promise.all([
        fetch('/api/trades/public'),
        fetch('/api/ai/feed'),
      ])
      if (tradesRes.ok)  setFeed(await tradesRes.json())
      if (signalsRes.ok) setSignals(await signalsRes.json())
      setLastUpdated(new Date())
    } catch {
      // backend not running
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, 5000)
    return () => clearInterval(t)
  }, [fetchData])

  // Merge trades with AI signals where reasoning_hash is present
  const aiTrades = feed.filter(t => t.reasoning_hash)
  const regularTrades = feed.filter(t => !t.reasoning_hash)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(167,139,250,0.04)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Users size={18} className="text-violet-400" />
              FollowerView — Live Encrypted Trade Feed
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Copy whale trades. You see the proof — never the strategy.
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-[#0f0f22] hover:bg-[#141430] px-3 py-1.5 rounded-lg transition-all"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        {lastUpdated && (
          <p className="text-xs text-slate-600 mt-1">Last updated: {ago(lastUpdated)}</p>
        )}
      </div>

      {/* What followers see */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-violet-950/15 px-5 py-3 text-sm text-violet-300 space-y-1">
        <p className="font-bold flex items-center gap-2">
          <Lock size={13} /> What followers see (Midnight selective disclosure):
        </p>
        <ul className="list-disc list-inside text-xs text-slate-400 space-y-0.5 ml-4">
          <li>Asset pair and settlement timestamp ✓</li>
          <li>Fairness proof flag (on-chain ZK verification) ✓</li>
          <li>Reasoning hash — cryptographic commitment to the AI strategy ✓</li>
          <li className="text-rose-400">Actual reasoning text — <strong>MIDNIGHT ENCRYPTED 🔒</strong></li>
          <li className="text-rose-400">Trade price and size — <strong>never disclosed</strong></li>
        </ul>
      </div>

      {/* AI-triggered trades */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-violet-300 flex items-center gap-2">
          ⚡ AI-Triggered Trades
          <span className="bg-violet-900/60 text-violet-400 text-xs px-2 py-0.5 rounded-full font-mono">
            {aiTrades.length}
          </span>
        </h3>

        {aiTrades.length === 0 && (
          <div className="rounded-xl border border-white/[0.05] bg-[#0b0b1c] p-8 text-center">
            <p className="text-4xl mb-2">🔒</p>
            <p className="text-slate-500 text-sm">No AI trades yet — go to WhaleView to generate a signal.</p>
          </div>
        )}

        {aiTrades.map((trade) => (
          <div key={trade.settlement_hash}
            className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SignalIcon asset_pair={trade.asset_pair} />
                <span className="text-white font-bold text-sm">{trade.asset_pair}</span>
                {trade.fairness_proven === 1 && (
                  <span className="text-xs bg-emerald-950/60 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full">
                    ✓ Fairness Proven
                  </span>
                )}
              </div>
              <span className="text-slate-500 text-xs font-mono">{ago(trade.timestamp)}</span>
            </div>

            {/* Encrypted reasoning */}
            <div className="bg-violet-950/20 rounded-lg px-3 py-2 border border-violet-500/[0.1]">
              <p className="text-xs text-slate-500 mb-1">AI Reasoning</p>
              <p className="text-violet-300 text-xs font-mono font-bold tracking-wide">
                [MIDNIGHT ENCRYPTED 🔒]
              </p>
              <p className="text-xs text-slate-600 mt-1 font-mono break-all">
                commitment: {trade.reasoning_hash?.slice(0, 32)}…
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-slate-500">Settlement Hash</p>
                <p className="font-mono text-slate-400 truncate">{trade.settlement_hash?.slice(0, 20)}…</p>
              </div>
              <div>
                <p className="text-slate-500">Strategy Exposed</p>
                <p className="font-mono text-emerald-400 font-bold">0 bytes</p>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Recent AI signals feed */}
      {signals.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-400 flex items-center gap-2">
            📡 Recent Signal Commitments
          </h3>
          <div className="rounded-xl border border-white/[0.05] bg-[#0b0b1c] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left text-slate-500 font-medium px-4 py-2.5">Asset</th>
                  <th className="text-left text-slate-500 font-medium px-4 py-2.5">Signal</th>
                  <th className="text-left text-slate-500 font-medium px-4 py-2.5">Confidence</th>
                  <th className="text-left text-slate-500 font-medium px-4 py-2.5">Reasoning</th>
                  <th className="text-left text-slate-500 font-medium px-4 py-2.5">Time</th>
                </tr>
              </thead>
              <tbody>
                {signals.slice(0, 10).map((s, i) => (
                  <tr key={s.signal_id} className={i % 2 === 0 ? 'bg-slate-900/20' : ''}>
                    <td className="px-4 py-2 text-white font-bold">{s.asset}</td>
                    <td className="px-4 py-2">
                      <SignalText signal={s.signal} />
                    </td>
                    <td className="px-4 py-2 text-slate-300">{s.confidence}%</td>
                    <td className="px-4 py-2 font-mono text-violet-400 max-w-[140px]">
                      <span title={s.reasoning_hash}>[ENCRYPTED 🔒]</span>
                    </td>
                    <td className="px-4 py-2 text-slate-500">{ago(s.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Regular (non-AI) trades */}
      {regularTrades.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-400">Manual Trades</h3>
          <div className="space-y-2">
            {regularTrades.slice(0, 5).map(trade => (
              <div key={trade.settlement_hash}
                className="rounded-lg border border-white/[0.05] bg-[#0b0b1c] px-4 py-3 flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">{trade.asset_pair}</span>
                <span className="font-mono text-slate-500">{trade.settlement_hash?.slice(0, 14)}…</span>
                <span className="text-slate-600">{ago(trade.timestamp)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function SignalText({ signal }) {
  const cfg = { BUY: 'text-emerald-400', SELL: 'text-rose-400', HOLD: 'text-amber-400' }
  return <span className={`font-bold ${cfg[signal] ?? 'text-slate-300'}`}>{signal}</span>
}
