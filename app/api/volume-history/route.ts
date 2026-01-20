import { NextResponse } from "next/server"

const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2"

// BONK.fun uses Raydium LaunchLab - graduated tokens go to CPMM or Standard AMM V4 pools
const BONKFUN_POOL_TYPES = ["cpmm", "standard"]

// Tokens to exclude (stablecoins, major tokens - not BONK.fun launched)
const EXCLUDED_SYMBOLS = ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"]

// Cache
interface CacheEntry {
  data: any
  timestamp: number
}

const volumeCache: Map<string, CacheEntry> = new Map()
const CACHE_TTL = 3 * 60 * 1000 // 3 minutes cache

// Fetch with timeout utility
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

// Check if token should be excluded
function shouldExclude(symbol?: string): boolean {
  if (!symbol) return false
  const s = symbol.toUpperCase()
  return EXCLUDED_SYMBOLS.some(excluded => s === excluded || s.includes(excluded))
}

// Get pool addresses from Raydium for BONK.fun/USD1 pairs
async function fetchRaydiumPoolAddresses(): Promise<{
  pools: Array<{ id: string; symbol: string; tvl: number }>
  totalVolume24h: number
}> {
  const pools: Array<{ id: string; symbol: string; tvl: number }> = []
  let totalVolume24h = 0

  try {
    const fetchPoolType = async (poolType: string) => {
      const url = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=${poolType}&poolSortField=liquidity&sortType=desc&pageSize=100&page=1`

      try {
        const response = await fetchWithTimeout(url)
        if (!response.ok) return

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

          totalVolume24h += pool.day?.volume || 0

          pools.push({
            id: pool.id,
            symbol: pairedSymbol,
            tvl: pool.tvl || 0,
          })
        }
      } catch (error) {
        console.error(`[Volume] Error fetching ${poolType} pools:`, error)
      }
    }

    await Promise.all(BONKFUN_POOL_TYPES.map(fetchPoolType))

    // Sort by TVL descending
    pools.sort((a, b) => b.tvl - a.tvl)

    console.log(`[Volume] Found ${pools.length} BONK.fun/USD1 pools from Raydium`)
  } catch (error) {
    console.error("[Volume] Error:", error)
  }

  return { pools, totalVolume24h }
}

// Fetch OHLCV data from GeckoTerminal for a specific pool
async function fetchPoolOHLCV(
  poolAddress: string,
  timeframe: "minute" | "hour" | "day",
  aggregate: number = 1,
  limit: number = 100
): Promise<Array<{ timestamp: number; volume: number }>> {
  try {
    // GeckoTerminal OHLCV endpoint
    const url = `${GECKOTERMINAL_API}/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd`

    const response = await fetchWithTimeout(url, 8000)
    if (!response.ok) {
      console.error(`[OHLCV] GeckoTerminal error for ${poolAddress}:`, response.status)
      return []
    }

    const json = await response.json()
    const ohlcvList = json.data?.attributes?.ohlcv_list || []

    // OHLCV format: [timestamp, open, high, low, close, volume]
    return ohlcvList.map((candle: number[]) => ({
      timestamp: candle[0] * 1000, // Convert to milliseconds
      volume: candle[5] || 0,
    }))
  } catch (error) {
    console.error(`[OHLCV] Error fetching ${poolAddress}:`, error)
    return []
  }
}

// Aggregate volume data from multiple pools
function aggregateVolumeData(
  poolsData: Array<Array<{ timestamp: number; volume: number }>>
): Array<{ timestamp: number; volume: number }> {
  const volumeByTimestamp = new Map<number, number>()

  for (const poolData of poolsData) {
    for (const point of poolData) {
      // Round timestamp to nearest interval for proper aggregation
      const existing = volumeByTimestamp.get(point.timestamp) || 0
      volumeByTimestamp.set(point.timestamp, existing + point.volume)
    }
  }

  // Convert to array and sort by timestamp
  return Array.from(volumeByTimestamp.entries())
    .map(([timestamp, volume]) => ({ timestamp, volume }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

// Main function to fetch historical volume data
async function fetchHistoricalVolume(period: string): Promise<{
  history: Array<{ timestamp: number; volume: number }>
  totalVolume: number
  poolCount: number
  topPools: Array<{ symbol: string; volume24h: number }>
  source: string
}> {
  console.log(`[Volume] Fetching historical volume for period: ${period}`)

  // Get pool addresses from Raydium
  const { pools, totalVolume24h } = await fetchRaydiumPoolAddresses()

  if (pools.length === 0) {
    console.log("[Volume] No pools found")
    return {
      history: [],
      totalVolume: 0,
      poolCount: 0,
      topPools: [],
      source: "raydium",
    }
  }

  // Determine OHLCV parameters based on period
  let timeframe: "minute" | "hour" | "day"
  let aggregate: number
  let limit: number

  switch (period) {
    case "24h":
      timeframe = "hour"
      aggregate = 1
      limit = 24
      break
    case "7d":
      timeframe = "hour"
      aggregate = 4 // 4-hour candles
      limit = 42 // 7 days * 6 candles per day
      break
    case "1m":
      timeframe = "day"
      aggregate = 1
      limit = 30
      break
    case "all":
      timeframe = "day"
      aggregate = 1
      limit = 90 // 3 months
      break
    default:
      timeframe = "hour"
      aggregate = 1
      limit = 24
  }

  // Fetch OHLCV for top pools (limit to top 10 by TVL for performance)
  const topPoolAddresses = pools.slice(0, 10)

  console.log(`[Volume] Fetching OHLCV for ${topPoolAddresses.length} pools (${timeframe}, aggregate: ${aggregate})`)

  const ohlcvPromises = topPoolAddresses.map(pool =>
    fetchPoolOHLCV(pool.id, timeframe, aggregate, limit)
  )

  const poolsOHLCV = await Promise.all(ohlcvPromises)

  // Aggregate volume across all pools
  const aggregatedVolume = aggregateVolumeData(poolsOHLCV)

  // Calculate total volume from the history
  const historyTotalVolume = aggregatedVolume.reduce((sum, point) => sum + point.volume, 0)

  // Use Raydium's 24h volume if we don't have enough history data
  const totalVolume = period === "24h" && totalVolume24h > historyTotalVolume
    ? totalVolume24h
    : historyTotalVolume

  console.log(`[Volume] Got ${aggregatedVolume.length} data points, total volume: $${totalVolume.toLocaleString()}`)

  // Get top pools with their approximate 24h volume
  const topPools = pools.slice(0, 5).map(p => ({
    symbol: p.symbol,
    volume24h: 0, // We don't have per-pool 24h volume from OHLCV, show TVL-based estimate
  }))

  return {
    history: aggregatedVolume,
    totalVolume,
    poolCount: pools.length,
    topPools,
    source: "geckoterminal",
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const period = url.searchParams.get("period") || "24h"

  // Check cache
  const cacheKey = `volume-${period}`
  const cached = volumeCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({
      ...cached.data,
      cached: true,
    })
  }

  // Fetch fresh data
  const data = await fetchHistoricalVolume(period)

  // Calculate stats
  const volumes = data.history.map(h => h.volume)
  const stats = {
    current: volumes[volumes.length - 1] || 0,
    previous: volumes[0] || 0,
    change: volumes.length > 1 && volumes[0] > 0
      ? ((volumes[volumes.length - 1] - volumes[0]) / volumes[0]) * 100
      : 0,
    peak: volumes.length > 0 ? Math.max(...volumes) : 0,
    low: volumes.length > 0 ? Math.min(...volumes.filter(v => v > 0)) : 0,
    average: volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0,
    totalVolume: data.totalVolume,
  }

  const response = {
    history: data.history,
    stats,
    period,
    dataPoints: data.history.length,
    poolCount: data.poolCount,
    topPools: data.topPools,
    source: data.source,
    cached: false,
  }

  // Cache the result
  volumeCache.set(cacheKey, {
    data: response,
    timestamp: Date.now(),
  })

  return NextResponse.json(response)
}

export const runtime = "edge"
