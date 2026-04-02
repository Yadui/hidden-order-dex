// ─── useMidnight ──────────────────────────────────────────────────────────────
// Central React hook for all Midnight Network interactions.
//
// Exposes:
//   walletStatus  — 'disconnected' | 'connecting' | 'connected' | 'error'
//   walletAddress — shortened Midnight address (or null)
//   proofServer   — { reachable: bool }
//   connect()     — trigger Lace wallet connection popup
//   submitProof() — run ZK proof generation + on-chain submission
//   zkMode        — 'real' | 'mock'  (what the last proof used)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import { isLaceInstalled, connectLaceWallet, getWalletAddress } from '../midnight/wallet.js'
import { submitTradeProof, checkMidnightService } from '../midnight/api.js'

export function useMidnight() {
  const [walletStatus, setWalletStatus] = useState('disconnected')
  const [walletAddress, setWalletAddress] = useState(null)
  const [walletError, setWalletError]   = useState(null)
  const [serviceStatus, setServiceStatus] = useState({
    serviceUp: false, proofServerUp: false, contractCompiled: false, networkId: null, zkMode: 'mock',
  })
  const [zkMode, setZkMode] = useState(null) // 'real' | 'mock'
  const walletApiRef = useRef(null)

  // Poll midnight-service health every 10s
  useEffect(() => {
    let alive = true
    async function poll() {
      const status = await checkMidnightService()
      if (alive) setServiceStatus(status)
    }
    poll()
    const t = setInterval(poll, 10_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const connect = useCallback(async () => {
    setWalletStatus('connecting')
    setWalletError(null)
    try {
      const api = await connectLaceWallet()
      walletApiRef.current = api
      const addr = await getWalletAddress(api)
      setWalletAddress(addr ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : 'Connected')
      setWalletStatus('connected')
    } catch (err) {
      setWalletError(err.message)
      setWalletStatus('error')
    }
  }, [])

  /**
   * Generate a ZK proof and submit on-chain.
   * Falls back to mock if Midnight stack is unreachable.
   *
   * @param {object} tradeData — { asset, amount, price, timestamp, signal }
   * @returns {Promise<object>} result from submitTradeProof()
   */
  const submitProof = useCallback(async (tradeData) => {
    const result = await submitTradeProof(walletApiRef.current, tradeData)
    setZkMode(result.mode)
    return result
  }, [])

  return {
    // Wallet
    walletStatus,
    walletAddress,
    walletError,
    isLaceInstalled: isLaceInstalled(),
    connect,
    // Midnight service + proof server
    serviceUp: serviceStatus.serviceUp,
    proofServerUp: serviceStatus.proofServerUp,
    contractCompiled: serviceStatus.contractCompiled,
    networkId: serviceStatus.networkId,
    serviceZkMode: serviceStatus.zkMode,
    // ZK submission
    submitProof,
    zkMode,
    // Derived convenience flag
    isFullyConnected: walletStatus === 'connected' && serviceStatus.serviceUp,
  }
}
