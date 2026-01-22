import { NextResponse } from "next/server"
import {
  clearVerificationCaches,
  getWhitelistStatus,
  getRetryQueueStatus,
} from "@/lib/bonkfun-verification"

/**
 * POST /api/cache/clear
 *
 * Clear the BonkFun verification cache to start fresh.
 * Use this after deploying new verification logic.
 *
 * Headers:
 * - Authorization: Bearer <CRON_SECRET> (required in production)
 */
export async function POST(request: Request) {
  try {
    // Verify authorization
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log("[Cache] Clearing all verification caches...")

    // Get status before clearing
    const beforeStatus = getWhitelistStatus()
    const beforeRetry = getRetryQueueStatus()

    // Clear all caches (in-memory and KV)
    await clearVerificationCaches()

    console.log("[Cache] All caches cleared successfully")

    return NextResponse.json({
      success: true,
      message: "All verification caches cleared",
      cleared: {
        whitelistTokens: beforeStatus.tokenCount,
        retryQueueItems: beforeRetry.size,
        source: beforeStatus.source,
      },
      note: "New tokens will be verified on next API request or cron run",
    })
  } catch (error) {
    console.error("[Cache] Error clearing cache:", error)
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
 * GET /api/cache/clear
 *
 * Get current cache status
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
      actions: {
        clear: "POST /api/cache/clear with Authorization header",
      },
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
