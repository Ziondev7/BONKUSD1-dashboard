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

// Category colors for stacked chart
const CATEGORIES = ["pumpdotfun", "bonk", "moonshot", "bags", "believe"] as const
type Category = typeof CATEGORIES[number]

// ============================================
// TYPES
// ============================================
interface StackedVolumeDataPoint {
  timestamp: number
  volumes: Record<Category, number>
  total: number
  isWeekly?: boolean
}

interface DuneRow {
  dt: string           // datetime like "2026-01-20 00:00:00.000 UTC"
  category: string     // "bonk", "pumpdotfun", "moonshot", "bags", "believe"
  volume_usd: number   // volume in USD
}

interface DuneApiResponse {
  execution_id: string
  query_id: number
  state: string
  result?: {
    rows: DuneRow[]
    metadata: {
      column_names: string[]
      result_set_bytes: number
      total_row_count: number
    }
  }
}

interface CacheEntry {
  data: StackedVolumeDataPoint[]
  timestamp: number
  period: string
  totalVolume: number
  categoryTotals: Record<Category, number>
  source: "dune-daily" | "dune-weekly"
}

// ============================================
// IN-MEMORY CACHE
// ============================================
const volumeCache: Map<string, CacheEntry> = new Map()

// Separate caches for daily and weekly Dune data (raw data)
let duneDailyCache: {
  data: DuneRow[]
  timestamp: number
} | null = null

let duneWeeklyCache: {
  data: DuneRow[]
  timestamp: number
} | null = null

// ============================================
// DUNE API FETCHERS
// ============================================

/**
 * Execute a Dune query to refresh its results
 */
async function executeDuneQuery(queryId: string, duneApiKey: string): Promise<string | null> {
  try {
    console.log(`[LaunchpadVolume] Executing Dune query ${queryId}...`)

    const response = await fetch(
      `${DUNE_API}/query/${queryId}/execute`,
      {
        method: "POST",
        headers: {
          "x-dune-api-key": duneApiKey,
          "Content-Type": "application/json",
        },
      }
    )

    if (!response.ok) {
      console.error(`[LaunchpadVolume] Failed to execute query ${queryId}:`, response.status)
      return null
    }

    const data = await response.json()
    console.log(`[LaunchpadVolume] Query ${queryId} execution started:`, data.execution_id)
    return data.execution_id
  } catch (error) {
    console.error(`[LaunchpadVolume] Error executing query ${queryId}:`, error)
    return null
  }
}

/**
 * Fetch daily volume data from Dune Analytics (query 5440992)
 * Returns ALL categories for stacked chart
 */
async function fetchDuneDailyVolume(): Promise<DuneRow[] | null> {
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
      `${DUNE_API}/query/${DUNE_DAILY_QUERY_ID}/results?limit=2000`,
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
      // Try to execute the query to refresh it
      await executeDuneQuery(DUNE_DAILY_QUERY_ID, duneApiKey)
      return null
    }

    const data: DuneApiResponse = await response.json()

    if (data.state !== "QUERY_STATE_COMPLETED" || !data.result?.rows) {
      console.error("[LaunchpadVolume] Dune daily query state:", data.state, "rows:", data.result?.rows?.length || 0)
      // Try to execute the query to refresh it
      if (data.state === "QUERY_STATE_EXPIRED" || !data.result?.rows) {
        await executeDuneQuery(DUNE_DAILY_QUERY_ID, duneApiKey)
      }
      return null
    }

    const rows = data.result.rows
    console.log(`[LaunchpadVolume] Fetched ${rows.length} daily rows from Dune`)

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
 * Returns ALL categories for stacked chart
 */
