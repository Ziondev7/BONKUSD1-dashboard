import { NextResponse } from "next/server"
import {
  saveDailyVolume,
  hasDailyVolumeForDate,
  getDailyVolumeStats,
  DailyVolumeData,
} from "@/lib/volume-store"

// Raydium API configuration
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"

// Tokens to exclude (stablecoins, major tokens - not BONK.fun launched)
const EXCLUDED_SYMBOLS = ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"]

function shouldExclude(symbol?: string): boolean {
  if (!symbol) return false
  const s = symbol.toUpperCase()
  return EXCLUDED_SYMBOLS.some(excluded => s === excluded || s.includes(excluded))
}

/**
 * Fetch total 24h volume from Raydium for all BonkFun/USD1 pools
 */
async function fetchRaydiumVolume(): Promise<{
  volume24h: number
  poolCount: number
  uniqueTokens: number
}> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(
      `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=volume&sortType=desc&pageSize=500&page=1`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      }
    )

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Raydium API error: ${response.status}`)
    }

    const data = await response.json()

    if (!data.success || !data.data?.data) {
      throw new Error("Invalid Raydium response")
    }

    let totalVolume = 0
    const uniqueTokens = new Set<string>()
    let poolCount = 0

    for (const pool of data.data.data) {
      const mintA = pool.mintA?.address
      const mintB = pool.mintB?.address
      const symbolA = pool.mintA?.symbol
      const symbolB = pool.mintB?.symbol

      const isAUSD1 = mintA === USD1_MINT
      const isBUSD1 = mintB === USD1_MINT

      if (!isAUSD1 && !isBUSD1) continue

      const pairedSymbol = isAUSD1 ? symbolB : symbolA
      const pairedMint = isAUSD1 ? mintB : mintA

      // Exclude non-BONK.fun tokens
      if (shouldExclude(pairedSymbol)) continue

      const volume24h = pool.day?.volume || 0
      totalVolume += volume24h
      poolCount++

      if (pairedMint) {
        uniqueTokens.add(pairedMint)
      }
    }

    return {
      volume24h: Math.round(totalVolume),
      poolCount,
      uniqueTokens: uniqueTokens.size,
    }
  } catch (error) {
    console.error("[Cron] Error fetching Raydium volume:", error)
    throw error
  }
}

/**
 * Get yesterday's date string in YYYY-MM-DD format (UTC)
 */
function getYesterdayDate(): string {
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  return yesterday.toISOString().split("T")[0]
}

/**
 * Get today's date string in YYYY-MM-DD format (UTC)
 */
function getTodayDate(): string {
  return new Date().toISOString().split("T")[0]
}

/**
 * POST /api/cron/sync-volume
 *
 * Daily cron job to sync volume data to KV.
 * Should be called daily after midnight UTC (e.g., at 00:05 UTC).
 *
 * This endpoint:
 * 1. Checks if yesterday's volume is already recorded
 * 2. If not, fetches current 24h volume from Raydium
 * 3. Saves it as yesterday's final volume
 *
 * Query params:
 * - date=YYYY-MM-DD: Manually sync a specific date
 * - force=true: Force re-sync even if data exists
 *
 * Headers:
 * - Authorization: Bearer <CRON_SECRET> (required in production)
 */
export async function POST(request: Request) {
  try {
    // Verify cron secret in production
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const targetDate = url.searchParams.get("date") || getYesterdayDate()
    const force = url.searchParams.get("force") === "true"

    console.log(`[Cron] Syncing volume for date: ${targetDate}`)

    // Check if we already have data for this date
    const hasData = await hasDailyVolumeForDate(targetDate)

    if (hasData && !force) {
      console.log(`[Cron] Data already exists for ${targetDate}, skipping`)
      return NextResponse.json({
        success: true,
        message: "Data already exists for this date",
        date: targetDate,
        skipped: true,
      })
    }

    // Fetch current 24h volume from Raydium
    console.log("[Cron] Fetching volume from Raydium...")
    const { volume24h, poolCount, uniqueTokens } = await fetchRaydiumVolume()

    console.log(`[Cron] Volume: $${volume24h.toLocaleString()}, Pools: ${poolCount}, Tokens: ${uniqueTokens}`)

    // Save to KV
    const dailyData: DailyVolumeData = {
      date: targetDate,
      timestamp: new Date(targetDate + "T00:00:00Z").getTime(),
      volume: volume24h,
      trades: 0, // Not available from Raydium
      uniqueTokens,
      source: "cron",
    }

    const saved = await saveDailyVolume(dailyData)

    if (!saved) {
      throw new Error("Failed to save to KV")
    }

    console.log(`[Cron] Successfully saved volume for ${targetDate}`)

    // Get updated stats
    const stats = await getDailyVolumeStats()

    return NextResponse.json({
      success: true,
      message: `Synced volume for ${targetDate}`,
      data: dailyData,
      stats,
    })
  } catch (error) {
    console.error("[Cron] Error:", error)
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
 * GET /api/cron/sync-volume
 *
 * Get sync status and next scheduled sync info
 */
export async function GET() {
  try {
    const stats = await getDailyVolumeStats()
    const yesterday = getYesterdayDate()
    const today = getTodayDate()
    const hasYesterday = await hasDailyVolumeForDate(yesterday)

    return NextResponse.json({
      status: "ready",
      stats,
      dates: {
        today,
        yesterday,
        hasYesterdayData: hasYesterday,
      },
      nextSync: hasYesterday
        ? "Tomorrow after midnight UTC"
        : "Ready to sync now",
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
