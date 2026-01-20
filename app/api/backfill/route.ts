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
  const dataMap = new Map<number, { timestamp: number; volume: number; trades: number }>()

  // Add delay to avoid rate limiting
  await new Promise(resolve => setTimeout(resolve, 300))

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

    // Add daily candles to map (keyed by timestamp to prevent duplicates)
    for (const candle of dailyCandles) {
      dataMap.set(candle.timestamp, {
        timestamp: candle.timestamp,
        volume: candle.volume,
        trades: Math.max(1, Math.floor(candle.volume / 1000))
      })
    }
  }

  // Add delay to avoid rate limiting
  await new Promise(resolve => setTimeout(resolve, 300))

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

    // Remove daily data that overlaps with hourly data (hourly is more granular)
    const hourlyDays = new Set(hourlyCandles.map(c => {
      return Math.floor(c.timestamp / (24 * 60 * 60 * 1000)) * 24 * 60 * 60 * 1000
    }))

    // Delete overlapping daily entries
    for (const dayTimestamp of hourlyDays) {
      dataMap.delete(dayTimestamp)
    }

    // Add hourly candles (keyed by timestamp to prevent duplicates)
    for (const candle of hourlyCandles) {
      dataMap.set(candle.timestamp, {
        timestamp: candle.timestamp,
        volume: candle.volume,
        trades: Math.max(1, Math.floor(candle.volume / 1000))
      })
    }
  }

  if (dataMap.size > 0) {
    // Convert map to sorted array
    const result = Array.from(dataMap.values()).sort((a, b) => a.timestamp - b.timestamp)
    return result
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
const BONKUSD1_API = "https://bonkusd1.fun/api/tokens" // Our dashboard API with ALL tokens

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
 * Fetch ALL USD1 pools from GeckoTerminal with full pagination
 */
async function fetchPoolsFromGeckoTerminal(limit: number): Promise<Pool[]> {
  console.log("[Backfill] Fetching ALL pools from GeckoTerminal...")

  const pools: Pool[] = []
  const maxPages = 50 // GeckoTerminal allows up to 50 pages (1000 pools max)

  for (let page = 1; page <= maxPages; page++) {
    const url = `${GECKOTERMINAL_API}/networks/solana/tokens/${USD1_MINT}/pools?page=${page}`
    console.log(`[Backfill] GeckoTerminal page ${page}...`)

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

    if (geckoPools.length === 0) {
      console.log(`[Backfill] No more pools on page ${page}, stopping pagination`)
      break
    }

    // Convert GeckoTerminal format to our Pool format
    for (const gp of geckoPools) {
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
 * Fetch ALL pools from bonkusd1.fun API (primary source - has all 600+ tokens)
 * Only includes tokens that are:
 * 1. Migrated (have a pairAddress on Raydium/Meteora)
 * 2. Paired with USD1
 */
async function fetchPoolsFromBonkUsd1Api(): Promise<Pool[]> {
  console.log("[Backfill] Fetching ALL migrated USD1 pools from bonkusd1.fun API...")

  try {
    const response = await fetch(BONKUSD1_API, {
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      throw new Error(`bonkusd1.fun API error: ${response.status}`)
    }

    const data = await response.json()
    const tokens = data.tokens || []

    console.log(`[Backfill] bonkusd1.fun API returned ${tokens.length} total tokens`)

    const pools: Pool[] = []
    let skippedNoPool = 0
    let skippedNotMigrated = 0
    let skippedExcluded = 0

    for (const token of tokens) {
      // Skip tokens without pool address (not migrated yet)
      if (!token.pairAddress) {
        skippedNoPool++
        continue
      }

      // Skip tokens not on a DEX (not migrated) - must be on raydium or meteora
      if (!token.dex || !['raydium', 'meteora'].includes(token.dex.toLowerCase())) {
        skippedNotMigrated++
        continue
      }

      // Skip excluded tokens (stablecoins, major tokens)
      if (EXCLUDED_SYMBOLS.has(token.symbol?.toUpperCase())) {
        skippedExcluded++
        continue
      }

      // Skip tokens with no liquidity (likely dead/rugged)
      if (!token.liquidity || token.liquidity <= 0) {
        continue
      }

      pools.push({
        id: token.pairAddress,
        mintA: {
          address: token.address || "",
          symbol: token.symbol || "UNKNOWN",
          name: token.name || token.symbol || "UNKNOWN"
        },
        mintB: {
          address: USD1_MINT,
          symbol: "USD1",
          name: "USD1"
        }
      })
    }

    console.log(`[Backfill] Migrated USD1 pools: ${pools.length} (skipped: ${skippedNoPool} no pool, ${skippedNotMigrated} not migrated, ${skippedExcluded} excluded)`)

    return pools
  } catch (error) {
    console.log(`[Backfill] bonkusd1.fun API failed: ${error instanceof Error ? error.message : 'Unknown'}`)
    return []
  }
}

/**
 * Fetch ALL pools from Raydium API with pagination (like /api/tokens does)
 */
async function fetchPoolsFromRaydium(): Promise<Pool[]> {
  console.log("[Backfill] Fetching pools from Raydium...")
  const pools: Pool[] = []

  try {
    const pageSize = 500
    const maxPages = 5

    for (let page = 1; page <= maxPages; page++) {
      const url = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=${pageSize}&page=${page}`

      const response = await fetch(url, {
        headers: { Accept: "application/json" }
      })

      if (!response.ok) {
        console.log(`[Backfill] Raydium page ${page} error: ${response.status}`)
        break
      }

      const data = await response.json()
      if (!data.success || !data.data?.data) break

      const pagePools = data.data.data
      if (pagePools.length === 0) break

      for (const pool of pagePools) {
        const mintA = pool.mintA?.address
        const mintB = pool.mintB?.address
        const isAUSD1 = mintA === USD1_MINT
        const isBUSD1 = mintB === USD1_MINT

        if (!isAUSD1 && !isBUSD1) continue

        const tokenMint = isAUSD1 ? mintB : mintA
        const tokenData = isAUSD1 ? pool.mintB : pool.mintA

        if (!tokenMint || tokenMint === USD1_MINT) continue
        if (EXCLUDED_TOKENS.has(tokenMint)) continue
        if (EXCLUDED_SYMBOLS.has(tokenData?.symbol?.toUpperCase())) continue

        pools.push({
          id: pool.id,
          mintA: {
            address: tokenMint,
            symbol: tokenData?.symbol || "UNKNOWN",
            name: tokenData?.name || tokenData?.symbol || "UNKNOWN"
          },
          mintB: {
            address: USD1_MINT,
            symbol: "USD1",
            name: "USD1"
          }
        })
      }

      console.log(`[Backfill] Raydium page ${page}: ${pagePools.length} pools (total: ${pools.length})`)

      if (pagePools.length < pageSize) break
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  } catch (error) {
    console.log(`[Backfill] Raydium error: ${error instanceof Error ? error.message : 'Unknown'}`)
  }

  return pools
}

/**
 * Fetch ALL pools from multiple sources and combine them (like /api/tokens does)
 */
async function fetchPools(limit: number): Promise<Pool[]> {
  const allPools = new Map<string, Pool>()

  // Fetch from all sources in parallel
  console.log("[Backfill] Fetching from all sources in parallel...")

  const [raydiumPools, dexScreenerPools, geckoTerminalPools] = await Promise.all([
    fetchPoolsFromRaydium(),
    fetchPoolsFromDexScreener(9999),
    fetchPoolsFromGeckoTerminal(9999)
  ])

  // Add Raydium pools
  for (const pool of raydiumPools) {
    allPools.set(pool.id, pool)
  }
  console.log(`[Backfill] Raydium: ${raydiumPools.length} pools`)

  // Add DexScreener pools (dedup by pool address)
  let newFromDex = 0
  for (const pool of dexScreenerPools) {
    if (!allPools.has(pool.id)) {
      allPools.set(pool.id, pool)
      newFromDex++
    }
  }
  console.log(`[Backfill] DexScreener: ${dexScreenerPools.length} pools (${newFromDex} new)`)

  // Add GeckoTerminal pools (dedup by pool address)
  let newFromGecko = 0
  for (const pool of geckoTerminalPools) {
    if (!allPools.has(pool.id)) {
      allPools.set(pool.id, pool)
      newFromGecko++
    }
  }
  console.log(`[Backfill] GeckoTerminal: ${geckoTerminalPools.length} pools (${newFromGecko} new)`)

  const pools = Array.from(allPools.values())
  console.log(`[Backfill] Total unique pools: ${pools.length}`)

  if (pools.length === 0) {
    throw new Error("No USD1 pools found from any source")
  }

  // Apply limit if specified (0 means no limit)
  return limit > 0 ? pools.slice(0, limit) : pools
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
  const poolLimit = parseInt(searchParams.get("poolLimit") || "0") // 0 = no limit, fetch ALL pools
  const daysBack = parseInt(searchParams.get("daysBack") || "0")   // 0 = fetch ALL history

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

      // Rate limit between pools (1 second to avoid GeckoTerminal 429 errors)
      await new Promise(resolve => setTimeout(resolve, 1000))
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
    description: "Backfill ALL bonk.fun/USD1 pools from multiple sources (DexScreener + GeckoTerminal + Raydium)",
    requirements: {
      supabase: isSupabaseConfigured(),
      helius: isHeliusConfigured() ? "configured (fallback)" : "not configured (optional)"
    },
    params: {
      poolLimit: "Max pools to process. 0 = ALL pools (default: 0)",
      daysBack: "How far back to fetch. 0 = ALL history (default: 0)"
    },
    authorization: "Bearer YOUR_CRON_SECRET",
    examples: {
      fetchAll: "POST /api/backfill - Fetch ALL pools with ALL history (default)",
      limited: "POST /api/backfill?poolLimit=10&daysBack=7 - Fetch 10 pools, last 7 days"
    }
  })
}
