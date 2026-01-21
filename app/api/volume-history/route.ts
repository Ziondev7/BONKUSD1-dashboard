import { NextResponse } from "next/server"
import { getVolumeSnapshots, saveVolumeSnapshot, getStorageStatus, type VolumeSnapshot } from "@/lib/volume-store"

// ============================================
// CONFIGURATION
// ============================================
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2"

// Tokens to exclude (stablecoins, major tokens - not BONK.fun launched)
const EXCLUDED_SYMBOLS = ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"]

// Cache configuration
const CACHE_TTL = 3 * 60 * 1000 // 3 minutes cache for volume history
const OHLCV_BATCH_SIZE = 5 // Fetch OHLCV for top 5 pools per batch (rate limit friendly)
const MAX_OHLCV_POOLS = 30 // Maximum pools to fetch OHLCV from

// ============================================
// TYPES
// ============================================
interface VolumeDataPoint {
  timestamp: number
  volume: number
  trades: number
  poolCount?: number
  isOhlcv?: boolean // True if from real OHLCV data
  isSnapshot?: boolean // True if from stored snapshots
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
  totalVolumePeriod: number
  poolCount: number
  ohlcvCoverage: number // Percentage of volume covered by real OHLCV
  dataSource: "ohlcv" | "snapshots" | "synthetic"
}

// ============================================
// IN-MEMORY CACHE
// ============================================
const volumeCache: Map<string, CacheEntry> = new Map()

// ============================================
// UTILITY FUNCTIONS
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
// DATA FETCHERS
// ============================================

/**
 * Fetch ALL USD1 pools from Raydium with their 24h volumes
 * This gives us the authoritative total volume across the ecosystem
 */
