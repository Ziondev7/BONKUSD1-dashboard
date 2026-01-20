import { NextResponse } from "next/server"
import { saveVolumeSnapshot, getStorageStatus } from "@/lib/volume-store"
import {
  isSupabaseConfigured,
  upsertVolumeSnapshots,
  getPoolsToSync,
  updateSyncStatus,
  registerPool
} from "@/lib/supabase"
import { isHeliusConfigured, getRecentSwaps, aggregateSwapsToHourly } from "@/lib/helius"

const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"
const EXCLUDED_SYMBOLS = ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"]

// Cron secret for authentication (set in Vercel environment variables)
const CRON_SECRET = process.env.CRON_SECRET

async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response> {
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

interface PoolData {
  poolId: string
  tokenMint: string
  tokenSymbol: string
  tokenName: string
  volume24h: number
  liquidity: number
}

/**
 * Fetch current volume metrics from all USD1 pools
 */
async function fetchCurrentMetrics(): Promise<{
  totalVolume24h: number
  totalLiquidity: number
  poolCount: number
  pools: PoolData[]
}> {
  let totalVolume24h = 0
  let totalLiquidity = 0
  const poolMap = new Map<string, PoolData>()

  try {
    const pageSize = 500
    const maxPages = 5

    // Fetch first page
    const firstPageUrl = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=${pageSize}&page=1`
    const firstResponse = await fetchWithTimeout(firstPageUrl)

    if (!firstResponse.ok) {
      throw new Error(`Raydium API error: ${firstResponse.status}`)
    }

    const firstJson = await firstResponse.json()
    if (!firstJson.success || !firstJson.data?.data) {
      throw new Error("Invalid Raydium response")
    }

    const processPool = (pool: any) => {
      const mintA = pool.mintA?.address
      const mintB = pool.mintB?.address
      const symbolA = pool.mintA?.symbol
      const symbolB = pool.mintB?.symbol
      const nameA = pool.mintA?.name
      const nameB = pool.mintB?.name

      const isAUSD1 = mintA === USD1_MINT
      const isBUSD1 = mintB === USD1_MINT

      if (!isAUSD1 && !isBUSD1) return

      const pairedSymbol = isAUSD1 ? symbolB : symbolA
      const pairedMint = isAUSD1 ? mintB : mintA
      const pairedName = isAUSD1 ? nameB : nameA

      if (shouldExclude(pairedSymbol)) return

      const volume24h = pool.day?.volume || 0
      const liquidity = pool.tvl || 0

      // Track unique pools by paired mint, keep highest volume
      const existing = poolMap.get(pairedMint)
      if (!existing || volume24h > existing.volume24h) {
        poolMap.set(pairedMint, {
          poolId: pool.id,
          tokenMint: pairedMint,
          tokenSymbol: pairedSymbol || "Unknown",
          tokenName: pairedName || pairedSymbol || "Unknown",
          volume24h,
          liquidity,
        })
      }
    }

    // Process first page
    firstJson.data.data.forEach(processPool)

    const totalCount = firstJson.data.count || firstJson.data.data.length
    const totalPages = Math.min(Math.ceil(totalCount / pageSize), maxPages)

    // Fetch remaining pages in parallel
    if (totalPages > 1 && firstJson.data.data.length >= pageSize) {
      const pagePromises = []
      for (let page = 2; page <= totalPages; page++) {
        const url = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=${pageSize}&page=${page}`
        pagePromises.push(
          fetchWithTimeout(url, 8000)
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
        )
      }

      const results = await Promise.all(pagePromises)
      results.forEach(json => {
        if (json?.success && json.data?.data) {
          json.data.data.forEach(processPool)
        }
      })
    }

    // Calculate totals
    const pools = Array.from(poolMap.values())
    pools.forEach(pool => {
      totalVolume24h += pool.volume24h
      totalLiquidity += pool.liquidity
    })

    return {
      totalVolume24h,
      totalLiquidity,
      poolCount: pools.length,
      pools,
    }
  } catch (error) {
    console.error("[Cron] Error fetching metrics:", error)
    throw error
  }
}

/**
 * Store hourly snapshot in Supabase
 */
async function storeSupabaseSnapshot(pools: PoolData[]): Promise<number> {
  if (!isSupabaseConfigured()) return 0

  const now = Date.now()
  const hourTimestamp = Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000)

  // Convert to volume snapshots
  const snapshots = pools
    .filter(p => p.volume24h > 0)
    .map(p => ({
      pool_address: p.poolId,
      token_mint: p.tokenMint,
      token_symbol: p.tokenSymbol,
      timestamp: hourTimestamp,
      // Divide 24h volume by 24 to estimate hourly volume
      volume_usd: p.volume24h / 24,
      trades: 0, // We don't have trade count from Raydium
    }))

  if (snapshots.length === 0) return 0

  const success = await upsertVolumeSnapshots(snapshots)
  return success ? snapshots.length : 0
}

/**
 * Incremental sync using Helius for recent transactions
 */
