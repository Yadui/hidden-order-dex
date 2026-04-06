import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Zap, Lock, AlertTriangle, CheckCircle2, Cpu, Loader2, RotateCcw, RefreshCw } from 'lucide-react'
import { useLocalStorage } from '../hooks/useLocalStorage.js'
import MarketOverview from './MarketOverview.jsx'
import VibeTerminal from './VibeTerminal.jsx'
import { fetchAssetData, SOURCE_LABEL } from '../utils/priceFeeds.js'

const ASSETS = ['ETH', 'BTC', 'SOL', 'XRP', 'AVAX', 'LINK', 'ADA', 'DOT']

const COINGECKO_IDS = {
  ETH:  'ethereum',
  BTC:  'bitcoin',
  SOL:  'solana',
  XRP:  'ripple',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  ADA:  'cardano',
  DOT:  'polkadot',
}

// ── RSI-14 computed from daily closing prices (Wilder smoothing) ────────────
function computeRSI(closingPrices, period = 14) {
  if (closingPrices.length < period + 1) return 50
  const changes = closingPrices.slice(1).map((p, i) => p - closingPrices[i])
  let avgGain = 0, avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  if (avgLoss === 0) return 100
  return Math.round(100 - 100 / (1 + avgGain / avgLoss))
}

const ZK_STEPS = [
  'Running circuit locally…',
  'Building private witness data…',
  'Sending to proof server (localhost:6300)…',
  'Generating ZK proof — direction & confidence never leave this machine…',
  'Proof generated ✓ — recording trade on-chain…',
  'Finalising ✓',
]

const LS = {
  asset:       'as_asset',
  price:       'as_price',
  rsi:         'as_rsi',
  volume:      'as_volume',
  amount:      'as_amount',
  signal:      'as_signal',
  tradeResult: 'as_trade_result',
}

function clearAll() {
  Object.values(LS).forEach((k) => localStorage.removeItem(k))
}

