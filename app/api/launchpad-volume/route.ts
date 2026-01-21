import { NextResponse } from "next/server"

// ============================================
// CONFIGURATION - Dune Launchpad Volume Queries
// ============================================
const DUNE_API = "https://api.dune.com/api/v1"
const DUNE_DAILY_QUERY_ID = "5440992"  // Daily Launchpad volume
const DUNE_WEEKLY_QUERY_ID = "5468582" // Weekly Launchpad volume

// Cache configuration
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes for in-memory response cache
const KV_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours for KV cache (data is historical)
const STALE_DATA_TTL = 24 * 60 * 60 * 1000 // 24 hours - return stale data if nothing else works
const POLL_INTERVAL = 2000 // 2 seconds between poll attempts
const MAX_POLL_ATTEMPTS = 15 // 30 seconds max polling

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

// KV client interface
interface KVClient {
  set: (key: string, value: unknown) => Promise<string | null>
  get: (key: string) => Promise<unknown | null>
}

// ============================================
// IN-MEMORY CACHE (short-term, per-instance)
// ============================================
const volumeCache: Map<string, CacheEntry> = new Map()

// ============================================
// VERCEL KV STORAGE (long-term, persistent)
// ============================================
async function getKV(): Promise<KVClient | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null
  }

  try {
    const module = await import("@vercel/kv")
    return module.kv as KVClient
  } catch (e) {
    console.error("[LaunchpadVolume] Failed to load @vercel/kv:", e)
    return null
  }
}

const KV_LAUNCHPAD_KEY = "launchpad:volume"

/**
 * Save launchpad data to KV storage
 */
async function saveToKV(period: string, entry: CacheEntry): Promise<void> {
  const kv = await getKV()
  if (!kv) return

  try {
    const key = `${KV_LAUNCHPAD_KEY}:${period}`
    await kv.set(key, JSON.stringify(entry))
    console.log(`[LaunchpadVolume] Saved ${period} data to KV (${entry.data.length} points)`)
  } catch (error) {
    console.error("[LaunchpadVolume] KV save error:", error)
  }
}

/**
 * Load launchpad data from KV storage
 */
async function loadFromKV(period: string): Promise<CacheEntry | null> {
  const kv = await getKV()
  if (!kv) return null

  try {
    const key = `${KV_LAUNCHPAD_KEY}:${period}`
    const data = await kv.get(key)
    if (data) {
      const entry = typeof data === "string" ? JSON.parse(data) : data as CacheEntry
      console.log(`[LaunchpadVolume] Loaded ${period} data from KV (${entry.data.length} points, age: ${Math.round((Date.now() - entry.timestamp) / 60000)}min)`)
      return entry
    }
  } catch (error) {
    console.error("[LaunchpadVolume] KV load error:", error)
  }
  return null
}

// ============================================
// DUNE API FETCHERS (with polling)
// ============================================

/**
 * Execute a Dune query and return execution ID
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
      const errorText = await response.text()
      console.error(`[LaunchpadVolume] Failed to execute query ${queryId}:`, response.status, errorText)
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
 * Poll for execution results
 */
async function pollExecutionResults(executionId: string, duneApiKey: string): Promise<DuneRow[] | null> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    try {
      console.log(`[LaunchpadVolume] Polling execution ${executionId} (attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS})...`)

      const response = await fetch(
        `${DUNE_API}/execution/${executionId}/results`,
        {
          headers: {
            "x-dune-api-key": duneApiKey,
            Accept: "application/json",
          },
        }
      )

      if (!response.ok) {
        console.error(`[LaunchpadVolume] Poll error:`, response.status)
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
        continue
      }

      const data: DuneApiResponse = await response.json()

      if (data.state === "QUERY_STATE_COMPLETED" && data.result?.rows) {
        console.log(`[LaunchpadVolume] Execution complete! Got ${data.result.rows.length} rows`)
        return data.result.rows
      }

      if (data.state === "QUERY_STATE_FAILED") {
        console.error(`[LaunchpadVolume] Query execution failed`)
        return null
      }

      // Still pending, wait and retry
      console.log(`[LaunchpadVolume] Query state: ${data.state}, waiting...`)
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
    } catch (error) {
      console.error(`[LaunchpadVolume] Poll error:`, error)
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
    }
  }

  console.error(`[LaunchpadVolume] Polling timed out after ${MAX_POLL_ATTEMPTS} attempts`)
  return null
}

/**
 * Fetch data from Dune with full retry logic:
 * 1. Try to get cached results
 * 2. If expired/failed, execute query and poll for results
 */
