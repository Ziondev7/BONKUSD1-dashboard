import { NextResponse } from "next/server"
import { saveVolumeSnapshot, getStorageStatus } from "@/lib/volume-store"

// ============================================
// CONFIGURATION
// ============================================
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2"

// Tokens to exclude (stablecoins, major tokens - not BONK.fun launched)
const EXCLUDED_SYMBOLS = ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"]

// Backfill configuration
const OHLCV_BATCH_SIZE = 3 // Pools per batch (conservative for rate limits)
const BATCH_DELAY_MS = 1500 // Delay between batches to avoid 429s
const MAX_POOLS_PER_RUN = 50 // Limit pools per API call to avoid timeout

// Auth
const CRON_SECRET = process.env.CRON_SECRET || "bonkfun-cron-secret-2024"

// ============================================
// TYPES
// ============================================
interface PoolInfo {
  poolId: string
  symbol: string
  volume24h: number
  liquidity: number
}

interface OHLCVCandle {
  timestamp: number // ms
  volume: number
}

interface BackfillProgress {
  totalPools: number
  processedPools: number
  currentPoolIndex: number
  aggregatedSnapshots: number
  startTime: number
  lastUpdate: number
  status: "running" | "completed" | "error"
  error?: string
}

// In-memory progress tracking (for streaming logs)
let currentProgress: BackfillProgress | null = null

// Aggregated volume data by timestamp
const volumeByTimestamp = new Map<number, { volume: number; poolCount: number; liquidity: number }>()

