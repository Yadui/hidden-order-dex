import { useState } from 'react'
import { Shield, ShieldOff, Wifi, WifiOff, Loader2, ChevronDown } from 'lucide-react'
import WalletModal from './WalletModal.jsx'

const TABS = [
  { id: 'whale', label: '🐋 Whale' },
  { id: 'follower', label: '👥 Follower' },
  { id: 'auditor', label: '🔍 Auditor' },
]

export default function Navbar({ midnightEnabled, setMidnightEnabled, currentTab, setCurrentTab, midnight }) {
  const [showWalletModal, setShowWalletModal] = useState(false)

  return (
    <>
      {showWalletModal && (
        <WalletModal
          onClose={() => setShowWalletModal(false)}
          connect={midnight?.connect}
          walletStatus={midnight?.walletStatus}
          walletError={midnight?.walletError}
          isLaceInstalled={midnight?.isLaceInstalled}
          proofServerUp={midnight?.proofServerUp}
          networkId={midnight?.networkId}
        />
      )}

    <nav
      className={`sticky top-0 z-40 border-b backdrop-blur-md transition-colors duration-700 ${
        midnightEnabled
          ? 'bg-[#0d0d1a]/95 border-violet-900/50'
          : 'bg-[#120808]/95 border-red-900/50'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4">
        {/* Top row */}
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg transition-colors duration-700 ${
                midnightEnabled ? 'bg-violet-900/50' : 'bg-red-900/50'
              }`}
            >
              {midnightEnabled
                ? <Shield size={20} className="text-violet-400" />
                : <ShieldOff size={20} className="text-red-400" />
              }
            </div>
            <div>
              <span
                className={`text-xl font-bold tracking-tight transition-colors duration-700 ${
                  midnightEnabled ? 'text-violet-300' : 'text-red-300'
                }`}
              >
                AlphaShield
              </span>
              <span className="text-slate-500 text-xs ml-2 font-mono">v1.0 · Midnight Network</span>
            </div>
          </div>

          {/* Wallet + ZK status */}
          <div className="hidden md:flex items-center gap-2 mr-4">
            {/* ZK mode pill — always visible if service is up */}
            {midnight?.serviceUp && (
              <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold border ${
                midnight?.serviceZkMode === 'real'
                  ? 'bg-violet-950/50 text-violet-300 border-violet-700'
                  : 'bg-slate-900 text-slate-500 border-slate-700'
              }`}>
                {midnight?.serviceZkMode === 'real' ? '⚡ ZK real' : '🔵 ZK mock'}
              </span>
            )}

            {/* Wallet button */}
            {midnight?.walletStatus === 'connected' ? (
              <button
                onClick={() => setShowWalletModal(true)}
                className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 hover:border-emerald-600 px-2.5 py-1 rounded-full font-mono transition-all"
              >
                <Wifi size={11} />
                {midnight.walletAddress}
                {midnight.proofServerUp
                  ? <span className="text-emerald-600">· proof ✓</span>
                  : <span className="text-amber-500">· proof ✗</span>
                }
                <ChevronDown size={10} className="text-emerald-700" />
              </button>
            ) : midnight?.walletStatus === 'connecting' ? (
              <span className="flex items-center gap-1.5 text-xs text-violet-400 bg-violet-950/40 border border-violet-800/60 px-2.5 py-1 rounded-full font-mono">
                <Loader2 size={11} className="animate-spin" />
                Connecting to Lace…
              </span>
            ) : (
              <button
                onClick={() => setShowWalletModal(true)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-violet-300 bg-slate-900 hover:bg-violet-950/40 border border-slate-700 hover:border-violet-700 px-2.5 py-1 rounded-full font-mono transition-all"
              >
                <WifiOff size={11} />
                {midnight?.walletError ? 'Retry Connection' : 'Connect Wallet'}
                {midnight?.walletError && <span className="text-red-400 ml-1">⚠</span>}
              </button>
            )}
          </div>

          {/* Toggle */}
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm font-medium hidden sm:block">Midnight</span>
            <button
              onClick={() => setMidnightEnabled(!midnightEnabled)}
              className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 focus:outline-none ${
                midnightEnabled ? 'bg-violet-600' : 'bg-red-700'
              }`}
              aria-label="Toggle Midnight Network"
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow-lg transform transition-transform duration-300 ${
                  midnightEnabled ? 'translate-x-8' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono transition-colors duration-300 ${
              midnightEnabled ? 'bg-violet-900/60 text-violet-300' : 'bg-red-900/60 text-red-300'
            }`}>
              {midnightEnabled ? 'ON' : 'OFF'}
            </span>
            {!midnightEnabled && (
              <span className="text-xs font-bold text-red-400 bg-red-900/40 border border-red-700 px-2 py-0.5 rounded hidden sm:block">
                ⚠️ EXPOSED
              </span>
            )}
          </div>
        </div>

        {/* Tab row */}
        <div className="flex gap-1 pb-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all duration-200 ${
                currentTab === tab.id
                  ? midnightEnabled
                    ? 'bg-violet-900/60 text-violet-200 border-b-2 border-violet-500'
                    : 'bg-red-900/60 text-red-200 border-b-2 border-red-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
    </>
  )
}
