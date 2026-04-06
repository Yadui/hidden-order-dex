import { useState } from 'react'
import Navbar from './components/Navbar'
import TraderView from './components/TraderView'
import OrderbookView from './components/OrderbookView'
import SettlementFeed from './components/SettlementFeed'
import WhaleView from './components/WhaleView'
import FollowerView from './components/FollowerView'
import AuditorView from './components/AuditorView'
import { useMidnight } from './hooks/useMidnight.js'

function App() {
  const [currentTab, setCurrentTab] = useState('trader')
  const midnight = useMidnight()

  return (
    <div className="min-h-screen w-full text-slate-100" style={{background: 'radial-gradient(ellipse 90% 45% at 50% 0%, rgba(109,40,217,0.13) 0%, transparent 60%), #05050e'}}>
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        midnight={midnight}
      />

      {/* All tabs stay mounted — CSS hidden preserves internal state */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className={currentTab === 'trader' ? '' : 'hidden'}>
          <TraderView midnight={midnight} />
        </div>
        <div className={currentTab === 'orderbook' ? '' : 'hidden'}>
          <OrderbookView />
        </div>
        <div className={currentTab === 'settlement' ? '' : 'hidden'}>
          <SettlementFeed />
        </div>
        <div className={currentTab === 'whale' ? '' : 'hidden'}>
          <WhaleView midnight={midnight} />
        </div>
        <div className={currentTab === 'follower' ? '' : 'hidden'}>
          <FollowerView />
        </div>
        <div className={currentTab === 'auditor' ? '' : 'hidden'}>
          <AuditorView />
        </div>
      </main>
    </div>
  )
}

export default App