// ============================================
// UTILITY FUNCTIONS
// ============================================
async function fetchWithTimeout(url: string, timeout = 15000): Promise<Response> {
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

function log(message: string) {
  console.log(`[Backfill] ${message}`)
}

// ============================================
// DATA FETCHERS
// ============================================

/**
 * Fetch all USD1 pools from Raydium
 */
async function fetchAllUSD1Pools(): Promise<PoolInfo[]> {
  const pools: PoolInfo[] = []
  const poolMap = new Map<string, PoolInfo>()

  try {
    const pageSize = 500
    const maxPages = 5

    for (let page = 1; page <= maxPages; page++) {
      const url = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=default&sortType=desc&pageSize=${pageSize}&page=${page}`
      const response = await fetchWithTimeout(url)

      if (!response.ok) {
        log(`Raydium API error on page ${page}: ${response.status}`)
        break
      }

      const json = await response.json()
      if (!json.success || !json.data?.data || json.data.data.length === 0) {
        break
      }

      for (const pool of json.data.data) {
        const mintA = pool.mintA?.address
        const mintB = pool.mintB?.address
        const symbolA = pool.mintA?.symbol
        const symbolB = pool.mintB?.symbol

        const isAUSD1 = mintA === USD1_MINT
        const isBUSD1 = mintB === USD1_MINT

        if (!isAUSD1 && !isBUSD1) continue

        const pairedSymbol = isAUSD1 ? symbolB : symbolA
        const pairedMint = isAUSD1 ? mintB : mintA

        if (shouldExclude(pairedSymbol)) continue

        const volume24h = pool.day?.volume || 0
        const liquidity = pool.tvl || 0

        // Keep highest volume pool per token
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

      if (json.data.data.length < pageSize) break
    }

    pools.push(...poolMap.values())
    pools.sort((a, b) => b.volume24h - a.volume24h)

    log(`Found ${pools.length} USD1 pools`)
  } catch (error) {
    log(`Error fetching pools: ${error}`)
    throw error
  }

  return pools
}

/**
 * Fetch OHLCV data for a single pool from GeckoTerminal
 */
async function fetchPoolOHLCV(poolId: string, symbol: string): Promise<OHLCVCandle[]> {
  const candles: OHLCVCandle[] = []

  try {
    // Fetch hourly candles (up to 1000)
    const hourlyUrl = `${GECKOTERMINAL_API}/networks/solana/pools/${poolId}/ohlcv/hour?aggregate=1&limit=1000`
    const hourlyResponse = await fetchWithTimeout(hourlyUrl, 10000)

    if (hourlyResponse.ok) {
      const hourlyData = await hourlyResponse.json()
      const ohlcvList = hourlyData.data?.attributes?.ohlcv_list || []

      for (const candle of ohlcvList) {
        candles.push({
          timestamp: candle[0] * 1000, // Convert to ms
          volume: candle[5] || 0,
        })
      }
    } else if (hourlyResponse.status === 429) {
      log(`Rate limited on ${symbol}, waiting...`)
      await new Promise(r => setTimeout(r, 5000))
    }

    // Also fetch daily candles for older data
    const dailyUrl = `${GECKOTERMINAL_API}/networks/solana/pools/${poolId}/ohlcv/day?aggregate=1&limit=365`
    const dailyResponse = await fetchWithTimeout(dailyUrl, 10000)

    if (dailyResponse.ok) {
      const dailyData = await dailyResponse.json()
      const ohlcvList = dailyData.data?.attributes?.ohlcv_list || []

      // Only add daily candles for timestamps we don't have hourly data for
      const hourlyTimestamps = new Set(candles.map(c => Math.floor(c.timestamp / (24 * 60 * 60 * 1000))))

      for (const candle of ohlcvList) {
        const dayTimestamp = candle[0] * 1000
        const dayKey = Math.floor(dayTimestamp / (24 * 60 * 60 * 1000))

        if (!hourlyTimestamps.has(dayKey)) {
          // Distribute daily volume across 24 hours
          const hourlyVolume = (candle[5] || 0) / 24
          for (let h = 0; h < 24; h++) {
            candles.push({
              timestamp: dayTimestamp + h * 60 * 60 * 1000,
              volume: hourlyVolume,
            })
          }
        }
      }
    }
  } catch (error) {
    log(`Error fetching OHLCV for ${symbol}: ${error}`)
  }

  return candles
}

/**
 * Aggregate a pool's OHLCV data into the global volume map
 */
function aggregatePoolData(candles: OHLCVCandle[], poolLiquidity: number) {
  for (const candle of candles) {
    // Round to hour
    const hourTimestamp = Math.floor(candle.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000)

    const existing = volumeByTimestamp.get(hourTimestamp)
    if (existing) {
      existing.volume += candle.volume
      existing.poolCount++
      existing.liquidity = Math.max(existing.liquidity, poolLiquidity)
    } else {
      volumeByTimestamp.set(hourTimestamp, {
        volume: candle.volume,
        poolCount: 1,
        liquidity: poolLiquidity,
      })
    }
  }
}

/**
 * Save all aggregated snapshots to volume-store
 */
async function saveAggregatedSnapshots(): Promise<number> {
  let saved = 0

  // Sort timestamps
  const timestamps = Array.from(volumeByTimestamp.keys()).sort((a, b) => a - b)

  log(`Saving ${timestamps.length} aggregated hourly snapshots...`)

  for (const timestamp of timestamps) {
    const data = volumeByTimestamp.get(timestamp)!

    // Calculate rolling 24h volume for this timestamp
    const twentyFourHoursAgo = timestamp - 24 * 60 * 60 * 1000
    let rolling24hVolume = 0

    for (const [ts, d] of volumeByTimestamp.entries()) {
      if (ts > twentyFourHoursAgo && ts <= timestamp) {
        rolling24hVolume += d.volume
      }
    }

    await saveVolumeSnapshot({
      timestamp,
      totalVolume24h: rolling24hVolume,
      totalLiquidity: data.liquidity,
      poolCount: data.poolCount,
    })

    saved++

    // Log progress every 100 snapshots
    if (saved % 100 === 0) {
      log(`Saved ${saved}/${timestamps.length} snapshots`)
    }
  }

  return saved
}

// ============================================
// MAIN BACKFILL LOGIC
// ============================================

async function runBackfill(maxPools?: number): Promise<BackfillProgress> {
  const startTime = Date.now()

  currentProgress = {
    totalPools: 0,
    processedPools: 0,
    currentPoolIndex: 0,
    aggregatedSnapshots: 0,
    startTime,
    lastUpdate: startTime,
    status: "running",
  }

  try {
    // Step 1: Fetch all pools
    log("Fetching all USD1 pools from Raydium...")
    const pools = await fetchAllUSD1Pools()
    const poolsToProcess = maxPools ? pools.slice(0, maxPools) : pools

    currentProgress.totalPools = poolsToProcess.length
    log(`Will process ${poolsToProcess.length} pools`)

    // Step 2: Fetch OHLCV for each pool and aggregate
    volumeByTimestamp.clear() // Reset aggregation

    for (let i = 0; i < poolsToProcess.length; i += OHLCV_BATCH_SIZE) {
      const batch = poolsToProcess.slice(i, i + OHLCV_BATCH_SIZE)

      for (const pool of batch) {
        currentProgress.currentPoolIndex = i
        currentProgress.processedPools++
        currentProgress.lastUpdate = Date.now()

        log(`[${currentProgress.processedPools}/${poolsToProcess.length}] Processing ${pool.symbol}...`)

        const candles = await fetchPoolOHLCV(pool.poolId, pool.symbol)

        if (candles.length > 0) {
          aggregatePoolData(candles, pool.liquidity)
          log(`  ${pool.symbol}: ${candles.length} candles aggregated`)
        } else {
          log(`  ${pool.symbol}: No OHLCV data available`)
        }
      }

      // Delay between batches to avoid rate limits
      if (i + OHLCV_BATCH_SIZE < poolsToProcess.length) {
        log(`Batch complete, waiting ${BATCH_DELAY_MS}ms...`)
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
      }
    }

    // Step 3: Save aggregated snapshots
    log("Saving aggregated snapshots to volume-store...")
    const savedCount = await saveAggregatedSnapshots()

    currentProgress.aggregatedSnapshots = savedCount
    currentProgress.status = "completed"
    currentProgress.lastUpdate = Date.now()

    const duration = (Date.now() - startTime) / 1000
    log(`Backfill completed in ${duration.toFixed(1)}s: ${savedCount} snapshots saved`)

    return currentProgress
  } catch (error) {
    currentProgress.status = "error"
    currentProgress.error = String(error)
    currentProgress.lastUpdate = Date.now()
    log(`Backfill error: ${error}`)
    throw error
  }
}

// ============================================
// API HANDLERS
// ============================================

export async function POST(request: Request) {
  // Auth check
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Parse options from body
  let maxPools = MAX_POOLS_PER_RUN
  try {
    const body = await request.json()
    if (body.maxPools && typeof body.maxPools === "number") {
      maxPools = body.maxPools
    }
  } catch {
    // No body or invalid JSON, use defaults
  }

  try {
    log(`Starting backfill with maxPools=${maxPools}`)
    const result = await runBackfill(maxPools)

    const storageStatus = await getStorageStatus()

    return NextResponse.json({
      success: true,
      progress: result,
      storage: storageStatus,
      message: `Backfill completed: ${result.aggregatedSnapshots} snapshots saved from ${result.processedPools} pools`,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: String(error),
        progress: currentProgress,
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const action = url.searchParams.get("action")

  // Status check
  if (action === "status") {
    const storageStatus = await getStorageStatus()
    return NextResponse.json({
      progress: currentProgress,
      storage: storageStatus,
      aggregatedTimestamps: volumeByTimestamp.size,
    })
  }

  // Quick test with few pools
  if (action === "test") {
    const secret = url.searchParams.get("secret")
    if (secret !== CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
      const result = await runBackfill(5) // Only 5 pools for testing
      const storageStatus = await getStorageStatus()

      return NextResponse.json({
        success: true,
        progress: result,
        storage: storageStatus,
      })
    } catch (error) {
      return NextResponse.json({ error: String(error) }, { status: 500 })
    }
  }

  // Default: return usage info
  return NextResponse.json({
    endpoint: "/api/backfill",
    description: "Backfill historical volume data for BONK.fun/USD1 ecosystem",
    usage: {
      "POST with Bearer token": "Run full backfill (use body {maxPools: N} to limit)",
      "GET ?action=status": "Check current backfill progress",
      "GET ?action=test&secret=<CRON_SECRET>": "Run test backfill with 5 pools",
    },
    currentProgress: currentProgress,
  })
}

// Use Node.js runtime for longer execution time
export const runtime = "nodejs"
export const maxDuration = 300 // 5 minutes max (Vercel Pro limit)
