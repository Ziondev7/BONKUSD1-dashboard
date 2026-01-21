import { NextResponse } from "next/server"

// ============================================
// CONFIGURATION - Dune Launchpad Volume Queries
// ============================================
const DUNE_API = "https://api.dune.com/api/v1"
const DUNE_DAILY_QUERY_ID = "5440992"  // Daily Launchpad volume
const DUNE_WEEKLY_QUERY_ID = "5468582" // Weekly Launchpad volume

// Cache configuration
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes cache
const DUNE_CACHE_TTL = 60 * 60 * 1000 // 1 hour cache for Dune data

// ============================================
// TYPES
// ============================================
interface VolumeDataPoint {
  timestamp: number
  volume: number
  trades?: number
  tokenCount?: number
  isWeekly?: boolean
}

interface DuneDailyRow {
  date: string
  num_trades: number
  unique_tokens: number
  total_volume_usd: number
}

interface DuneWeeklyRow {
  week_start: string
  num_trades: number
  unique_tokens: number
  total_volume_usd: number
}

interface DuneApiResponse<T> {
  execution_id: string
  query_id: number
  state: string
  result?: {
    rows: T[]
    metadata: {
      column_names: string[]
      result_set_bytes: number
      total_row_count: number
    }
  }
}

interface CacheEntry {
  data: VolumeDataPoint[]
  timestamp: number
  period: string
  totalVolume: number
  tokenCount: number
  source: "dune-daily" | "dune-weekly" | "combined"
}

// ============================================
// IN-MEMORY CACHE
// ============================================
const volumeCache: Map<string, CacheEntry> = new Map()

// Separate caches for daily and weekly Dune data
let duneDailyCache: {
  data: DuneDailyRow[]
  timestamp: number
} | null = null

let duneWeeklyCache: {
  data: DuneWeeklyRow[]
  timestamp: number
} | null = null

// ============================================
// DUNE API FETCHERS
// ============================================

/**
 * Fetch daily volume data from Dune Analytics (query 5440992)
 */
async function fetchDuneDailyVolume(): Promise<DuneDailyRow[] | null> {
  // Check cache first
  if (duneDailyCache && Date.now() - duneDailyCache.timestamp < DUNE_CACHE_TTL) {
    console.log("[LaunchpadVolume] Using cached daily Dune data")
    return duneDailyCache.data
  }

  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    console.log("[LaunchpadVolume] No DUNE_API_KEY configured")
    return null
  }

  try {
    console.log("[LaunchpadVolume] Fetching daily data from Dune...")

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(
      `${DUNE_API}/query/${DUNE_DAILY_QUERY_ID}/results?limit=1000`,
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
      console.error("[LaunchpadVolume] Dune daily API error:", response.status)
      return null
    }

    const data: DuneApiResponse<DuneDailyRow> = await response.json()

    if (data.state !== "QUERY_STATE_COMPLETED" || !data.result?.rows) {
      console.error("[LaunchpadVolume] Dune daily query not ready or no results")
      return null
    }

    const rows = data.result.rows
    console.log(`[LaunchpadVolume] Fetched ${rows.length} days of daily data from Dune`)

    // Cache the data
    duneDailyCache = {
      data: rows,
      timestamp: Date.now(),
    }

    return rows
  } catch (error) {
    console.error("[LaunchpadVolume] Error fetching daily from Dune:", error)
    return null
  }
}

/**
 * Fetch weekly volume data from Dune Analytics (query 5468582)
 */
async function fetchDuneWeeklyVolume(): Promise<DuneWeeklyRow[] | null> {
  // Check cache first
  if (duneWeeklyCache && Date.now() - duneWeeklyCache.timestamp < DUNE_CACHE_TTL) {
    console.log("[LaunchpadVolume] Using cached weekly Dune data")
    return duneWeeklyCache.data
  }

  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    console.log("[LaunchpadVolume] No DUNE_API_KEY configured")
    return null
  }

  try {
    console.log("[LaunchpadVolume] Fetching weekly data from Dune...")

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(
      `${DUNE_API}/query/${DUNE_WEEKLY_QUERY_ID}/results?limit=500`,
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
      console.error("[LaunchpadVolume] Dune weekly API error:", response.status)
      return null
    }

    const data: DuneApiResponse<DuneWeeklyRow> = await response.json()

    if (data.state !== "QUERY_STATE_COMPLETED" || !data.result?.rows) {
      console.error("[LaunchpadVolume] Dune weekly query not ready or no results")
      return null
    }

    const rows = data.result.rows
    console.log(`[LaunchpadVolume] Fetched ${rows.length} weeks of weekly data from Dune`)

    // Cache the data
    duneWeeklyCache = {
      data: rows,
      timestamp: Date.now(),
    }

    return rows
  } catch (error) {
    console.error("[LaunchpadVolume] Error fetching weekly from Dune:", error)
    return null
  }
}

// ============================================
// DATA PROCESSING
// ============================================

/**
 * Convert and filter daily data by period
 */
