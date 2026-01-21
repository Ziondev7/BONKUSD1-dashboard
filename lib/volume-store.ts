/**
 * Volume Snapshot Storage Layer
 *
 * This module provides a storage abstraction for volume snapshots.
 * It works with in-memory storage by default but can be upgraded to
 * Vercel KV for persistent storage across deployments.
 *
 * To enable Vercel KV:
 * 1. Run: npx vercel env pull .env.development.local
 * 2. Install: npm install @vercel/kv
 * 3. The module will auto-detect KV credentials in environment
 */

export interface VolumeSnapshot {
  timestamp: number
  totalVolume24h: number
  totalLiquidity: number
  poolCount: number
}

/**
 * Daily volume data stored in KV for historical tracking
 * This is the primary format for persistent storage
 */
export interface DailyVolumeData {
  date: string // YYYY-MM-DD format
  timestamp: number // Start of day timestamp (UTC)
  volume: number // Total USD volume for the day
  trades: number // Number of trades
  uniqueTokens: number // Number of unique tokens traded
  source: "dune" | "raydium" | "cron" // Data source
}

export interface VolumeStoreConfig {
  maxSnapshots: number
  snapshotIntervalMs: number
}

const DEFAULT_CONFIG: VolumeStoreConfig = {
  maxSnapshots: 720, // 30 days of hourly snapshots
  snapshotIntervalMs: 60 * 60 * 1000, // 1 hour
}

// In-memory storage (works without Vercel KV)
const memoryStore: VolumeSnapshot[] = []

// Type for Vercel KV module
interface KVModule {
  kv: {
    zrange: (key: string, start: number, end: number, options?: { byScore?: boolean }) => Promise<string[] | null>
    zadd: (key: string, member: { score: number; member: string }) => Promise<number>
    zcard: (key: string) => Promise<number>
    zremrangebyrank: (key: string, start: number, end: number) => Promise<number>
  }
}

/**
 * Dynamically load Vercel KV if available
 */
async function getKV(): Promise<KVModule["kv"] | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null
  }

  try {
    // Dynamic import with type assertion
    const kvModule = await import("@vercel/kv") as unknown as KVModule
    return kvModule.kv
  } catch {
    return null
  }
}

/**
 * Get all volume snapshots for a time period
 */
export async function getVolumeSnapshots(
  fromTimestamp: number,
  toTimestamp: number = Date.now()
): Promise<VolumeSnapshot[]> {
  const kv = await getKV()

  if (kv) {
    try {
      const snapshots = await kv.zrange(
        "volume:snapshots",
        fromTimestamp,
        toTimestamp,
        { byScore: true }
      )
      if (snapshots && Array.isArray(snapshots)) {
        return snapshots.map((s) => (typeof s === "string" ? JSON.parse(s) : s) as VolumeSnapshot)
      }
      return []
    } catch (error) {
      console.error("[VolumeStore] KV error, falling back to memory:", error)
    }
  }

  // Fallback to memory store
  return memoryStore.filter(
    (s) => s.timestamp >= fromTimestamp && s.timestamp <= toTimestamp
  )
}

/**
 * Save a volume snapshot
 */
export async function saveVolumeSnapshot(snapshot: VolumeSnapshot): Promise<void> {
  const config = DEFAULT_CONFIG

  // Round timestamp to nearest hour for consistency
  const hourTimestamp =
    Math.floor(snapshot.timestamp / config.snapshotIntervalMs) * config.snapshotIntervalMs

  const normalizedSnapshot: VolumeSnapshot = {
    ...snapshot,
    timestamp: hourTimestamp,
  }

  const kv = await getKV()

  if (kv) {
    try {
      // Use sorted set with timestamp as score for efficient range queries
      await kv.zadd("volume:snapshots", {
        score: hourTimestamp,
        member: JSON.stringify(normalizedSnapshot),
      })

      // Trim old snapshots (keep only last maxSnapshots)
      const count = await kv.zcard("volume:snapshots")
      if (count > config.maxSnapshots) {
        await kv.zremrangebyrank("volume:snapshots", 0, count - config.maxSnapshots - 1)
      }

      return
    } catch (error) {
      console.error("[VolumeStore] KV save error, falling back to memory:", error)
    }
  }

  // Fallback to memory store
  const existingIndex = memoryStore.findIndex(
    (s) => Math.abs(s.timestamp - hourTimestamp) < config.snapshotIntervalMs / 2
  )

  if (existingIndex >= 0) {
    // Update existing snapshot if new data has higher volume
    if (normalizedSnapshot.totalVolume24h > memoryStore[existingIndex].totalVolume24h) {
      memoryStore[existingIndex] = normalizedSnapshot
    }
  } else {
    // Add new snapshot
    memoryStore.push(normalizedSnapshot)

    // Sort by timestamp
    memoryStore.sort((a, b) => a.timestamp - b.timestamp)

    // Trim old snapshots
    while (memoryStore.length > config.maxSnapshots) {
      memoryStore.shift()
    }
  }
}