async function fetchAllRaydiumUSD1Pools(): Promise<{
  pools: PoolVolumeData[]
  totalVolume24h: number
  totalLiquidity: number
}> {
  const pools: PoolVolumeData[] = []
  let totalVolume24h = 0
  let totalLiquidity = 0

  try {
    const pageSize = 500
    const maxPages = 5
    const poolMap = new Map<string, PoolVolumeData>()

    // Fetch first page to get total count
    const firstPageUrl = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=${pageSize}&page=1`
    const firstResponse = await fetchWithTimeout(firstPageUrl)

    if (!firstResponse.ok) {
      console.error("[Volume] Raydium API error:", firstResponse.status)
      return { pools: [], totalVolume24h: 0, totalLiquidity: 0 }
    }

    const firstJson = await firstResponse.json()
    if (!firstJson.success || !firstJson.data?.data) {
      return { pools: [], totalVolume24h: 0, totalLiquidity: 0 }
    }

    const processPool = (pool: any) => {
      const mintA = pool.mintA?.address
      const mintB = pool.mintB?.address
      const symbolA = pool.mintA?.symbol
      const symbolB = pool.mintB?.symbol

      const isAUSD1 = mintA === USD1_MINT
      const isBUSD1 = mintB === USD1_MINT

      if (!isAUSD1 && !isBUSD1) return

      // Get the paired token (the BONK.fun launched token)
      const pairedSymbol = isAUSD1 ? symbolB : symbolA
      const pairedMint = isAUSD1 ? mintB : mintA

      // Exclude non-BONK.fun tokens
      if (shouldExclude(pairedSymbol)) return

      const volume24h = pool.day?.volume || 0
      const liquidity = pool.tvl || 0

      // Use pool ID as key to avoid duplicates, keep highest volume pool per token
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

    const totalCount = firstJson.data.count || firstJson.data.data.length
    const totalPages = Math.min(Math.ceil(totalCount / pageSize), maxPages)

    // Fetch remaining pages in parallel
    if (totalPages > 1 && firstJson.data.data.length >= pageSize) {
      const pagePromises = []
      for (let page = 2; page <= totalPages; page++) {
        const url = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=${pageSize}&page=${page}`
        pagePromises.push(
          fetchWithTimeout(url, 8000)
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

    // Convert map to array and calculate totals
    Array.from(poolMap.values()).forEach((pool) => {
      pools.push(pool)
      totalVolume24h += pool.volume24h
      totalLiquidity += pool.liquidity
    })

    // Sort by volume descending
    pools.sort((a, b) => b.volume24h - a.volume24h)

    console.log(`[Volume] Found ${pools.length} BONK.fun/USD1 pools with total 24h volume: $${totalVolume24h.toLocaleString()}`)
  } catch (error) {
    console.error("[Volume] Error fetching Raydium pools:", error)
  }

  return { pools, totalVolume24h, totalLiquidity }
}

/**
 * Fetch OHLCV data from GeckoTerminal for multiple pools
 * Uses batching to stay within rate limits
 */
async function fetchBatchedOHLCV(
  poolAddresses: string[],
  timeframe: string,
  aggregate: number = 1
): Promise<Map<number, { volume: number; pools: number }>> {
  const volumeByTimestamp = new Map<number, { volume: number; pools: number }>()

  // Process in batches to respect rate limits
  for (let i = 0; i < poolAddresses.length; i += OHLCV_BATCH_SIZE) {
    const batch = poolAddresses.slice(i, i + OHLCV_BATCH_SIZE)

    const batchPromises = batch.map(async (poolAddr) => {
      try {
        const url = `${GECKOTERMINAL_API}/networks/solana/pools/${poolAddr}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=1000`
        const response = await fetchWithTimeout(url, 8000)

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

    // Aggregate volumes by timestamp
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

    // Small delay between batches to be rate-limit friendly
    if (i + OHLCV_BATCH_SIZE < poolAddresses.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return volumeByTimestamp
}

/**
 * Convert stored snapshots to volume data points
 * Each snapshot contains totalVolume24h (rolling 24h volume at that point)
 * We use this to show volume trend over time
 */
function snapshotsToVolumeData(
  snapshots: VolumeSnapshot[],
  period: string
): VolumeDataPoint[] {
  if (snapshots.length === 0) return []

  // Sort by timestamp
  const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp)

  // For different periods, aggregate appropriately
  let aggregatedData: VolumeDataPoint[] = []

  switch (period) {
    case "24h": {
      // Hourly data points
      aggregatedData = sorted.map(s => ({
        timestamp: s.timestamp,
        volume: s.totalVolume24h,
        trades: 0,
        poolCount: s.poolCount,
        isSnapshot: true,
      }))
      break
    }
    case "7d": {
      // 4-hour aggregation
      const fourHourMs = 4 * 60 * 60 * 1000
      const buckets = new Map<number, VolumeSnapshot[]>()

      sorted.forEach(s => {
        const bucket = Math.floor(s.timestamp / fourHourMs) * fourHourMs
        const existing = buckets.get(bucket) || []
        existing.push(s)
        buckets.set(bucket, existing)
      })

      aggregatedData = Array.from(buckets.entries()).map(([timestamp, snaps]) => {
        // Use the maximum 24h volume in this bucket (most representative)
        const maxVolume = Math.max(...snaps.map(s => s.totalVolume24h))
        const avgPoolCount = Math.round(snaps.reduce((sum, s) => sum + s.poolCount, 0) / snaps.length)
        return {
          timestamp,
          volume: maxVolume,
          trades: 0,
          poolCount: avgPoolCount,
          isSnapshot: true,
        }
      })
      break
    }
    case "1m": {
      // Daily aggregation
      const dayMs = 24 * 60 * 60 * 1000
      const buckets = new Map<number, VolumeSnapshot[]>()

      sorted.forEach(s => {
        const bucket = Math.floor(s.timestamp / dayMs) * dayMs
        const existing = buckets.get(bucket) || []
        existing.push(s)
        buckets.set(bucket, existing)
      })

      aggregatedData = Array.from(buckets.entries()).map(([timestamp, snaps]) => {
        const maxVolume = Math.max(...snaps.map(s => s.totalVolume24h))
        const avgPoolCount = Math.round(snaps.reduce((sum, s) => sum + s.poolCount, 0) / snaps.length)
        return {
          timestamp,
          volume: maxVolume,
          trades: 0,
          poolCount: avgPoolCount,
          isSnapshot: true,
        }
      })
      break
    }
    case "all": {
      // Weekly aggregation for all-time
      const weekMs = 7 * 24 * 60 * 60 * 1000
      const buckets = new Map<number, VolumeSnapshot[]>()

      sorted.forEach(s => {
        const bucket = Math.floor(s.timestamp / weekMs) * weekMs
        const existing = buckets.get(bucket) || []
        existing.push(s)
        buckets.set(bucket, existing)
      })

      aggregatedData = Array.from(buckets.entries()).map(([timestamp, snaps]) => {
        const maxVolume = Math.max(...snaps.map(s => s.totalVolume24h))
        const avgPoolCount = Math.round(snaps.reduce((sum, s) => sum + s.poolCount, 0) / snaps.length)
        return {
          timestamp,
          volume: maxVolume,
          trades: 0,
          poolCount: avgPoolCount,
          isSnapshot: true,
        }
      })
      break
    }
  }

  return aggregatedData.sort((a, b) => a.timestamp - b.timestamp)
}

// ============================================
// MAIN VOLUME HISTORY LOGIC
// ============================================

/**
 * Main function to fetch accurate volume history
 * Strategy: Always use OHLCV data to get actual per-period volumes
 * This gives accurate totals (sum of all bars = total volume for period)
 */
async function fetchBonkFunVolumeHistory(period: string): Promise<{
  data: VolumeDataPoint[]
  synthetic: boolean
  totalVolume24h: number
  totalVolumePeriod: number
  poolCount: number
  ohlcvCoverage: number
  dataSource: "ohlcv" | "snapshots" | "synthetic"
}> {
  console.log(`[Volume] Fetching BONK.fun/USD1 volume data for period: ${period}`)

  // Step 1: Get current data from Raydium (always needed for latest snapshot)
  const { pools, totalVolume24h, totalLiquidity } = await fetchAllRaydiumUSD1Pools()

  if (pools.length === 0 || totalVolume24h === 0) {
    console.log("[Volume] No BONK.fun/USD1 pools found")
    return { data: [], synthetic: true, totalVolume24h: 0, totalVolumePeriod: 0, poolCount: 0, ohlcvCoverage: 0, dataSource: "synthetic" }
  }

  // Save current snapshot for historical tracking
  await saveVolumeSnapshot({
    timestamp: Date.now(),
    totalVolume24h,
    totalLiquidity,
    poolCount: pools.length,
  })

  // Step 2: Determine cutoff time based on period
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
      cutoffTime = new Date("2025-01-01").getTime()
      break
    default:
      cutoffTime = now - 24 * 60 * 60 * 1000
  }

  // Step 3: Always use OHLCV for accurate per-period volumes
  let timeframe: string
  let aggregate: number

  switch (period) {
    case "24h":
      timeframe = "hour"
      aggregate = 1
      break
    case "7d":
      timeframe = "hour"
      aggregate = 4
      break
    case "1m":
      timeframe = "day"
      aggregate = 1
      break
    case "all":
      timeframe = "day"
      aggregate = 7
      break
    default:
      timeframe = "hour"
      aggregate = 1
  }

  // Get pool addresses for OHLCV (top pools by volume)
  const topPoolsByVolume = pools
    .filter(p => p.volume24h > 0)
    .slice(0, MAX_OHLCV_POOLS)

  const poolAddresses = topPoolsByVolume.map(p => p.poolId)
  const volumeCoveredByOHLCV = topPoolsByVolume.reduce((sum, p) => sum + p.volume24h, 0)
  const ohlcvCoverage = totalVolume24h > 0 ? (volumeCoveredByOHLCV / totalVolume24h) * 100 : 0

  console.log(`[Volume] Fetching OHLCV for ${poolAddresses.length} pools covering ${ohlcvCoverage.toFixed(1)}% of volume`)

  // Fetch OHLCV data
  const ohlcvData = await fetchBatchedOHLCV(poolAddresses, timeframe, aggregate)

  // Filter by time period
  const filteredOhlcv: VolumeDataPoint[] = []
  let ohlcvTotalVolume = 0

  Array.from(ohlcvData.entries()).forEach(([timestamp, data]) => {
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
  })

  // Sort by timestamp
  filteredOhlcv.sort((a, b) => a.timestamp - b.timestamp)

  // Step 4: If we have OHLCV data, scale and return
  if (filteredOhlcv.length >= 2 && ohlcvTotalVolume > 0) {
    // For 24h period: scale to match Raydium's authoritative total (most accurate)
    // For longer periods: scale proportionally based on coverage
    let scaleFactor: number
    let totalVolumePeriod: number

    if (period === "24h" && totalVolume24h > 0) {
      // Use Raydium's 24h total as the authoritative source
      scaleFactor = totalVolume24h / ohlcvTotalVolume
      totalVolumePeriod = totalVolume24h
    } else {
      // For historical data, scale based on coverage percentage
      scaleFactor = ohlcvCoverage > 0 ? (100 / ohlcvCoverage) : 1
      totalVolumePeriod = Math.round(ohlcvTotalVolume * scaleFactor)
    }

    const scaledData = filteredOhlcv.map(point => ({
      ...point,
      volume: Math.round(point.volume * scaleFactor),
    }))

    console.log(`[Volume] Returning ${scaledData.length} OHLCV data points, total period volume: $${totalVolumePeriod.toLocaleString()}`)
    return {
      data: scaledData,
      synthetic: false,
      totalVolume24h,
      totalVolumePeriod,
      poolCount: pools.length,
      ohlcvCoverage,
      dataSource: "ohlcv",
    }
  }

  // Step 5: Fallback - create realistic distribution from total volume
  console.log(`[Volume] OHLCV unavailable, creating synthetic distribution from Raydium volume`)

  const distributedData = createVolumeDistribution(totalVolume24h, period, pools.length)
  const totalVolumePeriod = distributedData.reduce((sum, d) => sum + d.volume, 0)

  return {
    data: distributedData,
    synthetic: true,
    totalVolume24h,
    totalVolumePeriod,
    poolCount: pools.length,
    ohlcvCoverage: 0,
    dataSource: "synthetic",
  }
}

/**
 * Create a realistic volume distribution when OHLCV data isn't available
 * Uses typical crypto trading patterns (higher volume during US trading hours)
 */
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
      points = 7 * 4 // 4-hour candles for 7 days
      intervalMs = 4 * 60 * 60 * 1000
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

  // For 24h, distribute with typical trading pattern (more volume during active hours)
  // For longer periods, use more uniform distribution with slight trend
  const volumePerInterval = totalVolume / points

  for (let i = points - 1; i >= 0; i--) {
    const timestamp = now - (i * intervalMs)
    const date = new Date(timestamp)
    const hour = date.getUTCHours()

    let weight = 1.0

    if (period === "24h") {
      // Higher volume during US trading hours (13:00-22:00 UTC = 8am-5pm EST)
      if (hour >= 13 && hour <= 22) {
        weight = 1.2 + Math.random() * 0.3
      } else if (hour >= 23 || hour <= 5) {
        // Lower during night (UTC)
        weight = 0.6 + Math.random() * 0.2
      } else {
        // Asia/Europe hours
        weight = 0.9 + Math.random() * 0.2
      }
    } else {
      // For longer periods, add slight variance
      weight = 0.85 + Math.random() * 0.3
    }

    data.push({
      timestamp,
      volume: Math.round(volumePerInterval * weight),
      trades: 0,
      poolCount,
      isOhlcv: false,
    })
  }

  // Normalize to ensure total matches
  const currentTotal = data.reduce((sum, d) => sum + d.volume, 0)
  if (currentTotal > 0) {
    const normalizeFactor = totalVolume / currentTotal
    data.forEach(d => {
      d.volume = Math.round(d.volume * normalizeFactor)
    })
  }

  return data
}

/**
 * Calculate statistics from volume data
 */
function calculateStats(
  data: VolumeDataPoint[],
  totalVolumePeriod: number,
  poolCount: number
): {
  current: number
  previous: number
  change: number
  peak: number
  low: number
  average: number
  totalVolume: number
  poolCount: number
} {
  if (data.length === 0) {
    return {
      current: 0,
      previous: 0,
      change: 0,
      peak: 0,
      low: 0,
      average: 0,
      totalVolume: totalVolumePeriod,
      poolCount,
    }
  }

  const volumes = data.map(d => d.volume)
  const current = volumes[volumes.length - 1] || 0
  const previous = volumes[0] || current
  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0

  return {
    current,
    previous,
    change,
    peak: Math.max(...volumes),
    low: Math.min(...volumes.filter(v => v > 0)),
    average: totalVolumePeriod / volumes.length,
    totalVolume: totalVolumePeriod,
    poolCount,
  }
}

// ============================================
// API HANDLER
// ============================================

export async function GET(request: Request) {
  const url = new URL(request.url)
  const period = url.searchParams.get("period") || "24h"
  const debug = url.searchParams.get("debug") === "true"

  // Check cache
  const cached = volumeCache.get(period)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    const response: any = {
      history: cached.data,
      stats: calculateStats(cached.data, cached.totalVolumePeriod, cached.poolCount),
      period,
      dataPoints: cached.data.length,
      cached: true,
      synthetic: cached.synthetic,
      poolCount: cached.poolCount,
      ohlcvCoverage: cached.ohlcvCoverage,
      dataSource: cached.dataSource,
    }

    if (debug) {
      response.storageStatus = await getStorageStatus()
    }

    return NextResponse.json(response)
  }

  // Fetch fresh data
  const {
    data: volumeData,
    synthetic,
    totalVolume24h,
    totalVolumePeriod,
    poolCount,
    ohlcvCoverage,
    dataSource,
  } = await fetchBonkFunVolumeHistory(period)

  // Update cache
  volumeCache.set(period, {
    data: volumeData,
    timestamp: Date.now(),
    period,
    synthetic,
    totalVolume24h,
    totalVolumePeriod,
    poolCount,
    ohlcvCoverage,
    dataSource,
  })

  const response: any = {
    history: volumeData,
    stats: calculateStats(volumeData, totalVolumePeriod, poolCount),
    period,
    dataPoints: volumeData.length,
    cached: false,
    synthetic,
    poolCount,
    ohlcvCoverage,
    dataSource,
  }

  if (debug) {
    response.storageStatus = await getStorageStatus()
  }

  return NextResponse.json(response)
}

// Enable edge runtime for better performance
export const runtime = "edge"
