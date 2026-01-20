import { NextResponse } from "next/server"

// ============================================
// BONK.FUN × USD1 TOTAL VOLUME API
// Aggregates historical volume across ALL pools
// ============================================

const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2"

// BONK.fun LaunchLab tokens migrate to these pool types
const BONKFUN_POOL_TYPES = ["cpmm", "standard"]

// Exclude non-BONK.fun tokens
const EXCLUDED_SYMBOLS = [
  "WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY",
  "FREYA", "REAL", "AOL", "USDD", "DAI", "BUSD"
]

// ============================================
// TYPES
// ============================================

interface Pool {
  id: string
  symbol: string
  tvl: number
  volume24h: number
}

interface OHLCVPoint {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface AggregatedVolume {
  timestamp: number
  volume: number
  poolCount: number
}

interface CacheEntry {
  data: any
  timestamp: number
}

// ============================================
// INTERVAL CONFIGURATION
// ============================================

// Supported intervals with GeckoTerminal mapping
const INTERVAL_CONFIG: Record<string, {
  timeframe: "minute" | "hour" | "day"
  aggregate: number
  limit: number
  cacheTTL: number // ms
  description: string
}> = {
  "5m": {
    timeframe: "minute",
    aggregate: 5,
    limit: 288, // 24 hours of 5-min candles
    cacheTTL: 60 * 1000, // 1 minute cache for short intervals
    description: "5-minute candles for last 24 hours"
  },
  "15m": {
    timeframe: "minute",
    aggregate: 15,
    limit: 192, // 48 hours of 15-min candles
    cacheTTL: 2 * 60 * 1000, // 2 minutes
    description: "15-minute candles for last 48 hours"
  },
  "1h": {
    timeframe: "hour",
    aggregate: 1,
    limit: 72, // 3 days of hourly candles
    cacheTTL: 3 * 60 * 1000, // 3 minutes
    description: "Hourly candles for last 3 days"
  },
  "4h": {
    timeframe: "hour",
    aggregate: 4,
    limit: 42, // 7 days of 4-hour candles
    cacheTTL: 5 * 60 * 1000, // 5 minutes
    description: "4-hour candles for last 7 days"
  },
  "24h": {
    timeframe: "day",
    aggregate: 1,
    limit: 7, // 7 daily candles
    cacheTTL: 10 * 60 * 1000, // 10 minutes
    description: "Daily candles for last week"
  },
  "7d": {
    timeframe: "day",
    aggregate: 1,
    limit: 30, // 30 daily candles
    cacheTTL: 15 * 60 * 1000, // 15 minutes
    description: "Daily candles for last month"
  },
  "30d": {
    timeframe: "day",
    aggregate: 1,
    limit: 90, // 90 daily candles
    cacheTTL: 30 * 60 * 1000, // 30 minutes
    description: "Daily candles for last 3 months"
  },
}

// ============================================
// CACHE
// ============================================

const cache: Map<string, CacheEntry> = new Map()
const poolCache: CacheEntry = { data: null, timestamp: 0 }
const POOL_CACHE_TTL = 5 * 60 * 1000 // 5 minutes for pool list

// ============================================
// UTILITIES
// ============================================

async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

function shouldExclude(symbol?: string): boolean {
  if (!symbol) return false
  const s = symbol.toUpperCase()
  return EXCLUDED_SYMBOLS.some(excluded => s === excluded || s.includes(excluded))
}

// ============================================
// POOL DISCOVERY (RAYDIUM)
// ============================================

async function fetchBonkfunPools(): Promise<Pool[]> {
  // Check cache
  if (poolCache.data && Date.now() - poolCache.timestamp < POOL_CACHE_TTL) {
    console.log(`[Pools] Using cached pool list (${poolCache.data.length} pools)`)
    return poolCache.data
  }

  const pools: Pool[] = []
  console.log("[Pools] Fetching BONK.fun/USD1 pools from Raydium...")

  try {
    const fetchPoolType = async (poolType: string) => {
      const url = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=${poolType}&poolSortField=liquidity&sortType=desc&pageSize=200&page=1`

      try {
        const response = await fetchWithTimeout(url, 8000)
        if (!response.ok) {
          console.error(`[Pools] Raydium ${poolType} error:`, response.status)
          return
        }

        const json = await response.json()
        if (!json.success || !json.data?.data) return

        for (const pool of json.data.data) {
          const mintA = pool.mintA?.address
          const mintB = pool.mintB?.address
          const symbolA = pool.mintA?.symbol || "?"
          const symbolB = pool.mintB?.symbol || "?"

          const isAUSD1 = mintA === USD1_MINT
          const isBUSD1 = mintB === USD1_MINT

          if (!isAUSD1 && !isBUSD1) continue

          const pairedSymbol = isAUSD1 ? symbolB : symbolA
          if (shouldExclude(pairedSymbol)) continue

          pools.push({
            id: pool.id,
            symbol: pairedSymbol,
            tvl: pool.tvl || 0,
            volume24h: pool.day?.volume || 0,
          })
        }
      } catch (error) {
        console.error(`[Pools] Error fetching ${poolType}:`, error)
      }
    }

    // Fetch both pool types in parallel
    await Promise.all(BONKFUN_POOL_TYPES.map(fetchPoolType))

    // Sort by TVL (most liquid pools first)
    pools.sort((a, b) => b.tvl - a.tvl)

    // Cache the result
    poolCache.data = pools
    poolCache.timestamp = Date.now()

    console.log(`[Pools] Found ${pools.length} BONK.fun/USD1 pools`)
  } catch (error) {
    console.error("[Pools] Fatal error:", error)
  }

  return pools
}

// ============================================
// OHLCV FETCHING (GECKOTERMINAL)
// ============================================

async function fetchPoolOHLCV(
  poolAddress: string,
  timeframe: "minute" | "hour" | "day",
  aggregate: number,
  limit: number
): Promise<OHLCVPoint[]> {
  try {
    const url = `${GECKOTERMINAL_API}/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd`

    const response = await fetchWithTimeout(url, 8000)
    if (!response.ok) {
      if (response.status === 429) {
        console.warn(`[OHLCV] Rate limited for pool ${poolAddress.slice(0, 8)}...`)
      }
      return []
    }

    const json = await response.json()
    const ohlcvList = json.data?.attributes?.ohlcv_list || []

    // OHLCV format: [timestamp, open, high, low, close, volume]
    return ohlcvList.map((candle: number[]) => ({
      timestamp: candle[0] * 1000, // Convert to milliseconds
      open: candle[1] || 0,
      high: candle[2] || 0,
      low: candle[3] || 0,
      close: candle[4] || 0,
      volume: candle[5] || 0,
    }))
  } catch (error) {
    console.error(`[OHLCV] Error for ${poolAddress.slice(0, 8)}...:`, error)
    return []
  }
}

// ============================================
// VOLUME AGGREGATION
// ============================================

function aggregateVolumeAcrossPools(
  poolsData: OHLCVPoint[][]
): AggregatedVolume[] {
  const volumeByTimestamp = new Map<number, { volume: number; poolCount: number }>()

  for (const poolData of poolsData) {
    for (const candle of poolData) {
      const existing = volumeByTimestamp.get(candle.timestamp)
      if (existing) {
        existing.volume += candle.volume
        existing.poolCount++
      } else {
        volumeByTimestamp.set(candle.timestamp, {
          volume: candle.volume,
          poolCount: 1,
        })
      }
    }
  }

  // Convert to array and sort by timestamp
  return Array.from(volumeByTimestamp.entries())
    .map(([timestamp, data]) => ({
      timestamp,
      volume: data.volume,
      poolCount: data.poolCount,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

// ============================================
// MAIN VOLUME FETCHER
// ============================================

async function fetchTotalVolume(interval: string): Promise<{
  history: AggregatedVolume[]
  totalVolume: number
  poolCount: number
  topPools: Array<{ symbol: string; volume24h: number; tvl: number }>
  raydiumVolume24h: number
  source: string
  interval: string
  lastUpdated: number
}> {
  const config = INTERVAL_CONFIG[interval]
  if (!config) {
    throw new Error(`Invalid interval: ${interval}`)
  }

  console.log(`[Volume] Fetching ${interval} data (${config.description})`)

  // Step 1: Get pool list
  const pools = await fetchBonkfunPools()

  if (pools.length === 0) {
    return {
      history: [],
      totalVolume: 0,
      poolCount: 0,
      topPools: [],
      raydiumVolume24h: 0,
      source: "geckoterminal",
      interval,
      lastUpdated: Date.now(),
    }
  }

  // Calculate Raydium 24h volume (for validation)
  const raydiumVolume24h = pools.reduce((sum, p) => sum + p.volume24h, 0)

  // Step 2: Fetch OHLCV for top pools
  // Limit to top 15 pools by TVL to stay within rate limits
  // GeckoTerminal: 30 calls/min, so max ~25 pools per request cycle
  const maxPools = 15
  const topPools = pools.slice(0, maxPools)

  console.log(`[Volume] Fetching OHLCV for ${topPools.length} pools (${config.timeframe}, agg: ${config.aggregate})`)

  // Batch requests to avoid rate limiting
  const batchSize = 5
  const allOHLCV: OHLCVPoint[][] = []

  for (let i = 0; i < topPools.length; i += batchSize) {
    const batch = topPools.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(pool =>
        fetchPoolOHLCV(pool.id, config.timeframe, config.aggregate, config.limit)
      )
    )
    allOHLCV.push(...batchResults)

    // Small delay between batches to respect rate limits
    if (i + batchSize < topPools.length) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  // Step 3: Aggregate volume across all pools
  const aggregatedHistory = aggregateVolumeAcrossPools(allOHLCV)

  // Calculate total volume from history
  const totalVolume = aggregatedHistory.reduce((sum, point) => sum + point.volume, 0)

  console.log(`[Volume] Got ${aggregatedHistory.length} data points, total: $${totalVolume.toLocaleString()}`)

  return {
    history: aggregatedHistory,
    totalVolume,
    poolCount: pools.length,
    topPools: topPools.slice(0, 5).map(p => ({
      symbol: p.symbol,
      volume24h: p.volume24h,
      tvl: p.tvl,
    })),
    raydiumVolume24h,
    source: "geckoterminal",
    interval,
    lastUpdated: Date.now(),
  }
}

// ============================================
// API HANDLER
// ============================================

export async function GET(request: Request) {
  const url = new URL(request.url)
  const interval = url.searchParams.get("interval") || "1h"
  const forceRefresh = url.searchParams.get("force") === "true"

  // Validate interval
  if (!INTERVAL_CONFIG[interval]) {
    return NextResponse.json(
      { error: `Invalid interval. Supported: ${Object.keys(INTERVAL_CONFIG).join(", ")}` },
      { status: 400 }
    )
  }

  const config = INTERVAL_CONFIG[interval]
  const cacheKey = `volume-${interval}`

  // Check cache
  const cached = cache.get(cacheKey)
  if (cached && !forceRefresh && Date.now() - cached.timestamp < config.cacheTTL) {
    return NextResponse.json({
      ...cached.data,
      cached: true,
      cacheAge: Date.now() - cached.timestamp,
    })
  }

  try {
    // Fetch fresh data
    const data = await fetchTotalVolume(interval)

    // Calculate stats
    const volumes = data.history.map(h => h.volume)
    const nonZeroVolumes = volumes.filter(v => v > 0)

    const stats = {
      current: volumes[volumes.length - 1] || 0,
      previous: volumes[volumes.length - 2] || volumes[0] || 0,
      change: 0,
      peak: nonZeroVolumes.length > 0 ? Math.max(...nonZeroVolumes) : 0,
      low: nonZeroVolumes.length > 0 ? Math.min(...nonZeroVolumes) : 0,
      average: nonZeroVolumes.length > 0
        ? nonZeroVolumes.reduce((a, b) => a + b, 0) / nonZeroVolumes.length
        : 0,
      totalVolume: data.totalVolume,
    }

    // Calculate change percentage
    if (stats.previous > 0) {
      stats.change = ((stats.current - stats.previous) / stats.previous) * 100
    }

    const response = {
      history: data.history,
      stats,
      poolCount: data.poolCount,
      topPools: data.topPools,
      raydiumVolume24h: data.raydiumVolume24h,
      source: data.source,
      interval,
      dataPoints: data.history.length,
      lastUpdated: data.lastUpdated,
      cached: false,
    }

    // Cache the response
    cache.set(cacheKey, {
      data: response,
      timestamp: Date.now(),
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error("[Volume API] Error:", error)

    // Return cached data if available
    if (cached) {
      return NextResponse.json({
        ...cached.data,
        cached: true,
        stale: true,
        error: "Using stale cache due to error",
      })
    }

    return NextResponse.json(
      { error: "Failed to fetch volume data" },
      { status: 500 }
    )
  }
}

// Edge runtime for better performance
export const runtime = "edge"
