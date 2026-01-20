import { NextResponse } from "next/server"
import { saveVolumeSnapshot, getStorageStatus } from "@/lib/volume-store"

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

/**
 * Fetch current volume metrics from all USD1 pools
 */
async function fetchCurrentMetrics(): Promise<{
  totalVolume24h: number
  totalLiquidity: number
  poolCount: number
}> {
  let totalVolume24h = 0
  let totalLiquidity = 0
  const uniquePools = new Set<string>()

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

      const isAUSD1 = mintA === USD1_MINT
      const isBUSD1 = mintB === USD1_MINT

      if (!isAUSD1 && !isBUSD1) return

      const pairedSymbol = isAUSD1 ? symbolB : symbolA
      const pairedMint = isAUSD1 ? mintB : mintA

      if (shouldExclude(pairedSymbol)) return

      // Track unique pools by paired mint
      if (!uniquePools.has(pairedMint)) {
        uniquePools.add(pairedMint)
        totalVolume24h += pool.day?.volume || 0
        totalLiquidity += pool.tvl || 0
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
  } catch (error) {
    console.error("[Cron] Error fetching metrics:", error)
    throw error
  }

  return {
    totalVolume24h,
    totalLiquidity,
    poolCount: uniquePools.size,
  }
}

/**
 * POST handler for cron job
 * Can be triggered by:
 * - Vercel Cron (vercel.json config)
 * - External cron services (e.g., cron-job.org)
 * - Manual API call with CRON_SECRET
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

    // Fetch current metrics
    const metrics = await fetchCurrentMetrics()

    // Save snapshot
    await saveVolumeSnapshot({
      timestamp: Date.now(),
      totalVolume24h: metrics.totalVolume24h,
      totalLiquidity: metrics.totalLiquidity,
      poolCount: metrics.poolCount,
    })

    // Get storage status for logging
    const status = await getStorageStatus()

    console.log(`[Cron] Snapshot saved: $${metrics.totalVolume24h.toLocaleString()} volume, ${metrics.poolCount} pools`)

    return NextResponse.json({
      success: true,
      snapshot: {
        timestamp: Date.now(),
        totalVolume24h: metrics.totalVolume24h,
        totalLiquidity: metrics.totalLiquidity,
        poolCount: metrics.poolCount,
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

    // Trigger the POST handler logic
    try {
      const metrics = await fetchCurrentMetrics()
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

  // Default: return status
  const status = await getStorageStatus()
  return NextResponse.json({
    endpoint: "/api/cron/volume-snapshot",
    description: "Volume snapshot cron endpoint for BONK.fun/USD1 ecosystem",
    usage: {
      "POST with Bearer token": "Trigger snapshot (for Vercel Cron)",
      "GET ?action=status": "Check storage status",
      "GET ?action=trigger&secret=<CRON_SECRET>": "Manual trigger",
    },
    storage: status,
  })
}

// Enable edge runtime for better performance
export const runtime = "edge"
