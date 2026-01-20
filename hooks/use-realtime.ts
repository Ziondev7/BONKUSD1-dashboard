"use client"

import { useState, useEffect, useCallback, useRef } from "react"

/**
 * Real-time price update via WebSocket
 * Uses Birdeye's public WebSocket API for Solana token prices
 *
 * Note: Birdeye free tier has limitations. For production, consider:
 * - Adding API key authentication
 * - Using their paid WebSocket endpoint for higher rate limits
 */

// ============================================
// TYPES
// ============================================

export interface PriceUpdate {
  address: string
  price: number
  priceChange24h?: number
  timestamp: number
}

export interface WebSocketState {
  connected: boolean
  connecting: boolean
  error: string | null
  lastMessage: number | null
  subscriptions: Set<string>
}

interface BirdeyePriceMessage {
  type: "PRICE_DATA"
  data: {
    address: string
    value: number
    priceChange24h?: number
    updateUnixTime: number
  }
}

// ============================================
// WEBSOCKET HOOK
// ============================================

interface UseLivePricesOptions {
  enabled?: boolean
  tokenAddresses: string[]
  onPriceUpdate?: (update: PriceUpdate) => void
  reconnectDelay?: number
  maxReconnectAttempts?: number
}

interface UseLivePricesReturn {
  state: WebSocketState
  prices: Map<string, PriceUpdate>
  subscribe: (addresses: string[]) => void
  unsubscribe: (addresses: string[]) => void
  disconnect: () => void
}

