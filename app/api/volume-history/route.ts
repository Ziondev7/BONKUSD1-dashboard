import { NextResponse } from "next/server"
import {
  getAllDailyVolume,
  getDailyVolumeStats,
} from "@/lib/volume-store"

// ============================================
// CONFIGURATION
// ============================================
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2"
const DUNE_API = "https://api.dune.com/api/v1"
const DUNE_TOKEN_LIST_QUERY_ID = "6575979"

// Optimized cache settings for fast loading
const CACHE_TTL_24H = 60 * 1000 // 1 minute for 24h (needs live data)
const CACHE_TTL_HISTORICAL = 5 * 60 * 1000 // 5 minutes for 7D/1M/ALL (historical doesn't change often)
const TOKEN_LIST_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours for token whitelist
const OHLCV_BATCH_SIZE = 5
const MAX_OHLCV_POOLS = 20 // Reduced for faster loading

// ============================================
// TYPES
// ============================================
interface VolumeDataPoint {
  timestamp: number
  volume: number
  trades: number
  poolCount?: number
  isOhlcv?: boolean
}

interface RaydiumPool {
  id: string
  mintA: { address: string; symbol?: string }
  mintB: { address: string; symbol?: string }
  tvl: number
  day?: { volume?: number }
}

interface PoolVolumeData {
  poolId: string
  symbol: string
  volume24h: number
  liquidity: number
}

interface CacheEntry {
  data: VolumeDataPoint[]
  timestamp: number
  period: string
  synthetic: boolean
  totalVolume24h: number
  poolCount: number
  livePoolCount?: number
  ohlcvCoverage: number
  source: "kv" | "dune" | "raydium" | "synthetic"
}

// ============================================
// IN-MEMORY CACHE
// ============================================
const volumeCache: Map<string, CacheEntry> = new Map()

// Token whitelist cache (shared across requests)
let bonkfunTokenListCache: {
  tokens: Set<string>
  timestamp: number
} | null = null

// ============================================
// UTILITY FUNCTIONS
// ============================================
async function fetchWithTimeout(url: string, timeout = 8000): Promise<Response> {
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

/**
 * Validate a timestamp is valid and reasonable (2024-2030)
 */
function isValidTimestamp(timestamp: number): boolean {
  if (!timestamp || typeof timestamp !== "number" || isNaN(timestamp)) {
    return false
  }
  // Valid range: 2024 to 2030
  const minDate = new Date("2024-01-01").getTime()
  const maxDate = new Date("2030-01-01").getTime()
  return timestamp >= minDate && timestamp <= maxDate
}

/**
 * Normalize timestamp to milliseconds, handling various formats
 */
function normalizeTimestamp(timestamp: number): number {
  if (!timestamp) return 0

  // If in seconds (10 digits), convert to milliseconds
  if (timestamp > 1000000000 && timestamp < 2000000000) {
    return timestamp * 1000
  }
  return timestamp
}

// ============================================
// BONKFUN TOKEN WHITELIST
// ============================================

async function fetchBonkFunTokenList(): Promise<Set<string>> {
  // Check cache first
  if (bonkfunTokenListCache && Date.now() - bonkfunTokenListCache.timestamp < TOKEN_LIST_CACHE_TTL) {
    return bonkfunTokenListCache.tokens
  }

  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    return new Set()
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(
      `${DUNE_API}/query/${DUNE_TOKEN_LIST_QUERY_ID}/results?limit=150000`,
      {
        signal: controller.signal,
        headers: {
          "x-dune-api-key": duneApiKey,
          Accept: "application/json",
        },
      }
    )

    clearTimeout(timeoutId)

    if (!response.ok) {
      return bonkfunTokenListCache?.tokens || new Set()
    }

    const data = await response.json()

    if (data.state !== "QUERY_STATE_COMPLETED" || !data.result?.rows) {
      return bonkfunTokenListCache?.tokens || new Set()
    }

    const tokens = new Set<string>()
    for (const row of data.result.rows) {
      if (row.token_mint) {
        tokens.add(row.token_mint)
      }
    }

    // Cache the token list
    bonkfunTokenListCache = {
      tokens,
      timestamp: Date.now(),
    }

    return tokens
  } catch (error) {
    return bonkfunTokenListCache?.tokens || new Set()
  }
}

// ============================================
// RAYDIUM DATA FETCHER
// ============================================

