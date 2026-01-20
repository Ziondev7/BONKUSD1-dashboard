import { NextResponse } from "next/server"
import { isSupabaseConfigured, getAggregatedVolume } from "@/lib/supabase"

// ============================================
// CONFIGURATION
// ============================================
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2"

// Feature flag: Use database when available
const USE_DATABASE = true

// Tokens to exclude (stablecoins, major tokens - not BONK.fun launched)
const EXCLUDED_SYMBOLS = ["USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "mSOL", "stSOL", "jitoSOL", "BONK", "JUP", "PYUSD", "DAI", "BUSD"]

// Tokens to exclude by mint address
const EXCLUDED_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "So11111111111111111111111111111111111111112",   // SOL (wrapped)
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",  // mSOL
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",  // JUP
  USD1_MINT, // USD1 itself
])

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
  ohlcvCoverage: number // Percentage of volume covered by real OHLCV
}

// ============================================
// IN-MEMORY CACHE
// ============================================
const volumeCache: Map<string, CacheEntry> = new Map()

// Volume snapshot store for historical tracking
// (In production, this would be Vercel KV or another persistent store)
interface VolumeSnapshot {
  timestamp: number
  totalVolume24h: number
  poolCount: number
}

const volumeSnapshots: VolumeSnapshot[] = []
const MAX_SNAPSHOTS = 720 // Store up to 30 days of hourly snapshots

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

function shouldExcludeSymbol(symbol?: string): boolean {
  if (!symbol) return false
  const s = symbol.toUpperCase()
  return EXCLUDED_SYMBOLS.some(excluded => s === excluded || s.includes(excluded))
}

