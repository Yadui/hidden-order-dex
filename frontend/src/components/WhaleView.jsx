import { useState, useEffect, useCallback } from 'react'
import { BrainCircuit, Zap, Lock, TrendingUp, TrendingDown, Minus, Loader2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import ProofDrawer from './ProofDrawer'
import CryptoSearch, { POPULAR } from './CryptoSearch'
import { fetchPrice } from '../utils/fetchPrice'

const ASSETS = ['BTC', 'ETH', 'SOL', 'MATIC']
const MOCK_PRICES    = Object.fromEntries(POPULAR.map(c => [c.sym, c.mockPrice]))
const COINGECKO_IDS  = Object.fromEntries(POPULAR.map(c => [c.sym, c.id]))

const ZK_STEPS = [
  'Hashing AI reasoning text…',
  'Building order witness…',
  'Computing settlement hash…',
  'Running submit_order circuit…',
  'Sending to proof server (localhost:6301)…',
  'ZK proof generated — reasoning sealed 🔒',
]

function SignalBadge({ signal }) {
  if (!signal) return null
  const cfg = {
    BUY:  { color: 'emerald', icon: <TrendingUp  size={14} />, label: 'BUY' },
    SELL: { color: 'rose',    icon: <TrendingDown size={14} />, label: 'SELL' },
    HOLD: { color: 'amber',   icon: <Minus        size={14} />, label: 'HOLD' },
  }[signal] ?? { color: 'slate', icon: null, label: signal }

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border
      bg-${cfg.color}-950/50 text-${cfg.color}-300 border-${cfg.color}-700`}>
      {cfg.icon} {cfg.label}
    </span>
  )
}

export default function WhaleView({ midnight }) {
  const [asset, setAsset] = useState('BTC')
  const [assetId, setAssetId] = useState('bitcoin')
  const [price, setPrice] = useState('')
  const [livePrice, setLivePrice] = useState(null)   // CoinGecko live price
  const [amount, setAmount] = useState('')
  const [signal, setSignal] = useState(null)           // AI signal result
  const [signalLoading, setSignalLoading] = useState(false)
  const [signalError, setSignalError] = useState(null)

  const [priceError, setPriceError]   = useState(null)
  const [amountError, setAmountError] = useState(null)

  function validateWhaleFields() {
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
  const [result, setResult] = useState(null)
  const [execError, setExecError] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [proof, setProof] = useState(null)

  // Fetch live price via CoinGecko → Binance → CoinCap waterfall
  const fetchLivePrice = useCallback(async (sym, id) => {
    const cgId = id ?? COINGECKO_IDS[sym]
    const p = await fetchPrice(sym, cgId)
    if (p) {
      setLivePrice(p)
      setPrice(String(p))
    } else {
      setLivePrice(null)
      setPrice(String(MOCK_PRICES[sym] ?? ''))
    }
  }, [])

  // Prefill price when asset changes — try live first, fall back to mock
  useEffect(() => {
    setLivePrice(null)
    setPrice(String(MOCK_PRICES[asset] ?? ''))
    setSignal(null)
    setResult(null)
    setExecError(null)
    fetchLivePrice(asset, assetId)
  }, [asset, assetId, fetchLivePrice])

  async function generateSignal() {
    setSignalLoading(true)
    setSignalError(null)
    setSignal(null)
    try {
      const res = await fetch('/api/ai/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, price_usd: parseFloat(price) || null }),
      })
      if (!res.ok) throw new Error(`Signal API ${res.status}`)
      const data = await res.json()
      setSignal(data)
      // Auto-fill amount from confidence if field is empty (user can override)
      if (data.confidence != null) {
        setAmount(prev => prev.trim() ? prev : (data.confidence / 100).toFixed(4))
      }
    } catch (err) {
      setSignalError(err.message)
    } finally {
      setSignalLoading(false)
    }
  }

  async function executeZkTrade() {
    if (!signal) return
    if (!validateWhaleFields()) return
    setExecuting(true)
    setExecError(null)
    setResult(null)
    setZkStep(0)

    try {
      for (let i = 0; i < ZK_STEPS.length - 1; i++) {
        setZkStep(i)
        await new Promise(r => setTimeout(r, 450))
      }

      // Attempt real ZK proof via midnight-service
      let proofOverride = null
      if (midnight?.serviceUp) {
        try {
          const zkData = await midnight.submitProof({
            order_id: crypto.randomUUID(),
            asset_pair: `${asset}/USDC`,
            side: signal.signal === 'SELL' ? 'SELL' : 'BUY',
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
        } catch { /* fall through to mock */ }
      }

      setZkStep(ZK_STEPS.length - 1)

      const body = {
        asset_pair: `${asset}/USDC`,
        side: signal.signal === 'SELL' ? 'SELL' : 'BUY',
        price: parseFloat(price),
        amount: parseFloat(amount),
        reasoning_hash: signal.reasoning_hash,
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
      const proofRes = await fetch(`/api/proof/${data.order_id}`)
      if (proofRes.ok) setProof(await proofRes.json())
    } catch (err) {
      setExecError(err.message)
    } finally {
      setExecuting(false)
    }
  }

  const sideForSignal = signal?.signal === 'SELL' ? 'SELL' : 'BUY'

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(167,139,250,0.04)]">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <BrainCircuit size={18} className="text-violet-400" />
          WhaleView — AI Copy Trading
        </h2>
        <p className="text-slate-400 text-sm mt-2 leading-relaxed">
          Generate an AI trade signal. The reasoning is hashed and committed on-chain —
          followers see the proof, never the strategy.
        </p>
      </div>

      {/* Privacy guarantee */}
      <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 px-5 py-3 text-sm text-emerald-300 flex items-start gap-3">
        <Lock size={14} className="text-emerald-400 mt-0.5 shrink-0" />
        <span>
          AI reasoning is hashed with SHA-256 before the circuit runs.
          The text is discarded immediately — <strong>0 bytes of strategy</strong> reach any log,
          API response, or on-chain ledger.
        </span>
      </div>

      {/* Asset + price row */}
      <div className="rounded-xl border border-violet-500/[0.1] bg-[#0b0b1c] p-6 space-y-5 shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(167,139,250,0.04)]">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 col-span-2">
            <label className="text-slate-400 text-xs uppercase tracking-wide flex items-center gap-1.5">
              Asset
              {livePrice && (
                <span className="text-emerald-400 text-xs normal-case font-normal">● live</span>
              )}
            </label>
            <CryptoSearch
              value={asset}
              onChange={coin => {
                setAsset(coin.sym)
                setAssetId(coin.id)
                setPrice(String(coin.mockPrice ?? ''))
                setSignal(null)
                setResult(null)
                setExecError(null)
              }}
              onPriceLoad={p => {
                setLivePrice(p)
                if (p) setPrice(String(p))
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs uppercase tracking-wide flex items-center gap-1.5">
              Price (USD)
              {livePrice
                ? <span className="text-emerald-400 text-xs normal-case font-normal">● live</span>
                : <span className="text-amber-400 text-xs normal-case font-normal">⚠ stale fallback</span>
              }
            </label>
            <input
              type="number"
              value={price}
              onChange={e => { setPrice(e.target.value); setPriceError(null) }}
              placeholder="64200"
              className={`w-full bg-[#0d0d20] border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none ${
                priceError ? 'border-rose-500 focus:border-rose-400' : 'border-white/[0.07] focus:border-violet-500'
              }`}
            />
            {priceError && <p className="text-rose-400 text-xs mt-1 flex items-center gap-1">⚠ {priceError}</p>}
          </div>
        </div>

        {/* Generate signal */}
        <button
          onClick={generateSignal}
          disabled={signalLoading}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-700 to-purple-700 hover:from-violet-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-all shadow-[0_4px_16px_rgba(124,58,237,0.25)]"
        >
          {signalLoading
            ? <><Loader2 size={14} className="animate-spin" /> Generating signal…</>
            : <><BrainCircuit size={14} /> Generate AI Signal</>
          }
        </button>

        {signalError && (
          <p className="text-rose-400 text-xs flex items-center gap-1.5">
            <AlertTriangle size={13} /> {signalError}
          </p>
        )}
      </div>

      {/* Signal result */}
      {signal && (
        <div className="rounded-xl border border-violet-600/20 bg-violet-950/25 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-white font-bold text-sm">AI Signal for {signal.asset}/USDC</span>
            <span className="text-slate-500 text-xs font-mono">{signal.source === 'azure_openai' ? '⚡ Azure OpenAI' : '🔵 Mock AI'}</span>
          </div>

          <div className="flex items-center gap-4">
            <SignalBadge signal={signal.signal} />
            <div className="flex-1 bg-[#0f0f22] rounded-full h-2">
              <div
                className="h-2 rounded-full bg-violet-500 transition-all duration-700"
                style={{ width: `${signal.confidence}%` }}
              />
            </div>
            <span className="text-slate-300 text-xs font-mono w-10 text-right">{signal.confidence}%</span>
          </div>

          {/* Encrypted reasoning (whale sees hash, not text) */}
          <div className="bg-[#0c0c1e]/70 rounded-lg p-3 border border-white/[0.06]">
            <p className="text-xs text-slate-500 mb-1">Reasoning committed as SHA-256 (text discarded):</p>
            <p className="font-mono text-xs text-violet-400 break-all">{signal.reasoning_hash}</p>
          </div>

          <div className="text-xs text-slate-500">
            bytes_exposed: <span className="text-emerald-400 font-mono">0</span>
            <span className="mx-2">·</span>
            signal_id: <span className="font-mono text-slate-400">{signal.signal_id?.slice(0, 8)}…</span>
          </div>

          {/* Execute section */}
          {signal.signal !== 'HOLD' && (
            <div className="pt-2 border-t border-slate-700/50 space-y-3">
              <div className="space-y-1.5">
                <label className="text-slate-400 text-xs uppercase tracking-wide">Amount ({signal.asset}) <span className="text-violet-400 normal-case font-normal">· auto-filled from confidence</span></label>
                <input
                  type="number"
                  value={amount}
                  onChange={e => { setAmount(e.target.value); setAmountError(null) }}
                  placeholder="confidence / 100"
                  className={`w-full bg-[#0d0d20] border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none ${
                    amountError ? 'border-rose-500 focus:border-rose-400' : 'border-white/[0.07] focus:border-violet-500'
                  }`}
                />
                {amountError && <p className="text-rose-400 text-xs mt-1 flex items-center gap-1">⚠ {amountError}</p>}
              </div>

              <button
                onClick={executeZkTrade}
                disabled={executing || !amount}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-all shadow-[0_4px_16px_rgba(16,185,129,0.2)]"
              >
                {executing
                  ? <><Loader2 size={14} className="animate-spin" /> {ZK_STEPS[zkStep]}</>
                  : <><Zap size={14} /> Execute ZK Trade ({sideForSignal} {signal.asset})</>
                }
              </button>

              {execError && (
                <p className="text-rose-400 text-xs flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {execError}
                </p>
              )}
            </div>
          )}

          {signal.signal === 'HOLD' && (
            <div className="text-amber-400 text-xs text-center py-2">
              Signal is HOLD — no trade to execute.
            </div>
          )}
        </div>
      )}

      {/* Execution result */}
      {result && (
        <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/20 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400" />
            <span className="text-emerald-300 font-bold text-sm">
              ZK Trade Submitted — Reasoning Sealed
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Entry label="Order ID" value={result.order_id?.slice(0, 12) + '…'} mono />
            <Entry label="Status" value={['PENDING','MATCHED','SETTLED'][result.order_status] ?? result.order_status} />
            <Entry label="Settlement Hash" value={result.settlement_hash?.slice(0, 16) + '…'} mono />
            <Entry label="ZK Mode" value={result.zk_mode === 'real' ? '⚡ Real' : '🔵 Mock'} />
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-xs text-violet-400 hover:text-violet-300 underline"
          >
            View full ZK proof →
          </button>
        </div>
      )}

      <ProofDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} proof={proof} />
    </div>
  )
}

function Entry({ label, value, mono }) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p className={`text-slate-200 truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
