import { useEffect } from 'react'
import { ShieldCheck, X, Copy, CheckCircle } from 'lucide-react'
import { useState } from 'react'

const ORDER_STATUS_LABEL = { 0: 'PENDING', 1: 'MATCHED', 2: 'SETTLED' }

export default function ProofDrawer({ open, onClose, proof }) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !proof) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#08081a] border-l border-violet-500/[0.12] shadow-[0_0_60px_rgba(109,40,217,0.2)] flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-violet-400" />
            <h3 className="text-lg font-bold text-white">ZK Proof Details</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-violet-950/40"
          >
            <X size={20} />
          </button>
        </div>

        {/* Status banner */}
        <div className="mx-6 mt-5">
          {proof.fairness_proven === 1 ? (
            <div className="bg-emerald-950/50 border border-emerald-700 rounded-lg p-3 flex items-center gap-3">
              <ShieldCheck size={20} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-emerald-300 font-bold text-sm">FAIRNESS PROVEN</p>
                <p className="text-emerald-600 text-xs">
                  ZK proof confirms both parties agreed to a fair price.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-amber-950/50 border border-amber-700 rounded-lg p-3 flex items-center gap-3">
              <span className="text-amber-400 text-xl shrink-0">⏳</span>
              <div>
                <p className="text-amber-300 font-bold text-sm">
                  {ORDER_STATUS_LABEL[proof.order_status] ?? 'PENDING'}
                </p>
                <p className="text-amber-600 text-xs">Awaiting match and settlement.</p>
              </div>
            </div>
          )}
        </div>

        {/* Proof fields */}
        <div className="px-6 py-5 space-y-4">
          <Section title="Order Info">
            {proof.order_id && <ProofRow label="Order ID" value={proof.order_id} mono />}
            <ProofRow label="Asset Pair" value={proof.asset_pair} />
            <ProofRow label="Status" value={ORDER_STATUS_LABEL[proof.order_status] ?? 'UNKNOWN'} />
            <ProofRow label="Timestamp" value={new Date(proof.timestamp).toLocaleString()} />
          </Section>

          <Section title="Settlement">
            <ProofRow label="Settlement Hash" value={proof.settlement_hash} mono highlight copyable />
            <ProofRow
              label="Fairness Proven"
              value={proof.fairness_proven === 1 ? '✅ Yes' : '⏳ Pending'}
            />
          </Section>

          <Section title="ZK Proof">
            <ProofRow label="Proof Hash" value={proof.proof_hash} mono highlight copyable />
            <ProofRow
              label="ZK Mode"
              value={proof.zk_mode === 'real' ? '⚡ Real (Midnight Testnet)' : '🔵 Mock (Demo)'}
            />
            {proof.contract_address && (
              <ProofRow label="Contract Address" value={proof.contract_address} mono highlight />
            )}
            {proof.tx_hash && (
              <ProofRow label="Tx Hash" value={proof.tx_hash} mono highlight />
            )}
          </Section>
        </div>

        {/* ZK mode badge */}
        <div className="px-6 pb-4">
          <div className={`rounded-lg px-3 py-2 text-center border text-xs font-mono font-bold ${
            proof.zk_mode === 'real'
              ? 'bg-violet-950/30 border-violet-500/[0.15] text-violet-300'
              : 'bg-[#0d0d20] border-white/[0.05] text-slate-500'
          }`}>
            {proof.zk_mode === 'real'
              ? '⚡ On-Chain ZK Proof — Midnight Testnet'
              : '🔵 Mock ZK Proof — Demo Mode'}
          </div>
        </div>

        {/* Midnight selling point */}
        <div className="mx-6 mb-6 rounded-xl border border-violet-500/[0.1] bg-violet-950/15 p-4 text-center space-y-1">
          <p className="text-violet-300 font-bold text-sm">
            Your order price is never written to any chain or log.
          </p>
          <p className="text-violet-500 text-xs">
            When matched, a ZK proof confirms both parties agreed to a fair price.
            Settlement is on-chain and auditable. Your strategy is not.
          </p>
        </div>
      </div>
    </>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-slate-500 text-xs uppercase tracking-widest mb-2 font-medium">{title}</p>
      <div className="bg-[#0d0d20]/60 border border-white/[0.06] rounded-xl p-4 space-y-3">
        {children}
      </div>
    </div>
  )
}

function ProofRow({ label, value, mono, highlight, copyable }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    if (!copyable || !value) return
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-slate-500 text-xs uppercase tracking-wide shrink-0 mt-0.5">{label}</span>
      <div className="flex items-start gap-1.5 min-w-0">
        <span className={`text-right break-all text-xs ${mono ? 'font-mono' : ''} ${
          highlight ? 'text-violet-300' : 'text-slate-200'
        }`}>
          {value}
        </span>
        {copyable && (
          <button
            onClick={handleCopy}
            className="shrink-0 text-slate-600 hover:text-slate-300 transition-colors mt-0.5"
            title="Copy"
          >
            {copied ? <CheckCircle size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
        )}
      </div>
    </div>
  )
}