/**
 * Get the latest volume snapshot
 */
export async function getLatestSnapshot(): Promise<VolumeSnapshot | null> {
  const kv = await getKV()

  if (kv) {
    try {
      const snapshots = await kv.zrange("volume:snapshots", -1, -1)
      if (snapshots && snapshots.length > 0) {
        const parsed = typeof snapshots[0] === "string" ? JSON.parse(snapshots[0]) : snapshots[0]
        return parsed as VolumeSnapshot
      }
      return null
    } catch (error) {
      console.error("[VolumeStore] KV error, falling back to memory:", error)
    }
  }

  // Fallback to memory store
  return memoryStore[memoryStore.length - 1] || null
}

/**
 * Get aggregated volume for a time period
 */
export async function getAggregatedVolume(
  period: "24h" | "7d" | "30d" | "all"
): Promise<{
  totalVolume: number
  avgVolume: number
  peakVolume: number
  lowVolume: number
  snapshotCount: number
}> {
  const now = Date.now()
  let fromTimestamp: number

  switch (period) {
    case "24h":
      fromTimestamp = now - 24 * 60 * 60 * 1000
      break
    case "7d":
      fromTimestamp = now - 7 * 24 * 60 * 60 * 1000
      break
    case "30d":
      fromTimestamp = now - 30 * 24 * 60 * 60 * 1000
      break
    case "all":
      fromTimestamp = 0
      break
  }

  const snapshots = await getVolumeSnapshots(fromTimestamp, now)

  if (snapshots.length === 0) {
    return {
      totalVolume: 0,
      avgVolume: 0,
      peakVolume: 0,
      lowVolume: 0,
      snapshotCount: 0,
    }
  }

  const volumes = snapshots.map((s) => s.totalVolume24h)
  const totalVolume = volumes.reduce((sum, v) => sum + v, 0)

  return {
    totalVolume,
    avgVolume: totalVolume / volumes.length,
    peakVolume: Math.max(...volumes),
    lowVolume: Math.min(...volumes.filter((v) => v > 0)),
    snapshotCount: snapshots.length,
  }
}

/**
 * Check if Vercel KV is configured
 */
export function isKVConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

/**
 * Get storage status for debugging
 */
export async function getStorageStatus(): Promise<{
  type: "vercel-kv" | "memory"
  snapshotCount: number
  oldestTimestamp: number | null
  newestTimestamp: number | null
}> {
  const kv = await getKV()

  if (kv) {
    try {
      const count = await kv.zcard("volume:snapshots")
      const oldest = await kv.zrange("volume:snapshots", 0, 0)
      const newest = await kv.zrange("volume:snapshots", -1, -1)

      const oldestParsed = oldest?.[0] ? (typeof oldest[0] === "string" ? JSON.parse(oldest[0]) : oldest[0]) as VolumeSnapshot : null
      const newestParsed = newest?.[0] ? (typeof newest[0] === "string" ? JSON.parse(newest[0]) : newest[0]) as VolumeSnapshot : null

      return {
        type: "vercel-kv",
        snapshotCount: count,
        oldestTimestamp: oldestParsed?.timestamp || null,
        newestTimestamp: newestParsed?.timestamp || null,
      }
    } catch {
      // Fall through to memory
    }
  }

  return {
    type: "memory",
    snapshotCount: memoryStore.length,
    oldestTimestamp: memoryStore[0]?.timestamp || null,
    newestTimestamp: memoryStore[memoryStore.length - 1]?.timestamp || null,
  }
}

// ============================================
// DAILY VOLUME STORAGE (Persistent Historical Data)
// ============================================

// In-memory fallback for daily volume data
const dailyVolumeMemoryStore: DailyVolumeData[] = []

const DAILY_VOLUME_KEY = "volume:daily"

/**
 * Save daily volume data to KV storage
 * Uses date as the unique key to prevent duplicates
 */
export async function saveDailyVolume(data: DailyVolumeData): Promise<boolean> {
  const kv = await getKV()

  if (kv) {
    try {
      await kv.zadd(DAILY_VOLUME_KEY, {
        score: data.timestamp,
        member: JSON.stringify(data),
      })
      return true
    } catch (error) {
      console.error("[VolumeStore] KV error saving daily volume:", error)
    }
  }

  // Fallback to memory
  const existingIndex = dailyVolumeMemoryStore.findIndex(d => d.date === data.date)
  if (existingIndex >= 0) {
    dailyVolumeMemoryStore[existingIndex] = data
  } else {
    dailyVolumeMemoryStore.push(data)
    dailyVolumeMemoryStore.sort((a, b) => a.timestamp - b.timestamp)
  }
  return true
}

/**
 * Bulk save daily volume data (for seeding from Dune)
 */