export function useLivePrices(options: UseLivePricesOptions): UseLivePricesReturn {
  const {
    enabled = true,
    tokenAddresses,
    onPriceUpdate,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
  } = options

  const [state, setState] = useState<WebSocketState>({
    connected: false,
    connecting: false,
    error: null,
    lastMessage: null,
    subscriptions: new Set(),
  })

  const [prices, setPrices] = useState<Map<string, PriceUpdate>>(new Map())

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const subscriptionsRef = useRef<Set<string>>(new Set())

  // Clear reconnect timeout on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [])

  const connect = useCallback(() => {
    if (!enabled || wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    setState(prev => ({ ...prev, connecting: true, error: null }))

    try {
      // Birdeye public WebSocket endpoint
      // Note: For production, use authenticated endpoint with API key
      const ws = new WebSocket("wss://public-api.birdeye.so/socket/solana")

      ws.onopen = () => {
        console.log("[WebSocket] Connected to Birdeye")
        reconnectAttemptsRef.current = 0
        setState(prev => ({
          ...prev,
          connected: true,
          connecting: false,
          error: null,
        }))

        // Subscribe to any pending addresses
        if (subscriptionsRef.current.size > 0) {
          const addresses = Array.from(subscriptionsRef.current)
          ws.send(JSON.stringify({
            type: "SUBSCRIBE_PRICE",
            data: { addresses }
          }))
        }
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as BirdeyePriceMessage

          if (message.type === "PRICE_DATA" && message.data) {
            const update: PriceUpdate = {
              address: message.data.address,
              price: message.data.value,
              priceChange24h: message.data.priceChange24h,
              timestamp: message.data.updateUnixTime * 1000,
            }

            setPrices(prev => {
              const next = new Map(prev)
              next.set(update.address, update)
              return next
            })

            setState(prev => ({ ...prev, lastMessage: Date.now() }))

            onPriceUpdate?.(update)
          }
        } catch (err) {
          console.error("[WebSocket] Failed to parse message:", err)
        }
      }

      ws.onerror = (error) => {
        console.error("[WebSocket] Error:", error)
        setState(prev => ({
          ...prev,
          error: "Connection error",
          connecting: false,
        }))
      }

      ws.onclose = (event) => {
        console.log("[WebSocket] Disconnected:", event.code, event.reason)
        wsRef.current = null
        setState(prev => ({
          ...prev,
          connected: false,
          connecting: false,
        }))

        // Attempt reconnect if not intentionally closed
        if (enabled && event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++
          const delay = reconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1)
          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`)

          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, delay)
        }
      }

      wsRef.current = ws
    } catch (err) {
      console.error("[WebSocket] Failed to connect:", err)
      setState(prev => ({
        ...prev,
        connecting: false,
        error: "Failed to connect",
      }))
    }
  }, [enabled, maxReconnectAttempts, onPriceUpdate, reconnectDelay])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "User disconnect")
      wsRef.current = null
    }
    setState(prev => ({
      ...prev,
      connected: false,
      connecting: false,
      subscriptions: new Set(),
    }))
  }, [])

  const subscribe = useCallback((addresses: string[]) => {
    addresses.forEach(addr => subscriptionsRef.current.add(addr))
    setState(prev => ({
      ...prev,
      subscriptions: new Set(subscriptionsRef.current),
    }))

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "SUBSCRIBE_PRICE",
        data: { addresses }
      }))
    }
  }, [])

  const unsubscribe = useCallback((addresses: string[]) => {
    addresses.forEach(addr => subscriptionsRef.current.delete(addr))
    setState(prev => ({
      ...prev,
      subscriptions: new Set(subscriptionsRef.current),
    }))

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "UNSUBSCRIBE_PRICE",
        data: { addresses }
      }))
    }
  }, [])

  // Connect on mount if enabled
  useEffect(() => {
    if (enabled) {
      connect()
    }

    return () => {
      disconnect()
    }
  }, [enabled, connect, disconnect])

  // Subscribe to token addresses when they change
  useEffect(() => {
    if (tokenAddresses.length > 0 && state.connected) {
      subscribe(tokenAddresses)
    }
  }, [tokenAddresses, state.connected, subscribe])

  return {
    state,
    prices,
    subscribe,
    unsubscribe,
    disconnect,
  }
}

// ============================================
// DATA FRESHNESS HOOK
// ============================================

export interface DataFreshnessState {
  isStale: boolean
  isCriticallyStale: boolean
  ageMs: number
  ageText: string
  lastUpdate: Date | null
}

interface UseDataFreshnessOptions {
  lastUpdate: Date | null
  staleThresholdMs?: number // When to show "stale" warning (default: 30s)
  criticalThresholdMs?: number // When data is critically old (default: 2min)
}

export function useDataFreshness(options: UseDataFreshnessOptions): DataFreshnessState {
  const {
    lastUpdate,
    staleThresholdMs = 30 * 1000,
    criticalThresholdMs = 2 * 60 * 1000,
  } = options

  const [state, setState] = useState<DataFreshnessState>({
    isStale: false,
    isCriticallyStale: false,
    ageMs: 0,
    ageText: "Just now",
    lastUpdate: null,
  })

  useEffect(() => {
    const updateFreshness = () => {
      if (!lastUpdate) {
        setState({
          isStale: false,
          isCriticallyStale: false,
          ageMs: 0,
          ageText: "Never",
          lastUpdate: null,
        })
        return
      }

      const ageMs = Date.now() - lastUpdate.getTime()
      const isStale = ageMs > staleThresholdMs
      const isCriticallyStale = ageMs > criticalThresholdMs

      let ageText: string
      if (ageMs < 5000) {
        ageText = "Just now"
      } else if (ageMs < 60000) {
        ageText = `${Math.floor(ageMs / 1000)}s ago`
      } else if (ageMs < 3600000) {
        ageText = `${Math.floor(ageMs / 60000)}m ago`
      } else {
        ageText = `${Math.floor(ageMs / 3600000)}h ago`
      }

      setState({
        isStale,
        isCriticallyStale,
        ageMs,
        ageText,
        lastUpdate,
      })
    }

    updateFreshness()
    const interval = setInterval(updateFreshness, 1000)

    return () => clearInterval(interval)
  }, [lastUpdate, staleThresholdMs, criticalThresholdMs])

  return state
}

// ============================================
// NEW POOL DETECTION HOOK
// ============================================

export interface NewPoolInfo {
  address: string
  symbol: string
  name: string
  detectedAt: number
}

interface UseNewPoolDetectionOptions {
  enabled?: boolean
  currentTokens: Array<{ address: string; symbol: string; name: string }>
  onNewPool?: (pool: NewPoolInfo) => void
}

export function useNewPoolDetection(options: UseNewPoolDetectionOptions) {
  const { enabled = true, currentTokens, onNewPool } = options

  const [newPools, setNewPools] = useState<NewPoolInfo[]>([])
  const knownAddressesRef = useRef<Set<string>>(new Set())
  const isInitializedRef = useRef(false)

  useEffect(() => {
    if (!enabled || currentTokens.length === 0) return

    // On first load, just populate known addresses without triggering "new" events
    if (!isInitializedRef.current) {
      knownAddressesRef.current = new Set(currentTokens.map(t => t.address))
      isInitializedRef.current = true
      return
    }

    // Check for new tokens
    const newTokens: NewPoolInfo[] = []
    for (const token of currentTokens) {
      if (!knownAddressesRef.current.has(token.address)) {
        knownAddressesRef.current.add(token.address)
        const newPool: NewPoolInfo = {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          detectedAt: Date.now(),
        }
        newTokens.push(newPool)
        onNewPool?.(newPool)
      }
    }

    if (newTokens.length > 0) {
      setNewPools(prev => [...newTokens, ...prev].slice(0, 10)) // Keep last 10
    }
  }, [currentTokens, enabled, onNewPool])

  const clearNewPools = useCallback(() => {
    setNewPools([])
  }, [])

  const dismissPool = useCallback((address: string) => {
    setNewPools(prev => prev.filter(p => p.address !== address))
  }, [])

  return {
    newPools,
    hasNewPools: newPools.length > 0,
    clearNewPools,
    dismissPool,
  }
}
