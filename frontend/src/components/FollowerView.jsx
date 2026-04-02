import { TrendingUp, TrendingDown, Copy, CheckCircle, AlertTriangle, Zap, Bot } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

// ── MEV Bot simulator — shown when Midnight is OFF ──────────────────────────
function FrontRunAttack({ trade }) {
  const [phase, setPhase] = useState(0)
  // phases: 0=scanning, 1=detected, 2=copying, 3=executed_ahead
  useEffect(() => {
    const timings = [800, 600, 700]
    let t = 0
    const timers = timings.map((delay, i) => {
      t += delay
      return setTimeout(() => setPhase(i + 1), t)
    })
    return () => timers.forEach(clearTimeout)
  }, [trade.trade_id])

  const lines = [
    { phase: 0, color: 'text-slate-500', text: '> MEV bot scanning mempool...' },
    { phase: 1, color: 'text-red-400',   text: `> ⚠️  WHALE SIGNAL DETECTED: ${trade.asset} ${trade.signal?.direction}` },
    { phase: 2, color: 'text-amber-400', text: `> Copying trade: ${trade.amount} ${trade.asset} @ $${Number(trade.price).toLocaleString()}` },
    { phase: 3, color: 'text-red-300 font-bold', text: `> ✅ FRONT-RUN EXECUTED — whale order will fill AFTER bot` },
  ]

  return (
    <div className="mt-3 bg-red-950/40 border border-red-700/60 rounded-lg p-3 space-y-1">
      <p className="text-red-400 text-xs font-bold flex items-center gap-1.5 mb-2">
        <Bot size={12} /> MEV Front-Running Attack
      </p>
      {lines.map((l, i) => (
        <p key={i} className={`font-mono text-xs transition-all duration-300 ${i <= phase ? l.color : 'text-slate-800'}`}>
          {l.text}
        </p>
      ))}
    </div>
  )
}

function TradeCard({ trade, midnightEnabled, isNew }) {
  const [copied, setCopied] = useState(false)
  const [flash, setFlash] = useState(isNew)

  useEffect(() => {
    if (isNew) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 1600)
      return () => clearTimeout(t)
    }
  }, [isNew])

  function handleCopy() {
    const text = [
      `Asset: ${trade.asset}`,
      `Amount: ${trade.amount} ${trade.asset}`,
      `Price: $${Number(trade.price).toLocaleString()}`,
      `Signal: ${trade.signal?.direction ?? '—'}`,
      `Confidence: ${trade.signal?.confidence ?? '—'}%`,
      `Proof ID: ${trade.proof_id}`,
      `Timestamp: ${new Date(trade.timestamp).toISOString()}`,
    ].join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const cardBg = midnightEnabled ? 'bg-[#10101f]' : 'bg-[#150808]'
  const accentBorder = midnightEnabled ? 'border-violet-800/50' : 'border-red-800/50'
  const flashRing = flash ? (midnightEnabled ? 'ring-2 ring-violet-400 shadow-lg shadow-violet-500/30' : 'ring-2 ring-emerald-400 shadow-lg shadow-emerald-500/20') : ''
  const ts = new Date(trade.timestamp).toLocaleTimeString()

  return (
    <div className={`rounded-xl border ${accentBorder} ${cardBg} ${flashRing} p-5 space-y-3 transition-all duration-500`}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold px-3 py-1 rounded-lg font-mono ${
            midnightEnabled
              ? 'bg-violet-900/50 text-violet-300 border border-violet-700'
              : 'bg-red-900/50 text-red-300 border border-red-700'
          }`}>
            {trade.asset}
          </span>
          <span className="text-slate-400 text-xs font-mono">{ts}</span>
        </div>
        {midnightEnabled ? (
          <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800 px-2 py-1 rounded font-medium">
            <CheckCircle size={11} /> ZK Proof Verified
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-950/40 border border-amber-800 px-2 py-1 rounded font-medium">
            <AlertTriangle size={11} /> Strategy Exposed — Front-Running Risk
          </span>
        )}
      </div>

      {/* Trade details */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-slate-500 text-xs uppercase tracking-wide">Amount</p>
          <p className="text-white font-mono font-bold">{trade.amount} {trade.asset}</p>
        </div>
        <div>
          <p className="text-slate-500 text-xs uppercase tracking-wide">Price</p>
          <p className="text-white font-mono font-bold">${Number(trade.price).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-slate-500 text-xs uppercase tracking-wide">Total</p>
          <p className="text-white font-mono font-bold">
            ${(trade.amount * trade.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Strategy section */}
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Strategy</p>
        {midnightEnabled ? (
          <div className="bg-violet-950/60 border border-violet-800 rounded-lg p-3">
            <p className="text-violet-300 font-mono text-sm font-bold">
              {trade.signal?.encrypted_payload || '[MIDNIGHT ENCRYPTED 🔒]'}
            </p>
            <p className="text-violet-700 text-xs mt-1 font-mono">
              Proof: {trade.proof_id?.slice(0, 24)}...
            </p>
          </div>
        ) : (
          <div className="bg-red-950/30 border border-red-700 rounded-lg p-3 space-y-1">
            <p className="text-red-400 text-xs font-bold flex items-center gap-1">
              <AlertTriangle size={11} /> ⚠️ STRATEGY EXPOSED
            </p>
            {trade.signal?.direction && (
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded ${
                  trade.signal.direction === 'BUY'
                    ? 'bg-emerald-900/50 text-emerald-300'
                    : 'bg-red-900/50 text-red-300'
                }`}>
                  {trade.signal.direction === 'BUY' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {trade.signal.direction}
                </span>
                {trade.signal.confidence != null && (
                  <span className="text-xs text-amber-400 font-mono">
                    Confidence: {trade.signal.confidence}%
                  </span>
                )}
              </div>
            )}
            {trade.signal?.reasoning && (
              <p className="text-slate-300 text-xs leading-relaxed pt-1">{trade.signal.reasoning}</p>
            )}
          </div>
        )}
      </div>

      {/* Front-running attack animation when Midnight is OFF */}
      {!midnightEnabled && <FrontRunAttack trade={trade} />}

      {/* Copy button */}
      <button
        onClick={handleCopy}
        className={`w-full py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
          copied
            ? 'bg-emerald-800 text-emerald-200'
            : 'bg-blue-700 hover:bg-blue-600 text-white'
        }`}
      >
        {copied ? (
          <><CheckCircle size={14} /> Trade Copied!</>
        ) : (
          <><Copy size={14} /> Copy Trade</>
        )}
      </button>
    </div>
  )
}

