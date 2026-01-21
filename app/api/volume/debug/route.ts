import { NextResponse } from "next/server"
import {
  getAllDailyVolume,
  getDailyVolumeStats,
} from "@/lib/volume-store"

/**
 * GET /api/volume/debug
 *
 * Debug endpoint to see raw stored volume data
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

    return NextResponse.json({
      stats,
      summary: {
        totalDays: allData.length,
        totalVolume: totalVolume,
        totalVolumeFormatted: `$${(totalVolume / 1_000_000_000).toFixed(2)}B`,
        avgDailyVolume: Math.round(avgDailyVolume),
        avgDailyVolumeFormatted: `$${(avgDailyVolume / 1_000_000).toFixed(2)}M`,
        highVolumeDaysCount: highVolumeDays.length,
      },
      sampleData: {
        firstDays: firstDays.map(d => ({
          date: d.date,
          volume: d.volume,
          volumeFormatted: `$${(d.volume / 1_000_000).toFixed(2)}M`,
          trades: d.trades,
          uniqueTokens: d.uniqueTokens,
          source: d.source,
        })),
        lastDays: lastDays.map(d => ({
          date: d.date,
          volume: d.volume,
          volumeFormatted: `$${(d.volume / 1_000_000).toFixed(2)}M`,
          trades: d.trades,
          uniqueTokens: d.uniqueTokens,
          source: d.source,
        })),
        highVolumeDays: highVolumeDays.map(d => ({
          date: d.date,
          volume: d.volume,
          volumeFormatted: `$${(d.volume / 1_000_000).toFixed(2)}M`,
          trades: d.trades,
          uniqueTokens: d.uniqueTokens,
        })),
      },
      message: highVolumeDays.length > 10
        ? "WARNING: Many days with >$100M volume - data may include non-BonkFun tokens"
        : "Data looks reasonable for BonkFun-only volume"
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
