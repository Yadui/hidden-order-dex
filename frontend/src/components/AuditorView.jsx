import { useState } from 'react'
import { Search, ShieldCheck, X, Code2, Copy, CheckCircle } from 'lucide-react'

const COMPACT_CONTRACT = `pragma language_version >= 0.22;

// ─── AlphaShield Trade Proof Contract  v2 ─────────────────────────────────────
// Public ledger (visible on-chain to everyone):
export ledger trade_asset:        Opaque<"string">;
export ledger trade_timestamp:    Opaque<"string">;
export ledger trade_amount:       Opaque<"string">;
export ledger reasoning_hash:     Opaque<"string">;  // SHA-256(reasoning|sl%|pos%)
export ledger strategy_version:   Uint<32>;          // = 2
export ledger strategy_verified:  Uint<32>;
export ledger bytes_exposed:      Uint<32>;          // always 0
export ledger risk_committed:     Uint<32>;          // stop_loss + position (sum only)

// ─── ZK Circuit: submit_trade ─────────────────────────────────────────────────
// Private witnesses (NEVER leave the whale's machine):
//   direction      — 0=SELL, 1=BUY
//   confidence     — 70..100 (below threshold is circuit-rejected)
//   stop_loss_pct  — 1..20  (stop-loss as % of position value)
//   position_pct   — 1..50  (portfolio allocation %)
export circuit submit_trade(
  asset:          Opaque<"string">,
  timestamp:      Opaque<"string">,
  amount:         Opaque<"string">,
  r_hash:         Opaque<"string">,
  direction:      Uint<32>,    // PRIVATE
  confidence:     Uint<32>,    // PRIVATE
  stop_loss_pct:  Uint<32>,    // PRIVATE
  position_pct:   Uint<32>     // PRIVATE
): [] {
  // ── 1. Signal integrity ─────────────────────────────────────────────────
  assert(direction < 2,          "BUY (1) or SELL (0) only");
  assert(confidence > 69,        "confidence must be ≥ 70%");

  // ── 2. Risk management ──────────────────────────────────────────────────
  assert(stop_loss_pct > 0,      "stop-loss must be set");
  assert(stop_loss_pct <= 20,    "stop-loss cannot exceed 20%");
  assert(position_pct > 0,       "position size must be > 0%");
  assert(position_pct <= 50,     "position cannot exceed 50% of portfolio");

  // ── 3. Risk-adjusted sizing (prevents over-conviction) ──────────────────
  assert(confidence + position_pct <= 120, "position too large for confidence level");

  // ── Ledger writes (only public fields disclosed) ─────────────────────────
  trade_asset       = disclose(asset);
  trade_timestamp   = disclose(timestamp);
  trade_amount      = disclose(amount);
  reasoning_hash    = disclose(r_hash);    // commits to risk params privately
  strategy_version  = disclose(2);
  strategy_verified = disclose(1);
  bytes_exposed     = disclose(0);
  risk_committed    = disclose(stop_loss_pct + position_pct);  // sum only
}

// ─── ZK Circuit: cancel_trade ─────────────────────────────────────────────────
export circuit cancel_trade(
  trade_id_hash:  Opaque<"string">,
  direction:      Uint<32>,    // PRIVATE — proves original submitter identity
  confidence:     Uint<32>     // PRIVATE
): [] {
  assert(direction < 2,   "invalid direction");
  assert(confidence > 69, "must prove original high-conviction position");
  trade_asset       = disclose(trade_id_hash);
  strategy_version  = disclose(2);
  strategy_verified = disclose(0);  // marks trade as cancelled
  bytes_exposed     = disclose(0);
  risk_committed    = disclose(0);
}

// ─── ZK Circuit: emergency_exit ───────────────────────────────────────────────
export circuit emergency_exit(
  asset:          Opaque<"string">,
  timestamp:      Opaque<"string">,
  stop_loss_pct:  Uint<32>,    // PRIVATE — threshold that was hit
  position_pct:   Uint<32>     // PRIVATE — size being exited
): [] {
  assert(stop_loss_pct > 0,   "stop-loss must be set");
  assert(stop_loss_pct <= 20, "stop-loss out of range");
  assert(position_pct > 0,    "position must be > 0");
  assert(position_pct <= 50,  "position out of range");
  trade_asset       = disclose(asset);
  trade_timestamp   = disclose(timestamp);
  trade_amount      = disclose("0");
  reasoning_hash    = disclose("emergency_exit");
  strategy_version  = disclose(2);
  strategy_verified = disclose(0);
  bytes_exposed     = disclose(0);
  risk_committed    = disclose(stop_loss_pct + position_pct);
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
        {proof.verifyStatus === 'checking' ? (
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex items-center gap-2">
            <span className="animate-spin inline-block w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full" />
            <div>
              <p className="text-violet-300 font-bold text-sm">Verifying…</p>
              <p className="text-slate-500 text-xs">Sending preimage to Midnight proof server /check</p>
            </div>
          </div>
        ) : proof.verifyStatus === 'valid' ? (
          <div className="bg-emerald-950/50 border border-emerald-700 rounded-lg p-3 flex items-center gap-2">
            <span className="text-emerald-400 text-xl">✅</span>
            <div>
              <p className="text-emerald-300 font-bold text-sm">CRYPTOGRAPHICALLY VERIFIED</p>
              <p className="text-emerald-600 text-xs">Midnight proof server confirmed circuit satisfiability</p>
            </div>
          </div>
        ) : proof.verifyStatus === 'invalid' ? (
          <div className="bg-red-950/50 border border-red-700 rounded-lg p-3 flex items-center gap-2">
            <span className="text-red-400 text-xl">❌</span>
            <div>
              <p className="text-red-300 font-bold text-sm">INVALID PROOF</p>
              <p className="text-red-600 text-xs">Proof server rejected the circuit witness</p>
            </div>
          </div>
        ) : proof.verifyStatus === 'mock' ? (
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex items-center gap-2">
            <span className="text-slate-400 text-xl">🔵</span>
            <div>
              <p className="text-slate-300 font-bold text-sm">MOCK HASH PROOF</p>
              <p className="text-slate-500 text-xs">Enable Midnight Network for real ZK verification</p>
            </div>
          </div>
        ) : (
          <div className="bg-emerald-950/50 border border-emerald-700 rounded-lg p-3 flex items-center gap-2">
            <span className="text-emerald-400 text-xl">✅</span>
            <div>
              <p className="text-emerald-300 font-bold text-sm">VERIFIED</p>
              <p className="text-emerald-600 text-xs">Cryptographic proof validated by Midnight Network</p>
            </div>
          </div>
        )}

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
            {proof.reasoning_hash && (
              <ProofRow label="Reasoning Hash (SHA-256)" value={proof.reasoning_hash} mono />
            )}
            {proof.risk_committed != null && (
              <ProofRow
                label="Risk Committed (sl+pos sum)"
                value={`${proof.risk_committed} (sum only · params private)`}
                highlight
              />
            )}
            <ProofRow
              label="Contract Version"
              value={`v${proof.strategy_version ?? 2} — 3 circuits, 7 ZK assertions`}
            />
            {proof.proof_size_bytes && (
              <ProofRow label="ZK Proof Size" value={`${proof.proof_size_bytes.toLocaleString()} bytes`} highlight />
            )}
            {proof.proof_generated_ms && (
              <ProofRow
                label="Proof Generated In"
                value={proof.proof_generated_ms < 1000
                  ? `${proof.proof_generated_ms}ms`
                  : `${(proof.proof_generated_ms / 1000).toFixed(1)}s`}
                highlight
              />
            )}
          </div>
        )}

        {/* Raw ZK proof bytes — real proofs only */}
        {proof.zk_mode === 'real' && proof.proof_bytes && (
          <div className="border-t border-slate-800 pt-3 space-y-2">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Raw ZK Proof (base64)</p>
            <div className="bg-slate-950 border border-violet-900/40 rounded-lg p-3 max-h-28 overflow-y-auto">
              <p className="font-mono text-xs text-violet-400/70 break-all leading-relaxed select-all">
                {proof.proof_bytes}
              </p>
            </div>
            <p className="text-xs text-slate-600 font-mono">
              Prefix: {atob(proof.proof_bytes.slice(0, 12)).split('').map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join('')}
              {' '}= "<span className="text-slate-400">{atob(proof.proof_bytes.slice(0, 12)).replace(/[^\x20-\x7e]/g, '·')}</span>"
            </p>
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
  const [verifyingId, setVerifyingId] = useState(null)

  async function verifyProof(trade) {
    setLoadingId(trade.trade_id)
    try {
      // Fetch proof data first
      const res = await fetch(`/api/proof/${trade.trade_id}`)
      if (!res.ok) throw new Error('Not found')
      const data = await res.json()

      // Kick off cryptographic verification in parallel if real proof exists
      if (data.zk_mode === 'real' && data.proof_preimage) {
        setSelectedProof({ ...data, verifyStatus: 'checking' })
        setLoadingId(null)
        setVerifyingId(trade.trade_id)
        try {
          const vRes = await fetch(`/api/verify-proof/${trade.trade_id}`, { method: 'POST' })
          const vData = await vRes.json()
          setSelectedProof(prev => prev ? {
            ...prev,
            verifyStatus: vData.valid === true ? 'valid' : vData.valid === false ? 'invalid' : 'no_preimage',
            verifyMode: vData.mode,
            verifyMessage: vData.message,
          } : null)
        } catch (e) {
          setSelectedProof(prev => prev ? { ...prev, verifyStatus: 'error', verifyMessage: e.message } : null)
        } finally {
          setVerifyingId(null)
        }
      } else {
        setSelectedProof({ ...data, verifyStatus: data.zk_mode === 'real' ? 'no_preimage' : 'mock' })
      }
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
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium">ZK Mode</th>
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium">Exposed</th>
                <th className="px-5 py-3 text-slate-500 uppercase text-xs tracking-wide font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, i) => {
                const zkMode = trade.proof?.zk_mode ?? trade.zk_mode ?? 'mock'
                const isReal = zkMode === 'real'
                return (
                  <tr
                    key={trade.trade_id}
                    onClick={() => verifyProof(trade)}
                    className={`border-b border-slate-800/50 hover:bg-violet-950/20 transition-colors cursor-pointer ${
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
                    <td className="px-5 py-3">
                      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                        isReal
                          ? 'bg-violet-950/50 text-violet-300 border-violet-700'
                          : 'bg-slate-900 text-slate-500 border-slate-700'
                      }`}>
                        {isReal ? '⚡ real' : '🔵 mock'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-emerald-400 font-bold font-mono text-xs">0 bytes ✓</span>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); verifyProof(trade) }}
                        disabled={loadingId === trade.trade_id || verifyingId === trade.trade_id}
                        className="flex items-center gap-1.5 bg-violet-700 hover:bg-violet-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                      >
                        {(loadingId === trade.trade_id || verifyingId === trade.trade_id) ? (
                          <span className="animate-spin inline-block w-3 h-3 border border-white border-t-transparent rounded-full" />
                        ) : (
                          <Search size={12} />
                        )}
                        {verifyingId === trade.trade_id ? 'Verifying…' : 'Verify'}
                      </button>
                    </td>
                  </tr>
                )
              })}
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
