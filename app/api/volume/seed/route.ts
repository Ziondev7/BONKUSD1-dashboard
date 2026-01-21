import { NextResponse } from "next/server"
import {
  bulkSaveDailyVolume,
  getDailyVolumeStats,
  clearAllDailyVolume,
  DailyVolumeData,
} from "@/lib/volume-store"

// Dune Analytics API configuration
const DUNE_API = "https://api.dune.com/api/v1"

// Saved Dune query ID for BonkFun/USD1 volume
// Query URL: https://dune.com/queries/6572422
const DUNE_QUERY_ID = 6572422

// Key addresses for BonkFun token identification (for reference)
const LAUNCHLAB_PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
const LETSBONK_PLATFORM = "FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1"
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"

interface DuneVolumeRow {
  date: string
  num_trades: number
  unique_tokens: number
  total_volume_usd: number
}

interface DuneExecuteResponse {
  execution_id: string
  state: string
}

interface DuneStatusResponse {
  execution_id: string
  query_id: number
  state: string
  result_metadata?: {
    column_names: string[]
    result_set_bytes: number
    total_row_count: number
  }
}

interface DuneResultsResponse {
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
 * Execute the saved Dune query by ID
 */
async function executeQuery(queryId: number): Promise<string> {
  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    throw new Error("DUNE_API_KEY not configured")
  }

  console.log(`[Seed] Executing saved query ${queryId}...`)
  const executeResponse = await fetch(`${DUNE_API}/query/${queryId}/execute`, {
    method: "POST",
    headers: {
      "x-dune-api-key": duneApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      performance: "large",
    }),
  })

  if (!executeResponse.ok) {
    const errorText = await executeResponse.text()
    throw new Error(`Dune execute error: ${executeResponse.status} - ${errorText}`)
  }

  const executeData: DuneExecuteResponse = await executeResponse.json()
  console.log(`[Seed] Execution ID: ${executeData.execution_id}`)
  return executeData.execution_id
}

/**
 * Check execution status
 */
async function getExecutionStatus(executionId: string): Promise<string> {
  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    throw new Error("DUNE_API_KEY not configured")
  }

  const response = await fetch(`${DUNE_API}/execution/${executionId}/status`, {
    headers: {
      "x-dune-api-key": duneApiKey,
    },
  })

  if (!response.ok) {
    throw new Error(`Dune status error: ${response.status}`)
  }

  const data: DuneStatusResponse = await response.json()
  return data.state
}

/**
 * Get execution results
 */
async function getExecutionResults(executionId: string): Promise<DuneVolumeRow[]> {
  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    throw new Error("DUNE_API_KEY not configured")
  }

  const response = await fetch(
    `${DUNE_API}/execution/${executionId}/results?limit=1000`,
    {
      headers: {
        "x-dune-api-key": duneApiKey,
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Dune results error: ${response.status}`)
  }

  const data: DuneResultsResponse = await response.json()

  if (!data.result?.rows) {
    throw new Error("No results returned from Dune")
  }

  return data.result.rows
}

/**
 * Poll for query completion with exponential backoff
 */
async function waitForCompletion(executionId: string, maxWaitMs: number = 600000): Promise<void> {
  const startTime = Date.now()
  let delay = 2000 // Start with 2 second delay

  while (Date.now() - startTime < maxWaitMs) {
    const status = await getExecutionStatus(executionId)

    if (status === "QUERY_STATE_COMPLETED") {
      return
    }

    if (status === "QUERY_STATE_FAILED" || status === "QUERY_STATE_CANCELLED") {
      throw new Error(`Query ${status}`)
    }

    // Wait with exponential backoff (max 30 seconds)
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 1.5, 30000)
  }

  throw new Error("Query timed out")
}

/**
 * Fetch BonkFun/USD1 volume data from Dune Analytics using saved query
 */
async function fetchDuneHistory(): Promise<DuneVolumeRow[]> {
  console.log(`[Seed] Fetching data from saved Dune query ${DUNE_QUERY_ID}...`)

  // Execute the saved query
  const executionId = await executeQuery(DUNE_QUERY_ID)

  // Wait for completion
  console.log("[Seed] Waiting for query completion...")
  await waitForCompletion(executionId)

  // Get results
  console.log("[Seed] Fetching results...")
  const rows = await getExecutionResults(executionId)

  return rows
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

    // Clear existing data if force re-seeding
    if (force && currentStats.count > 0) {
      console.log("[Seed] Force flag set, clearing existing data...")
      await clearAllDailyVolume()
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
      duneQueryUrl: `https://dune.com/queries/${DUNE_QUERY_ID}`,
      launchLabProgram: LAUNCHLAB_PROGRAM,
      letsBonkPlatform: LETSBONK_PLATFORM,
      usd1Mint: USD1_MINT,
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