export async function bulkSaveDailyVolume(dataArray: DailyVolumeData[]): Promise<{
  success: boolean
  saved: number
  errors: number
}> {
  const kv = await getKV()
  let saved = 0
  let errors = 0

  if (kv) {
    // Use pipeline for bulk operations
    for (const data of dataArray) {
      try {
        await kv.zadd(DAILY_VOLUME_KEY, {
          score: data.timestamp,
          member: JSON.stringify(data),
        })
        saved++
      } catch (error) {
        console.error(`[VolumeStore] Error saving ${data.date}:`, error)
        errors++
      }
    }
    return { success: errors === 0, saved, errors }
  }

  // Fallback to memory
  for (const data of dataArray) {
    const existingIndex = dailyVolumeMemoryStore.findIndex(d => d.date === data.date)
    if (existingIndex >= 0) {
      dailyVolumeMemoryStore[existingIndex] = data
    } else {
      dailyVolumeMemoryStore.push(data)
    }
    saved++
  }
  dailyVolumeMemoryStore.sort((a, b) => a.timestamp - b.timestamp)

  return { success: true, saved, errors: 0 }
}

/**
 * Get daily volume data for a date range
 */
export async function getDailyVolume(
  fromDate: string, // YYYY-MM-DD
  toDate?: string // YYYY-MM-DD, defaults to today
): Promise<DailyVolumeData[]> {
  const fromTimestamp = new Date(fromDate + "T00:00:00Z").getTime()
  const toTimestamp = toDate
    ? new Date(toDate + "T23:59:59Z").getTime()
    : Date.now()

  const kv = await getKV()

  if (kv) {
    try {
      const results = await kv.zrange(
        DAILY_VOLUME_KEY,
        fromTimestamp,
        toTimestamp,
        { byScore: true }
      )

      if (results && Array.isArray(results)) {
        return results.map(r =>
          (typeof r === "string" ? JSON.parse(r) : r) as DailyVolumeData
        )
      }
      return []
    } catch (error) {
      console.error("[VolumeStore] KV error fetching daily volume:", error)
    }
  }

  // Fallback to memory
  return dailyVolumeMemoryStore.filter(
    d => d.timestamp >= fromTimestamp && d.timestamp <= toTimestamp
  )
}

/**
 * Get all daily volume data (for charting)
 */
export async function getAllDailyVolume(): Promise<DailyVolumeData[]> {
  const kv = await getKV()

  if (kv) {
    try {
      const results = await kv.zrange(DAILY_VOLUME_KEY, 0, -1)

      if (results && Array.isArray(results)) {
        return results.map(r =>
          (typeof r === "string" ? JSON.parse(r) : r) as DailyVolumeData
        )
      }
      return []
    } catch (error) {
      console.error("[VolumeStore] KV error fetching all daily volume:", error)
    }
  }

  return [...dailyVolumeMemoryStore]
}

/**
 * Get the latest daily volume entry
 */
export async function getLatestDailyVolume(): Promise<DailyVolumeData | null> {
  const kv = await getKV()

  if (kv) {
    try {
      const results = await kv.zrange(DAILY_VOLUME_KEY, -1, -1)
      if (results && results.length > 0) {
        return (typeof results[0] === "string" ? JSON.parse(results[0]) : results[0]) as DailyVolumeData
      }
      return null
    } catch (error) {
      console.error("[VolumeStore] KV error fetching latest daily volume:", error)
    }
  }

  return dailyVolumeMemoryStore[dailyVolumeMemoryStore.length - 1] || null
}

/**
 * Check if we have data for a specific date
 */
export async function hasDailyVolumeForDate(date: string): Promise<boolean> {
  const data = await getDailyVolume(date, date)
  return data.length > 0
}

/**
 * Get daily volume storage stats
 */
export async function getDailyVolumeStats(): Promise<{
  type: "vercel-kv" | "memory"
  count: number
  oldestDate: string | null
  newestDate: string | null
}> {
  const kv = await getKV()

  if (kv) {
    try {
      const count = await kv.zcard(DAILY_VOLUME_KEY)
      const oldest = await kv.zrange(DAILY_VOLUME_KEY, 0, 0)
      const newest = await kv.zrange(DAILY_VOLUME_KEY, -1, -1)

      const oldestParsed = oldest?.[0]
        ? (typeof oldest[0] === "string" ? JSON.parse(oldest[0]) : oldest[0]) as DailyVolumeData
        : null
      const newestParsed = newest?.[0]
        ? (typeof newest[0] === "string" ? JSON.parse(newest[0]) : newest[0]) as DailyVolumeData
        : null

      return {
        type: "vercel-kv",
        count,
        oldestDate: oldestParsed?.date || null,
        newestDate: newestParsed?.date || null,
      }
    } catch {
      // Fall through to memory
    }
  }

  return {
    type: "memory",
    count: dailyVolumeMemoryStore.length,
    oldestDate: dailyVolumeMemoryStore[0]?.date || null,
    newestDate: dailyVolumeMemoryStore[dailyVolumeMemoryStore.length - 1]?.date || null,
  }
}
