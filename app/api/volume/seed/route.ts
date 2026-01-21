import { NextResponse } from "next/server"
import {
  bulkSaveDailyVolume,
  getDailyVolumeStats,
  clearAllDailyVolume,
  DailyVolumeData,
} from "@/lib/volume-store"

// Dune Analytics API configuration
const DUNE_API = "https://api.dune.com/api/v1"

// Key addresses for BonkFun token identification
const LAUNCHLAB_PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
const LETSBONK_PLATFORM = "FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1"
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"

/**
 * SQL query to get BonkFun/USD1 daily volume
 *
 * This query:
 * 1. Identifies BonkFun tokens created via Raydium LaunchLab with LetsBonk platform
 * 2. Joins with DEX trades where one side is USD1 and other side is a BonkFun token
 * 3. Aggregates volume by day
 *
 * Account indices in initializeV2 instruction (1-indexed for Dune SQL):
 * - account_arguments[4] = platform_config (LetsBonk address)
 * - account_arguments[7] = base_mint (the BonkFun token)
 */
const BONKFUN_USD1_VOLUME_QUERY = `
WITH bonkfun_tokens AS (
  SELECT DISTINCT
    account_arguments[7] as token_mint
  FROM solana.instruction_calls
  WHERE executing_account = '${LAUNCHLAB_PROGRAM}'
    AND account_arguments[4] = '${LETSBONK_PLATFORM}'
    AND tx_success = true
    AND block_date >= DATE '2025-04-16'
),
usd1_trades AS (
  SELECT
    DATE(block_time) as trade_date,
    tx_hash,
    CASE
      WHEN token_bought_address = '${USD1_MINT}' THEN token_sold_address
      ELSE token_bought_address
    END as bonkfun_token,
    amount_usd
  FROM dex_solana.trades
  WHERE (
    token_bought_address = '${USD1_MINT}'
    OR token_sold_address = '${USD1_MINT}'
  )
  AND block_date >= DATE '2025-04-16'
  AND amount_usd > 0
)
SELECT
  t.trade_date as date,
  COUNT(DISTINCT t.tx_hash) as num_trades,
  COUNT(DISTINCT t.bonkfun_token) as unique_tokens,
  COALESCE(SUM(t.amount_usd), 0) as total_volume_usd
FROM usd1_trades t
INNER JOIN bonkfun_tokens b ON t.bonkfun_token = b.token_mint
GROUP BY t.trade_date
ORDER BY t.trade_date ASC
`

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
 * Execute a custom SQL query on Dune Analytics
 */
async function executeDuneQuery(sql: string): Promise<string> {
  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    throw new Error("DUNE_API_KEY not configured")
  }

  const response = await fetch(`${DUNE_API}/query/execute`, {
    method: "POST",
    headers: {
      "x-dune-api-key": duneApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_sql: sql,
      performance: "medium",
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Dune execute error: ${response.status} - ${errorText}`)
  }

  const data: DuneExecuteResponse = await response.json()
  return data.execution_id
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
async function waitForCompletion(executionId: string, maxWaitMs: number = 300000): Promise<void> {
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
 * Fetch BonkFun/USD1 volume data from Dune Analytics
 */
async function fetchDuneHistory(): Promise<DuneVolumeRow[]> {
  console.log("[Seed] Executing custom BonkFun/USD1 volume query...")

  // Execute the query
  const executionId = await executeDuneQuery(BONKFUN_USD1_VOLUME_QUERY)
  console.log(`[Seed] Execution ID: ${executionId}`)

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
      queryType: "custom_bonkfun_usd1_volume",
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
