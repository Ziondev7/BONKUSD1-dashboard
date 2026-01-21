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

// Dune Analytics API for fallback when KV is empty
const DUNE_API = "https://api.dune.com/api/v1"
const DUNE_QUERY_ID = "6572422" // BonkFun USD1 Daily Volume query

// Tokens to exclude (stablecoins, major tokens - not BONK.fun launched)
const EXCLUDED_SYMBOLS = ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"]

// Cache configuration
const CACHE_TTL = 3 * 60 * 1000 // 3 minutes cache for volume history
const DUNE_CACHE_TTL = 60 * 60 * 1000 // 1 hour cache for Dune data (fallback only)
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
  source: "kv" | "dune" | "raydium" | "synthetic"
}

// Dune API response types
interface DuneVolumeRow {
  date: string
  num_trades: number
  unique_tokens: number
  total_volume_usd: number
}

interface DuneApiResponse {
  execution_id: string
  query_id: number
  state: string
  result?: {
    rows: DuneVolumeRow[]
    metadata: {
      column_names: string[]
      result_set_bytes: number
      total_row_count: number
    }
  }
}

// ============================================
// IN-MEMORY CACHE
// ============================================
const volumeCache: Map<string, CacheEntry> = new Map()

// Separate cache for Dune data (longer TTL since it's historical)
let duneDataCache: {
  data: DuneVolumeRow[]
  timestamp: number
} | null = null

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

function shouldExclude(symbol?: string): boolean {
  if (!symbol) return false
  const s = symbol.toUpperCase()
  return EXCLUDED_SYMBOLS.some(excluded => s === excluded || s.includes(excluded))
}

// ============================================
// DUNE API FETCHER (Primary source for historical data)
// ============================================

/**
 * Fetch historical volume data from Dune Analytics
 * This provides accurate on-chain data for the BonkFun USD1 ecosystem
 */
async function fetchDuneVolumeHistory(): Promise<DuneVolumeRow[] | null> {
  // Check cache first
  if (duneDataCache && Date.now() - duneDataCache.timestamp < DUNE_CACHE_TTL) {
    console.log("[Volume] Using cached Dune data")
    return duneDataCache.data
  }

  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    console.log("[Volume] No DUNE_API_KEY configured, falling back to Raydium")
    return null
  }

  try {
    console.log("[Volume] Fetching historical data from Dune Analytics...")

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(
      `${DUNE_API}/query/${DUNE_QUERY_ID}/results?limit=1000`,
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
      console.error("[Volume] Dune API error:", response.status)
      return null
    }

    const data: DuneApiResponse = await response.json()

    if (data.state !== "QUERY_STATE_COMPLETED" || !data.result?.rows) {
      console.error("[Volume] Dune query not ready or no results")
      return null
    }

    const rows = data.result.rows
    console.log(`[Volume] Fetched ${rows.length} days of historical data from Dune`)

    // Cache the data
    duneDataCache = {
      data: rows,
      timestamp: Date.now(),
    }

    return rows
  } catch (error) {
    console.error("[Volume] Error fetching from Dune:", error)
    return null
  }
}

/**
 * Convert Dune data to VolumeDataPoint format
 */