async function incrementalSync(): Promise<{ synced: number; errors: number }> {
  if (!isHeliusConfigured() || !isSupabaseConfigured()) {
    return { synced: 0, errors: 0 }
  }

  const poolsToSync = await getPoolsToSync()
  let synced = 0
  let errors = 0

  for (const pool of poolsToSync.slice(0, 5)) { // Process max 5 pools per cron run
    try {
      await updateSyncStatus({
        pool_address: pool.pool_address,
        status: 'syncing'
      })

      // Get swaps since last sync
      const swaps = await getRecentSwaps(pool.pool_address, pool.last_synced_timestamp)

      if (swaps.length > 0) {
        // Aggregate to hourly
        const hourly = aggregateSwapsToHourly(swaps)

        // Store in database
        const snapshots = hourly.map(h => ({
          pool_address: pool.pool_address,
          token_mint: '', // Would need to look this up
          token_symbol: '',
          timestamp: h.timestamp,
          volume_usd: h.volume,
          trades: h.trades,
        }))

        await upsertVolumeSnapshots(snapshots)
      }

      await updateSyncStatus({
        pool_address: pool.pool_address,
        status: 'completed',
        last_synced_timestamp: Date.now()
      })

      synced++
    } catch (error) {
      console.error(`[Cron] Sync error for ${pool.pool_address}:`, error)
      await updateSyncStatus({
        pool_address: pool.pool_address,
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error'
      })
      errors++
    }
  }

  return { synced, errors }
}

/**
 * POST handler for cron job
 */
export async function POST(request: Request) {
  // Verify cron secret if configured
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization")
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    console.log("[Cron] Starting volume snapshot...")

    // Fetch current metrics from Raydium
    const metrics = await fetchCurrentMetrics()

    // Strategy 1: Store in Supabase (if configured)
    let supabaseSnapshots = 0
    if (isSupabaseConfigured()) {
      supabaseSnapshots = await storeSupabaseSnapshot(metrics.pools)
      console.log(`[Cron] Stored ${supabaseSnapshots} snapshots in Supabase`)
    }

    // Strategy 2: Run incremental Helius sync (if configured)
    let heliusSync = { synced: 0, errors: 0 }
    if (isHeliusConfigured() && isSupabaseConfigured()) {
      heliusSync = await incrementalSync()
      console.log(`[Cron] Helius sync: ${heliusSync.synced} pools, ${heliusSync.errors} errors`)
    }

    // Strategy 3: Save to Vercel KV / in-memory (fallback)
    await saveVolumeSnapshot({
      timestamp: Date.now(),
      totalVolume24h: metrics.totalVolume24h,
      totalLiquidity: metrics.totalLiquidity,
      poolCount: metrics.poolCount,
    })

    // Get storage status
    const status = await getStorageStatus()

    console.log(`[Cron] Snapshot complete: $${metrics.totalVolume24h.toLocaleString()} volume, ${metrics.poolCount} pools`)

    return NextResponse.json({
      success: true,
      snapshot: {
        timestamp: Date.now(),
        totalVolume24h: metrics.totalVolume24h,
        totalLiquidity: metrics.totalLiquidity,
        poolCount: metrics.poolCount,
      },
      supabase: {
        configured: isSupabaseConfigured(),
        snapshots: supabaseSnapshots,
      },
      helius: {
        configured: isHeliusConfigured(),
        ...heliusSync,
      },
      storage: status,
    })
  } catch (error) {
    console.error("[Cron] Snapshot failed:", error)
    return NextResponse.json(
      { error: "Failed to save snapshot", details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET handler for manual trigger and status check
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const action = url.searchParams.get("action")

  // Status check
  if (action === "status") {
    const status = await getStorageStatus()
    return NextResponse.json({
      status: "ok",
      supabase: isSupabaseConfigured(),
      helius: isHeliusConfigured(),
      storage: status,
    })
  }

  // Manual trigger (requires secret or dev mode)
  if (action === "trigger") {
    const secret = url.searchParams.get("secret")
    const isDev = process.env.NODE_ENV === "development"

    if (!isDev && secret !== CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
      const metrics = await fetchCurrentMetrics()

      // Store in Supabase
      let supabaseSnapshots = 0
      if (isSupabaseConfigured()) {
        supabaseSnapshots = await storeSupabaseSnapshot(metrics.pools)
      }

      // Fallback storage
      await saveVolumeSnapshot({
        timestamp: Date.now(),
        totalVolume24h: metrics.totalVolume24h,
        totalLiquidity: metrics.totalLiquidity,
        poolCount: metrics.poolCount,
      })

      const status = await getStorageStatus()

      return NextResponse.json({
        success: true,
        snapshot: {
          timestamp: Date.now(),
          ...metrics,
          pools: undefined, // Don't include full pool list in response
        },
        supabase: {
          configured: isSupabaseConfigured(),
          snapshots: supabaseSnapshots,
        },
        storage: status,
      })
    } catch (error) {
      return NextResponse.json(
        { error: "Failed to save snapshot", details: String(error) },
        { status: 500 }
      )
    }
  }

  // Default: return status and docs
  const status = await getStorageStatus()
  return NextResponse.json({
    endpoint: "/api/cron/volume-snapshot",
    description: "Volume snapshot cron endpoint for BONK.fun/USD1 ecosystem",
    configuration: {
      supabase: isSupabaseConfigured(),
      helius: isHeliusConfigured(),
    },
    usage: {
      "POST with Bearer token": "Trigger snapshot (for Vercel Cron)",
      "GET ?action=status": "Check storage and configuration status",
      "GET ?action=trigger&secret=<CRON_SECRET>": "Manual trigger",
    },
    storage: status,
  })
}

// Enable edge runtime for better performance
export const runtime = "edge"
