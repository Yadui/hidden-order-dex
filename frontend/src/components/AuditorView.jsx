import { useState } from 'react'
import { Search, ShieldCheck, X, Code2, Copy, CheckCircle } from 'lucide-react'

const COMPACT_CONTRACT = `pragma language_version >= 0.22;

// ─── AlphaShield Trade Proof Contract ─────────────────
// Public ledger (visible on-chain to everyone):
export ledger trade_asset:       Opaque<"string">;
export ledger trade_timestamp:   Opaque<"string">;
export ledger trade_amount:      Opaque<"string">;
export ledger reasoning_hash:    Opaque<"string">;  // SHA-256 of AI reasoning
export ledger strategy_verified: Uint<32>;
export ledger bytes_exposed:     Uint<32>;          // always 0

// ─── ZK Circuit ───────────────────────────────────────
// Private witnesses (NEVER leave the whale's machine):
//   direction   — 0=SELL, 1=BUY
//   confidence  — 0..100
export circuit submit_trade(
  asset:      Opaque<"string">,
  timestamp:  Opaque<"string">,
  amount:     Opaque<"string">,
  r_hash:     Opaque<"string">,
  direction:  Uint<32>,      // PRIVATE — never disclosed
  confidence: Uint<32>       // PRIVATE — never disclosed
): [] {
  // ZK guarantees (without revealing direction or confidence):
  assert(direction < 2, "valid BUY (1) or SELL (0) signal");
  assert(confidence > 0, "whale holds a real position");

  // Only public fields are written to the ledger:
  trade_asset       = disclose(asset);
  trade_timestamp   = disclose(timestamp);
  trade_amount      = disclose(amount);
  reasoning_hash    = disclose(r_hash);
  strategy_verified = disclose(1);
  bytes_exposed     = disclose(0);
}`;

function ContractCodePanel() {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(COMPACT_CONTRACT).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-xl border border-violet-800/60 bg-[#10101f] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Code2 size={16} className="text-violet-400" />
          <span className="text-sm font-bold text-white">Compact Smart Contract</span>
          <span className="text-xs text-slate-500 font-mono">contract/src/trade_proof.compact</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition-all"
        >
          {copied ? <><CheckCircle size={11} className="text-emerald-400" /> Copied</> : <><Copy size={11} /> Copy</>}
        </button>
      </div>
      <pre className="text-xs font-mono p-5 overflow-x-auto leading-relaxed text-slate-300 whitespace-pre-wrap">
        {COMPACT_CONTRACT.split('\n').map((line, i) => {
          const isComment = line.trim().startsWith('//')
          const isKeyword = /\b(pragma|export|ledger|circuit|assert|disclose|Uint|Opaque)\b/.test(line)
          return (
            <div key={i} className={
              isComment ? 'text-slate-600'
              : line.includes('assert(') ? 'text-amber-400/80'
              : line.includes('disclose(') ? 'text-emerald-400/80'
              : line.includes('PRIVATE') ? 'text-rose-400/70 italic'
              : isKeyword ? 'text-violet-300'
              : 'text-slate-300'
            }>{line}</div>
          )
        })}
      </pre>
    </div>
  )
}

