/**
 * Supabase Client for BonkFun Dashboard
 *
 * Provides database access for:
 * - bonkfun_tokens: Verified BonkFun tokens paired with USD1
 * - volume_snapshots: Hourly volume data per token
 * - total_volume_snapshots: Aggregate volume for charts
 * - daily_aggregates: Pre-computed daily totals
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js"

// ============================================
// DATABASE TYPES
// ============================================

export interface BonkFunToken {
  id?: number
  mint: string
  symbol?: string
  name?: string
  decimals?: number
  pool_address?: string
  pool_type?: string
  verified_at?: string
  verification_source?: "helius" | "rpc" | "manual"
  confidence?: "high" | "medium" | "low"
  image_url?: string
  graduated_at?: string
  graduation_tx?: string
  is_active?: boolean
  created_at?: string
  updated_at?: string
}

export interface VolumeSnapshot {
  id?: number
  snapshot_time: string
  token_mint: string
  volume_1h?: number
  volume_24h?: number
  price_usd?: number
  liquidity_usd?: number
  market_cap_usd?: number
  buy_count?: number
  sell_count?: number
  created_at?: string
}

export interface TotalVolumeSnapshot {
  id?: number
  snapshot_time: string
  total_volume_1h?: number
  total_volume_24h?: number
  total_liquidity_usd?: number
  total_market_cap_usd?: number
  active_token_count?: number
  tokens_with_volume?: number
  top_tokens?: Array<{
    mint: string
    symbol: string
    volume_1h: number
    price_change?: number
  }>
  created_at?: string
}

export interface DailyAggregate {
  id?: number
  day: string
  total_volume?: number
  avg_hourly_volume?: number
  peak_hourly_volume?: number
  avg_liquidity?: number
  end_of_day_liquidity?: number
  active_token_count?: number
  new_tokens_graduated?: number
  created_at?: string
  updated_at?: string
}

// ============================================
// SUPABASE CLIENT SINGLETON
// ============================================

let supabaseClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) return supabaseClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return supabaseClient
}

// ============================================
// BONKFUN TOKENS OPERATIONS
// ============================================

/**
 * Get all verified BonkFun tokens
 */
export async function getAllBonkFunTokens(): Promise<BonkFunToken[]> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from("bonkfun_tokens")
    .select("*")
    .eq("is_active", true)
    .order("verified_at", { ascending: false })

  if (error) {
    console.error("[Supabase] Error fetching tokens:", error)
    return []
  }

  return data || []
}

/**
 * Get token mints as a Set (for verification matching)
 */
export async function getBonkFunTokenMints(): Promise<Set<string>> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from("bonkfun_tokens")
    .select("mint")
    .eq("is_active", true)

  if (error) {
    console.error("[Supabase] Error fetching token mints:", error)
    return new Set()
  }

  return new Set((data || []).map((t) => t.mint))
}

/**
 * Check if a token exists in the database
 */
export async function isTokenVerified(mint: string): Promise<boolean> {
  const supabase = getSupabaseClient()

  const { count, error } = await supabase
    .from("bonkfun_tokens")
    .select("*", { count: "exact", head: true })
    .eq("mint", mint)
    .eq("is_active", true)

  if (error) {
    console.error("[Supabase] Error checking token:", error)
    return false
  }

  return (count || 0) > 0
}

/**
 * Upsert a BonkFun token (insert or update)
 */
export async function upsertBonkFunToken(token: BonkFunToken): Promise<boolean> {
  const supabase = getSupabaseClient()

  const { error } = await supabase
    .from("bonkfun_tokens")
    .upsert(token, { onConflict: "mint" })

  if (error) {
    console.error("[Supabase] Error upserting token:", error)
    return false
  }

  return true
}

/**
 * Batch upsert multiple tokens
 */
export async function upsertBonkFunTokens(tokens: BonkFunToken[]): Promise<number> {
  if (tokens.length === 0) return 0

  const supabase = getSupabaseClient()

  const { error, count } = await supabase
    .from("bonkfun_tokens")
    .upsert(tokens, { onConflict: "mint", count: "exact" })

  if (error) {
    console.error("[Supabase] Error batch upserting tokens:", error)
    return 0
  }

  return count || tokens.length
}

// ============================================
// VOLUME SNAPSHOTS OPERATIONS
// ============================================

/**
 * Insert volume snapshots for multiple tokens
 */
export async function insertVolumeSnapshots(snapshots: VolumeSnapshot[]): Promise<number> {
  if (snapshots.length === 0) return 0

  const supabase = getSupabaseClient()

  // Round snapshot_time to the hour
  const normalizedSnapshots = snapshots.map((s) => ({
    ...s,
    snapshot_time: roundToHour(new Date(s.snapshot_time)).toISOString(),
  }))

  const { error, count } = await supabase
    .from("volume_snapshots")
    .upsert(normalizedSnapshots, {
      onConflict: "snapshot_time,token_mint",
      count: "exact",
    })

  if (error) {
    console.error("[Supabase] Error inserting volume snapshots:", error)
    return 0
  }

  return count || snapshots.length
}

/**
 * Insert total volume snapshot (aggregate)
 */
