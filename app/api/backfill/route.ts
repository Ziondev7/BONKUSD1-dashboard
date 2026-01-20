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

// Constants - USD1 stablecoin (BONK.fun pairs)
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"

interface Pool {
  id: string
  mintA: { address: string; symbol: string; name: string }
  mintB: { address: string; symbol: string; name: string }
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

export async function POST(request: NextRequest) {
  // Verify authorization
  const authHeader = request.headers.get("authorization")
  const expectedToken = process.env.CRON_SECRET

  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Check configuration
  if (!isHeliusConfigured()) {
    return NextResponse.json(
      { error: "Helius not configured. Set HELIUS_API_KEY in environment." },
      { status: 500 }
    )
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    )
  }

  const { searchParams } = new URL(request.url)
  const poolLimit = parseInt(searchParams.get("poolLimit") || "50")
  const daysBack = parseInt(searchParams.get("daysBack") || "30")

  const startTime = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000)
  const results: { pool: string; status: string; snapshots?: number; error?: string }[] = []

  console.log(`[Backfill] Starting backfill for ${poolLimit} pools, ${daysBack} days back`)

  try {
    // Step 1: Get all BONK.fun/USD1 pools from Raydium
    // We use poolType=all to capture all pool types (CPMM, AMM, etc.)
    console.log("[Backfill] Fetching pools from Raydium...")
    const poolsUrl = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=volume24h&sortType=desc&pageSize=${poolLimit}`

    const poolsResponse = await fetchWithRetry(poolsUrl)
    const poolsData = await poolsResponse.json()

    if (!poolsData.success || !poolsData.data?.data) {
      throw new Error("Invalid response from Raydium API")
    }

    const pools: Pool[] = poolsData.data.data

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

        // Fetch historical swaps
        const swaps = await fetchAllPoolHistory(poolAddress, {
          startTime,
          onProgress: (count) => {
            console.log(`[Backfill] ${tokenSymbol}: Fetched ${count} transactions...`)
          }
        })

        if (swaps.length === 0) {
          console.log(`[Backfill] ${tokenSymbol}: No swaps found`)
          await updateSyncStatus({
            pool_address: poolAddress,
            status: 'completed',
            last_synced_timestamp: Date.now()
          })
          results.push({ pool: tokenSymbol, status: 'no_data' })
          continue
        }

        // Aggregate to hourly buckets
        const hourlyData = aggregateSwapsToHourly(swaps)

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
    description: "One-time historical data backfill",
    requirements: {
      helius: isHeliusConfigured(),
      supabase: isSupabaseConfigured()
    },
    params: {
      poolLimit: "Max pools to process (default: 50)",
      daysBack: "How far back to fetch (default: 30)"
    },
    authorization: "Bearer YOUR_CRON_SECRET"
  })
}
