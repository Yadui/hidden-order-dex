import { useState, useEffect, useCallback } from 'react'
import Navbar from './components/Navbar'
import WhaleView from './components/WhaleView'
import FollowerView from './components/FollowerView'
import AuditorView from './components/AuditorView'
import { useMidnight } from './hooks/useMidnight.js'

function App() {
  const [midnightEnabled, setMidnightEnabled] = useState(true)
  const [currentTab, setCurrentTab] = useState('whale')
  const [trades, setTrades] = useState([])
  const midnight = useMidnight()

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`/api/trades?midnight=${midnightEnabled}`)
      if (res.ok) {
        const data = await res.json()
        setTrades(data)
      }
    } catch (e) {
      // backend not running yet
    }
  }, [midnightEnabled])

  useEffect(() => {
    fetchTrades()
    const interval = setInterval(fetchTrades, 5000)
    return () => clearInterval(interval)
  }, [fetchTrades])

  const bg = midnightEnabled
    ? 'bg-[#0a0a14] text-slate-100'
    : 'bg-[#0f0505] text-slate-100'

  return (
    <div className={`min-h-screen w-full transition-colors duration-700 ${bg}`}>
      {/* Dramatic banner when midnight is OFF */}
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

      {/* All tabs stay mounted — CSS hidden preserves their internal state */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className={currentTab === 'whale' ? '' : 'hidden'}>
          <WhaleView
            midnightEnabled={midnightEnabled}
            onTradeExecuted={fetchTrades}
            midnight={midnight}
          />
        </div>
        <div className={currentTab === 'follower' ? '' : 'hidden'}>
          <FollowerView
            midnightEnabled={midnightEnabled}
            trades={trades}
          />
        </div>
        <div className={currentTab === 'auditor' ? '' : 'hidden'}>
          <AuditorView trades={trades} />
        </div>
      </main>
    </div>
  )
}

export default App
