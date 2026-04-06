// ─── VibeTerminal ─────────────────────────────────────────────────────────────
// Natural language trading terminal.
// Type anything → AI agent parses intent → pre-fills signal card → one-click ZK execute.
// If no coin is mentioned in the message, an inline coin picker is shown automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react'
import { Terminal, Zap, Lock, AlertTriangle, CheckCircle2 } from 'lucide-react'

const EXAMPLES = [
  'Feeling very bullish on ETH, buy 0.5',
  'SOL looking oversold, long 2 with tight stop',
  'BTC breaking support, sell 0.1',
  'Load up on AVAX — clear breakout',
  'XRP looks weak, small short',
]

const KNOWN_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'AVAX', 'LINK', 'ADA', 'DOT']
const MAX_LEN = 280
const INJECTION_RE = /<\s*script|javascript:|on\w+\s*=|data:\s*text\/html/i

function validateTerminalInput(text) {
  const t = text.trim()
  if (!t)           return 'Please enter a trade instruction'
  if (t.length < 3) return 'Too short — describe your trade'
  if (text.length > MAX_LEN) return `Max ${MAX_LEN} characters`
  if (INJECTION_RE.test(text)) return 'Invalid input'
  return null
}

function detectCoin(text) {
  const upper = text.toUpperCase()
  return KNOWN_COINS.find(c => new RegExp(`\\b${c}\\b`).test(upper)) ?? null
}

function relativeTime(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5)  return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

