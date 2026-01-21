import { NextResponse } from "next/server"

// ============================================
// DUNE ANALYTICS INTEGRATION FOR USD1 VOLUME
// ============================================

const DUNE_API_KEY = process.env.DUNE_API_KEY
const DUNE_API_BASE = "https://api.dune.com/api/v1"

// USD1 token mint address
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"

// Cache configuration
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const cache: Map<string, { data: any; timestamp: number }> = new Map()

interface DuneExecutionResponse {
  execution_id: string
  state: string
}

interface DuneResultResponse {
  execution_id: string
  state: string
  result?: {
    rows: any[]
    metadata: {
      column_names: string[]
      result_set_bytes: number
      total_row_count: number
    }
  }
}

/**
 * Execute a Dune query and wait for results
 * Uses Dune's query execution API
 */
async function executeDuneQuery(queryId: number, parameters?: Record<string, any>): Promise<any[]> {
  if (!DUNE_API_KEY) {
    throw new Error("DUNE_API_KEY not configured")
  }

  // Execute the query
  const executeUrl = `${DUNE_API_BASE}/query/${queryId}/execute`
  const executeResponse = await fetch(executeUrl, {
    method: "POST",
    headers: {
      "X-Dune-API-Key": DUNE_API_KEY,
      "Content-Type": "application/json",
    },
    body: parameters ? JSON.stringify({ query_parameters: parameters }) : undefined,
  })

  if (!executeResponse.ok) {
    const error = await executeResponse.text()
    throw new Error(`Dune execute error: ${executeResponse.status} - ${error}`)
  }

  const executeData: DuneExecutionResponse = await executeResponse.json()
  const executionId = executeData.execution_id

  // Poll for results (max 60 seconds)
  const maxWaitTime = 60000
  const pollInterval = 2000
  let elapsed = 0

  while (elapsed < maxWaitTime) {
    const statusUrl = `${DUNE_API_BASE}/execution/${executionId}/results`
    const statusResponse = await fetch(statusUrl, {
      headers: {
        "X-Dune-API-Key": DUNE_API_KEY,
      },
    })

    if (!statusResponse.ok) {
      throw new Error(`Dune status error: ${statusResponse.status}`)
    }

    const statusData: DuneResultResponse = await statusResponse.json()

    if (statusData.state === "QUERY_STATE_COMPLETED" && statusData.result) {
      return statusData.result.rows
    }

    if (statusData.state === "QUERY_STATE_FAILED") {
      throw new Error("Dune query execution failed")
    }

    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, pollInterval))
    elapsed += pollInterval
  }

  throw new Error("Dune query timeout")
}

/**
 * Get latest results from a saved Dune query (faster, no execution needed)
 */
async function getDuneQueryLatestResults(queryId: number): Promise<any[]> {
  if (!DUNE_API_KEY) {
    throw new Error("DUNE_API_KEY not configured")
  }

  const url = `${DUNE_API_BASE}/query/${queryId}/results`
  const response = await fetch(url, {
    headers: {
      "X-Dune-API-Key": DUNE_API_KEY,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Dune results error: ${response.status} - ${error}`)
  }

  const data: DuneResultResponse = await response.json()
  return data.result?.rows || []
}

/**
 * Execute a custom SQL query on Dune
 */
async function executeDuneSQL(sql: string): Promise<any[]> {
  if (!DUNE_API_KEY) {
    throw new Error("DUNE_API_KEY not configured")
  }

  const url = `${DUNE_API_BASE}/query/execute`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Dune-API-Key": DUNE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_sql: sql,
      is_private: false,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Dune SQL error: ${response.status} - ${error}`)
  }

  const data: DuneExecutionResponse = await response.json()
  const executionId = data.execution_id

  // Poll for results
  const maxWaitTime = 120000 // 2 minutes for custom queries
  const pollInterval = 3000
  let elapsed = 0

  while (elapsed < maxWaitTime) {
    const statusUrl = `${DUNE_API_BASE}/execution/${executionId}/results`
    const statusResponse = await fetch(statusUrl, {
      headers: {
        "X-Dune-API-Key": DUNE_API_KEY,
      },
    })

    if (statusResponse.ok) {
      const statusData: DuneResultResponse = await statusResponse.json()

      if (statusData.state === "QUERY_STATE_COMPLETED" && statusData.result) {
        return statusData.result.rows
      }

      if (statusData.state === "QUERY_STATE_FAILED") {
        throw new Error("Dune SQL query failed")
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval))
    elapsed += pollInterval
  }

  throw new Error("Dune SQL query timeout")
}

/**
 * Build SQL query for USD1 volume history
 */
function buildVolumeHistorySQL(period: string): string {
  let interval: string
  let lookback: string

  switch (period) {
    case "24h":
      interval = "hour"
      lookback = "24 hours"
      break
    case "7d":
      interval = "hour"
      lookback = "7 days"
      break
    case "1m":
      interval = "day"
      lookback = "30 days"
      break
    case "all":
      interval = "day"
      lookback = "180 days"
      break
    default:
      interval = "hour"
      lookback = "24 hours"
  }

  // Query for Raydium DEX trades involving USD1
  return `
    SELECT
      date_trunc('${interval}', block_time) as time_bucket,
      SUM(amount_usd) as volume,
      COUNT(*) as trades
    FROM dex_solana.trades
    WHERE
      block_time >= NOW() - INTERVAL '${lookback}'
      AND (
        token_bought_mint_address = '${USD1_MINT}'
        OR token_sold_mint_address = '${USD1_MINT}'
      )
      AND project = 'raydium'
    GROUP BY 1
    ORDER BY 1 ASC
  `
}

// ============================================
// API HANDLER
// ============================================

export async function GET(request: Request) {
  const url = new URL(request.url)
  const period = url.searchParams.get("period") || "24h"
  const queryId = url.searchParams.get("queryId") // Optional: use a saved query

  // Check cache
  const cacheKey = `dune-volume-${period}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({
      ...cached.data,
      cached: true,
    })
  }

  try {
    let rows: any[]

    if (queryId) {
      // Use a pre-saved Dune query (faster)
      rows = await getDuneQueryLatestResults(parseInt(queryId))
    } else {
      // Execute custom SQL
      const sql = buildVolumeHistorySQL(period)
      rows = await executeDuneSQL(sql)
    }

    // Transform to our format
    const history = rows.map(row => ({
      timestamp: new Date(row.time_bucket).getTime(),
      volume: parseFloat(row.volume) || 0,
      trades: parseInt(row.trades) || 0,
    }))

    // Calculate stats
    const volumes = history.map(h => h.volume)
    const totalVolume = volumes.reduce((sum, v) => sum + v, 0)
    const current = volumes[volumes.length - 1] || 0
    const previous = volumes[0] || current
    const change = previous > 0 ? ((current - previous) / previous) * 100 : 0

    const result = {
      history,
      stats: {
        current,
        previous,
        change,
        peak: Math.max(...volumes, 0),
        low: Math.min(...volumes.filter(v => v > 0), 0),
        average: volumes.length > 0 ? totalVolume / volumes.length : 0,
        totalVolume,
      },
      period,
      dataPoints: history.length,
      source: "dune",
    }

    // Update cache
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("[Dune] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch Dune data" },
      { status: 500 }
    )
  }
}

export const runtime = "edge"
