import { useState, useEffect, useCallback, useRef } from 'react'
import Navbar from './components/Navbar'
import WhaleView from './components/WhaleView'
import FollowerView from './components/FollowerView'
import AuditorView from './components/AuditorView'
import { useMidnight } from './hooks/useMidnight.js'

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ target, suffix = '' }) {
  const [val, setVal] = useState(0)
  const prevRef = useRef(0)
  useEffect(() => {
    const from = prevRef.current
    if (from === target) return
    prevRef.current = target
    const steps = 30
    const diff  = target - from
    let step = 0
    const id = setInterval(() => {
      step++
      setVal(Math.round(from + (diff * step) / steps))
      if (step >= steps) clearInterval(id)
    }, 20)
    return () => clearInterval(id)
  }, [target])
  return <>{val}{suffix}</>
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ trades, midnightEnabled }) {
  const realProofs  = trades.filter(t => t.proof?.zk_mode === 'real' || t.zk_mode === 'real').length
  const totalTrades = trades.length
  const accent      = midnightEnabled ? 'border-violet-800/40 bg-violet-950/20' : 'border-red-800/40 bg-red-950/20'
  const numColor    = midnightEnabled ? 'text-violet-300' : 'text-red-300'

  const stats = [
    { label: 'Trades Executed',      value: totalTrades,          suffix: '',   icon: '📊' },
    { label: 'ZK Proofs Generated',  value: realProofs,            suffix: '',   icon: '⚡' },
    { label: 'Strategy Bytes Exposed', value: 0,                  suffix: '',   icon: '🔒' },
    { label: 'Midnight Network',      value: midnightEnabled ? 1 : 0, suffix: '', icon: midnightEnabled ? '✅' : '⚠️', isStatus: true },
  ]

  return (
    <div className={`border-b transition-colors duration-700 ${midnightEnabled ? 'border-violet-900/30 bg-[#09091a]' : 'border-red-900/30 bg-[#0e0707]'}`}>
      <div className="max-w-7xl mx-auto px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-px">
        {stats.map(({ label, value, suffix, icon, isStatus }) => (
          <div key={label} className={`flex items-center gap-3 px-4 py-2 rounded-lg ${accent}`}>
            <span className="text-lg">{icon}</span>
            <div>
              <p className={`text-xl font-bold font-mono leading-none ${
                isStatus
                  ? (midnightEnabled ? 'text-emerald-400' : 'text-red-400')
                  : label === 'Strategy Bytes Exposed'
                  ? 'text-emerald-400'
                  : numColor
              }`}>
                {isStatus
                  ? (midnightEnabled ? 'ACTIVE' : 'OFF')
                  : <Counter target={value} suffix={suffix} />
                }
              </p>
              <p className="text-slate-500 text-xs mt-0.5 leading-none">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Role explainer (shows only before first trade) ────────────────────────────
function RoleExplainer({ midnightEnabled, onDismiss }) {
  const roles = [
    {
      icon: '🐋',
      title: 'Whale',
      desc: 'Generate an AI trading signal, execute with a ZK proof. Your direction and confidence never leave your machine.',
      tab: 'whale',
      color: midnightEnabled ? 'border-violet-700/60 bg-violet-950/30' : 'border-red-700/60 bg-red-950/30',
    },
    {
      icon: '👥',
      title: 'Follower',
      desc: 'See the live trade feed. With Midnight ON: only an encrypted hash. With Midnight OFF: full strategy exposed.',
      tab: 'follower',
      color: 'border-slate-700/60 bg-slate-900/30',
    },
    {
      icon: '🔍',
      title: 'Auditor',
      desc: 'Cryptographically verify every trade is fair — ZK proof confirmed by the Midnight proof server.',
      tab: 'auditor',
      color: 'border-slate-700/60 bg-slate-900/30',
    },
  ]

  return (
    <div className={`border-b transition-colors duration-700 ${midnightEnabled ? 'border-violet-900/30' : 'border-red-900/30'}`}>
      <div className="max-w-7xl mx-auto px-4 py-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className={`text-2xl font-bold ${midnightEnabled ? 'text-violet-200' : 'text-red-200'}`}>
              AlphaShield — ZK-Protected AI Copy Trading
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
              Institutional whales generate AI trade signals and commit them on-chain with Midnight ZK proofs.
              Followers copy safely. Auditors verify fairly.{' '}
              <span className={`font-bold ${midnightEnabled ? 'text-violet-300' : 'text-red-300'}`}>
                Zero strategy bytes ever exposed.
              </span>
            </p>
          </div>
          <button onClick={onDismiss} className="text-slate-600 hover:text-slate-400 text-xs font-mono ml-6 shrink-0 mt-1">
            dismiss ×
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {roles.map(({ icon, title, desc, color }) => (
            <div key={title} className={`rounded-xl border px-4 py-3 ${color}`}>
              <p className="text-white font-bold text-sm mb-1">{icon} {title}</p>
              <p className="text-slate-400 text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function App() {
  const [midnightEnabled, setMidnightEnabled]   = useState(true)
  const [currentTab, setCurrentTab]             = useState('whale')
  const [trades, setTrades]                     = useState([])
  const [showExplainer, setShowExplainer]       = useState(true)
  const midnight = useMidnight()

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`/api/trades?midnight=${midnightEnabled}`)
      if (res.ok) setTrades(await res.json())
    } catch { /* backend starting */ }
  }, [midnightEnabled])

  useEffect(() => {
    fetchTrades()
    const interval = setInterval(fetchTrades, 5000)
    return () => clearInterval(interval)
  }, [fetchTrades])

  // Auto-dismiss explainer once a trade has been executed
  useEffect(() => {
    if (trades.length > 0) setShowExplainer(false)
  }, [trades.length])

  const bg = midnightEnabled ? 'bg-[#0a0a14] text-slate-100' : 'bg-[#0f0505] text-slate-100'

  return (
    <div className={`min-h-screen w-full transition-colors duration-700 ${bg}`}>
      {/* Alert banner when Midnight is OFF */}
      {!midnightEnabled && (
        <div className="w-full bg-red-700 text-white text-center py-2 px-4 font-bold text-sm tracking-wide animate-pulse">
          ⚠️ MIDNIGHT PROTECTION DISABLED — ALL STRATEGIES EXPOSED TO MEMPOOL
        </div>
      )}

      <Navbar
        midnightEnabled={midnightEnabled}
        setMidnightEnabled={setMidnightEnabled}
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        midnight={midnight}
      />

      <StatsBar trades={trades} midnightEnabled={midnightEnabled} />

      {showExplainer && (
        <RoleExplainer
          midnightEnabled={midnightEnabled}
          onDismiss={() => setShowExplainer(false)}
        />
      )}

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className={currentTab === 'whale'    ? '' : 'hidden'}>
          <WhaleView midnightEnabled={midnightEnabled} onTradeExecuted={fetchTrades} midnight={midnight} />
        </div>
        <div className={currentTab === 'follower' ? '' : 'hidden'}>
          <FollowerView midnightEnabled={midnightEnabled} trades={trades} />
        </div>
        <div className={currentTab === 'auditor'  ? '' : 'hidden'}>
          <AuditorView trades={trades} />
        </div>
      </main>
    </div>
  )
}

export default App
