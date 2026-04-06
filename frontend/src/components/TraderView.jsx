import { useState } from 'react'
import { Lock, Send, Loader2, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react'
import ProofDrawer from './ProofDrawer'
import CryptoSearch from './CryptoSearch'

const ASSET_PAIRS = ['BTC/USDC', 'ETH/USDC', 'SOL/USDC', 'MATIC/USDC']
// ASSET_PAIRS kept for reference; CryptoSearch now handles coin selection

const ZK_STEPS = [
  'Building order witness…',
  'Computing settlement hash…',
  'Running submit_order circuit…',
  'Sending to proof server (localhost:6301)…',
  'Generating ZK proof…',
  'Order submitted to dark pool…',
]

export default function TraderView({ midnight }) {
  const [assetPair, setAssetPair] = useState('BTC/USDC')
  const [livePrice, setLivePrice] = useState(null)
  const [side, setSide] = useState('BUY')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')

  const [priceError, setPriceError]   = useState(null)
  const [amountError, setAmountError] = useState(null)

  function validateFields() {
    let valid = true
    const p = parseFloat(price)
    const a = parseFloat(amount)
    if (!price || isNaN(p) || p <= 0) {
      setPriceError('Price must be a positive number.')
      valid = false
    } else if (p > 1_000_000_000) {
      setPriceError('Price exceeds maximum allowed value.')
      valid = false
    } else {
      setPriceError(null)
    }
    if (!amount || isNaN(a) || a <= 0) {
      setAmountError('Amount must be a positive number.')
      valid = false
    } else if (a > 1_000_000) {
      setAmountError('Amount exceeds maximum allowed value.')
      valid = false
    } else {
      setAmountError(null)
    }
    return valid
  }

  const [loading, setLoading] = useState(false)
  const [zkStep, setZkStep]   = useState(0)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [proof, setProof] = useState(null)

  function reset() {
    setPrice('')
    setAmount('')
    setResult(null)
    setError(null)
    setZkStep(0)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validateFields()) return
    setError(null)
    setResult(null)
    setLoading(true)
    setZkStep(0)

    try {
      // Animate ZK steps for UX
      for (let i = 0; i < ZK_STEPS.length - 1; i++) {
        setZkStep(i)
        await new Promise((r) => setTimeout(r, 500))
      }

      // Attempt real ZK proof via midnight-service
      let proofOverride = null
      if (midnight?.serviceUp) {
        try {
          const zkData = await midnight.submitProof({
            order_id: crypto.randomUUID(),
            asset_pair: assetPair,
            side,
            price_cents: Math.round(parseFloat(price) * 100),
            amount_units: Math.round(parseFloat(amount) * 1e8),
            timestamp: new Date().toISOString(),
          })
          proofOverride = {
            proof_hash: zkData.proofHash,
            contract_address: zkData.contractAddress,
            tx_hash: zkData.txHash,
            zk_mode: zkData.mode,
          }
        } catch {
          // fall back to mock
        }
      }

      setZkStep(ZK_STEPS.length - 1)

      const body = {
        asset_pair: assetPair,
        side,
        price: parseFloat(price),
        amount: parseFloat(amount),
      }
      if (proofOverride) body.proof_override = proofOverride

      const res = await fetch('/api/order/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Submit failed')
      }

      const data = await res.json()
      setResult(data)
      // Pre-fetch proof for drawer
      const proofRes = await fetch(`/api/proof/${data.order_id}`)
      if (proofRes.ok) setProof(await proofRes.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const STATUS_LABEL = { 0: 'PENDING', 1: 'MATCHED', 2: 'SETTLED' }

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      {/* Header */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(167,139,250,0.04)]">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Lock size={18} className="text-violet-400" />
          Submit Hidden Limit Order
        </h2>
        <p className="text-slate-400 text-sm mt-2 leading-relaxed">
          Your order price is never written to any chain or log.
          When matched, a ZK proof confirms both parties agreed to a fair price.
          Settlement is on-chain and auditable. Your strategy is not.
        </p>
      </div>

      {/* Privacy callout */}
      <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 px-5 py-3 text-sm text-emerald-300 flex items-start gap-3">
        <span className="text-emerald-400 mt-0.5">🔒</span>
        <span>
          Your price stays private. Only the settlement hash and a fairness proof are
          written on-chain — Midnight selective disclosure keeps everything else hidden.
        </span>
      </div>

      {/* Order form */}
      {!result ? (
        <form onSubmit={handleSubmit} className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-6 space-y-5 shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(167,139,250,0.04)]">
          {/* Asset pair */}
          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs uppercase tracking-wide flex items-center gap-1.5">
              Asset Pair
              {livePrice && <span className="text-emerald-400 text-xs normal-case font-normal">● live price: ${livePrice.toLocaleString()}</span>}
            </label>
            <CryptoSearch
              value={assetPair.split('/')[0]}
              pairSuffix="/USDC"
              disabled={loading}
              onChange={coin => {
                setAssetPair(`${coin.sym}/USDC`)
                if (coin.mockPrice) setPrice(String(coin.mockPrice))
              }}
              onPriceLoad={p => {
                setLivePrice(p)
                if (p) setPrice(String(p))
              }}
            />
          </div>

          {/* Side */}
          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs uppercase tracking-wide">Side</label>
            <div className="flex gap-3">
              {['BUY', 'SELL'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  disabled={loading}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                    side === s
                      ? s === 'BUY'
                        ? 'bg-emerald-700 text-white border border-emerald-500'
                        : 'bg-rose-700 text-white border border-rose-500'
                      : 'bg-[#0f0f22] text-slate-400 border border-white/[0.07] hover:bg-[#141430]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Price */}
          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs uppercase tracking-wide flex items-center gap-2">
              Limit Price (USD)
              <span className="text-violet-400 font-mono text-xs normal-case">Your price stays private 🔒</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={price}
              onChange={(e) => { setPrice(e.target.value); setPriceError(null) }}
              disabled={loading}
              required
              placeholder="e.g. 67500.00"
              className={`w-full bg-[#0d0d20] border rounded-lg px-3 py-2.5 text-white text-sm font-mono focus:outline-none placeholder-slate-700 ${
                priceError ? 'border-rose-500 focus:border-rose-400' : 'border-white/[0.07] focus:border-violet-500'
              }`}
            />
            {priceError && <p className="text-rose-400 text-xs mt-1 flex items-center gap-1">⚠ {priceError}</p>}
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs uppercase tracking-wide">Amount</label>
            <input
              type="number"
              step="0.0001"
              min="0.0001"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setAmountError(null) }}
              disabled={loading}
              required
              placeholder="e.g. 0.5"
              className={`w-full bg-[#0d0d20] border rounded-lg px-3 py-2.5 text-white text-sm font-mono focus:outline-none placeholder-slate-700 ${
                amountError ? 'border-rose-500 focus:border-rose-400' : 'border-white/[0.07] focus:border-violet-500'
              }`}
            />
            {amountError && <p className="text-rose-400 text-xs mt-1 flex items-center gap-1">⚠ {amountError}</p>}
          </div>

          {/* ZK steps */}
          {loading && (
            <div className="bg-violet-950/20 border border-violet-500/[0.1] rounded-lg p-4 space-y-2">
              {ZK_STEPS.map((step, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs font-mono transition-colors ${
                  i < zkStep ? 'text-emerald-400' : i === zkStep ? 'text-violet-300 font-bold' : 'text-slate-600'
                }`}>
                  {i < zkStep ? (
                    <CheckCircle2 size={12} />
                  ) : i === zkStep ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <span className="w-3 h-3 rounded-full border border-slate-700 inline-block" />
                  )}
                  {step}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-rose-400 text-sm bg-rose-950/30 border border-rose-800/50 rounded-lg p-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !price || !amount}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-700 to-fuchsia-700 hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all shadow-[0_4px_20px_rgba(124,58,237,0.25)]"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {loading ? 'Generating ZK Proof…' : 'Submit Order to Dark Pool'}
          </button>
        </form>
      ) : (
        /* Result card */
        <div className="rounded-xl border border-emerald-700 bg-[#0a1a10] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={20} className="text-emerald-400" />
            <h3 className="text-white font-bold text-lg">Order Submitted</h3>
            <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded font-mono ${
              result.order_status === 1
                ? 'bg-amber-900/50 text-amber-300 border border-amber-700'
                : result.order_status === 2
                  ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700'
                  : 'bg-violet-900/50 text-violet-300 border border-violet-700'
            }`}>
              {STATUS_LABEL[result.order_status] ?? 'PENDING'}
            </span>
          </div>

          <div className="space-y-2 text-sm">
            <Row label="Order ID" value={result.order_id} mono />
            <Row label="Pair" value={result.asset_pair} />
            <Row label="Side" value={result.side} />
            <Row label="Settlement Hash"
              value={result.settlement_hash?.slice(0, 20) + '…'}
              mono highlight />
            <Row label="Submit ZK" value={result.zk_mode === 'real' ? '⚡ Real' : '🔵 Mock'} />
            {result.settle_proof_hash && (
              <Row
                label="Fairness Proof"
                value={(result.settle_zk_mode === 'real' ? '⚡ Real · ' : '🔵 Mock · ') + result.settle_proof_hash.slice(0, 18) + '…'}
                mono highlight
              />
            )}
          </div>

          <div className="bg-violet-950/20 border border-violet-500/[0.1] rounded-lg p-3 text-xs text-violet-300 text-center">
            Price hidden · Fairness proven · Settlement on-chain
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => { setDrawerOpen(true) }}
              className="flex-1 bg-violet-900/50 hover:bg-violet-800/60 text-white text-sm font-medium py-2 rounded-lg transition-all border border-violet-700/30"
            >
              View ZK Proof
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-1.5 text-slate-500 hover:text-white text-sm px-4 py-2 rounded-lg bg-[#0f0f22] hover:bg-[#141430] transition-all"
            >
              <RotateCcw size={13} />
              New Order
            </button>
          </div>
        </div>
      )}

      <ProofDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        proof={proof}
      />
    </div>
  )
}

function Row({ label, value, mono, highlight }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-slate-500 text-xs uppercase tracking-wide shrink-0">{label}</span>
      <span className={`text-right break-all text-sm ${mono ? 'font-mono' : ''} ${
        highlight ? 'text-violet-300' : 'text-slate-200'
      }`}>
        {value}
      </span>
    </div>
  )
}