function processDailyData(
  rows: DuneDailyRow[],
  period: string
): { data: VolumeDataPoint[]; totalVolume: number; tokenCount: number } {
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
  const filteredRows = rows
    .map(row => ({
      timestamp: new Date(row.date).getTime(),
      volume: row.total_volume_usd,
      trades: row.num_trades,
      tokenCount: row.unique_tokens,
    }))
    .filter(row => row.timestamp >= cutoffTime && row.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp)

  const data: VolumeDataPoint[] = filteredRows.map(row => ({
    timestamp: row.timestamp,
    volume: Math.round(row.volume),
    trades: row.trades,
    tokenCount: row.tokenCount,
    isWeekly: false,
  }))

  const totalVolume = data.reduce((sum, d) => sum + d.volume, 0)
  const tokenCount = Math.max(...filteredRows.map(r => r.tokenCount), 0)

  return { data, totalVolume, tokenCount }
}

/**
 * Process weekly data for ALL period
 */
function processWeeklyData(
  rows: DuneWeeklyRow[]
): { data: VolumeDataPoint[]; totalVolume: number; tokenCount: number } {
  const now = Date.now()

  // Filter and convert rows
  const filteredRows = rows
    .map(row => ({
      timestamp: new Date(row.week_start).getTime(),
      volume: row.total_volume_usd,
      trades: row.num_trades,
      tokenCount: row.unique_tokens,
    }))
    .filter(row => row.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp)

  const data: VolumeDataPoint[] = filteredRows.map(row => ({
    timestamp: row.timestamp,
    volume: Math.round(row.volume),
    trades: row.trades,
    tokenCount: row.tokenCount,
    isWeekly: true,
  }))

  const totalVolume = data.reduce((sum, d) => sum + d.volume, 0)
  const tokenCount = Math.max(...filteredRows.map(r => r.tokenCount), 0)

  return { data, totalVolume, tokenCount }
}

/**
 * Main function to fetch Launchpad volume data
 * Uses daily data for 24h, 7d, 1m periods
 * Uses weekly data for ALL period
 */
async function fetchLaunchpadVolume(period: string): Promise<{
  data: VolumeDataPoint[]
  totalVolume: number
  tokenCount: number
  source: "dune-daily" | "dune-weekly" | "combined"
}> {
  console.log(`[LaunchpadVolume] Fetching Launchpad volume for period: ${period}`)

  // For ALL period, use weekly data
  if (period === "all") {
    const weeklyData = await fetchDuneWeeklyVolume()
    if (weeklyData && weeklyData.length > 0) {
      const processed = processWeeklyData(weeklyData)
      console.log(`[LaunchpadVolume] Returning ${processed.data.length} weekly data points`)
      return { ...processed, source: "dune-weekly" }
    }
  }

  // For other periods, use daily data
  const dailyData = await fetchDuneDailyVolume()
  if (dailyData && dailyData.length > 0) {
    const processed = processDailyData(dailyData, period)
    console.log(`[LaunchpadVolume] Returning ${processed.data.length} daily data points`)
    return { ...processed, source: "dune-daily" }
  }

  // No data available
  console.log("[LaunchpadVolume] No data available from Dune")
  return { data: [], totalVolume: 0, tokenCount: 0, source: "dune-daily" }
}

/**
 * Calculate statistics from volume data
 */
function calculateStats(
  data: VolumeDataPoint[],
  totalVolume: number,
  tokenCount: number
): {
  current: number
  previous: number
  change: number
  peak: number
  low: number
  average: number
  totalVolume: number
  tokenCount: number
} {
  if (data.length === 0) {
    return {
      current: 0,
      previous: 0,
      change: 0,
      peak: 0,
      low: 0,
      average: 0,
      totalVolume,
      tokenCount,
    }
  }

  const volumes = data.map(d => d.volume)
  const current = volumes[volumes.length - 1] || 0
  const previous = volumes[0] || current
  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0
  const sumVolume = volumes.reduce((sum, v) => sum + v, 0)

  return {
    current,
    previous,
    change,
    peak: Math.max(...volumes),
    low: Math.min(...volumes.filter(v => v > 0)),
    average: sumVolume / volumes.length,
    totalVolume: Math.max(totalVolume, sumVolume),
    tokenCount,
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
      stats: calculateStats(cached.data, cached.totalVolume, cached.tokenCount),
      period,
      dataPoints: cached.data.length,
      cached: true,
      tokenCount: cached.tokenCount,
      source: cached.source,
    })
  }

  // Fetch fresh data
  const { data, totalVolume, tokenCount, source } = await fetchLaunchpadVolume(period)

  // Update cache
  volumeCache.set(period, {
    data,
    timestamp: Date.now(),
    period,
    totalVolume,
    tokenCount,
    source,
  })

  return NextResponse.json({
    history: data,
    stats: calculateStats(data, totalVolume, tokenCount),
    period,
    dataPoints: data.length,
    cached: false,
    tokenCount,
    source,
  })
}

// Enable edge runtime for better performance
export const runtime = "edge"