async function fetchDuneWeeklyVolume(): Promise<DuneRow[] | null> {
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
      `${DUNE_API}/query/${DUNE_WEEKLY_QUERY_ID}/results?limit=1000`,
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

    const data: DuneApiResponse = await response.json()

    if (data.state !== "QUERY_STATE_COMPLETED" || !data.result?.rows) {
      console.error("[LaunchpadVolume] Dune weekly query not ready or no results")
      return null
    }

    const rows = data.result.rows
    console.log(`[LaunchpadVolume] Fetched ${rows.length} weekly rows from Dune`)

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
 * Process raw Dune data into stacked volume data points
 * Groups data by timestamp and includes volume for each category
 */
function processStackedData(
  rows: DuneRow[],
  isWeekly: boolean
): {
  data: StackedVolumeDataPoint[]
  totalVolume: number
  categoryTotals: Record<Category, number>
} {
  const now = Date.now()

  // Group by timestamp
  const groupedByTime = new Map<number, Record<Category, number>>()

  for (const row of rows) {
    const timestamp = new Date(row.dt).getTime()
    if (timestamp > now) continue // Skip future dates

    const category = row.category as Category
    if (!CATEGORIES.includes(category)) continue // Skip unknown categories

    if (!groupedByTime.has(timestamp)) {
      groupedByTime.set(timestamp, {
        pumpdotfun: 0,
        bonk: 0,
        moonshot: 0,
        bags: 0,
        believe: 0,
      })
    }

    const volumes = groupedByTime.get(timestamp)!
    volumes[category] = Math.round(row.volume_usd)
  }

  // Convert to array and sort by timestamp
  const data: StackedVolumeDataPoint[] = Array.from(groupedByTime.entries())
    .map(([timestamp, volumes]) => ({
      timestamp,
      volumes,
      total: Object.values(volumes).reduce((sum, v) => sum + v, 0),
      isWeekly,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)

  // Calculate totals
  const categoryTotals: Record<Category, number> = {
    pumpdotfun: 0,
    bonk: 0,
    moonshot: 0,
    bags: 0,
    believe: 0,
  }

  let totalVolume = 0
  for (const point of data) {
    for (const cat of CATEGORIES) {
      categoryTotals[cat] += point.volumes[cat]
    }
    totalVolume += point.total
  }

  console.log(`[LaunchpadVolume] Processed ${data.length} stacked data points`)

  return { data, totalVolume, categoryTotals }
}

/**
 * Main function to fetch Launchpad volume data
 */
async function fetchLaunchpadVolume(period: string): Promise<{
  data: StackedVolumeDataPoint[]
  totalVolume: number
  categoryTotals: Record<Category, number>
  source: "dune-daily" | "dune-weekly"
}> {
  console.log(`[LaunchpadVolume] Fetching Launchpad volume for period: ${period}`)

  // For weekly period, use weekly data only
  if (period === "weekly") {
    const weeklyData = await fetchDuneWeeklyVolume()
    if (weeklyData && weeklyData.length > 0) {
      const processed = processStackedData(weeklyData, true)
      return { ...processed, source: "dune-weekly" }
    }
    // Weekly not available
    console.log("[LaunchpadVolume] Weekly data not available")
    return {
      data: [],
      totalVolume: 0,
      categoryTotals: { pumpdotfun: 0, bonk: 0, moonshot: 0, bags: 0, believe: 0 },
      source: "dune-weekly"
    }
  }

  // For daily period, use daily data only - NO FALLBACK to weekly
  const dailyData = await fetchDuneDailyVolume()
  if (dailyData && dailyData.length > 0) {
    const processed = processStackedData(dailyData, false)
    return { ...processed, source: "dune-daily" }
  }

  // Daily not available - don't fall back to weekly (they show different granularity)
  console.log("[LaunchpadVolume] Daily data not available from Dune")
  return {
    data: [],
    totalVolume: 0,
    categoryTotals: { pumpdotfun: 0, bonk: 0, moonshot: 0, bags: 0, believe: 0 },
    source: "dune-daily"
  }
}

/**
 * Calculate statistics from stacked volume data
 */
function calculateStats(
  data: StackedVolumeDataPoint[],
  totalVolume: number,
  categoryTotals: Record<Category, number>
) {
  if (data.length === 0) {
    return {
      current: 0,
      previous: 0,
      change: 0,
      peak: 0,
      low: 0,
      average: 0,
      totalVolume,
      categoryTotals,
    }
  }

  const totals = data.map(d => d.total)
  const current = totals[totals.length - 1] || 0
  const previous = totals[0] || current
  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0
  const sumVolume = totals.reduce((sum, v) => sum + v, 0)

  return {
    current,
    previous,
    change,
    peak: Math.max(...totals),
    low: Math.min(...totals.filter(v => v > 0)),
    average: sumVolume / totals.length,
    totalVolume: Math.max(totalVolume, sumVolume),
    categoryTotals,
  }
}

// ============================================
// API HANDLER
// ============================================

export async function GET(request: Request) {
  const url = new URL(request.url)
  const period = url.searchParams.get("period") || "daily"

  // Check cache
  const cached = volumeCache.get(period)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({
      history: cached.data,
      stats: calculateStats(cached.data, cached.totalVolume, cached.categoryTotals),
      period,
      dataPoints: cached.data.length,
      cached: true,
      categories: CATEGORIES,
      source: cached.source,
    })
  }

  // Fetch fresh data
  const { data, totalVolume, categoryTotals, source } = await fetchLaunchpadVolume(period)

  // Update cache
  volumeCache.set(period, {
    data,
    timestamp: Date.now(),
    period,
    totalVolume,
    categoryTotals,
    source,
  })

  return NextResponse.json({
    history: data,
    stats: calculateStats(data, totalVolume, categoryTotals),
    period,
    dataPoints: data.length,
    cached: false,
    categories: CATEGORIES,
    source,
  })
}

// Enable edge runtime for better performance
export const runtime = "edge"