async function fetchDuneData(queryId: string, queryName: string): Promise<DuneRow[] | null> {
  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    console.log("[LaunchpadVolume] No DUNE_API_KEY configured")
    return null
  }

  try {
    // First, try to get existing results
    console.log(`[LaunchpadVolume] Fetching ${queryName} data from Dune...`)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(
      `${DUNE_API}/query/${queryId}/results?limit=2000`,
      {
        signal: controller.signal,
        headers: {
          "x-dune-api-key": duneApiKey,
          Accept: "application/json",
        },
      }
    )

    clearTimeout(timeoutId)

    if (response.ok) {
      const data: DuneApiResponse = await response.json()

      if (data.state === "QUERY_STATE_COMPLETED" && data.result?.rows?.length > 0) {
        console.log(`[LaunchpadVolume] Got ${data.result.rows.length} ${queryName} rows from cached results`)
        return data.result.rows
      }

      // Results expired or empty - need to execute
      console.log(`[LaunchpadVolume] ${queryName} query state: ${data.state}, rows: ${data.result?.rows?.length || 0}`)
    } else {
      console.error(`[LaunchpadVolume] ${queryName} API error:`, response.status)
    }

    // Execute query and poll for results
    const executionId = await executeDuneQuery(queryId, duneApiKey)
    if (executionId) {
      const rows = await pollExecutionResults(executionId, duneApiKey)
      if (rows && rows.length > 0) {
        return rows
      }
    }

    return null
  } catch (error) {
    console.error(`[LaunchpadVolume] Error fetching ${queryName} from Dune:`, error)
    return null
  }
}

// ============================================
// DATA PROCESSING
// ============================================

/**
 * Process raw Dune data into stacked volume data points
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
 * Implements stale-while-revalidate pattern
 */
async function fetchLaunchpadVolume(period: string): Promise<{
  data: StackedVolumeDataPoint[]
  totalVolume: number
  categoryTotals: Record<Category, number>
  source: "dune-daily" | "dune-weekly"
  fromCache: boolean
  cacheAge?: number
}> {
  console.log(`[LaunchpadVolume] Fetching Launchpad volume for period: ${period}`)

  const isWeekly = period === "weekly"
  const queryId = isWeekly ? DUNE_WEEKLY_QUERY_ID : DUNE_DAILY_QUERY_ID
  const source = isWeekly ? "dune-weekly" : "dune-daily"
  const queryName = isWeekly ? "weekly" : "daily"

  // Check KV cache first
  const kvCached = await loadFromKV(period)
  const kvAge = kvCached ? Date.now() - kvCached.timestamp : Infinity

  // If KV cache is fresh (< 6 hours), use it
  if (kvCached && kvAge < KV_CACHE_TTL) {
    console.log(`[LaunchpadVolume] Using fresh KV cache for ${period} (age: ${Math.round(kvAge / 60000)}min)`)
    return {
      data: kvCached.data,
      totalVolume: kvCached.totalVolume,
      categoryTotals: kvCached.categoryTotals,
      source: kvCached.source,
      fromCache: true,
      cacheAge: kvAge,
    }
  }

  // Try to fetch fresh data from Dune
  const duneRows = await fetchDuneData(queryId, queryName)

  if (duneRows && duneRows.length > 0) {
    const processed = processStackedData(duneRows, isWeekly)

    // Save to KV for persistence
    const entry: CacheEntry = {
      ...processed,
      timestamp: Date.now(),
      period,
      source,
    }
    await saveToKV(period, entry)

    return {
      ...processed,
      source,
      fromCache: false,
    }
  }

  // Dune failed - use stale KV cache if available (up to 24 hours old)
  if (kvCached && kvAge < STALE_DATA_TTL) {
    console.log(`[LaunchpadVolume] Using stale KV cache for ${period} (age: ${Math.round(kvAge / 60000)}min)`)
    return {
      data: kvCached.data,
      totalVolume: kvCached.totalVolume,
      categoryTotals: kvCached.categoryTotals,
      source: kvCached.source,
      fromCache: true,
      cacheAge: kvAge,
    }
  }

  // Nothing available
  console.log(`[LaunchpadVolume] No data available for ${period}`)
  return {
    data: [],
    totalVolume: 0,
    categoryTotals: { pumpdotfun: 0, bonk: 0, moonshot: 0, bags: 0, believe: 0 },
    source,
    fromCache: false,
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
  const forceRefresh = url.searchParams.get("refresh") === "true"

  // Check in-memory cache (short TTL for same-instance requests)
  const cached = volumeCache.get(period)
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
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

  // Fetch data (will use KV cache or Dune with stale-while-revalidate)
  const { data, totalVolume, categoryTotals, source, fromCache, cacheAge } = await fetchLaunchpadVolume(period)

  // Update in-memory cache
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
    cached: fromCache,
    cacheAge: cacheAge ? Math.round(cacheAge / 60000) : undefined, // in minutes
    categories: CATEGORIES,
    source,
  })
}

// Enable edge runtime for better performance
export const runtime = "edge"
