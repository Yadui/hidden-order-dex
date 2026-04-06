// ─── VibeTerminal ─────────────────────────────────────────────────────────────
// Natural language trading terminal.
// Type anything → AI agent parses intent → pre-fills signal card → one-click ZK execute.
//
// Examples:
//   "Feeling very bullish on ETH, buy 0.5"
//   "SOL is oversold on RSI, long 2 SOL"
//   "BTC looking weak, sell 0.1 with tight stop"
//   "Load up on AVAX, clear breakout pattern"
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react'
import { Terminal, Zap, Lock, AlertTriangle, Loader2, TrendingUp, TrendingDown, CheckCircle2 } from 'lucide-react'

const EXAMPLES = [
  'Feeling very bullish on ETH, buy 0.5',
  'SOL looking oversold, long 2 with tight stop',
  'BTC breaking support, sell 0.1',
  'Load up on AVAX — clear breakout',
  'XRP looks weak, small short',
]

export default function VibeTerminal({ midnightEnabled, onSignalParsed, onAutoExecute, midnight, disabled }) {
  const [input,    setInput]    = useState('')
  const [history,  setHistory]  = useState([])   // { role: 'user'|'agent'|'error', text, parsed? }
  const [loading,  setLoading]  = useState(false)
  const [example,  setExample]  = useState(0)
  const inputRef  = useRef(null)
  const bottomRef = useRef(null)

  const accent       = midnightEnabled ? 'violet' : 'red'
  const accentBorder = midnightEnabled ? 'border-violet-800/60' : 'border-red-800/60'
  const accentBg     = midnightEnabled ? 'bg-violet-950/40'     : 'bg-red-950/30'
  const accentBtn    = midnightEnabled
    ? 'bg-violet-700 hover:bg-violet-600 text-white'
    : 'bg-red-700 hover:bg-red-600 text-white'

  // Cycle placeholder examples
  useEffect(() => {
    const t = setInterval(() => setExample(e => (e + 1) % EXAMPLES.length), 3000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  async function submit() {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    setHistory(h => [...h, { role: 'user', text: msg }])
    setLoading(true)

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      const data = await res.json()

      if (!data.ok) {
        setHistory(h => [...h, { role: 'error', text: data.error ?? 'Could not parse trade intent.' }])
        return
      }

      const p = data.parsed
      const signal = {
        direction:     p.intent ?? p.direction,
        confidence:    p.confidence,
        reasoning:     p.reasoning,
        risk_level:    p.risk_level,
        stop_loss_pct: p.stop_loss_pct,
        position_pct:  p.position_pct,
      }

      setHistory(h => [...h, {
        role:   'agent',
        text:   `Parsed: ${signal.direction} ${p.asset} — ${signal.confidence}% confidence`,
        parsed: { ...p, signal },
      }])

      // Bubble up to WhaleView to pre-fill the form
      onSignalParsed?.({
        asset:  p.asset,
        amount: p.amount ?? 1,
        signal,
      })
    } catch (e) {
      setHistory(h => [...h, { role: 'error', text: `Agent error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function handleAutoExecute(parsedEntry) {
    onAutoExecute?.(parsedEntry.parsed)
  }

  return (
    <div className={`rounded-xl border ${accentBorder} bg-[#080812] overflow-hidden`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-4 py-3 border-b ${accentBorder} ${accentBg}`}>
        <Terminal size={15} className={midnightEnabled ? 'text-violet-400' : 'text-red-400'} />
        <span className="text-white text-sm font-bold">Vibe Terminal</span>
        <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
          midnightEnabled
            ? 'bg-violet-900/40 text-violet-400 border-violet-700'
            : 'bg-red-900/40 text-red-400 border-red-700'
        }`}>natural language → ZK trade</span>
        {midnightEnabled
          ? <Lock size={12} className="text-violet-500 ml-auto" />
          : <AlertTriangle size={12} className="text-red-500 ml-auto" />
        }
      </div>

      {/* History */}
      <div className="px-4 py-3 space-y-2.5 min-h-[120px] max-h-[260px] overflow-y-auto font-mono text-xs">
        {history.length === 0 && (
          <p className="text-slate-700 italic">
            Describe your trade in plain English. The agent will parse intent and pre-fill the signal card.
          </p>
        )}
        {history.map((entry, i) => (
          <div key={i} className={`space-y-1.5 ${entry.role === 'user' ? 'pl-3 border-l-2 border-slate-700' : entry.role === 'error' ? 'pl-3 border-l-2 border-red-700' : 'pl-3 border-l-2 border-violet-700'}`}>
            <div className="flex items-start gap-2">
              <span className={`shrink-0 ${
                entry.role === 'user'  ? 'text-slate-500' :
                entry.role === 'error' ? 'text-red-500'   : 'text-violet-400'
              }`}>
                {entry.role === 'user' ? '>' : entry.role === 'error' ? '✗' : '⚡'}
              </span>
              <span className={
                entry.role === 'user'  ? 'text-slate-300' :
                entry.role === 'error' ? 'text-red-400'   : 'text-violet-300'
              }>
                {entry.text}
              </span>
            </div>

            {/* Parsed signal preview card */}
            {entry.role === 'agent' && entry.parsed && (
              <div className={`ml-4 rounded-lg border ${accentBorder} bg-slate-900/60 p-2.5 space-y-1.5`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-bold text-xs px-2 py-0.5 rounded ${
                    entry.parsed.signal.direction === 'BUY'
                      ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
                      : 'bg-red-900/60 text-red-300 border border-red-700'
                  }`}>
                    {entry.parsed.signal.direction === 'BUY' ? '▲' : '▼'} {entry.parsed.signal.direction}
                  </span>
                  <span className={`font-bold text-xs px-2 py-0.5 rounded border ${
                    midnightEnabled ? 'text-violet-300 border-violet-700 bg-violet-950/40' : 'text-red-300 border-red-700 bg-red-950/40'
                  }`}>{entry.parsed.asset}</span>
                  <span className="text-slate-400 text-xs">{entry.parsed.amount ?? 1} units</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${
                    entry.parsed.signal.risk_level === 'LOW' ? 'bg-emerald-900/50 text-emerald-400'
                    : entry.parsed.signal.risk_level === 'HIGH' ? 'bg-red-900/50 text-red-400'
                    : 'bg-amber-900/50 text-amber-400'
                  }`}>{entry.parsed.signal.risk_level} RISK</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-xs">
                  <div className="bg-slate-800/60 rounded px-2 py-1">
                    <span className="text-slate-600">confidence</span>
                    <div className={`font-bold ${midnightEnabled ? 'text-violet-300' : 'text-red-300'}`}>{entry.parsed.signal.confidence}%</div>
                  </div>
                  <div className="bg-slate-800/60 rounded px-2 py-1 flex flex-col justify-between">
                    <span className="text-slate-600">stop-loss</span>
                    <div className="flex items-center gap-1 font-bold text-emerald-400"><Lock size={8} />{entry.parsed.signal.stop_loss_pct}%</div>
                  </div>
                  <div className="bg-slate-800/60 rounded px-2 py-1">
                    <span className="text-slate-600">position</span>
                    <div className="flex items-center gap-1 font-bold text-emerald-400"><Lock size={8} />{entry.parsed.signal.position_pct}%</div>
                  </div>
                </div>
                <p className="text-slate-500 text-xs leading-relaxed">{entry.parsed.signal.reasoning}</p>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => onSignalParsed?.({ asset: entry.parsed.asset, amount: entry.parsed.amount ?? 1, signal: entry.parsed.signal })}
                    className={`flex-1 py-1.5 rounded text-xs font-bold transition-all border ${
                      midnightEnabled
                        ? 'border-violet-700 text-violet-300 hover:bg-violet-900/40'
                        : 'border-red-700 text-red-300 hover:bg-red-900/40'
                    }`}
                  >
                    ✎ Edit in form
                  </button>
                  <button
                    onClick={() => handleAutoExecute(entry)}
                    disabled={disabled || !midnight?.submitProof}
                    className={`flex-1 py-1.5 rounded text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${accentBtn}`}
                  >
                    {midnightEnabled ? <><Lock size={10} className="inline mr-1" />Execute ZK</> : <><AlertTriangle size={10} className="inline mr-1" />Execute</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className={`flex items-center gap-2 px-3 pb-3 pt-2 border-t ${accentBorder}`}>
        <span className={`text-xs font-mono shrink-0 ${midnightEnabled ? 'text-violet-500' : 'text-red-500'}`}>$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={EXAMPLES[example]}
          disabled={loading}
          className="flex-1 bg-transparent text-white text-xs font-mono placeholder-slate-700 focus:outline-none disabled:opacity-50"
        />
        {loading
          ? <Loader2 size={14} className={`animate-spin shrink-0 ${midnightEnabled ? 'text-violet-400' : 'text-red-400'}`} />
          : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              className={`shrink-0 px-3 py-1 rounded text-xs font-bold transition-all disabled:opacity-30 ${accentBtn}`}
            >
              <Zap size={11} className="inline mr-1" />Send
            </button>
          )
        }
      </div>
    </div>
  )
}