function shouldExcludeMint(mint?: string): boolean {
  if (!mint) return false
  return EXCLUDED_MINTS.has(mint)
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

      // Exclude non-BONK.fun tokens (by symbol AND mint address)
      if (shouldExcludeSymbol(pairedSymbol) || shouldExcludeMint(pairedMint)) return

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
 * Record a volume snapshot for historical tracking
 */
function recordVolumeSnapshot(totalVolume24h: number, poolCount: number): void {
  const now = Date.now()
  const hourTimestamp = Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000)

  // Check if we already have a snapshot for this hour
  const existingIndex = volumeSnapshots.findIndex(
    s => Math.abs(s.timestamp - hourTimestamp) < 30 * 60 * 1000
  )

  if (existingIndex >= 0) {
    // Update existing snapshot if volume is higher
    if (totalVolume24h > volumeSnapshots[existingIndex].totalVolume24h) {
      volumeSnapshots[existingIndex] = { timestamp: hourTimestamp, totalVolume24h, poolCount }
    }
  } else {
    // Add new snapshot
    volumeSnapshots.push({ timestamp: hourTimestamp, totalVolume24h, poolCount })

    // Keep only MAX_SNAPSHOTS
    if (volumeSnapshots.length > MAX_SNAPSHOTS) {
      volumeSnapshots.shift()
    }
  }

  // Sort by timestamp
  volumeSnapshots.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Get stored volume snapshots for a period
 */
function getStoredSnapshots(period: string): VolumeSnapshot[] {
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

  return volumeSnapshots.filter(s => s.timestamp >= cutoffTime)
}

// ============================================
// MAIN VOLUME HISTORY LOGIC
// ============================================

/**
 * Main function to fetch accurate volume history
 * Strategy:
 * 1. Get ALL pools and their 24h volumes from Raydium (source of truth for totals)
 * 2. Fetch OHLCV from top pools by volume to get time distribution
 * 3. Scale the OHLCV data to match the actual total volume
 * 4. Fallback to realistic distribution if OHLCV unavailable
 */
async function fetchBonkFunVolumeHistory(period: string): Promise<{
  data: VolumeDataPoint[]
  synthetic: boolean
  totalVolume24h: number
  poolCount: number
  ohlcvCoverage: number
}> {
  console.log(`[Volume] Fetching BONK.fun/USD1 volume data for period: ${period}`)

  // Step 1: Get ALL pools from Raydium
  const { pools, totalVolume24h, totalLiquidity } = await fetchAllRaydiumUSD1Pools()

  if (pools.length === 0 || totalVolume24h === 0) {
    console.log("[Volume] No BONK.fun/USD1 pools found")
    return { data: [], synthetic: true, totalVolume24h: 0, poolCount: 0, ohlcvCoverage: 0 }
  }

  // Record snapshot for historical tracking
  recordVolumeSnapshot(totalVolume24h, pools.length)

  // Step 2: Determine timeframe settings
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

  // Step 3: Get pool addresses for OHLCV (top pools by volume, up to MAX_OHLCV_POOLS)
  const topPoolsByVolume = pools
    .filter(p => p.volume24h > 0)
    .slice(0, MAX_OHLCV_POOLS)

  const poolAddresses = topPoolsByVolume.map(p => p.poolId)
  const volumeCoveredByOHLCV = topPoolsByVolume.reduce((sum, p) => sum + p.volume24h, 0)
  const ohlcvCoverage = totalVolume24h > 0 ? (volumeCoveredByOHLCV / totalVolume24h) * 100 : 0

  console.log(`[Volume] Fetching OHLCV for ${poolAddresses.length} pools covering ${ohlcvCoverage.toFixed(1)}% of volume`)

  // Step 4: Fetch OHLCV data
  const ohlcvData = await fetchBatchedOHLCV(poolAddresses, timeframe, aggregate)

  // Step 5: Filter by time period
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

  // Filter OHLCV data by cutoff time
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

  // Step 6: If we have OHLCV data, scale it to match actual total
  if (filteredOhlcv.length >= 2 && ohlcvTotalVolume > 0) {
    // For 24h period, scale to match Raydium's reported total
    const scaleFactor = period === "24h" && totalVolume24h > 0
      ? totalVolume24h / ohlcvTotalVolume
      : 1

    const scaledData = filteredOhlcv.map(point => ({
      ...point,
      volume: Math.round(point.volume * scaleFactor),
    }))

    console.log(`[Volume] Returning ${scaledData.length} OHLCV data points (scaled by ${scaleFactor.toFixed(2)}x)`)
    return {
      data: scaledData,
      synthetic: false,
      totalVolume24h,
      poolCount: pools.length,
      ohlcvCoverage,
    }
  }

  // Step 7: Fallback - create realistic distribution from total volume
  console.log(`[Volume] OHLCV unavailable, creating distribution from Raydium volume`)

  const distributedData = createVolumeDistribution(totalVolume24h, period, pools.length)

  return {
    data: distributedData,
    synthetic: true,
    totalVolume24h,
    poolCount: pools.length,
    ohlcvCoverage: 0,
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
  totalVolume24h: number,
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
      totalVolume: totalVolume24h,
      poolCount,
    }
  }

  const volumes = data.map(d => d.volume)
  const current = volumes[volumes.length - 1] || 0
  const previous = volumes[0] || current
  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0
  const sumVolume = volumes.reduce((sum, v) => sum + v, 0)

  // Use the Raydium total if it's more accurate
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
  const forceRefresh = url.searchParams.get("refresh") === "true"

  // ============================================
  // STRATEGY 1: Use Database (Supabase) - Instant, No Rate Limits
  // ============================================
  if (USE_DATABASE && isSupabaseConfigured() && !forceRefresh) {
    console.log(`[Volume] Checking Supabase for ${period} data...`)

    // For 24H, if database doesn't have recent data, use 7D data filtered to last 24h
    let dbResult = await getAggregatedVolume(period as '24h' | '7d' | '1m' | 'all')

    // If 24H is empty but we have historical data, use 7D and filter
    if (period === '24h' && (!dbResult || dbResult.history.length === 0)) {
      console.log(`[Volume] 24H empty, checking 7D data...`)
      const sevenDayResult = await getAggregatedVolume('7d')
      if (sevenDayResult && sevenDayResult.history.length > 0) {
        // Filter to last 24 hours
        const cutoff = Date.now() - 24 * 60 * 60 * 1000
        const filtered = sevenDayResult.history.filter(h => h.timestamp >= cutoff)
        if (filtered.length > 0) {
          dbResult = {
            history: filtered,
            total: filtered.reduce((sum, h) => sum + h.volume, 0),
            poolCount: sevenDayResult.poolCount
          }
        }
      }
    }

    if (dbResult && dbResult.history.length > 0) {
      console.log(`[Volume] Using Supabase data: ${dbResult.history.length} points, $${dbResult.total.toLocaleString()} total`)

      const volumeData = dbResult.history.map(h => ({
        timestamp: h.timestamp,
        volume: h.volume,
        trades: h.trades,
        isOhlcv: true, // Data from DB is real on-chain data
      }))

      return NextResponse.json({
        history: volumeData,
        stats: calculateStats(volumeData, dbResult.total, dbResult.poolCount),
        period,
        dataPoints: volumeData.length,
        cached: false,
        synthetic: false,
        poolCount: dbResult.poolCount,
        ohlcvCoverage: 100, // Database has complete coverage
        source: 'database',
      })
    }

    console.log(`[Volume] Supabase empty for all periods, falling back to API...`)
  }

  // ============================================
  // STRATEGY 2: Use In-Memory Cache
  // ============================================
  const cached = volumeCache.get(period)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({
      history: cached.data,
      stats: calculateStats(cached.data, cached.totalVolume24h, cached.poolCount),
      period,
      dataPoints: cached.data.length,
      cached: true,
      synthetic: cached.synthetic,
      poolCount: cached.poolCount,
      ohlcvCoverage: cached.ohlcvCoverage,
      source: 'cache',
    })
  }

  // ============================================
  // STRATEGY 3: Fetch from External APIs (Fallback)
  // ============================================
  const {
    data: volumeData,
    synthetic,
    totalVolume24h,
    poolCount,
    ohlcvCoverage,
  } = await fetchBonkFunVolumeHistory(period)

  // Update cache
  volumeCache.set(period, {
    data: volumeData,
    timestamp: Date.now(),
    period,
    synthetic,
    totalVolume24h,
    poolCount,
    ohlcvCoverage,
  })

  return NextResponse.json({
    history: volumeData,
    stats: calculateStats(volumeData, totalVolume24h, poolCount),
    period,
    dataPoints: volumeData.length,
    cached: false,
    synthetic,
    poolCount,
    ohlcvCoverage,
    source: 'api',
  })
}

// Enable edge runtime for better performance
export const runtime = "edge"