export async function insertTotalVolumeSnapshot(snapshot: TotalVolumeSnapshot): Promise<boolean> {
  const supabase = getSupabaseClient()

  // Round to hour
  const normalizedSnapshot = {
    ...snapshot,
    snapshot_time: roundToHour(new Date(snapshot.snapshot_time)).toISOString(),
  }

  const { error } = await supabase
    .from("total_volume_snapshots")
    .upsert(normalizedSnapshot, { onConflict: "snapshot_time" })

  if (error) {
    console.error("[Supabase] Error inserting total volume snapshot:", error)
    return false
  }

  return true
}

/**
 * Get volume chart data for a time range
 */
export async function getVolumeChartData(
  startTime: Date,
  endTime: Date
): Promise<TotalVolumeSnapshot[]> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from("total_volume_snapshots")
    .select("*")
    .gte("snapshot_time", startTime.toISOString())
    .lt("snapshot_time", endTime.toISOString())
    .order("snapshot_time", { ascending: true })

  if (error) {
    console.error("[Supabase] Error fetching volume chart data:", error)
    return []
  }

  return data || []
}

/**
 * Get per-token volume data for a time range
 */
export async function getTokenVolumeHistory(
  tokenMint: string,
  startTime: Date,
  endTime: Date
): Promise<VolumeSnapshot[]> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from("volume_snapshots")
    .select("*")
    .eq("token_mint", tokenMint)
    .gte("snapshot_time", startTime.toISOString())
    .lt("snapshot_time", endTime.toISOString())
    .order("snapshot_time", { ascending: true })

  if (error) {
    console.error("[Supabase] Error fetching token volume history:", error)
    return []
  }

  return data || []
}

/**
 * Get aggregated volume data grouped by hour
 * (Alternative to the SQL function, done client-side)
 */
export async function getAggregatedVolumeData(
  startTime: Date,
  endTime: Date
): Promise<Array<{ time: string; volume: number; liquidity: number; token_count: number }>> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from("volume_snapshots")
    .select("snapshot_time, volume_1h, liquidity_usd, token_mint")
    .gte("snapshot_time", startTime.toISOString())
    .lt("snapshot_time", endTime.toISOString())
    .order("snapshot_time", { ascending: true })

  if (error) {
    console.error("[Supabase] Error fetching aggregated volume:", error)
    return []
  }

  // Group by hour
  const hourlyData = new Map<string, { volume: number; liquidity: number; tokens: Set<string> }>()

  for (const row of data || []) {
    const hour = roundToHour(new Date(row.snapshot_time)).toISOString()
    const existing = hourlyData.get(hour) || { volume: 0, liquidity: 0, tokens: new Set() }

    existing.volume += Number(row.volume_1h) || 0
    existing.liquidity += Number(row.liquidity_usd) || 0
    existing.tokens.add(row.token_mint)

    hourlyData.set(hour, existing)
  }

  return Array.from(hourlyData.entries()).map(([time, data]) => ({
    time,
    volume: data.volume,
    liquidity: data.liquidity,
    token_count: data.tokens.size,
  }))
}

// ============================================
// DAILY AGGREGATES OPERATIONS
// ============================================

/**
 * Upsert daily aggregate data
 */
export async function upsertDailyAggregate(aggregate: DailyAggregate): Promise<boolean> {
  const supabase = getSupabaseClient()

  const { error } = await supabase
    .from("daily_aggregates")
    .upsert(aggregate, { onConflict: "day" })

  if (error) {
    console.error("[Supabase] Error upserting daily aggregate:", error)
    return false
  }

  return true
}

/**
 * Get daily aggregates for a date range
 */
export async function getDailyAggregates(
  startDate: Date,
  endDate: Date
): Promise<DailyAggregate[]> {
  const supabase = getSupabaseClient()

  const startDay = startDate.toISOString().split("T")[0]
  const endDay = endDate.toISOString().split("T")[0]

  const { data, error } = await supabase
    .from("daily_aggregates")
    .select("*")
    .gte("day", startDay)
    .lte("day", endDay)
    .order("day", { ascending: true })

  if (error) {
    console.error("[Supabase] Error fetching daily aggregates:", error)
    return []
  }

  return data || []
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Round a date to the nearest hour
 */
function roundToHour(date: Date): Date {
  const rounded = new Date(date)
  rounded.setMinutes(0, 0, 0)
  return rounded
}

/**
 * Check if Supabase is properly configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(): Promise<{
  tokenCount: number
  snapshotCount: number
  oldestSnapshot: string | null
  newestSnapshot: string | null
}> {
  const supabase = getSupabaseClient()

  const [tokensResult, snapshotsResult, oldestResult, newestResult] = await Promise.all([
    supabase.from("bonkfun_tokens").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("volume_snapshots").select("*", { count: "exact", head: true }),
    supabase.from("volume_snapshots").select("snapshot_time").order("snapshot_time", { ascending: true }).limit(1),
    supabase.from("volume_snapshots").select("snapshot_time").order("snapshot_time", { ascending: false }).limit(1),
  ])

  return {
    tokenCount: tokensResult.count || 0,
    snapshotCount: snapshotsResult.count || 0,
    oldestSnapshot: oldestResult.data?.[0]?.snapshot_time || null,
    newestSnapshot: newestResult.data?.[0]?.snapshot_time || null,
  }
}
