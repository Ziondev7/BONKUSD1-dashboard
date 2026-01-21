import { NextResponse } from "next/server"
import {
  bulkSaveDailyVolume,
  getDailyVolumeStats,
  DailyVolumeData,
} from "@/lib/volume-store"

// Dune Analytics API configuration
const DUNE_API = "https://api.dune.com/api/v1"
const DUNE_QUERY_ID = "6572422" // BonkFun USD1 Daily Volume query

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

/**
 * Fetch all historical data from Dune Analytics
 */
async function fetchDuneHistory(): Promise<DuneVolumeRow[]> {
  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    throw new Error("DUNE_API_KEY not configured")
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
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
      throw new Error(`Dune API error: ${response.status}`)
    }

    const data: DuneApiResponse = await response.json()

    if (data.state !== "QUERY_STATE_COMPLETED" || !data.result?.rows) {
      throw new Error("Dune query not completed or no results")
    }

    return data.result.rows
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

/**
 * Convert Dune rows to DailyVolumeData format
 */
function convertToDailyVolumeData(rows: DuneVolumeRow[]): DailyVolumeData[] {
  return rows.map((row) => ({
    date: row.date.split("T")[0], // Ensure YYYY-MM-DD format
    timestamp: new Date(row.date + "T00:00:00Z").getTime(),
    volume: Math.round(row.total_volume_usd),
    trades: row.num_trades,
    uniqueTokens: row.unique_tokens,
    source: "dune" as const,
  }))
}

/**
 * POST /api/volume/seed
 *
 * Seed the KV store with historical volume data from Dune Analytics.
 * This is a one-time operation to import historical data.
 *
 * Query params:
 * - force=true: Re-seed even if data already exists
 */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url)
    const force = url.searchParams.get("force") === "true"

    // Check current stats
    const currentStats = await getDailyVolumeStats()
    console.log("[Seed] Current KV stats:", currentStats)

    // Skip if we already have data (unless forced)
    if (currentStats.count > 0 && !force) {
      return NextResponse.json({
        success: false,
        message: "Data already exists. Use ?force=true to re-seed.",
        stats: currentStats,
      })
    }

    // Fetch from Dune
    console.log("[Seed] Fetching historical data from Dune...")
    const duneRows = await fetchDuneHistory()
    console.log(`[Seed] Fetched ${duneRows.length} rows from Dune`)

    // Convert to our format
    const dailyData = convertToDailyVolumeData(duneRows)

    // Sort by date ascending
    dailyData.sort((a, b) => a.timestamp - b.timestamp)

    console.log(`[Seed] Saving ${dailyData.length} days of volume data to KV...`)

    // Bulk save to KV
    const result = await bulkSaveDailyVolume(dailyData)

    // Get updated stats
    const newStats = await getDailyVolumeStats()

    console.log("[Seed] Complete:", result)

    return NextResponse.json({
      success: result.success,
      message: `Seeded ${result.saved} days of historical volume data`,
      imported: {
        total: dailyData.length,
        saved: result.saved,
        errors: result.errors,
        dateRange: {
          from: dailyData[0]?.date,
          to: dailyData[dailyData.length - 1]?.date,
        },
      },
      stats: newStats,
    })
  } catch (error) {
    console.error("[Seed] Error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/volume/seed
 *
 * Get current seeding status and KV stats
 */
export async function GET() {
  try {
    const stats = await getDailyVolumeStats()

    return NextResponse.json({
      status: stats.count > 0 ? "seeded" : "empty",
      stats,
      duneQueryId: DUNE_QUERY_ID,
      hasApiKey: !!process.env.DUNE_API_KEY,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
