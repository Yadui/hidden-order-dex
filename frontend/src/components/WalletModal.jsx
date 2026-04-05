import { useState } from 'react'
import { X, ExternalLink, CheckCircle2, Circle, Loader2, AlertTriangle, Wifi } from 'lucide-react'

// ── Step indicator ────────────────────────────────────────────────────────────
function Step({ n, done, active, label, sub }) {
  return (
    <div className={`flex gap-3 items-start transition-opacity ${active ? 'opacity-100' : done ? 'opacity-70' : 'opacity-40'}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
        done   ? 'bg-emerald-600 text-white' :
        active ? 'bg-violet-600 text-white ring-2 ring-violet-400/50' :
                 'bg-slate-800 text-slate-500'
      }`}>
        {done ? <CheckCircle2 size={13} /> : n}
      </div>
      <div>
        <p className={`text-sm font-semibold ${active ? 'text-white' : done ? 'text-slate-300' : 'text-slate-500'}`}>
          {label}
        </p>
        {sub && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{sub}</p>}
      </div>
    </div>
  )
}

export default function WalletModal({ onClose, connect, walletStatus, walletError, isLaceInstalled, proofServerUp, networkId }) {
  const [activeTab, setActiveTab] = useState('lace') // 'lace' | 'nightforge'

  const laceInstalled  = isLaceInstalled
  const midnightInLace = laceInstalled && typeof window !== 'undefined' && window.midnight?.mnLace != null
  const proofOk        = proofServerUp
  const walletOk       = walletStatus === 'connected'
  const isConnecting   = walletStatus === 'connecting'

  // Derive current step (1-indexed)
  const currentStep = !laceInstalled ? 1 : !midnightInLace ? 2 : !proofOk ? 3 : !walletOk ? 4 : 5

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-lg bg-[#0b0b1a] border border-violet-800/60 rounded-2xl shadow-2xl shadow-violet-900/20 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-white font-bold text-lg">Connect Midnight Wallet</h2>
            <p className="text-slate-500 text-xs mt-0.5 font-mono">AlphaShield · ZK-Protected Trading</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        {/* Tab selector */}
        <div className="flex border-b border-slate-800">
          {[
            { id: 'lace',      label: 'Lace Wallet',   sub: 'Official · Browser Extension' },
            { id: 'nightforge', label: 'Nightforge',   sub: 'Testnet · In-Browser'          },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 px-4 py-3 text-left transition-colors ${
                activeTab === t.id
                  ? 'border-b-2 border-violet-500 bg-violet-950/20'
                  : 'hover:bg-slate-800/30'
              }`}
            >
              <p className={`text-sm font-semibold ${activeTab === t.id ? 'text-violet-300' : 'text-slate-400'}`}>
                {t.label}
              </p>
              <p className="text-xs text-slate-600">{t.sub}</p>
            </button>
          ))}
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* ── Lace tab ─── */}
          {activeTab === 'lace' && (
            <>
              <p className="text-slate-400 text-sm leading-relaxed">
                Lace is the official Midnight Network browser wallet. It holds your private keys
                and runs the proof server at <span className="font-mono text-violet-400">localhost:6300</span> — enabling real ZK proofs directly in your browser.
              </p>

              {/* Setup steps */}
              <div className="space-y-4">
                <Step n={1} done={currentStep > 1} active={currentStep === 1}
                  label="Install Lace Browser Extension"
                  sub="Available for Chrome and Brave." />
                {currentStep === 1 && (
                  <a
                    href="https://www.lace.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 bg-violet-700 hover:bg-violet-600 text-white text-sm font-bold px-4 py-2.5 rounded-lg transition-all ml-9 w-fit"
                  >
                    Install Lace <ExternalLink size={13} />
                  </a>
                )}

                <Step n={2} done={currentStep > 2} active={currentStep === 2}
                  label="Enable Midnight in Lace Settings"
                  sub='In Lace → Settings → Midnight → toggle "Enable Midnight" → set Proof Server to localhost:6300' />

                <Step n={3} done={currentStep > 3} active={currentStep === 3}
                  label="Start the Midnight Proof Server"
                  sub="The proof server runs locally for privacy. Run: docker compose -f midnight-local-dev/standalone.yml up proof-server -d" />
                {currentStep === 3 && (
                  <div className="ml-9 bg-slate-900 border border-slate-700 rounded-lg p-3">
                    <p className="text-xs font-mono text-slate-400 select-all">
                      docker compose -f midnight-local-dev/standalone.yml up proof-server -d
                    </p>
                  </div>
                )}

                <Step n={4} done={currentStep > 4} active={currentStep === 4}
                  label="Connect Wallet"
                  sub="Click below — Lace will show a connection approval popup." />

                <Step n={5} done={currentStep === 5} active={false}
                  label="Ready ✓"
                  sub="ZK proofs will be generated in real mode via the Midnight proof server." />
              </div>

              {/* Status indicators */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  { label: 'Lace Installed',   ok: laceInstalled  },
                  { label: 'Proof Server',      ok: proofOk        },
                  { label: 'Wallet',            ok: walletOk       },
                ].map(({ label, ok }) => (
                  <div key={label} className={`rounded-lg border px-3 py-2 text-center ${
                    ok ? 'border-emerald-700/60 bg-emerald-950/30' : 'border-slate-700/60 bg-slate-900/30'
                  }`}>
                    <p className={`font-bold font-mono ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {ok ? '✓' : '○'}
                    </p>
                    <p className={ok ? 'text-emerald-600' : 'text-slate-600'}>{label}</p>
                  </div>
                ))}
              </div>

              {/* Error */}
              {walletError && (
                <div className="bg-red-950/40 border border-red-700/60 rounded-lg p-3 flex gap-2">
                  <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs leading-relaxed font-mono">{walletError}</p>
                </div>
              )}

              {/* Connected state */}
              {walletOk ? (
                <div className="bg-emerald-950/40 border border-emerald-700/60 rounded-xl p-4 text-center">
                  <p className="text-emerald-300 font-bold text-sm flex items-center justify-center gap-2">
                    <Wifi size={15} /> Wallet Connected
                  </p>
                  {networkId && (
                    <p className="text-emerald-600 text-xs font-mono mt-1">{networkId}</p>
                  )}
                  <button onClick={onClose} className="mt-3 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-bold px-6 py-2 rounded-lg transition-all">
                    Continue →
                  </button>
                </div>
              ) : (
                <button
                  onClick={connect}
                  disabled={!laceInstalled || isConnecting}
                  className="w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConnecting
                    ? <><Loader2 size={15} className="animate-spin" /> Waiting for Lace approval…</>
                    : !laceInstalled
                    ? 'Install Lace First (see Step 1)'
                    : 'Connect Lace Wallet'
                  }
                </button>
              )}
            </>
          )}

          {/* ── Nightforge tab ─── */}
          {activeTab === 'nightforge' && (
            <>
              <p className="text-slate-400 text-sm leading-relaxed">
                Midnight Nightforge is the official in-browser testnet environment — no extension needed.
                Use it to test on <span className="font-mono text-violet-400">testnet-02</span> without installing Lace.
              </p>

              <div className="bg-amber-950/30 border border-amber-700/60 rounded-lg p-3 flex gap-2">
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-amber-300 text-xs leading-relaxed">
                  Nightforge is a web-based wallet — it cannot inject <span className="font-mono">window.midnight</span> into AlphaShield's domain.
                  Direct connection is not supported yet. Use Lace for full wallet integration,
                  or run AlphaShield with mock ZK (proof server still generates real proofs).
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Useful testnet links</p>
                {[
                  { label: 'Midnight Nightforge',     href: 'https://nightforge.midnight.network',              desc: 'In-browser testnet wallet' },
                  { label: 'Midnight Testnet Faucet', href: 'https://midnight.network/faucet',                  desc: 'Get tDust for transactions' },
                  { label: 'Midnight Docs',           href: 'https://docs.midnight.network',                    desc: 'SDK + DApp connector guide' },
                  { label: 'Midnight Block Explorer', href: 'https://midnight-explore.netlify.app',             desc: 'Inspect on-chain proofs'    },
                ].map(({ label, href, desc }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 transition-colors group"
                  >
                    <div>
                      <p className="text-sm text-white font-medium group-hover:text-violet-300 transition-colors">{label}</p>
                      <p className="text-xs text-slate-500">{desc}</p>
                    </div>
                    <ExternalLink size={13} className="text-slate-600 group-hover:text-violet-400 transition-colors" />
                  </a>
                ))}
              </div>

              <div className="bg-violet-950/30 border border-violet-800/60 rounded-lg p-3">
                <p className="text-violet-300 text-xs font-bold mb-1">Current ZK mode</p>
                <p className="text-violet-400 text-xs font-mono">
                  {proofOk
                    ? '⚡ Real ZK proofs — proof server at localhost:6300 is running'
                    : '🔵 Mock ZK — start proof server docker container for real proofs'
                  }
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
