import { Layers, WifiOff, Loader2 } from 'lucide-react'

const TABS = [
  { id: 'trader',     label: 'Trader' },
  { id: 'orderbook',  label: 'Order Book' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'whale',      label: 'Whale AI' },
  { id: 'follower',   label: 'Copy Trade' },
  { id: 'auditor',    label: 'Auditor' },
]

export default function Navbar({ currentTab, setCurrentTab, midnight }) {
  return (
    <nav className="sticky top-0 z-50 bg-[#07070e]/96 backdrop-blur-xl border-b border-white/[0.04]">
      <div className="max-w-7xl mx-auto px-4">
        {/* Top row */}
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-8 h-8">
              <div className="absolute inset-0 rounded-lg bg-violet-600/25 blur-sm" />
              <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-[#130c2e] border border-violet-600/25">
                <Layers size={15} className="text-violet-400" />
              </div>
            </div>
            <div className="flex flex-col leading-none gap-0.5">
              <div className="flex items-baseline">
                <span className="text-[17px] font-bold tracking-tight bg-gradient-to-r from-violet-300 via-purple-300 to-fuchsia-400 bg-clip-text text-transparent">
                  HiddenOrder
                </span>
                <span className="text-[17px] font-bold tracking-tight text-white/85 ml-1">DEX</span>
              </div>
              <span className="text-[10px] font-mono text-violet-600/60 tracking-[0.15em] uppercase">
                dark pool · midnight
              </span>
            </div>
          </div>

          {/* Status */}
          <div className="hidden md:flex items-center gap-2">
            {midnight?.walletStatus === 'connected' ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-300/80 bg-emerald-950/20 border border-emerald-500/15 px-3 py-1.5 rounded-full font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                <span>{midnight.walletAddress}</span>
                {midnight.proofServerUp
                  ? <span className="ml-1.5 text-emerald-500/60">· proof ✓</span>
                  : <span className="ml-1.5 text-amber-500/60">· proof ✗</span>
                }
                {midnight.networkId && (
                  <span className="ml-1.5 text-slate-600">· {midnight.networkId}</span>
                )}
              </div>
            ) : midnight?.walletStatus === 'connecting' ? (
              <div className="flex items-center gap-1.5 text-xs text-violet-300/80 bg-violet-950/20 border border-violet-500/15 px-3 py-1.5 rounded-full font-mono">
                <Loader2 size={10} className="animate-spin" />
                <span>Connecting…</span>
              </div>
            ) : (
              <button
                onClick={midnight?.connect}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-300 bg-transparent hover:bg-violet-950/30 border border-white/[0.06] hover:border-violet-600/30 px-3 py-1.5 rounded-full font-mono transition-all duration-200"
              >
                <WifiOff size={10} />
                Connect Lace
              </button>
            )}
            {midnight?.serviceUp && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-mono border ${
                midnight?.serviceZkMode === 'real'
                  ? 'text-violet-300/80 bg-violet-950/20 border-violet-500/15'
                  : 'text-slate-600 bg-transparent border-white/[0.04]'
              }`}>
                {midnight?.serviceZkMode === 'real' ? '⚡ zk·real' : '· zk·mock'}
              </span>
            )}
            {midnight?.contractAddress && (
              <span className="text-xs font-mono text-slate-700 border border-white/[0.03] px-2 py-1 rounded-full" title={midnight.contractAddress}>
                📄 {midnight.contractAddress.slice(0, 10)}…
              </span>
            )}
          </div>
        </div>

        {/* Pill tabs */}
        <div className="flex gap-1 pb-2.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200 ${
                currentTab === tab.id
                  ? 'bg-violet-950/80 text-violet-200 ring-1 ring-violet-700/40 shadow-[0_0_18px_rgba(124,58,237,0.22),inset_0_1px_0_rgba(167,139,250,0.08)]'
                  : 'text-slate-600 hover:text-slate-300 hover:bg-white/[0.04]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}