export default function FollowerView({ midnightEnabled, trades }) {
  const cardBg = midnightEnabled ? 'bg-[#10101f]' : 'bg-[#150808]'
  const accentBorder = midnightEnabled ? 'border-violet-800/60' : 'border-red-800/60'
  const listRef = useRef(null)
  const prevCountRef = useRef(trades.length)
  const [newestId, setNewestId] = useState(null)

  useEffect(() => {
    if (trades.length > prevCountRef.current && trades.length > 0) {
      // New trade arrived — flash the newest card and scroll to top
      setNewestId(trades[0]?.trade_id ?? null)
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      const t = setTimeout(() => setNewestId(null), 1800)
      prevCountRef.current = trades.length
      return () => clearTimeout(t)
    }
    prevCountRef.current = trades.length
  }, [trades.length])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={`rounded-xl border ${accentBorder} ${cardBg} p-5`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              👥 Live Trade Feed
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              {midnightEnabled
                ? 'Whale strategies are ZK-encrypted — copy trades safely without seeing the edge'
                : '⚠️ Midnight protection is OFF — strategies are fully visible to all participants'
              }
            </p>
          </div>
          <span className={`text-xs px-3 py-1.5 rounded-full font-mono font-bold ${
            midnightEnabled
              ? 'bg-violet-900/50 text-violet-300 border border-violet-700'
              : 'bg-red-900/50 text-red-300 border border-red-700'
          }`}>
            {trades.length} trades
          </span>
        </div>
      </div>

      {/* Trade list */}
      {trades.length === 0 ? (
        <div className={`rounded-xl border ${accentBorder} ${cardBg} p-12 text-center`}>
          <p className="text-4xl mb-3">🐋</p>
          <p className="text-slate-400">No trades yet. Go to the Whale tab to execute a trade.</p>
        </div>
      ) : (
        <div ref={listRef} className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto pr-1">
          {trades.map((trade) => (
            <TradeCard
              key={trade.trade_id}
              trade={trade}
              midnightEnabled={midnightEnabled}
              isNew={trade.trade_id === newestId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
