"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import useSWR from "swr"
import type { Token, ApiResponse, StatusState, MetricsSnapshot } from "@/lib/types"

const CACHE_KEY = "bonkusd1_tokens_v6"
const LOCAL_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Use v2 API (on-chain discovery) if enabled
const USE_V2_API = process.env.NEXT_PUBLIC_USE_V2_API === "true"
const API_ENDPOINT = USE_V2_API ? "/api/tokens-v2" : "/api/tokens"

// ============================================
// LOCAL STORAGE HELPERS
// ============================================

function loadLocalCache(): Token[] | null {
  if (typeof window === "undefined") return null
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) {
      const { tokens, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < LOCAL_CACHE_TTL) {
        return tokens
      }
    }
  } catch {
    // Silent fail
  }
  return null
}

function saveLocalCache(tokens: Token[]) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ tokens, timestamp: Date.now() }))
  } catch {
    // Silent fail - quota exceeded
  }
}

// ============================================
// FETCHER WITH ERROR HANDLING
// ============================================

const fetcher = async (url: string): Promise<ApiResponse> => {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`API Error: ${res.status}`)
  }
  return res.json()
}

// ============================================
// MAIN HOOK
// ============================================

interface UseTokensOptions {
  refreshInterval?: number // Default 10s for snappy updates
  enableSound?: boolean
}

interface UseTokensReturn {
  tokens: Token[]
  isLoading: boolean
  isError: boolean
  isRefreshing: boolean
  status: StatusState
  metrics: MetricsSnapshot
  lastRefresh: Date | null
  refresh: () => Promise<void>
  apiHealth: { raydium: boolean; dexscreener: boolean; geckoterminal: boolean } | null
  // Optimistic update support
  updateTokenPrice: (address: string, price: number, change24h?: number) => void
}

