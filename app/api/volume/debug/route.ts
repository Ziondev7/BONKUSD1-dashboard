import { NextResponse } from "next/server"
import {
  getAllDailyVolume,
  getDailyVolumeStats,
} from "@/lib/volume-store"

/**
 * Validate if a timestamp is reasonable (2024-2030)
 */
function isValidTimestamp(timestamp: number): boolean {
  if (!timestamp || typeof timestamp !== "number" || isNaN(timestamp)) {
    return false
  }
  const minDate = new Date("2024-01-01").getTime()
  const maxDate = new Date("2030-01-01").getTime()
  return timestamp >= minDate && timestamp <= maxDate
}

/**
 * GET /api/volume/debug
 *
 * Debug endpoint to see raw stored volume data and diagnose issues
 */
export async function GET() {
  try {
    const stats = await getDailyVolumeStats()
    const allData = await getAllDailyVolume()

    // Calculate totals
    const totalVolume = allData.reduce((sum, d) => sum + d.volume, 0)
    const avgDailyVolume = allData.length > 0 ? totalVolume / allData.length : 0

    // Get sample data (first 5 and last 5 days)
    const firstDays = allData.slice(0, 5)
    const lastDays = allData.slice(-5)

    // Check for suspiciously high volumes (> $100M per day)
    const highVolumeDays = allData.filter(d => d.volume > 100_000_000)

    // Check for timestamp issues
    const invalidTimestamps = allData.filter(d => !isValidTimestamp(d.timestamp))
    const validTimestamps = allData.filter(d => isValidTimestamp(d.timestamp))

    // Format data for display
    const formatDay = (d: any) => ({
      date: d.date,
      timestamp: d.timestamp,
      timestampFormatted: isValidTimestamp(d.timestamp)
        ? new Date(d.timestamp).toISOString()
        : "INVALID",
      volume: d.volume,
      volumeFormatted: `$${(d.volume / 1_000_000).toFixed(2)}M`,
      trades: d.trades,
      uniqueTokens: d.uniqueTokens,
      source: d.source,
    })

    const issues: string[] = []
    if (invalidTimestamps.length > 0) {
      issues.push(`${invalidTimestamps.length} records have invalid timestamps - need to re-seed`)
    }
    if (highVolumeDays.length > 10) {
      issues.push("Many days with >$100M volume - data may include non-BonkFun tokens")
    }
    if (allData.length === 0) {
      issues.push("No data in KV store - need to seed with POST /api/volume/seed")
    }

    return NextResponse.json({
      stats,
      summary: {
        totalDays: allData.length,
        validDays: validTimestamps.length,
        invalidDays: invalidTimestamps.length,
        totalVolume: totalVolume,
        totalVolumeFormatted: `$${(totalVolume / 1_000_000_000).toFixed(2)}B`,
        avgDailyVolume: Math.round(avgDailyVolume),
        avgDailyVolumeFormatted: `$${(avgDailyVolume / 1_000_000).toFixed(2)}M`,
        highVolumeDaysCount: highVolumeDays.length,
      },
      sampleData: {
        firstDays: firstDays.map(formatDay),
        lastDays: lastDays.map(formatDay),
        invalidTimestamps: invalidTimestamps.slice(0, 5).map(formatDay),
        highVolumeDays: highVolumeDays.slice(0, 5).map(formatDay),
      },
      issues,
      status: issues.length === 0 ? "OK" : "NEEDS_ATTENTION",
      recommendation: invalidTimestamps.length > 0
        ? "Re-seed with POST /api/volume/seed?force=true to fix invalid timestamps"
        : issues.length > 0
          ? "Review the issues above"
          : "Data looks good",
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
