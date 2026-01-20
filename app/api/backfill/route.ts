/**
 * Backfill API - One-time historical data population
 *
 * This endpoint fetches all historical swap data from Helius
 * and stores it in Supabase. Run this once to populate your database.
 *
 * Usage: POST /api/backfill
 * Headers: Authorization: Bearer YOUR_CRON_SECRET
 *
 * Query params:
 * - poolLimit: Max pools to process (default: 50)
 * - daysBack: How far back to fetch (default: 30)
 */

import { NextRequest, NextResponse } from "next/server"
import { isHeliusConfigured, fetchAllPoolHistory, aggregateSwapsToHourly } from "@/lib/helius"
import { isSupabaseConfigured, getSupabase, upsertVolumeSnapshots, registerPool, updateSyncStatus } from "@/lib/supabase"

interface OHLCVCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * Fetch historical OHLCV data from GeckoTerminal
 * This provides pre-aggregated volume data which is much more reliable than parsing transactions
 */
async function fetchOHLCVFromGeckoTerminal(
  poolAddress: string,
  timeframe: 'hour' | 'day' = 'hour',
  limit: number = 1000
): Promise<OHLCVCandle[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?limit=${limit}`

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    })

    if (!response.ok) {
      console.log(`[GeckoTerminal OHLCV] API error: ${response.status}`)
      return []
    }

    const data = await response.json()
    const ohlcvList = data.data?.attributes?.ohlcv_list || []

    // GeckoTerminal returns [timestamp, open, high, low, close, volume]
    return ohlcvList.map((candle: number[]) => ({
      timestamp: candle[0] * 1000, // Convert to milliseconds
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: candle[5]
    }))
  } catch (error) {
    console.log(`[GeckoTerminal OHLCV] Error: ${error instanceof Error ? error.message : 'Unknown'}`)
    return []
  }
}

/**
 * Fetch complete historical volume using OHLCV (primary) or Helius (fallback)
 * When daysBack is 0 or "all", fetches ALL available historical data
 */
async function fetchHistoricalVolume(
  poolAddress: string,
  tokenSymbol: string,
  daysBack: number
): Promise<{ timestamp: number; volume: number; trades: number }[]> {
  console.log(`[Backfill] Fetching OHLCV data for ${tokenSymbol}...`)

  const fetchAll = daysBack === 0 // 0 means fetch all available data
  const allData: { timestamp: number; volume: number; trades: number }[] = []

  // STEP 1: Always fetch daily candles first for maximum historical coverage (up to 1000 days)
  console.log(`[Backfill] Fetching daily candles for full history...`)
  let dailyCandles = await fetchOHLCVFromGeckoTerminal(poolAddress, 'day', 1000)

  if (dailyCandles.length > 0) {
    console.log(`[Backfill] Got ${dailyCandles.length} daily candles from GeckoTerminal`)

    // Filter to requested time range (skip if fetching all)
    if (!fetchAll && daysBack > 0) {
      const cutoffTime = Date.now() - daysBack * 24 * 60 * 60 * 1000
      dailyCandles = dailyCandles.filter(c => c.timestamp >= cutoffTime)
    }

    // Find the oldest and newest data points
    if (dailyCandles.length > 0) {
      const oldest = new Date(Math.min(...dailyCandles.map(c => c.timestamp)))
      const newest = new Date(Math.max(...dailyCandles.map(c => c.timestamp)))
      console.log(`[Backfill] Daily data range: ${oldest.toISOString().split('T')[0]} to ${newest.toISOString().split('T')[0]}`)
    }

    // Convert daily candles to our format
    for (const candle of dailyCandles) {
      allData.push({
        timestamp: candle.timestamp,
        volume: candle.volume,
        trades: Math.max(1, Math.floor(candle.volume / 1000))
      })
    }
  }

  // STEP 2: Also fetch hourly candles for recent data (more granular, last ~41 days)
  console.log(`[Backfill] Fetching hourly candles for recent granularity...`)
  let hourlyCandles = await fetchOHLCVFromGeckoTerminal(poolAddress, 'hour', 1000)

  if (hourlyCandles.length > 0) {
    console.log(`[Backfill] Got ${hourlyCandles.length} hourly candles from GeckoTerminal`)

    // Filter to requested time range (skip if fetching all)
    if (!fetchAll && daysBack > 0) {
      const cutoffTime = Date.now() - daysBack * 24 * 60 * 60 * 1000
      hourlyCandles = hourlyCandles.filter(c => c.timestamp >= cutoffTime)
    }

    // Merge hourly data - replace daily data with hourly where available
    const hourlyTimestamps = new Set(hourlyCandles.map(c => {
      // Round to day for comparison
      return Math.floor(c.timestamp / (24 * 60 * 60 * 1000)) * 24 * 60 * 60 * 1000
    }))

    // Remove daily data that overlaps with hourly data
    const filteredDaily = allData.filter(d => !hourlyTimestamps.has(
      Math.floor(d.timestamp / (24 * 60 * 60 * 1000)) * 24 * 60 * 60 * 1000
    ))

    // Add hourly candles
    for (const candle of hourlyCandles) {
      filteredDaily.push({
        timestamp: candle.timestamp,
        volume: candle.volume,
        trades: Math.max(1, Math.floor(candle.volume / 1000))
      })
    }

    // Sort by timestamp
    filteredDaily.sort((a, b) => a.timestamp - b.timestamp)
    return filteredDaily
  }

  if (allData.length > 0) {
    allData.sort((a, b) => a.timestamp - b.timestamp)
    return allData
  }

  // Final fallback: Helius transaction parsing
  if (isHeliusConfigured()) {
    console.log(`[Backfill] No OHLCV data, falling back to Helius...`)
    const startTime = fetchAll ? 0 : Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000)

    const swaps = await fetchAllPoolHistory(poolAddress, {
      startTime,
      onProgress: (count) => {
        console.log(`[Backfill] ${tokenSymbol}: Fetched ${count} transactions...`)
      }
    })

    if (swaps.length > 0) {
      return aggregateSwapsToHourly(swaps)
    }
  }

  console.log(`[Backfill] No historical data found for ${tokenSymbol}`)
  return []
}

// Constants - USD1 stablecoin (BONK.fun pairs)
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2"
const DEXSCREENER_API = "https://api.dexscreener.com/latest"

// Tokens to EXCLUDE (stablecoins, major tokens - NOT bonk.fun meme tokens)
const EXCLUDED_TOKENS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "So11111111111111111111111111111111111111112",   // SOL (wrapped)
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",  // mSOL
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",  // JUP
  USD1_MINT, // USD1 itself (avoid USD1/USD1 if any)
])

// Symbol-based exclusions (for APIs that don't return mint addresses)
const EXCLUDED_SYMBOLS = new Set([
  "USDC", "USDT", "SOL", "WSOL", "mSOL", "stSOL", "jitoSOL",
  "BONK", "JUP", "RAY", "USD1", "PYUSD", "DAI", "BUSD"
])

interface Pool {
  id: string
  mintA: { address: string; symbol: string; name: string }
  mintB: { address: string; symbol: string; name: string }
}

interface GeckoPool {
  id: string
  attributes: {
    address: string
    name: string
    base_token_price_usd: string
    quote_token_price_usd: string
    volume_usd: { h24: string }
  }
  relationships: {
    base_token: { data: { id: string } }
    quote_token: { data: { id: string } }
  }
}

/**
 * Fetch with retry logic for flaky APIs
 */
async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Backfill] Fetch attempt ${attempt}/${maxRetries}...`)
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      })

      if (response.ok) {
        return response
      }

      // If 500 error, retry
      if (response.status >= 500 && attempt < maxRetries) {
        console.log(`[Backfill] Server error ${response.status}, retrying in ${attempt * 2}s...`)
        await new Promise(resolve => setTimeout(resolve, attempt * 2000))
        continue
      }

      throw new Error(`API error: ${response.status}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < maxRetries) {
        console.log(`[Backfill] Error: ${lastError.message}, retrying in ${attempt * 2}s...`)
        await new Promise(resolve => setTimeout(resolve, attempt * 2000))
      }
    }
  }

  throw lastError || new Error("Fetch failed after retries")
}

/**
 * Fetch USD1 pools from GeckoTerminal as fallback (with pagination)
 */
async function fetchPoolsFromGeckoTerminal(limit: number): Promise<Pool[]> {
  console.log("[Backfill] Trying GeckoTerminal fallback...")

  const pools: Pool[] = []
  const maxPages = Math.ceil(limit / 20) // GeckoTerminal returns 20 per page

  for (let page = 1; page <= maxPages && pools.length < limit; page++) {
    const url = `${GECKOTERMINAL_API}/networks/solana/tokens/${USD1_MINT}/pools?page=${page}`
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      if (page === 1) {
        throw new Error(`GeckoTerminal API error: ${response.status}`)
      }
      break // Stop pagination on error after first page
    }

    const data = await response.json()
    const geckoPools: GeckoPool[] = data.data || []

    if (geckoPools.length === 0) break // No more pages

    // Convert GeckoTerminal format to our Pool format
    for (const gp of geckoPools) {
      if (pools.length >= limit) break

      const poolAddress = gp.attributes.address
      const poolName = gp.attributes.name || ""

      // Parse pool name to extract token symbols (e.g., "TOKEN / USD1")
      const nameParts = poolName.split(" / ")
      const baseSymbol = nameParts[0]?.trim() || "UNKNOWN"
      const quoteSymbol = nameParts[1]?.trim() || "USD1"

      // Determine which side is USD1
      const isBaseUsd1 = quoteSymbol.toUpperCase() !== "USD1"
      const otherSymbol = isBaseUsd1 ? baseSymbol : quoteSymbol

      // Skip excluded tokens (stablecoins, major tokens)
      if (EXCLUDED_SYMBOLS.has(otherSymbol.toUpperCase())) {
        console.log(`[Backfill] Skipping ${otherSymbol} (excluded token)`)
        continue
      }

      pools.push({
        id: poolAddress,
        mintA: {
          address: isBaseUsd1 ? USD1_MINT : "",
          symbol: isBaseUsd1 ? "USD1" : baseSymbol,
          name: isBaseUsd1 ? "USD1" : baseSymbol
        },
        mintB: {
          address: isBaseUsd1 ? "" : USD1_MINT,
          symbol: isBaseUsd1 ? baseSymbol : "USD1",
          name: isBaseUsd1 ? baseSymbol : "USD1"
        }
      })
    }

    console.log(`[Backfill] GeckoTerminal page ${page}: got ${geckoPools.length} pools (total: ${pools.length})`)

    // Rate limit between pages
    if (page < maxPages) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  return pools
}

/**
 * Fetch USD1 pools from DexScreener (often has more pools than GeckoTerminal)
 */
async function fetchPoolsFromDexScreener(limit: number): Promise<Pool[]> {
  console.log("[Backfill] Trying DexScreener...")

  const url = `${DEXSCREENER_API}/dex/tokens/${USD1_MINT}`
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  })

  if (!response.ok) {
    throw new Error(`DexScreener API error: ${response.status}`)
  }

  const data = await response.json()
  const dexPairs = data.pairs || []

  console.log(`[Backfill] DexScreener returned ${dexPairs.length} pairs`)

  // Filter for Raydium pools only (BONK.fun uses Raydium)
  const raydiumPairs = dexPairs.filter((p: any) =>
    p.dexId === 'raydium' && p.chainId === 'solana'
  )

  console.log(`[Backfill] Found ${raydiumPairs.length} Raydium pools`)

  // Filter out stablecoins and major tokens - we only want bonk.fun meme tokens
  const memeTokenPairs = raydiumPairs.filter((p: any) => {
    const baseMint = p.baseToken?.address || ""
    const quoteMint = p.quoteToken?.address || ""
    // The "other" token (not USD1) should NOT be in our excluded list
    const otherMint = baseMint === USD1_MINT ? quoteMint : baseMint
    return !EXCLUDED_TOKENS.has(otherMint)
  })

  console.log(`[Backfill] Found ${memeTokenPairs.length} bonk.fun meme token pools (after filtering)`)

  const pools: Pool[] = []
  for (const pair of memeTokenPairs.slice(0, limit)) {
    const poolAddress = pair.pairAddress
    const baseSymbol = pair.baseToken?.symbol || "UNKNOWN"
    const quoteSymbol = pair.quoteToken?.symbol || "USD1"
    const baseMint = pair.baseToken?.address || ""
    const quoteMint = pair.quoteToken?.address || ""

    // Determine which side is USD1
    const isBaseUsd1 = baseMint === USD1_MINT

    pools.push({
      id: poolAddress,
      mintA: {
        address: isBaseUsd1 ? USD1_MINT : baseMint,
        symbol: isBaseUsd1 ? "USD1" : baseSymbol,
        name: isBaseUsd1 ? "USD1" : baseSymbol
      },
      mintB: {
        address: isBaseUsd1 ? quoteMint : USD1_MINT,
        symbol: isBaseUsd1 ? quoteSymbol : "USD1",
        name: isBaseUsd1 ? quoteSymbol : "USD1"
      }
    })
  }

  return pools
}

/**
 * Try to fetch pools from multiple sources (Raydium -> DexScreener -> GeckoTerminal)
 */
async function fetchPools(limit: number): Promise<Pool[]> {
  // Try Raydium first (most accurate for BONK.fun)
  try {
    const poolsUrl = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=volume24h&sortType=desc&pageSize=${limit}`
    const poolsResponse = await fetchWithRetry(poolsUrl)
    const poolsData = await poolsResponse.json()

    if (poolsData.success && poolsData.data?.data?.length > 0) {
      console.log(`[Backfill] Got ${poolsData.data.data.length} pools from Raydium`)
      return poolsData.data.data
    }
  } catch (error) {
    console.log(`[Backfill] Raydium failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  // Try DexScreener (usually has more pools indexed)
  try {
    const pools = await fetchPoolsFromDexScreener(limit)
    if (pools.length > 0) {
      console.log(`[Backfill] Got ${pools.length} pools from DexScreener`)
      return pools
    }
  } catch (error) {
    console.log(`[Backfill] DexScreener failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  // Fallback to GeckoTerminal
  try {
    const pools = await fetchPoolsFromGeckoTerminal(limit)
    console.log(`[Backfill] Got ${pools.length} pools from GeckoTerminal`)
    return pools
  } catch (error) {
    throw new Error(`All APIs failed (Raydium, DexScreener, GeckoTerminal). Last error: ${error instanceof Error ? error.message : 'Unknown'}`)
  }
}

export async function POST(request: NextRequest) {
  // Verify authorization
  const authHeader = request.headers.get("authorization")
  const expectedToken = process.env.CRON_SECRET

  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Check configuration - Supabase is required, Helius is optional (GeckoTerminal is primary)
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    )
  }

  const { searchParams } = new URL(request.url)
  const poolLimit = parseInt(searchParams.get("poolLimit") || "50")
  const daysBack = parseInt(searchParams.get("daysBack") || "30")

  const results: { pool: string; status: string; snapshots?: number; error?: string }[] = []

  console.log(`[Backfill] Starting backfill for ${poolLimit} pools, ${daysBack} days back`)

  try {
    // Step 1: Get all BONK.fun/USD1 pools (tries Raydium first, then GeckoTerminal)
    console.log("[Backfill] Fetching USD1 pools...")
    const pools = await fetchPools(poolLimit)

    if (pools.length === 0) {
      throw new Error("No USD1 pools found")
    }

    console.log(`[Backfill] Found ${pools.length} pools to process`)

    // Step 2: Process each pool
    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i]
      const poolAddress = pool.id

      // Determine which mint is the token (not USD1)
      const isAUsd1 = pool.mintA.address === USD1_MINT
      const tokenMint = isAUsd1 ? pool.mintB.address : pool.mintA.address
      const tokenSymbol = isAUsd1 ? pool.mintB.symbol : pool.mintA.symbol
      const tokenName = isAUsd1 ? pool.mintB.name : pool.mintA.name

      console.log(`[Backfill] Processing ${i + 1}/${pools.length}: ${tokenSymbol} (${poolAddress.slice(0, 8)}...)`)

      try {
        // Register pool in database
        await registerPool({
          pool_address: poolAddress,
          token_mint: tokenMint,
          token_symbol: tokenSymbol,
          token_name: tokenName
        })

        // Update sync status to 'syncing'
        await updateSyncStatus({
          pool_address: poolAddress,
          status: 'syncing'
        })

        // Fetch historical volume using OHLCV (primary) or Helius (fallback)
        const hourlyData = await fetchHistoricalVolume(poolAddress, tokenSymbol, daysBack)

        if (hourlyData.length === 0) {
          console.log(`[Backfill] ${tokenSymbol}: No volume data found`)
          await updateSyncStatus({
            pool_address: poolAddress,
            status: 'completed',
            last_synced_timestamp: Date.now()
          })
          results.push({ pool: tokenSymbol, status: 'no_data' })
          continue
        }

        // Convert to volume snapshots
        const snapshots = hourlyData.map(h => ({
          pool_address: poolAddress,
          token_mint: tokenMint,
          token_symbol: tokenSymbol,
          timestamp: h.timestamp,
          volume_usd: h.volume,
          trades: h.trades
        }))

        // Store in database
        const success = await upsertVolumeSnapshots(snapshots)

        if (success) {
          await updateSyncStatus({
            pool_address: poolAddress,
            status: 'completed',
            last_synced_timestamp: Date.now()
          })
          results.push({ pool: tokenSymbol, status: 'success', snapshots: snapshots.length })
          console.log(`[Backfill] ${tokenSymbol}: Stored ${snapshots.length} hourly snapshots`)
        } else {
          throw new Error('Failed to store snapshots')
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[Backfill] ${tokenSymbol}: Error - ${errorMessage}`)

        await updateSyncStatus({
          pool_address: poolAddress,
          status: 'error',
          error_message: errorMessage
        })

        results.push({ pool: tokenSymbol, status: 'error', error: errorMessage })
      }

      // Rate limit between pools
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Summary
    const successful = results.filter(r => r.status === 'success').length
    const failed = results.filter(r => r.status === 'error').length
    const noData = results.filter(r => r.status === 'no_data').length
    const totalSnapshots = results.reduce((sum, r) => sum + (r.snapshots || 0), 0)

    console.log(`[Backfill] Complete! Success: ${successful}, Failed: ${failed}, No data: ${noData}, Total snapshots: ${totalSnapshots}`)

    return NextResponse.json({
      success: true,
      summary: {
        poolsProcessed: pools.length,
        successful,
        failed,
        noData,
        totalSnapshots
      },
      results
    })

  } catch (error) {
    console.error("[Backfill] Fatal error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 500 }
    )
  }
}

// GET endpoint for status check
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/backfill",
    method: "POST",
    description: "One-time historical data backfill using GeckoTerminal OHLCV (primary) or Helius (fallback)",
    requirements: {
      supabase: isSupabaseConfigured(),
      helius: isHeliusConfigured() ? "configured (fallback)" : "not configured (optional)"
    },
    params: {
      poolLimit: "Max pools to process (default: 50)",
      daysBack: "How far back to fetch. Use 0 to fetch ALL available history (default: 30)"
    },
    authorization: "Bearer YOUR_CRON_SECRET",
    examples: {
      fetchAll: "POST /api/backfill?daysBack=0 - Fetch all available historical data",
      fetch30Days: "POST /api/backfill?daysBack=30 - Fetch last 30 days"
    }
  })
}