export function useTokens(options: UseTokensOptions = {}): UseTokensReturn {
  const { refreshInterval = 10000, enableSound = false } = options // 10s for faster updates

  // Initial cache load
  const [cachedTokens] = useState<Token[] | null>(() => loadLocalCache())
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, { price: number; change24h?: number; timestamp: number }>>(new Map())
  const prevTokensRef = useRef<Map<string, Token>>(new Map())
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // SWR with stale-while-revalidate
  // Uses v2 API (on-chain discovery) if NEXT_PUBLIC_USE_V2_API=true
  const { data, error, isLoading, mutate } = useSWR<ApiResponse>(
    API_ENDPOINT,
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      fallbackData: cachedTokens ? { tokens: cachedTokens, cached: true, timestamp: Date.now() } : undefined,
      keepPreviousData: true,
      onSuccess: (data) => {
        if (data?.tokens && !data.cached) {
          saveLocalCache(data.tokens)
          setLastRefresh(new Date())
        }
      },
    }
  )

  const tokens = useMemo(() => {
    const rawTokens = data?.tokens || []

    // Track price changes for animations
    const prevMap = prevTokensRef.current
    const now = Date.now()

    const updatedTokens = rawTokens.map(token => {
      const prev = prevMap.get(token.address)
      const optimistic = optimisticUpdates.get(token.address)

      // Apply optimistic update if it's recent (< 10s old)
      let currentPrice = token.price
      let currentChange = token.change24h
      if (optimistic && now - optimistic.timestamp < 10000) {
        currentPrice = optimistic.price
        if (optimistic.change24h !== undefined) {
          currentChange = optimistic.change24h
        }
      }

      let priceDirection: 'up' | 'down' | 'neutral' = 'neutral'
      if (prev && prev.price !== currentPrice) {
        priceDirection = currentPrice > prev.price ? 'up' : 'down'
      }

      return {
        ...token,
        price: currentPrice,
        change24h: currentChange,
        prevPrice: prev?.price,
        priceDirection,
        lastUpdate: now,
      }
    })

    // Update previous tokens map
    const newMap = new Map<string, Token>()
    for (const token of updatedTokens) {
      newMap.set(token.address, token)
    }
    prevTokensRef.current = newMap

    return updatedTokens
  }, [data?.tokens, optimisticUpdates])

  // Play sound for hot tokens
  useEffect(() => {
    if (!enableSound || tokens.length === 0) return

    const volumeThreshold = [...tokens]
      .sort((a, b) => b.volume24h - a.volume24h)[Math.floor(tokens.length * 0.2)]?.volume24h || 0

    const hotTokens = tokens.filter(t => 
      t.volume24h >= volumeThreshold && 
      t.change24h > 5 && 
      t.priceDirection === 'up'
    )

    if (hotTokens.length > 0 && prevTokensRef.current.size > 0) {
      if (!audioRef.current) {
        audioRef.current = new Audio("/sounds/alert.mp3")
        audioRef.current.volume = 0.3
      }
      audioRef.current.play().catch(() => {})
    }
  }, [tokens, enableSound])

  // Calculate metrics
  const metrics = useMemo<MetricsSnapshot>(() => {
    if (tokens.length === 0) {
      return {
        totalVolume: 0,
        totalLiquidity: 0,
        totalMcap: 0,
        tokenCount: 0,
        gainersCount: 0,
        losersCount: 0,
        avgChange24h: 0,
        timestamp: Date.now(),
      }
    }

    const totalVolume = tokens.reduce((sum, t) => sum + t.volume24h, 0)
    const totalLiquidity = tokens.reduce((sum, t) => sum + t.liquidity, 0)
    const totalMcap = tokens.reduce((sum, t) => sum + t.mcap, 0)
    const gainersCount = tokens.filter(t => t.change24h > 0).length
    const losersCount = tokens.filter(t => t.change24h < 0).length
    const avgChange24h = tokens.reduce((sum, t) => sum + t.change24h, 0) / tokens.length

    return {
      totalVolume,
      totalLiquidity,
      totalMcap,
      tokenCount: tokens.length,
      gainersCount,
      losersCount,
      avgChange24h,
      timestamp: Date.now(),
    }
  }, [tokens])

  // Status calculation
  const status = useMemo<StatusState>(() => {
    if (isLoading && tokens.length === 0) {
      return { type: "loading", text: "Loading..." }
    }
    if (error) {
      return { type: "error", text: "Offline" }
    }
    if (data?.stale) {
      return { type: "syncing", text: "Syncing...", lastUpdate: lastRefresh || undefined }
    }
    return { type: "live", text: "Live", lastUpdate: lastRefresh || undefined }
  }, [isLoading, error, data?.stale, tokens.length, lastRefresh])

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await mutate()
    } finally {
      setIsRefreshing(false)
    }
  }, [mutate])

  // Optimistic price update function (for WebSocket integration)
  const updateTokenPrice = useCallback((address: string, price: number, change24h?: number) => {
    setOptimisticUpdates(prev => {
      const next = new Map(prev)
      next.set(address, { price, change24h, timestamp: Date.now() })
      return next
    })
  }, [])

  // Clean up stale optimistic updates periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setOptimisticUpdates(prev => {
        const now = Date.now()
        const next = new Map<string, { price: number; change24h?: number; timestamp: number }>()
        prev.forEach((value, key) => {
          // Keep updates less than 10 seconds old
          if (now - value.timestamp < 10000) {
            next.set(key, value)
          }
        })
        // Only update state if something changed
        return next.size === prev.size ? prev : next
      })
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  return {
    tokens,
    isLoading: isLoading && tokens.length === 0,
    isError: !!error,
    isRefreshing,
    status,
    metrics,
    lastRefresh,
    refresh,
    apiHealth: data?.health || null,
    updateTokenPrice,
  }
}

// ============================================
// FAVORITES HOOK
// ============================================

const FAVORITES_KEY = "bonkusd1_favorites"

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set()
    try {
      const stored = localStorage.getItem(FAVORITES_KEY)
      if (stored) {
        return new Set(JSON.parse(stored))
      }
    } catch {
      // Silent fail
    }
    return new Set()
  })

  const toggleFavorite = useCallback((address: string) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(address)) {
        next.delete(address)
      } else {
        next.add(address)
      }
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]))
      } catch {
        // Silent fail
      }
      return next
    })
  }, [])

  const isFavorite = useCallback((address: string) => {
    return favorites.has(address)
  }, [favorites])

  return { favorites, toggleFavorite, isFavorite, count: favorites.size }
}

// ============================================
// SOUND PREFERENCE HOOK
// ============================================

const SOUND_KEY = "bonkusd1_sound"

export function useSoundPreference() {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem(SOUND_KEY) === "true"
  })

  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev
      localStorage.setItem(SOUND_KEY, String(next))
      return next
    })
  }, [])

  return { enabled, toggle }
}

// ============================================
// SCROLL POSITION HOOK
// ============================================

export function useScrollPosition() {
  const [scrolled, setScrolled] = useState(false)
  const [scrollY, setScrollY] = useState(0)

  useEffect(() => {
    let ticking = false
    
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setScrollY(window.scrollY)
          setScrolled(window.scrollY > 20)
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return { scrolled, scrollY }
}