export default function VibeTerminal({ midnightEnabled, onSignalParsed, onAutoExecute, midnight, disabled }) {
  const [input,    setInput]    = useState('')
  const [history,  setHistory]  = useState([])   // { role: 'user'|'agent'|'error'|'picker', text, parsed?, generatedAt?, originalMsg? }
  const [loading,  setLoading]  = useState(false)
  const [example,  setExample]  = useState(0)
  const [tick,     setTick]     = useState(0)    // triggers re-render for relative timestamps
  const [inputError, setInputError] = useState(null)
  const inputRef    = useRef(null)
  const historyRef  = useRef(null)

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

  // Tick every 30s to refresh "X ago" labels
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // Scroll only within the history container — never the page
  useEffect(() => {
    const el = historyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history])

  async function callAgent(msg) {
    setLoading(true)
    setHistory(h => [...h, { role: 'typing' }])
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      const data = await res.json()

      if (!data.ok) {
        setHistory(h => [...h.filter(e => e.role !== 'typing'), { role: 'error', text: data.error ?? 'Could not parse trade intent.' }])
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

      setHistory(h => [...h.filter(e => e.role !== 'typing'), {
        role:        'agent',
        text:        `Parsed: ${signal.direction} ${p.asset} — ${signal.confidence}% confidence`,
        parsed:      { ...p, signal },
        generatedAt: Date.now(),
      }])

      onSignalParsed?.({
        asset:  p.asset,
        amount: p.amount ?? 1,
        signal,
      })
    } catch (e) {
      setHistory(h => [...h.filter(e => e.role !== 'typing'), { role: 'error', text: `Agent error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    const msg = input.trim()
    const err = validateTerminalInput(input)
    if (err) { setInputError(err); return }
    if (loading) return
    setInputError(null)
    setInput('')
    setHistory(h => [...h, { role: 'user', text: msg }])

    const coin = detectCoin(msg)
    if (!coin) {
      // No coin detected — show inline picker instead of calling API
      setHistory(h => [...h, { role: 'picker', originalMsg: msg }])
      return
    }

    await callAgent(msg)
  }

  async function pickCoin(coin, originalMsg) {
    // Replace the picker entry with a user-visible coin selection note, then call agent
    setHistory(h => h.map(e =>
      e.role === 'picker' && e.originalMsg === originalMsg
        ? { role: 'user', text: `${originalMsg} [coin: ${coin}]` }
        : e
    ))
    await callAgent(`${originalMsg} (asset: ${coin})`)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
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
      <div ref={historyRef} className="px-4 py-3 space-y-2.5 h-[220px] overflow-y-auto font-mono text-xs">
        {history.length === 0 && (
          <p className="text-slate-700 italic">
            Describe your trade in plain English. Mention a coin (BTC, ETH, SOL …) or pick one when prompted.
          </p>
        )}
        {/* Typing animation entry */}
        {history.map((entry, i) => (
          <div key={i} className={`space-y-1.5 ${
            entry.role === 'user'   ? 'pl-3 border-l-2 border-slate-700'  :
            entry.role === 'error'  ? 'pl-3 border-l-2 border-red-700'    :
            entry.role === 'picker' ? 'pl-3 border-l-2 border-amber-700'  :
            entry.role === 'typing' ? 'pl-3 border-l-2 border-violet-800/50' :
                                      'pl-3 border-l-2 border-violet-700'
          }`}>
            {/* Typing dots */}
            {entry.role === 'typing' && (
              <div className="flex items-center gap-1.5 text-violet-500">
                <span className="text-violet-500">⚡</span>
                <span className="text-slate-500 text-xs">AlphaShield</span>
                <span className="flex items-end gap-[3px] h-3">
                  <span className="w-1 h-1 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            )}
            {/* Coin picker row */}
            {entry.role === 'picker' && (
              <div className="space-y-2">
                <span className="text-amber-400 flex items-center gap-1.5">
                  <span>?</span>
                  <span>No coin detected — select preferred coin:</span>
                </span>
                <div className="flex flex-wrap gap-1.5 ml-4">
                  {KNOWN_COINS.map(coin => (
                    <button
                      key={coin}
                      onClick={() => pickCoin(coin, entry.originalMsg)}
                      disabled={loading}
                      className={`px-2.5 py-1 rounded border text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        midnightEnabled
                          ? 'border-violet-700 text-violet-300 bg-violet-950/30 hover:bg-violet-800/50'
                          : 'border-red-700 text-red-300 bg-red-950/30 hover:bg-red-800/50'
                      }`}
                    >
                      {coin}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Normal user / error / agent rows */}
            {entry.role !== 'picker' && entry.role !== 'typing' && (
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
            )}

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
                  {/* Timestamp */}
                  {entry.generatedAt && (
                    <span className="ml-auto text-slate-600 text-xs flex items-center gap-1">
                      <CheckCircle2 size={9} className="text-emerald-700" />
                      signal generated {relativeTime(entry.generatedAt)}
                    </span>
                  )}
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
                    onClick={() => {
                      onSignalParsed?.({ asset: entry.parsed.asset, amount: entry.parsed.amount ?? 1, signal: entry.parsed.signal })
                      document.getElementById('whale-signal-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                    className={`flex-1 py-1.5 rounded text-xs font-bold transition-all border ${
                      midnightEnabled
                        ? 'border-violet-700 text-violet-300 hover:bg-violet-900/40'
                        : 'border-red-700 text-red-300 hover:bg-red-900/40'
                    }`}
                  >
                    ✎ Edit in form
                  </button>
                  <button
                    onClick={() => {
                      onAutoExecute?.(entry.parsed)
                      document.getElementById('whale-execute')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
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
      </div>

      {/* Input row */}
      <div className={`flex flex-col gap-1 px-3 pb-3 pt-2 border-t ${accentBorder}`}>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono shrink-0 ${midnightEnabled ? 'text-violet-500' : 'text-red-500'}`}>$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); if (inputError) setInputError(validateTerminalInput(e.target.value)) }}
            onKeyDown={handleKeyDown}
            placeholder={EXAMPLES[example]}
            disabled={loading}
            maxLength={MAX_LEN + 10}
            className={`flex-1 bg-transparent text-xs font-mono placeholder-slate-700 focus:outline-none disabled:opacity-50 ${
              inputError ? 'text-red-300' : 'text-white'
            }`}
          />
          <span className={`text-xs font-mono shrink-0 tabular-nums ${
            input.length > MAX_LEN ? 'text-red-500' : input.length > MAX_LEN * 0.85 ? 'text-amber-500' : 'text-slate-700'
          }`}>{input.length}/{MAX_LEN}</span>
          <button
            onClick={submit}
            disabled={loading || !input.trim()}
            className={`shrink-0 px-3 py-1 rounded text-xs font-bold transition-all disabled:opacity-30 ${accentBtn}`}
          >
            <Zap size={11} className="inline mr-1" />{loading ? '…' : 'Send'}
          </button>
        </div>
        {inputError && <p className="text-red-400 text-xs pl-4">{inputError}</p>}
      </div>
    </div>
  )
}