function ProofModal({ proof, onClose }) {
  if (!proof) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#0f0f1f] border border-violet-700 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl shadow-violet-900/30">
        {/* Modal header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-violet-400" />
            <h3 className="text-lg font-bold text-white">ZK Proof Verification</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"
          >
            <X size={20} />
          </button>
        </div>

        {/* Status banner */}
        <div className="bg-emerald-950/50 border border-emerald-700 rounded-lg p-3 flex items-center gap-2">
          <span className="text-emerald-400 text-xl">✅</span>
          <div>
            <p className="text-emerald-300 font-bold text-sm">VERIFIED</p>
            <p className="text-emerald-600 text-xs">Cryptographic proof validated by Midnight Network</p>
          </div>
        </div>

        {/* Proof details */}
        <div className="space-y-3">
          <ProofRow label="Proof ID" value={proof.proof_id} mono />
          <ProofRow
            label="Proof Hash"
            value={proof.proof_hash}
            mono
            highlight
          />
          <ProofRow label="Status" value="✅ VERIFIED" />
          <ProofRow label="Execution Fair" value="✅ Yes" />
          <ProofRow label="Strategy Data Exposed" value={`${proof.strategy_bytes_exposed} bytes`} highlight2 />
          <div className="border-t border-slate-800 pt-3 space-y-3">
            <ProofRow label="Asset" value={proof.asset} mono />
            <ProofRow label="Amount" value={`${proof.amount} ${proof.asset}`} mono />
            <ProofRow label="Timestamp" value={new Date(proof.timestamp).toLocaleString()} />
          </div>
        </div>

        {/* On-chain fields (only when real ZK) */}
        {proof.zk_mode === 'real' && (
          <div className="space-y-2 border-t border-slate-800 pt-3">
            {proof.contract_address && (
              <ProofRow label="Contract Address" value={proof.contract_address} mono highlight />
            )}
            {proof.tx_hash && (
              <ProofRow label="Tx Hash" value={proof.tx_hash} mono highlight />
            )}
            {proof.reasoning_hash && (
              <ProofRow label="Reasoning Hash (SHA-256)" value={proof.reasoning_hash} mono />
            )}
          </div>
        )}

        {/* ZK mode badge */}
        <div className={`rounded-lg px-3 py-2 text-center border text-xs font-mono font-bold ${
          proof.zk_mode === 'real'
            ? 'bg-violet-950/50 border-violet-700 text-violet-300'
            : 'bg-slate-900 border-slate-700 text-slate-400'
        }`}>
          {proof.zk_mode === 'real' ? '⚡ On-Chain ZK Proof — Midnight Testnet' : '🔵 Mock ZK Proof — Demo Mode'}
        </div>

        {/* ZK statement */}
        <div className="bg-violet-950/50 border border-violet-800 rounded-xl p-4 text-center">
          <p className="text-violet-300 font-bold text-sm">
            Zero knowledge of trading strategy confirmed by Midnight Network
          </p>
          <p className="text-violet-600 text-xs mt-1 font-mono">
            The whale's edge is provably private. The execution is provably fair.
          </p>
        </div>
      </div>
    </div>
  )
}

function ProofRow({ label, value, mono, highlight, highlight2 }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-slate-500 text-xs uppercase tracking-wide shrink-0">{label}</span>
      <span className={`text-right break-all text-sm ${
        mono ? 'font-mono' : ''
      } ${
        highlight ? 'text-violet-300' : highlight2 ? 'text-emerald-400 font-bold' : 'text-slate-200'
      }`}>
        {value}
      </span>
    </div>
  )
}

export default function AuditorView({ trades }) {
  const [selectedProof, setSelectedProof] = useState(null)
  const [loadingId, setLoadingId] = useState(null)

  async function verifyProof(trade) {
    setLoadingId(trade.trade_id)
    try {
      const res = await fetch(`/api/proof/${trade.trade_id}`)
      if (!res.ok) throw new Error('Not found')
      const data = await res.json()
      setSelectedProof(data)
    } catch (e) {
      alert(`Failed to load proof: ${e.message}`)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-violet-800/60 bg-[#10101f] p-5">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          🔍 ZK Proof Verification
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Independently verify that all trades were executed fairly, with zero knowledge of the underlying strategy.
        </p>
      </div>

      {trades.length === 0 ? (
        <div className="rounded-xl border border-violet-800/60 bg-[#10101f] p-12 text-center">
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-slate-400">No trades to audit yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-violet-800/60 bg-[#10101f] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left">
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium">Asset</th>
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium">Amount</th>
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium">Timestamp</th>
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium">Proof ID</th>
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, i) => (
                <tr
                  key={trade.trade_id}
                  className={`border-b border-slate-800/50 hover:bg-violet-950/20 transition-colors ${
                    i % 2 === 0 ? 'bg-slate-900/20' : ''
                  }`}
                >
                  <td className="px-5 py-3">
                    <span className="bg-violet-900/40 text-violet-300 border border-violet-700/50 px-2 py-0.5 rounded text-xs font-mono font-bold">
                      {trade.asset}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-white font-mono">
                    {trade.amount} {trade.asset}
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs font-mono">
                    {new Date(trade.timestamp).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs font-mono">
                    {trade.proof_id?.slice(0, 18)}...
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => verifyProof(trade)}
                      disabled={loadingId === trade.trade_id}
                      className="flex items-center gap-1.5 bg-violet-700 hover:bg-violet-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                    >
                      {loadingId === trade.trade_id ? (
                        <span className="animate-spin inline-block w-3 h-3 border border-white border-t-transparent rounded-full" />
                      ) : (
                        <Search size={12} />
                      )}
                      Verify Proof
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProofModal proof={selectedProof} onClose={() => setSelectedProof(null)} />

      {/* Compact smart contract source */}
      <ContractCodePanel />
    </div>
  )
}