export default function WhaleView({ midnightEnabled, onTradeExecuted, midnight }) {
  // ── Persisted form + result state ──────────────────────────────────────────
  const [asset,       setAsset]       = useLocalStorage(LS.asset,       'ETH')
  const [price,       setPrice]       = useLocalStorage(LS.price,       3200)
  const [rsi,         setRsi]         = useLocalStorage(LS.rsi,         58)
  const [volumeChange,setVolumeChange]= useLocalStorage(LS.volume,      12.5)
  const [amount,      setAmount]      = useLocalStorage(LS.amount,      1)
  const [signal,      setSignal]      = useLocalStorage(LS.signal,      null)
  const [tradeResult, setTradeResult] = useLocalStorage(LS.tradeResult, null)

  // ── Transient UI state (not persisted) ─────────────────────────────────────
  const [loadingSignal,  setLoadingSignal]  = useState(false)
  const [signalError,    setSignalError]    = useState(null)
  const [loadingTrade,   setLoadingTrade]   = useState(false)
  const [zkStep,         setZkStep]         = useState(0)
  const [tradeError,     setTradeError]     = useState(null)

  // ── Field-level validation errors ──────────────────────────────────────────
  const [priceError,  setPriceError]  = useState(null)
  const [volumeError, setVolumeError] = useState(null)
  const [amountError, setAmountError] = useState(null)

  function validatePrice(v) {
    const n = Number(v)
    if (v === '' || v === null || v === undefined) return 'Price is required'
    if (isNaN(n)) return 'Price must be a number'
    if (n <= 0)   return 'Price must be greater than 0'
    if (n > 10_000_000) return 'Price seems unrealistically high'
    return null
  }

  function validateVolume(v) {
    const n = Number(v)
    if (v === '' || v === null || v === undefined) return 'Volume change is required'
    if (isNaN(n)) return 'Must be a number'
    if (n < -100) return 'Cannot be less than -100%'
    if (n > 100_000) return 'Value seems unrealistically high'
    return null
  }

  function validateAmount(v) {
    const n = Number(v)
    if (v === '' || v === null || v === undefined) return 'Amount is required'
    if (isNaN(n)) return 'Amount must be a number'
    if (n <= 0)   return 'Amount must be greater than 0'
    if (n > 1_000_000) return 'Amount exceeds maximum allowed'
    return null
  }

  const signalFormValid = !validatePrice(price) && !validateVolume(volumeChange)
  const [livePrice,      setLivePrice]      = useState(null)
  const [liveRsi,        setLiveRsi]        = useState(null)
  const [liveVolume,     setLiveVolume]     = useState(null)
  const [fetchingPrice,  setFetchingPrice]  = useState(false)
  const [priceSource,    setPriceSource]    = useState(null)

  // ── Live market data (multi-source fallback: CoinGecko → Binance → CoinCap) ──
  async function fetchLivePrice(a) {
    setFetchingPrice(true)
    try {
      const cgId   = COINGECKO_IDS[a]
      const result = await fetchAssetData(a, cgId)
      if (!result) return

      const { price, closes, vols, source } = result
      setPriceSource(source)

      if (price) { setLivePrice(price); setPrice(price) }

      if (closes.length >= 15) {
        const computedRsi = computeRSI(closes)
        setLiveRsi(computedRsi)
        setRsi(computedRsi)
      }

      if (vols.length >= 2) {
        const prev = vols[vols.length - 2]
        const curr = vols[vols.length - 1]
        const pct  = prev > 0 ? +((curr - prev) / prev * 100).toFixed(1) : 0
        setLiveVolume(pct)
        setVolumeChange(pct)
      }
    } catch {
      // silently ignore — user can still type manually
    } finally {
      setFetchingPrice(false)
    }
  }

  // Fetch all live market data when asset changes (on mount + change)
  useEffect(() => { fetchLivePrice(asset) }, [asset])

  const accentBorder = midnightEnabled ? 'border-violet-800/60' : 'border-red-800/60'
  const accentBg     = midnightEnabled ? 'bg-violet-950/40'     : 'bg-red-950/30'
  const accentBtn    = midnightEnabled
    ? 'bg-violet-700 hover:bg-violet-600 text-white'
    : 'bg-red-700 hover:bg-red-600 text-white'
  const cardBg = midnightEnabled ? 'bg-[#10101f]' : 'bg-[#150808]'

  // ── Start Over ─────────────────────────────────────────────────────────────
  function startOver() {
    clearAll()
    setAsset('ETH')
    setPrice(3200)
    setRsi(58)
    setVolumeChange(12.5)
    setAmount(1)
    setSignal(null)
    setTradeResult(null)
    setSignalError(null)
    setTradeError(null)
    setLivePrice(null)
    setLiveRsi(null)
    setLiveVolume(null)
  }

  // ── Generate signal ─────────────────────────────────────────────────────────
  async function generateSignal() {
    const pe = validatePrice(price)
    const ve = validateVolume(volumeChange)
    setPriceError(pe)
    setVolumeError(ve)
    if (pe || ve) return
    setLoadingSignal(true)
    setSignalError(null)
    setSignal(null)
    setTradeResult(null)
    try {
      const res = await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, price: Number(price), volume_change: Number(volumeChange), rsi: Number(rsi) }),
      })
      if (!res.ok) throw new Error(`Server error: ${res.status}`)
      const data = await res.json()
      setSignal(data)
    } catch (e) {
      setSignalError(e.message)
    } finally {
      setLoadingSignal(false)
    }
  }

  // ── Agent: pre-fill form from vibe terminal parsed result ──────────────────
  function handleSignalParsed({ asset: a, amount: amt, signal: sig }) {
    if (a)   { setAsset(a);       fetchLivePrice(a) }
    if (amt) { setAmount(amt) }
    if (sig) { setSignal(sig);    setTradeResult(null); setTradeError(null) }
  }

  // ── Agent: auto-execute from vibe terminal (skip form entirely) ─────────────
  async function handleAutoExecute({ asset: a, amount: amt, signal: sig }) {
    if (!sig || !midnight) return
    // Pre-fill state so the ZK step progress is visible
    if (a)   setAsset(a)
    if (amt) setAmount(amt)
    setSignal(sig)
    setTradeResult(null)
    setTradeError(null)
    setLoadingTrade(true)
    setZkStep(0)

    const liveP = livePrice ?? Number(price)
    let stepIdx = 0
    const stepTimer = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, ZK_STEPS.length - 1)
      setZkStep(stepIdx)
    }, 4000)

    try {
      const timestamp    = new Date().toISOString()
      const proofResult  = await midnight.submitProof({ asset: a ?? asset, amount: Number(amt ?? amount), price: liveP, timestamp, signal: sig })

      const res = await fetch('/api/trade/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: a ?? asset, amount: Number(amt ?? amount), price: liveP, signal: sig,
          proof_override: {
            proof_hash:         proofResult.proofHash,
            contract_address:   proofResult.contractAddress,
            tx_hash:            proofResult.txHash,
            reasoning_hash:     proofResult.reasoningHash,
            zk_mode:            proofResult.mode,
            proof_bytes:        proofResult.proofBytes ?? null,
            proof_preimage:     proofResult.proofPreimage ?? null,
            proof_size_bytes:   proofResult.proofSizeBytes ?? null,
            proof_generated_ms: proofResult.proofGeneratedMs ?? null,
            risk_committed:     proofResult.riskCommitted ?? null,
            strategy_version:   proofResult.strategyVersion ?? 2,
          },
        }),
      })
      if (!res.ok) throw new Error(`Backend error: ${res.status}`)
      const data = await res.json()
      setTradeResult({ ...data, zkMode: proofResult.mode, contractAddress: proofResult.contractAddress, proofSizeBytes: proofResult.proofSizeBytes, proofGeneratedMs: proofResult.proofGeneratedMs, riskCommitted: proofResult.riskCommitted, strategyVersion: proofResult.strategyVersion ?? 2 })
      onTradeExecuted()
    } catch (e) {
      setTradeError(e.message)
    } finally {
      clearInterval(stepTimer)
      setLoadingTrade(false)
    }
  }

  // ── Execute trade ───────────────────────────────────────────────────────────
  async function executeTrade() {
    if (!signal) return
    setLoadingTrade(true)
    setZkStep(0)
    setTradeError(null)
    setTradeResult(null)

    let stepIdx = 0
    const stepTimer = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, ZK_STEPS.length - 1)
      setZkStep(stepIdx)
    }, 4000)

    try {
      const timestamp = new Date().toISOString()

      const proofResult = await midnight.submitProof({
        asset, amount: Number(amount), price: Number(price), timestamp, signal,
      })

      const res = await fetch('/api/trade/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset, amount: Number(amount), price: Number(price), signal,
          proof_override: {
            proof_hash:         proofResult.proofHash,
            contract_address:   proofResult.contractAddress,
            tx_hash:            proofResult.txHash,
            reasoning_hash:     proofResult.reasoningHash,
            zk_mode:            proofResult.mode,
            proof_bytes:        proofResult.proofBytes ?? null,
            proof_preimage:     proofResult.proofPreimage ?? null,
            proof_size_bytes:   proofResult.proofSizeBytes ?? null,
            proof_generated_ms: proofResult.proofGeneratedMs ?? null,
            risk_committed:     proofResult.riskCommitted ?? null,
            strategy_version:   proofResult.strategyVersion ?? 2,
          },
        }),
      })
      if (!res.ok) throw new Error(`Backend error: ${res.status}`)
      const data = await res.json()
      setTradeResult({
        ...data,
        zkMode:           proofResult.mode,
        contractAddress:  proofResult.contractAddress,
        proofSizeBytes:   proofResult.proofSizeBytes,
        proofGeneratedMs: proofResult.proofGeneratedMs,
        riskCommitted:    proofResult.riskCommitted,
        strategyVersion:  proofResult.strategyVersion ?? 2,
      })
      onTradeExecuted()
    } catch (e) {
      setTradeError(e.message)
    } finally {
      clearInterval(stepTimer)
      setLoadingTrade(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Start Over button — only shown once there's something to clear */}
      {(signal || tradeResult) && (
        <div className="flex justify-end">
          <button
            onClick={startOver}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg transition-all"
          >
            <RotateCcw size={12} />
            Start Over
          </button>
        </div>
      )}

      {/* ── Vibe Terminal ────────────────────────────────────────────────── */}
      <VibeTerminal
        midnightEnabled={midnightEnabled}
        onSignalParsed={handleSignalParsed}
        onAutoExecute={handleAutoExecute}
        midnight={midnight}
        disabled={loadingTrade}
      />

      {/* ── Market Overview ──────────────────────────────────────────────── */}
      <MarketOverview
        midnightEnabled={midnightEnabled}
        onSelectAsset={(ticker) => {
          setAsset(ticker)
          fetchLivePrice(ticker)
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left: Signal Engine ─────────────────────────────────────────── */}
        <div id="whale-signal-form" className={`rounded-xl border ${accentBorder} ${cardBg} p-6 space-y-5`}>
          <div className="flex items-center gap-2">
            <Cpu size={18} className={midnightEnabled ? 'text-violet-400' : 'text-red-400'} />
            <h2 className="text-lg font-bold text-white">AI Signal Engine</h2>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded font-mono ${
              midnightEnabled ? 'bg-violet-900/50 text-violet-300' : 'bg-red-900/50 text-red-300'
            }`}>
              {midnightEnabled ? '🔒 PROTECTED' : '⚠️ EXPOSED'}
            </span>
          </div>

          {/* Asset */}
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wide mb-1 block">Asset</label>
            <div className="flex flex-wrap gap-2">
              {ASSETS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAsset(a)}
                  className={`px-3 py-2 rounded-lg text-sm font-bold transition-all min-w-[3.5rem] ${
                    asset === a
                      ? midnightEnabled ? 'bg-violet-700 text-white' : 'bg-red-700 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Price */}
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-2">
              Current Price (USD)
              {livePrice && (
                <span className={`text-xs font-mono font-bold ${SOURCE_LABEL[priceSource]?.color ?? 'text-emerald-500'}`}>
                  ● {SOURCE_LABEL[priceSource]?.text ?? 'LIVE'}
                </span>
              )}
              <button
                onClick={() => fetchLivePrice(asset)}
                disabled={fetchingPrice}
                className="ml-auto text-slate-500 hover:text-slate-300 transition-colors"
                title="Refresh live price"
              >
                <RefreshCw size={11} className={fetchingPrice ? 'animate-spin' : ''} />
              </button>
            </label>
            <input
              type="number"
              value={price}
              onChange={(e) => { setPrice(e.target.value); setLivePrice(null); setPriceError(validatePrice(e.target.value)) }}
              className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-2 ${
                priceError
                  ? 'border-red-600 focus:ring-red-600'
                  : midnightEnabled ? `${accentBorder} focus:ring-violet-600` : `${accentBorder} focus:ring-red-600`
              }`}
            />
            {priceError && <p className="text-red-400 text-xs mt-1">{priceError}</p>}
          </div>

          {/* RSI */
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-2">
              RSI: <span className={`font-mono font-bold ${midnightEnabled ? 'text-violet-300' : 'text-red-300'}`}>{rsi}</span>
              <span className="text-slate-600">
                {rsi < 30 ? '(Oversold)' : rsi > 70 ? '(Overbought)' : '(Neutral)'}
              </span>
              {liveRsi !== null && (
                <span className="text-emerald-500 text-xs font-mono font-bold">● LIVE</span>
              )}
              <button
                onClick={() => fetchLivePrice(asset)}
                disabled={fetchingPrice}
                className="ml-auto text-slate-500 hover:text-slate-300 transition-colors"
                title="Refresh live RSI"
              >
                <RefreshCw size={11} className={fetchingPrice ? 'animate-spin' : ''} />
              </button>
            </label>
            <input
              type="range" min="0" max="100" value={rsi}
              onChange={(e) => { setRsi(Number(e.target.value)); setLiveRsi(null) }}
              className="w-full h-2 rounded cursor-pointer"
              style={{ accentColor: midnightEnabled ? '#7C3AED' : '#DC2626' }}
            />
            <div className="flex justify-between text-xs text-slate-600 mt-1">
              <span>0</span><span>50</span><span>100</span>
            </div>
          </div>

          {/* Volume */}
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-2">
              Volume Change (%)
              {liveVolume !== null && (
                <span className="text-emerald-500 text-xs font-mono font-bold">● LIVE</span>
              )}
              <button
                onClick={() => fetchLivePrice(asset)}
                disabled={fetchingPrice}
                className="ml-auto text-slate-500 hover:text-slate-300 transition-colors"
                title="Refresh live volume"
              >
                <RefreshCw size={11} className={fetchingPrice ? 'animate-spin' : ''} />
              </button>
            </label>
            <input
              type="number"
              value={volumeChange}
              onChange={(e) => { setVolumeChange(e.target.value); setLiveVolume(null); setVolumeError(validateVolume(e.target.value)) }}
              step="0.1"
              className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-2 ${
                volumeError
                  ? 'border-red-600 focus:ring-red-600'
                  : midnightEnabled ? `${accentBorder} focus:ring-violet-600` : `${accentBorder} focus:ring-red-600`
              }`}
            />
            {volumeError && <p className="text-red-400 text-xs mt-1">{volumeError}</p>}
          </div>

          <button
            onClick={generateSignal}
            disabled={loadingSignal || !signalFormValid}
            className={`w-full py-3 rounded-lg font-bold text-sm transition-all ${accentBtn} disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
          >
            {loadingSignal ? (
              <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />Generating Signal...</>
            ) : (
              <><Zap size={16} />Generate Signal</>
            )}
          </button>

          {signalError && (
            <p className="text-red-400 text-sm bg-red-950/40 border border-red-800 rounded p-3">❌ {signalError}</p>
          )}

          {/* Signal result card */}
          {signal && (
            <div className={`rounded-xl border ${accentBorder} ${accentBg} p-4 space-y-3`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wide">Signal Output</h3>
                <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
                  midnightEnabled
                    ? 'border-violet-700 text-violet-400 bg-violet-950/60'
                    : 'border-red-700 text-red-400 bg-red-950/60'
                }`}>{asset}</span>
              </div>

              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold ${
                  signal.direction === 'BUY'
                    ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
                    : 'bg-red-900/60 text-red-300 border border-red-700'
                }`}>
                  {signal.direction === 'BUY' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {signal.direction}
                </span>
                <span className={`text-xs px-2 py-1 rounded font-bold ${
                  signal.risk_level === 'LOW' ? 'bg-emerald-900/50 text-emerald-400'
                  : signal.risk_level === 'HIGH' ? 'bg-red-900/50 text-red-400'
                  : 'bg-amber-900/50 text-amber-400'
                }`}>{signal.risk_level} RISK</span>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Confidence</span>
                  <span className={`font-mono font-bold ${midnightEnabled ? 'text-violet-300' : 'text-red-300'}`}>{signal.confidence}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${midnightEnabled ? 'bg-violet-500' : 'bg-red-500'}`}
                    style={{ width: `${signal.confidence}%` }}
                  />
                </div>
              </div>

              {/* v2: private risk parameters — whale always sees their own values */}
              <div className="grid grid-cols-2 gap-2">
                <div className={`rounded-lg border ${accentBorder} bg-slate-900/60 px-3 py-2`}>
                  <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
                    <Lock size={9} className={midnightEnabled ? 'text-violet-500' : 'text-red-500'} />
                    Stop-Loss
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono font-bold text-sm ${midnightEnabled ? 'text-violet-300' : 'text-red-300'}`}>
                      {signal.stop_loss_pct ?? 10}%
                    </span>
                    <span className="text-slate-600 text-xs font-mono">of position</span>
                  </div>
                  <div className="text-xs text-emerald-600 font-mono mt-0.5">🔒 private witness</div>
                </div>
                <div className={`rounded-lg border ${accentBorder} bg-slate-900/60 px-3 py-2`}>
                  <div className="text-xs text-slate-500 mb-0.5 flex items-center gap-1">
                    <Lock size={9} className={midnightEnabled ? 'text-violet-500' : 'text-red-500'} />
                    Position Size
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono font-bold text-sm ${midnightEnabled ? 'text-violet-300' : 'text-red-300'}`}>
                      {signal.position_pct ?? 20}%
                    </span>
                    <span className="text-slate-600 text-xs font-mono">of portfolio</span>
                  </div>
                  <div className="text-xs text-emerald-600 font-mono mt-0.5">🔒 private witness</div>
                </div>
              </div>

              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Strategy Reasoning</p>
                {/* Whale always sees their own reasoning — it's their strategy */}
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
                  <p className="text-slate-200 text-sm leading-relaxed">{signal.reasoning}</p>
                </div>
                {/* Show what gets broadcast publicly */}
                {midnightEnabled ? (
                  <div className="mt-2 bg-violet-950/40 border border-violet-800/60 rounded-lg px-3 py-2 flex items-center gap-2">
                    <span className="text-violet-400 text-xs font-mono font-bold">🔒 Broadcast to network:</span>
                    <span className="text-violet-600 text-xs font-mono truncate">
                      0x{signal.reasoning.split('').map((c) => c.charCodeAt(0).toString(16).padStart(2,'0')).join('').slice(0,48)}...
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 bg-red-950/40 border border-red-700/60 rounded-lg px-3 py-2 flex items-center gap-2">
                    <AlertTriangle size={11} className="text-red-400 shrink-0" />
                    <span className="text-red-400 text-xs font-bold">Broadcast to network: full reasoning visible — front-running risk</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Execute Trade ─────────────────────────────────────────── */}
        <div id="whale-execute" className={`rounded-xl border ${accentBorder} ${cardBg} p-6 space-y-5`}>
          <div className="flex items-center gap-2">
            {midnightEnabled
              ? <Lock size={18} className="text-violet-400" />
              : <AlertTriangle size={18} className="text-red-400" />
            }
            <h2 className="text-lg font-bold text-white">Execute Trade</h2>
          </div>

          {/* Summary */}
          <div className={`rounded-lg border ${accentBorder} bg-slate-900/50 p-4 space-y-2`}>
            {[
              ['Asset',          <span className={`font-bold font-mono ${midnightEnabled ? 'text-violet-300' : 'text-red-300'}`}>{asset}</span>],
              ['Price',          <span className="text-white font-mono">${Number(price).toLocaleString()}</span>],
              ['Signal',         <span className={signal ? (signal.direction === 'BUY' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold') : 'text-slate-600'}>{signal ? signal.direction : '—'}</span>],
              ['ZK Protection',  <span className={midnightEnabled ? 'text-violet-400' : 'text-red-400'}>{midnightEnabled ? '🔒 Active' : '⚠️ Disabled'}</span>],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-slate-400">{label}</span>
                {val}
              </div>
            ))}
          </div>

          {/* Amount */}
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wide mb-1 block">Amount ({asset})</label>
            <input
              type="number" value={amount} min="0.001" step="0.001"
              onChange={(e) => { setAmount(e.target.value); setAmountError(validateAmount(e.target.value)) }}
              className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-2 ${
                amountError
                  ? 'border-red-600 focus:ring-red-600'
                  : midnightEnabled ? `${accentBorder} focus:ring-violet-600` : `${accentBorder} focus:ring-red-600`
              }`}
            />
            {amountError && <p className="text-red-400 text-xs mt-1">{amountError}</p>}
          </div>

          {/* Total */}
          <div className={`rounded-lg ${accentBg} border ${accentBorder} px-4 py-3 flex justify-between items-center`}>
            <span className="text-slate-400 text-sm">Total Value</span>
            <span className="text-white font-mono font-bold text-lg">
              ${(Number(amount) * Number(price)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>

          {!signal && (
            <p className="text-slate-500 text-sm text-center py-2">Generate a signal first to execute a trade</p>
          )}

          {/* ZK steps */}
          {loadingTrade && (
            <div className={`rounded-lg border ${accentBorder} bg-slate-900/60 p-3 space-y-2`}>
              {ZK_STEPS.map((step, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs transition-all duration-500 ${
                  i < zkStep ? 'text-emerald-500'
                  : i === zkStep ? (midnightEnabled ? 'text-violet-300' : 'text-red-300')
                  : 'text-slate-700'
                }`}>
                  {i < zkStep ? <CheckCircle2 size={12} />
                   : i === zkStep ? <Loader2 size={12} className="animate-spin" />
                   : <span className="w-3 h-3 rounded-full border border-current opacity-30 inline-block" />}
                  {step}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              const ae = validateAmount(amount)
              setAmountError(ae)
              if (!ae) executeTrade()
            }}
            disabled={!signal || loadingTrade || !!validateAmount(amount)}
            className={`w-full py-3 rounded-lg font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${accentBtn}`}
          >
            {loadingTrade ? (
              <><Loader2 size={16} className="animate-spin" />Generating ZK Proof…</>
            ) : midnightEnabled ? (
              <><Lock size={16} />Execute with Midnight Protection</>
            ) : (
              <><AlertTriangle size={16} />Execute UNPROTECTED ⚠️</>
            )}
          </button>

          {tradeError && (
            <p className="text-red-400 text-sm bg-red-950/40 border border-red-800 rounded p-3">❌ {tradeError}</p>
          )}

          {/* Trade result */}
          {tradeResult && (
            <div className={`rounded-xl border ${midnightEnabled ? 'border-emerald-700 bg-emerald-950/30' : 'border-red-700 bg-red-950/20'} p-4 space-y-3`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-400" />
                  <h3 className="text-sm font-bold text-emerald-300">Trade Executed</h3>
                </div>
                <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                  tradeResult.zkMode === 'real'
                    ? 'bg-violet-900/60 text-violet-300 border-violet-600'
                    : 'bg-slate-800 text-slate-400 border-slate-600'
                }`}>
                  {tradeResult.zkMode === 'real' ? '⚡ On-Chain ZK' : '🔵 Mock ZK'}
                </span>
              </div>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Trade ID</span>
                  <span className="text-slate-300 truncate ml-4">{tradeResult.trade_id.slice(0, 16)}…</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Proof ID</span>
                  <span className="text-slate-300 truncate ml-4">{tradeResult.proof_id.slice(0, 16)}…</span>
                </div>
                {tradeResult.contractAddress && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Contract</span>
                    <span className="text-violet-400 truncate ml-4">{tradeResult.contractAddress.slice(0, 18)}…</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <span className="text-emerald-400 font-bold">✅ {tradeResult.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Strategy Exposed</span>
                  <span className="text-emerald-400 font-bold">0 bytes</span>
                </div>
                {tradeResult.zkMode === 'real' && tradeResult.proofSizeBytes && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">ZK Proof Size</span>
                    <span className="text-violet-300 font-bold">{tradeResult.proofSizeBytes.toLocaleString()} bytes</span>
                  </div>
                )}
                {tradeResult.zkMode === 'real' && tradeResult.proofGeneratedMs && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Proof Generated In</span>
                    <span className="text-violet-300 font-bold">
                      {tradeResult.proofGeneratedMs < 1000
                        ? `${tradeResult.proofGeneratedMs}ms`
                        : `${(tradeResult.proofGeneratedMs / 1000).toFixed(1)}s`}
                    </span>
                  </div>
                )}
                {tradeResult.riskCommitted != null && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Risk Committed</span>
                    <span className="text-amber-400 font-bold font-mono">{tradeResult.riskCommitted} <span className="text-slate-600 font-normal">sl+pos (sum only)</span></span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Contract Version</span>
                  <span className="text-violet-400 font-mono">v{tradeResult.strategyVersion ?? 2}</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-slate-500">
                    {tradeResult.zkMode === 'real' && tradeResult.contractAddress
                      ? 'On-Chain Tx Hash'
                      : tradeResult.zkMode === 'real'
                      ? 'ZK Proof Hash'
                      : 'ZK Proof Hash (mock)'}
                  </p>
                  {tradeResult.zkMode === 'real' && !tradeResult.contractAddress && (
                    <span className="text-xs text-amber-500/80 font-mono">
                      local proof · testnet submission pending
                    </span>
                  )}
                </div>
                <p className={`font-mono text-xs break-all p-2 rounded ${
                  midnightEnabled ? 'bg-violet-950/60 text-violet-300' : 'bg-red-950/40 text-red-300'
                }`}>
                  {tradeResult.proof_hash}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