async function fetchAllRaydiumUSD1Pools(): Promise<{
  pools: PoolVolumeData[]
  totalVolume24h: number
  totalLiquidity: number
}> {
  const pools: PoolVolumeData[] = []
  let totalVolume24h = 0
  let totalLiquidity = 0

  try {
    // Fetch whitelist and Raydium data in parallel for speed
    const [bonkfunTokens, firstResponse] = await Promise.all([
      fetchBonkFunTokenList(),
      fetchWithTimeout(
        `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=500&page=1`
      ),
    ])

    const useWhitelist = bonkfunTokens.size > 0

    if (!firstResponse.ok) {
      return { pools: [], totalVolume24h: 0, totalLiquidity: 0 }
    }

    const firstJson = await firstResponse.json()
    if (!firstJson.success || !firstJson.data?.data) {
      return { pools: [], totalVolume24h: 0, totalLiquidity: 0 }
    }

    const poolMap = new Map<string, PoolVolumeData>()

    const processPool = (pool: any) => {
      const mintA = pool.mintA?.address
      const mintB = pool.mintB?.address
      const symbolA = pool.mintA?.symbol
      const symbolB = pool.mintB?.symbol

      const isAUSD1 = mintA === USD1_MINT
      const isBUSD1 = mintB === USD1_MINT

      if (!isAUSD1 && !isBUSD1) return

      const pairedSymbol = isAUSD1 ? symbolB : symbolA
      const pairedMint = isAUSD1 ? mintB : mintA

      if (useWhitelist && !bonkfunTokens.has(pairedMint)) return

      const volume24h = pool.day?.volume || 0
      const liquidity = pool.tvl || 0

      const existing = poolMap.get(pairedMint)
      if (!existing || volume24h > existing.volume24h) {
        poolMap.set(pairedMint, {
          poolId: pool.id,
          symbol: pairedSymbol || "Unknown",
          volume24h,
          liquidity,
        })
      }
    }

    // Process first page
    firstJson.data.data.forEach(processPool)

    // Fetch more pages if needed (up to 3 total for speed)
    const totalCount = firstJson.data.count || firstJson.data.data.length
    const totalPages = Math.min(Math.ceil(totalCount / 500), 3)

    if (totalPages > 1) {
      const pagePromises = []
      for (let page = 2; page <= totalPages; page++) {
        const url = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=500&page=${page}`
        pagePromises.push(
          fetchWithTimeout(url, 6000)
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
        )
      }

      const results = await Promise.all(pagePromises)
      results.forEach(json => {
        if (json?.success && json.data?.data) {
          json.data.data.forEach(processPool)
        }
      })
    }

    // Convert map to array
    Array.from(poolMap.values()).forEach((pool) => {
      pools.push(pool)
      totalVolume24h += pool.volume24h
      totalLiquidity += pool.liquidity
    })

    pools.sort((a, b) => b.volume24h - a.volume24h)
  } catch (error) {
    console.error("[Volume] Error fetching Raydium pools:", error)
  }

  return { pools, totalVolume24h, totalLiquidity }
}

// ============================================
// OHLCV FETCHER
// ============================================

async function fetchBatchedOHLCV(
  poolAddresses: string[],
  timeframe: string,
  aggregate: number = 1
): Promise<Map<number, { volume: number; pools: number }>> {
  const volumeByTimestamp = new Map<number, { volume: number; pools: number }>()

  for (let i = 0; i < poolAddresses.length; i += OHLCV_BATCH_SIZE) {
    const batch = poolAddresses.slice(i, i + OHLCV_BATCH_SIZE)

    const batchPromises = batch.map(async (poolAddr) => {
      try {
        const url = `${GECKOTERMINAL_API}/networks/solana/pools/${poolAddr}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=500`
        const response = await fetchWithTimeout(url, 6000)

        if (!response.ok) return []

        const data = await response.json()
        const ohlcvList = data.data?.attributes?.ohlcv_list || []

        return ohlcvList.map((candle: number[]) => ({
          timestamp: candle[0] * 1000,
          volume: candle[5] || 0,
        }))
      } catch {
        return []
      }
    })

    const results = await Promise.all(batchPromises)

    for (const poolData of results) {
      for (const point of poolData) {
        const existing = volumeByTimestamp.get(point.timestamp)
        if (existing) {
          existing.volume += point.volume
          existing.pools++
        } else {
          volumeByTimestamp.set(point.timestamp, { volume: point.volume, pools: 1 })
        }
      }
    }

    if (i + OHLCV_BATCH_SIZE < poolAddresses.length) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  return volumeByTimestamp
}

// ============================================
// WEEKLY AGGREGATION (ROBUST)
// ============================================

function aggregateToWeekly(dailyData: VolumeDataPoint[]): VolumeDataPoint[] {
  if (dailyData.length === 0) return []

  // Filter out invalid data first
  const validData = dailyData.filter(day => {
    const ts = normalizeTimestamp(day.timestamp)
    return isValidTimestamp(ts) && day.volume >= 0
  })

  if (validData.length === 0) {
    console.error("[Volume] No valid data points for weekly aggregation")
    return []
  }

  const weeklyMap = new Map<string, {
    timestamp: number
    volume: number
    trades: number
    poolCount: number
    count: number
  }>()

  for (const day of validData) {
    const timestamp = normalizeTimestamp(day.timestamp)
    const date = new Date(timestamp)

    // Get day of week (0 = Sunday, 1 = Monday, etc.)
    const dayOfWeek = date.getUTCDay()

    // Calculate days from Monday (Monday = 0, Sunday = 6)
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

    // Get Monday of this week at midnight UTC
    const weekStartMs = timestamp - (daysFromMonday * 24 * 60 * 60 * 1000)
    const weekStartDate = new Date(weekStartMs)

    // Create a string key for this week
    const year = weekStartDate.getUTCFullYear()
    const month = weekStartDate.getUTCMonth()
    const dayNum = weekStartDate.getUTCDate()
    const weekKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`

    // Create normalized timestamp at midnight UTC
    const normalizedTimestamp = Date.UTC(year, month, dayNum, 0, 0, 0, 0)

    const existing = weeklyMap.get(weekKey)
    if (existing) {
      existing.volume += day.volume
      existing.trades += day.trades || 0
      existing.poolCount = Math.max(existing.poolCount, day.poolCount || 0)
      existing.count++
    } else {
      weeklyMap.set(weekKey, {
        timestamp: normalizedTimestamp,
        volume: day.volume,
        trades: day.trades || 0,
        poolCount: day.poolCount || 0,
        count: 1,
      })
    }
  }

  // Convert to array and sort
  const weeklyData: VolumeDataPoint[] = []
  for (const [key, data] of weeklyMap) {
    // Validate the aggregated timestamp
    if (!isValidTimestamp(data.timestamp)) {
      console.warn(`[Volume] Skipping invalid week: ${key} with timestamp ${data.timestamp}`)
      continue
    }

    weeklyData.push({
      timestamp: data.timestamp,
      volume: Math.round(data.volume),
      trades: data.trades,
      poolCount: data.poolCount,
      isOhlcv: true,
    })
  }

  weeklyData.sort((a, b) => a.timestamp - b.timestamp)

  console.log(`[Volume] Weekly aggregation: ${validData.length} valid days -> ${weeklyData.length} weekly candles`)

  return weeklyData
}

// ============================================
// KV DATA FETCHER
// ============================================

async function fetchKVVolumeHistory(period: string): Promise<{
  data: VolumeDataPoint[]
  totalVolume: number
  uniqueTokens: number
} | null> {
  try {
    const stats = await getDailyVolumeStats()

    if (stats.count === 0) {
      console.log("[Volume] KV is empty")
      return null
    }

    const allData = await getAllDailyVolume()

    if (!allData || allData.length === 0) {
      return null
    }

    // Filter by period
    const now = Date.now()
    let cutoffTime: number

    switch (period) {
      case "24h":
        cutoffTime = now - 24 * 60 * 60 * 1000
        break
      case "7d":
        cutoffTime = now - 7 * 24 * 60 * 60 * 1000
        break
      case "1m":
        cutoffTime = now - 30 * 24 * 60 * 60 * 1000
        break
      case "all":
        cutoffTime = 0
        break
      default:
        cutoffTime = now - 24 * 60 * 60 * 1000
    }

    // Filter and validate data
    const filteredData = allData
      .map(d => ({
        ...d,
        timestamp: normalizeTimestamp(d.timestamp),
      }))
      .filter(d => {
        if (!isValidTimestamp(d.timestamp)) {
          return false
        }
        return d.timestamp >= cutoffTime && d.timestamp <= now
      })
      .sort((a, b) => a.timestamp - b.timestamp)

    if (filteredData.length === 0) {
      console.log("[Volume] No valid data after filtering")
      return null
    }

    let data: VolumeDataPoint[] = filteredData.map(d => ({
      timestamp: d.timestamp,
      volume: d.volume,
      trades: d.trades,
      poolCount: d.uniqueTokens,
      isOhlcv: true,
    }))

    // For ALL period, aggregate to weekly
    if (period === "all" && data.length > 14) {
      data = aggregateToWeekly(data)

      // If aggregation failed, return daily data instead
      if (data.length === 0) {
        console.log("[Volume] Weekly aggregation failed, returning daily data")
        data = filteredData.map(d => ({
          timestamp: d.timestamp,
          volume: d.volume,
          trades: d.trades,
          poolCount: d.uniqueTokens,
          isOhlcv: true,
        }))
      }
    }

    const totalVolume = data.reduce((sum, d) => sum + d.volume, 0)
    const uniqueTokens = Math.max(...filteredData.map(d => d.uniqueTokens), 0)

    console.log(`[Volume] KV returned ${data.length} data points for ${period}`)

    return { data, totalVolume, uniqueTokens }
  } catch (error) {
    console.error("[Volume] KV fetch error:", error)
    return null
  }
}

// ============================================
// MAIN VOLUME HISTORY LOGIC
// ============================================

async function fetchBonkFunVolumeHistory(period: string): Promise<{
  data: VolumeDataPoint[]
  synthetic: boolean
  totalVolume24h: number
  poolCount: number
  livePoolCount?: number
  ohlcvCoverage: number
  source: "kv" | "dune" | "raydium" | "synthetic"
}> {
  const startTime = Date.now()
  console.log(`[Volume] Fetching volume data for period: ${period}`)

  // For historical periods (7D, 1M, ALL), use KV data only for speed
  if (period !== "24h") {
    const kvData = await fetchKVVolumeHistory(period)

    if (kvData && kvData.data.length > 0) {
      console.log(`[Volume] KV data loaded in ${Date.now() - startTime}ms`)

      return {
        data: kvData.data,
        synthetic: false,
        totalVolume24h: kvData.totalVolume,
        poolCount: kvData.uniqueTokens,
        ohlcvCoverage: 100,
        source: "kv",
      }
    }
  }

  // For 24H or if KV is empty, fetch live data
  const { pools, totalVolume24h } = await fetchAllRaydiumUSD1Pools()

  if (pools.length === 0 || totalVolume24h === 0) {
    console.log("[Volume] No pools found")
    return {
      data: [],
      synthetic: true,
      totalVolume24h: 0,
      poolCount: 0,
      ohlcvCoverage: 0,
      source: "synthetic"
    }
  }

  // For 24H, try to get OHLCV data
  if (period === "24h") {
    const topPools = pools.filter(p => p.volume24h > 0).slice(0, MAX_OHLCV_POOLS)
    const poolAddresses = topPools.map(p => p.poolId)
    const volumeCoveredByOHLCV = topPools.reduce((sum, p) => sum + p.volume24h, 0)
    const ohlcvCoverage = totalVolume24h > 0 ? (volumeCoveredByOHLCV / totalVolume24h) * 100 : 0

    const ohlcvData = await fetchBatchedOHLCV(poolAddresses, "hour", 1)

    const now = Date.now()
    const cutoffTime = now - 24 * 60 * 60 * 1000

    const filteredOhlcv: VolumeDataPoint[] = []
    let ohlcvTotalVolume = 0

    for (const [timestamp, data] of ohlcvData) {
      if (timestamp >= cutoffTime && timestamp <= now) {
        filteredOhlcv.push({
          timestamp,
          volume: data.volume,
          trades: 0,
          poolCount: data.pools,
          isOhlcv: true,
        })
        ohlcvTotalVolume += data.volume
      }
    }

    filteredOhlcv.sort((a, b) => a.timestamp - b.timestamp)

    if (filteredOhlcv.length >= 2 && ohlcvTotalVolume > 0) {
      const scaleFactor = totalVolume24h / ohlcvTotalVolume
      const scaledData = filteredOhlcv.map(point => ({
        ...point,
        volume: Math.round(point.volume * scaleFactor),
      }))

      console.log(`[Volume] 24H OHLCV loaded in ${Date.now() - startTime}ms`)

      return {
        data: scaledData,
        synthetic: false,
        totalVolume24h,
        poolCount: pools.length,
        livePoolCount: pools.length,
        ohlcvCoverage,
        source: "raydium",
      }
    }
  }

  // Fallback: create synthetic distribution
  const distributedData = createVolumeDistribution(totalVolume24h, period, pools.length)

  console.log(`[Volume] Synthetic data created in ${Date.now() - startTime}ms`)

  return {
    data: distributedData,
    synthetic: true,
    totalVolume24h,
    poolCount: pools.length,
    livePoolCount: pools.length,
    ohlcvCoverage: 0,
    source: "synthetic",
  }
}

function createVolumeDistribution(totalVolume: number, period: string, poolCount: number): VolumeDataPoint[] {
  const now = Date.now()
  const data: VolumeDataPoint[] = []

  let points: number
  let intervalMs: number

  switch (period) {
    case "24h":
      points = 24
      intervalMs = 60 * 60 * 1000
      break
    case "7d":
      points = 28
      intervalMs = 6 * 60 * 60 * 1000
      break
    case "1m":
      points = 30
      intervalMs = 24 * 60 * 60 * 1000
      break
    case "all":
      points = 12
      intervalMs = 7 * 24 * 60 * 60 * 1000
      break
    default:
      points = 24
      intervalMs = 60 * 60 * 1000
  }

  const volumePerInterval = totalVolume / points

  for (let i = points - 1; i >= 0; i--) {
    const timestamp = now - (i * intervalMs)
    const weight = 0.85 + Math.random() * 0.3

    data.push({
      timestamp,
      volume: Math.round(volumePerInterval * weight),
      trades: 0,
      poolCount,
      isOhlcv: false,
    })
  }

  // Normalize totals
  const currentTotal = data.reduce((sum, d) => sum + d.volume, 0)
  if (currentTotal > 0) {
    const normalizeFactor = totalVolume / currentTotal
    data.forEach(d => {
      d.volume = Math.round(d.volume * normalizeFactor)
    })
  }

  return data
}

function calculateStats(
  data: VolumeDataPoint[],
  totalVolume24h: number,
  poolCount: number
) {
  if (data.length === 0) {
    return {
      current: 0,
      previous: 0,
      change: 0,
      peak: 0,
      low: 0,
      average: 0,
      totalVolume: totalVolume24h,
      poolCount,
    }
  }

  const volumes = data.map(d => d.volume)
  const current = volumes[volumes.length - 1] || 0
  const previous = volumes[0] || current
  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0
  const sumVolume = volumes.reduce((sum, v) => sum + v, 0)
  const totalVolume = Math.max(totalVolume24h, sumVolume)

  return {
    current,
    previous,
    change,
    peak: Math.max(...volumes),
    low: Math.min(...volumes.filter(v => v > 0)),
    average: sumVolume / volumes.length,
    totalVolume,
    poolCount,
  }
}

// ============================================
// API HANDLER
// ============================================

export async function GET(request: Request) {
  const url = new URL(request.url)
  const period = url.searchParams.get("period") || "24h"

  // Determine cache TTL based on period
  const cacheTTL = period === "24h" ? CACHE_TTL_24H : CACHE_TTL_HISTORICAL

  // Check cache
  const cached = volumeCache.get(period)
  if (cached && Date.now() - cached.timestamp < cacheTTL) {
    return NextResponse.json({
      history: cached.data,
      stats: calculateStats(cached.data, cached.totalVolume24h, cached.poolCount),
      period,
      dataPoints: cached.data.length,
      cached: true,
      synthetic: cached.synthetic,
      poolCount: cached.poolCount,
      livePoolCount: cached.livePoolCount,
      ohlcvCoverage: cached.ohlcvCoverage,
      source: cached.source,
    })
  }

  // Fetch fresh data
  const {
    data: volumeData,
    synthetic,
    totalVolume24h,
    poolCount,
    livePoolCount,
    ohlcvCoverage,
    source,
  } = await fetchBonkFunVolumeHistory(period)

  // Update cache
  volumeCache.set(period, {
    data: volumeData,
    timestamp: Date.now(),
    period,
    synthetic,
    totalVolume24h,
    poolCount,
    livePoolCount,
    ohlcvCoverage,
    source,
  })

  return NextResponse.json({
    history: volumeData,
    stats: calculateStats(volumeData, totalVolume24h, poolCount),
    period,
    dataPoints: volumeData.length,
    cached: false,
    synthetic,
    poolCount,
    livePoolCount,
    ohlcvCoverage,
    source,
  })
}

export const runtime = "edge"
