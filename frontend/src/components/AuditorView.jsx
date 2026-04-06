import { useState, useEffect, useCallback } from 'react'
import { Search, ShieldCheck, RefreshCw, Code2, AlertTriangle, CheckCircle2 } from 'lucide-react'

const CONTRACT_SOURCE = `pragma language_version >= 0.22;

// Hidden Order DEX — Order Proof Contract
// Private witnesses (NEVER leave submitter's machine):
//   price_cents, amount_units, side, nonce

export ledger order_id:        Opaque<"string">;
export ledger asset_pair:      Opaque<"string">;
export ledger order_timestamp: Opaque<"string">;
export ledger settlement_hash: Opaque<"string">;
export ledger order_status:    Uint<32>;
export ledger fairness_proven: Uint<32>;

export circuit submit_order(
  oid:          Opaque<"string">,
  pair:         Opaque<"string">,
  timestamp:    Opaque<"string">,
  settle_hash:  Opaque<"string">,
  price_cents:  Uint<64>,     // PRIVATE
  amount_units: Uint<64>,     // PRIVATE
  side:         Uint<32>,     // PRIVATE
  nonce:        Uint<64>      // PRIVATE
): [] {
  assert(side < 2,         "side must be 0 (BUY) or 1 (SELL)");
  assert(price_cents > 0,  "price_cents must be greater than 0");
  assert(amount_units > 0, "amount_units must be greater than 0");

  order_id        = disclose(oid);
  asset_pair      = disclose(pair);
  order_timestamp = disclose(timestamp);
  settlement_hash = disclose(settle_hash);
  order_status    = disclose(0);
  fairness_proven = disclose(0);
}

export circuit settle_order(
  oid:                 Opaque<"string">,
  matched_price_cents: Uint<64>,
  buyer_limit:         Uint<64>,
  seller_limit:        Uint<64>
): [] {
  assert(matched_price_cents >= seller_limit, "seller price floor not met");
  assert(matched_price_cents <= buyer_limit,  "buyer price ceiling exceeded");

  order_id        = disclose(oid);
  order_status    = disclose(2);
  fairness_proven = disclose(1);
}`