function convertDuneToVolumeData(
  duneRows: DuneVolumeRow[],
  period: string
): { data: VolumeDataPoint[]; totalVolume: number; uniqueTokens: number } {
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

  // Filter and convert rows
  const filteredRows = duneRows
    .map(row => ({
      timestamp: new Date(row.date).getTime(),
      volume: row.total_volume_usd,
      trades: row.num_trades,
      uniqueTokens: row.unique_tokens,
    }))
    .filter(row => row.timestamp >= cutoffTime && row.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp)

  const data: VolumeDataPoint[] = filteredRows.map(row => ({
    timestamp: row.timestamp,
    volume: Math.round(row.volume),
    trades: row.trades,
    poolCount: row.uniqueTokens,
    isOhlcv: true, // Dune data is real on-chain data
  }))

  const totalVolume = data.reduce((sum, d) => sum + d.volume, 0)
  const uniqueTokens = Math.max(...filteredRows.map(r => r.uniqueTokens), 0)

  return { data, totalVolume, uniqueTokens }
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
// VERCEL KV DATA FETCHER (Primary source)
// ============================================

/**
 * Fetch historical volume data from Vercel KV
 * This is the primary source for historical data (fast, ~5ms)
 */
async function fetchKVVolumeHistory(period: string): Promise<{
  data: VolumeDataPoint[]
  totalVolume: number
  uniqueTokens: number
} | null> {
  try {
    const stats = await getDailyVolumeStats()

    if (stats.count === 0) {
      console.log("[Volume] KV is empty, need to seed first")
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

    const filteredData = allData
      .filter(d => d.timestamp >= cutoffTime && d.timestamp <= now)
      .sort((a, b) => a.timestamp - b.timestamp)

    const data: VolumeDataPoint[] = filteredData.map(d => ({
      timestamp: d.timestamp,
      volume: d.volume,
      trades: d.trades,
      poolCount: d.uniqueTokens,
      isOhlcv: true, // KV data is accurate historical data
    }))

    const totalVolume = data.reduce((sum, d) => sum + d.volume, 0)
    const uniqueTokens = Math.max(...filteredData.map(d => d.uniqueTokens), 0)

    console.log(`[Volume] KV returned ${data.length} days of historical data`)

    return { data, totalVolume, uniqueTokens }
  } catch (error) {
    console.error("[Volume] KV fetch error:", error)
    return null
  }
}

/**
 * Fetch today's live 24h volume from Raydium
 */
async function fetchTodayLiveVolume(): Promise<{
  volume24h: number
  poolCount: number
  uniqueTokens: number
} | null> {
  try {
    const { pools, totalVolume24h } = await fetchAllRaydiumUSD1Pools()

    if (pools.length === 0) {
      return null
    }

    const uniqueTokens = new Set<string>()
    pools.forEach(p => uniqueTokens.add(p.symbol))

    return {
      volume24h: totalVolume24h,
      poolCount: pools.length,
      uniqueTokens: uniqueTokens.size,
    }
  } catch (error) {
    console.error("[Volume] Error fetching today's live volume:", error)
    return null
  }
}

// ============================================
// MAIN VOLUME HISTORY LOGIC
// ============================================

/**
 * Main function to fetch accurate volume history
 * Strategy:
 * 1. Try Vercel KV first (fast, persistent historical data)
 * 2. Add today's live volume from Raydium
 * 3. Fallback to Dune Analytics if KV is empty
 * 4. Final fallback to Raydium + synthetic distribution
 */
async function fetchBonkFunVolumeHistory(period: string): Promise<{
  data: VolumeDataPoint[]
  synthetic: boolean
  totalVolume24h: number
  poolCount: number
  ohlcvCoverage: number
  source: "kv" | "dune" | "raydium" | "synthetic"
}> {
  console.log(`[Volume] Fetching BONK.fun/USD1 volume data for period: ${period}`)

  // ========================================
  // STEP 1: Try Vercel KV (primary source - instant)
  // ========================================
  const kvData = await fetchKVVolumeHistory(period)

  // For 24h period, we need hourly data - KV only has daily, so skip to OHLCV fallback
  const minDataPointsFor24h = 6 // Need at least 6 hourly points for a decent 24h chart

  if (kvData && kvData.data.length > 0 && (period !== "24h" || kvData.data.length >= minDataPointsFor24h)) {
    // Get today's live volume from Raydium
    const todayLive = await fetchTodayLiveVolume()

    let finalData = [...kvData.data]
    let totalVolume24h = todayLive?.volume24h || kvData.data[kvData.data.length - 1]?.volume || 0

    // If we have today's live data and it's for a different day, add it
    if (todayLive) {
      const todayStart = new Date().setUTCHours(0, 0, 0, 0)
      const lastDataTimestamp = kvData.data[kvData.data.length - 1]?.timestamp || 0

      // Only add today's data if it's newer than what we have in KV
      if (todayStart > lastDataTimestamp) {
        finalData.push({
          timestamp: todayStart,
          volume: todayLive.volume24h,
          trades: 0,
          poolCount: todayLive.uniqueTokens,
          isOhlcv: true,
        })
      }
    }

    console.log(`[Volume] Using KV data: ${finalData.length} data points, $${totalVolume24h.toLocaleString()} 24h volume`)

    return {
      data: finalData,
      synthetic: false,
      totalVolume24h: Math.round(totalVolume24h),
      poolCount: todayLive?.poolCount || kvData.uniqueTokens,
      ohlcvCoverage: 100,
      source: "kv",
    }
  }

  // ========================================
  // STEP 2: Fallback to Dune Analytics (if KV is empty)
  // Skip for 24h since Dune only has daily data too
  // ========================================
  if (period === "24h") {
    console.log("[Volume] Skipping Dune for 24h (need hourly data), going to Raydium OHLCV...")
  }

  const duneData = period !== "24h" ? await fetchDuneVolumeHistory() : null

  if (duneData && duneData.length > 0) {
    const { data, totalVolume, uniqueTokens } = convertDuneToVolumeData(duneData, period)

    if (data.length > 0) {
      // Get the most recent day's volume as "24h volume"
      const sortedByDate = [...duneData].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      )
      const latestDayVolume = sortedByDate[0]?.total_volume_usd || totalVolume

      console.log(`[Volume] Using Dune data: ${data.length} data points, $${latestDayVolume.toLocaleString()} latest day volume`)
      console.log("[Volume] Consider seeding KV with: POST /api/volume/seed")

      return {
        data,
        synthetic: false,
        totalVolume24h: Math.round(latestDayVolume),
        poolCount: uniqueTokens,
        ohlcvCoverage: 100,
        source: "dune",
      }
    }
  }

  // ========================================
  // STEP 3: Fallback to Raydium + OHLCV
  // ========================================
  console.log("[Volume] Dune unavailable, falling back to Raydium...")

  // Step 1: Get ALL pools from Raydium
  const { pools, totalVolume24h, totalLiquidity } = await fetchAllRaydiumUSD1Pools()

  if (pools.length === 0 || totalVolume24h === 0) {
    console.log("[Volume] No BONK.fun/USD1 pools found")
    return { data: [], synthetic: true, totalVolume24h: 0, poolCount: 0, ohlcvCoverage: 0, source: "synthetic" }
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
      source: "raydium",
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
    source: "synthetic",
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

  // Check cache
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
      source: cached.source,
    })
  }

  // Fetch fresh data
  const {
    data: volumeData,
    synthetic,
    totalVolume24h,
    poolCount,
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
    ohlcvCoverage,
    source,
  })
}

// Enable edge runtime for better performance
export const runtime = "edge"
