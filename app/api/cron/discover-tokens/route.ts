import { NextResponse } from "next/server"
import {
  fetchBonkFunWhitelist,
  verifyPoolsViaBonkFun,
  processRetryQueue,
  getWhitelistStatus,
  getRetryQueueStatus,
} from "@/lib/bonkfun-verification"

// Configuration
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"
const MAX_NEW_TOKENS_PER_RUN = 30 // Verify max 30 new tokens per run (~15 seconds)

// Tokens to exclude
const EXCLUDED_SYMBOLS = ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"]

function shouldExclude(symbol?: string): boolean {
  if (!symbol) return false
  const s = symbol.toUpperCase()
  return EXCLUDED_SYMBOLS.some(excluded => s === excluded || s.includes(excluded))
}

/**
 * POST /api/cron/discover-tokens
 *
 * Lightweight cron job to discover new BonkFun tokens.
 * Runs every 30 minutes. Only verifies NEW tokens not in cache.
 *
 * This endpoint:
 * 1. Fetches current USD1 pools from Raydium
 * 2. Identifies tokens not in the whitelist cache
 * 3. Verifies only new tokens (limited per run)
 * 4. Processes the retry queue for failed verifications
 *
 * Headers:
 * - Authorization: Bearer <CRON_SECRET> (required in production)
 */
export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    // Verify cron secret in production
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log("[Cron:Discover] Starting new token discovery...")

    // Step 1: Get current whitelist
    const whitelist = await fetchBonkFunWhitelist()
    console.log(`[Cron:Discover] Current whitelist: ${whitelist.size} tokens`)

    // Step 2: Fetch current pools from Raydium
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(
      `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=500&page=1`,
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

    // Step 3: Find new tokens not in whitelist
    const newPools: Array<{ mint: string; poolAddress: string }> = []

    for (const pool of data.data.data) {
      const mintA = pool.mintA?.address
      const mintB = pool.mintB?.address
      const symbolA = pool.mintA?.symbol
      const symbolB = pool.mintB?.symbol

      const isAUSD1 = mintA === USD1_MINT
      const isBUSD1 = mintB === USD1_MINT

      if (!isAUSD1 && !isBUSD1) continue

      const baseMint = isAUSD1 ? mintB : mintA
      const baseSymbol = isAUSD1 ? symbolB : symbolA

      // Skip excluded tokens
      if (shouldExclude(baseSymbol)) continue

      // Skip if already in whitelist
      if (baseMint && !whitelist.has(baseMint)) {
        newPools.push({
          mint: baseMint,
          poolAddress: pool.id || ""
        })
      }
    }

    console.log(`[Cron:Discover] Found ${newPools.length} tokens not in whitelist`)

    let newTokensVerified = 0
    let retryResult = { processed: 0, verified: 0, remaining: 0 }

    if (newPools.length > 0) {
      // Step 4: Verify new tokens (limited per run)
      const toVerify = newPools.slice(0, MAX_NEW_TOKENS_PER_RUN)
      console.log(`[Cron:Discover] Verifying ${toVerify.length} new tokens...`)

      const verified = await verifyPoolsViaBonkFun(toVerify)
      newTokensVerified = verified.size - whitelist.size // Count newly added
      if (newTokensVerified < 0) newTokensVerified = 0
    }

    // Step 5: Process retry queue
    retryResult = await processRetryQueue()

    const duration = Date.now() - startTime

    console.log(`[Cron:Discover] Completed in ${duration}ms: ${newTokensVerified} new tokens verified, ${retryResult.verified} retries succeeded`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      newTokens: {
        found: newPools.length,
        checked: Math.min(newPools.length, MAX_NEW_TOKENS_PER_RUN),
        verified: newTokensVerified,
        pending: Math.max(0, newPools.length - MAX_NEW_TOKENS_PER_RUN),
      },
      retryQueue: {
        processed: retryResult.processed,
        verified: retryResult.verified,
        remaining: retryResult.remaining,
      },
      whitelist: {
        total: whitelist.size + newTokensVerified + retryResult.verified,
      },
    })
  } catch (error) {
    console.error("[Cron:Discover] Error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        duration: `${Date.now() - startTime}ms`,
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/cron/discover-tokens
 *
 * Get discovery status and whitelist info
 */
export async function GET() {
  try {
    const whitelistStatus = getWhitelistStatus()
    const retryQueueStatus = getRetryQueueStatus()

    return NextResponse.json({
      status: "ready",
      whitelist: {
        loaded: whitelistStatus.loaded,
        tokenCount: whitelistStatus.tokenCount,
        source: whitelistStatus.source,
        ageMinutes: Math.round(whitelistStatus.ageMs / 60000),
        isStale: whitelistStatus.isStale,
      },
      retryQueue: retryQueueStatus,
      schedule: "Every 30 minutes",
      maxTokensPerRun: MAX_NEW_TOKENS_PER_RUN,
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