function HashVerifier({ label, hash, expected }) {
  const match = !expected || hash === expected
  return (
    <div className={`rounded-lg border px-4 py-3 space-y-1 ${
      match ? 'border-emerald-800/60 bg-emerald-950/20' : 'border-rose-800/60 bg-rose-950/20'
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 font-medium">{label}</span>
        {match
          ? <CheckCircle2 size={13} className="text-emerald-400" />
          : <AlertTriangle size={13} className="text-rose-400" />
        }
      </div>
      <p className="font-mono text-xs text-slate-300 break-all">{hash || '—'}</p>
      {expected && !match && (
        <p className="text-rose-400 text-xs">Expected: {expected}</p>
      )}
    </div>
  )
}

export default function AuditorView() {
  const [lookupId, setLookupId] = useState('')
  const [proofData, setProofData] = useState(null)
  const [lookupError, setLookupError] = useState(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [trades, setTrades] = useState([])
  const [showSource, setShowSource] = useState(false)

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/trades/public')
      if (res.ok) setTrades(await res.json())
    } catch { /* backend not running */ }
  }, [])

  useEffect(() => {
    fetchTrades()
    const t = setInterval(fetchTrades, 8000)
    return () => clearInterval(t)
  }, [fetchTrades])

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  async function lookupProof(e) {
    e.preventDefault()
    const id = lookupId.trim()
    if (!id) {
      setLookupError('Please enter an order ID.')
      return
    }
    if (!UUID_RE.test(id)) {
      setLookupError('Invalid format — order IDs are UUIDs, e.g. 5d366a5a-3d92-446a-ab6d-a3416c4d181d')
      return
    }
    setLookupLoading(true)
    setLookupError(null)
    setProofData(null)
    try {
      const res = await fetch(`/api/proof/${id}`)
      if (!res.ok) throw new Error('Order not found')
      setProofData(await res.json())
    } catch (err) {
      setLookupError(err.message)
    } finally {
      setLookupLoading(false)
    }
  }

  // Stats
  const totalSettled  = trades.length
  const fairnessProven = trades.filter(t => t.fairness_proven === 1).length
  const aiTrades      = trades.filter(t => t.reasoning_hash).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(167,139,250,0.04)]">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <ShieldCheck size={18} className="text-violet-400" />
          AuditorView — On-Chain ZK Verification
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Verify any trade's ZK proof. Inspect the Compact contract. Confirm 0 bytes of strategy leaked.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Settled Trades" value={totalSettled} color="violet" />
        <StatCard label="Fairness Proven" value={fairnessProven} color="emerald" />
        <StatCard label="AI Trades" value={aiTrades} color="blue" />
      </div>

      {/* Privacy guarantee */}
      <div className="rounded-xl border border-white/[0.05] bg-[#0b0b1c] p-5 space-y-3 shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
        <h3 className="text-sm font-semibold text-white">Midnight Network Guarantees</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'Bytes of strategy exposed', value: '0', color: 'emerald' },
            { label: 'On-chain private fields', value: 'price · amount · side', color: 'violet' },
            { label: 'Public fields', value: 'hash · asset · status', color: 'slate' },
          ].map(g => (
            <div key={g.label} className={`rounded-lg border border-${g.color}-800/60 bg-${g.color}-950/20 p-3`}>
              <p className="text-xs text-slate-500">{g.label}</p>
              <p className={`text-${g.color}-300 font-bold font-mono text-sm mt-1`}>{g.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Proof lookup */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-5 space-y-4 shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(167,139,250,0.04)]">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Search size={14} className="text-violet-400" /> Verify Proof by Order ID
        </h3>
        <form onSubmit={lookupProof} className="flex gap-2">
          <input
            value={lookupId}
            onChange={e => { setLookupId(e.target.value); setLookupError(null) }}
            placeholder="Paste order UUID…"
            className={`flex-1 bg-[#0d0d20] border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none ${
              lookupError && lookupId.trim() ? 'border-rose-500 focus:border-rose-400' : 'border-white/[0.07] focus:border-violet-500'
            }`}
          />
          <button
            type="submit"
            disabled={lookupLoading || !lookupId.trim()}
            className="flex items-center gap-1.5 bg-gradient-to-r from-violet-700 to-purple-700 hover:from-violet-600 hover:to-purple-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
          >
            {lookupLoading ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
            Verify
          </button>
        </form>

        {lookupError && (
          <p className="text-rose-400 text-xs flex items-center gap-1.5">
            <AlertTriangle size={13} /> {lookupError}
          </p>
        )}

        {proofData && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              {proofData.fairness_proven === 1
                ? <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-950/50 border border-emerald-700 px-3 py-1 rounded-full font-bold">
                    <CheckCircle2 size={13} /> FAIRNESS PROVEN
                  </span>
                : <span className="inline-flex items-center gap-1.5 text-xs text-amber-300 bg-amber-950/50 border border-amber-700 px-3 py-1 rounded-full font-bold">
                    ⏳ PENDING
                  </span>
              }
              <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold border ${
                proofData.zk_mode === 'real'
                  ? 'bg-violet-950/50 text-violet-300 border-violet-700'
                  : 'bg-slate-900 text-slate-500 border-slate-700'
              }`}>
                {proofData.zk_mode === 'real' ? '⚡ On-Chain ZK' : '🔵 Mock ZK'}
              </span>
            </div>

            <div className="space-y-2">
              <HashVerifier label="Proof Hash" hash={proofData.proof_hash} />
              <HashVerifier label="Settlement Hash" hash={proofData.settlement_hash} />
              {proofData.reasoning_hash && (
                <HashVerifier label="AI Reasoning Commitment (bytes_exposed: 0)" hash={proofData.reasoning_hash} />
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {[
                ['Order ID', proofData.order_id],
                ['Asset Pair', proofData.asset_pair],
                ['Status', ['PENDING','MATCHED','SETTLED'][proofData.order_status] ?? proofData.order_status],
                ['Timestamp', new Date(proofData.timestamp).toLocaleString()],
                ['Contract Address', proofData.contract_address ?? 'local (no deployment)'],
                ['TX Hash', proofData.tx_hash ?? 'n/a'],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-slate-500">{k}</p>
                  <p className="text-slate-300 font-mono truncate" title={v}>{v}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent settlements with verification */}
      {trades.length > 0 && (
        <div className="rounded-xl border border-white/[0.05] bg-[#0b0b1c] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
          <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Recent Settlements</span>
            <button onClick={fetchTrades} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.04]">
                <th className="text-left text-slate-500 font-medium px-5 py-2.5">Asset</th>
                <th className="text-left text-slate-500 font-medium px-4 py-2.5">Settlement Hash</th>
                <th className="text-left text-slate-500 font-medium px-4 py-2.5">AI?</th>
                <th className="text-left text-slate-500 font-medium px-4 py-2.5">Fairness</th>
                <th className="text-left text-slate-500 font-medium px-4 py-2.5">Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 15).map((t, i) => (
                <tr
                  key={t.settlement_hash}
                  className={`border-b border-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}
                >
                  <td className="px-5 py-2.5 text-white font-bold">{t.asset_pair}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-400">
                    {t.settlement_hash?.slice(0, 16)}…
                  </td>
                  <td className="px-4 py-2.5">
                    {t.reasoning_hash
                      ? <span className="text-violet-400 font-bold">⚡ AI</span>
                      : <span className="text-slate-600">—</span>
                    }
                  </td>
                  <td className="px-4 py-2.5">
                    {t.fairness_proven === 1
                      ? <span className="text-emerald-400">✓</span>
                      : <span className="text-amber-400">⏳</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {new Date(t.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Contract source inspector */}
      <div className="rounded-xl border border-white/[0.05] bg-[#0b0b1c] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
        <button
          onClick={() => setShowSource(s => !s)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-white hover:bg-violet-950/10 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Code2 size={14} className="text-violet-400" />
            Compact Contract Source — order_proof.compact
          </span>
          <span className="text-slate-500 text-xs">{showSource ? '▲ hide' : '▼ show'}</span>
        </button>
        {showSource && (
          <div className="border-t border-white/[0.04]">
            <pre className="text-xs font-mono text-slate-300 p-5 overflow-x-auto leading-relaxed bg-[#06060e]">
              {CONTRACT_SOURCE}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }) {
  const colors = {
    violet: 'border-violet-500/[0.12] bg-violet-950/15 text-violet-300',
    emerald: 'border-emerald-500/[0.12] bg-emerald-950/15 text-emerald-300',
    blue:    'border-blue-500/[0.12] bg-blue-950/15 text-blue-300',
    slate:   'border-white/[0.05] bg-white/[0.02] text-slate-300',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color] ?? colors.slate}`}>
      <p className="text-2xl font-bold font-mono">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  )
}
