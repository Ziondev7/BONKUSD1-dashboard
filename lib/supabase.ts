/**
 * Supabase client for storing historical volume data
 * This replaces the need to fetch historical data from external APIs on every request
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Database types
export interface VolumeSnapshot {
  id?: number
  pool_address: string
  token_mint: string
  token_symbol: string
  timestamp: number       // Unix timestamp (hour bucket)
  volume_usd: number
  trades: number
  created_at?: string
  updated_at?: string
}

export interface PoolInfo {
  id?: number
  pool_address: string
  token_mint: string
  token_symbol: string
  token_name: string
  created_at?: string
  last_synced_at?: string
  total_volume_usd: number
  total_trades: number
}

export interface SyncStatus {
  id?: number
  pool_address: string
  last_synced_timestamp: number
  last_signature?: string
  status: 'pending' | 'syncing' | 'completed' | 'error'
  error_message?: string
  created_at?: string
  updated_at?: string
}

// Supabase client singleton
let supabaseClient: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.warn('[Supabase] Not configured - missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return null
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey)
  return supabaseClient
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY))
}

/**
 * Insert or update volume snapshots (upsert by pool_address + timestamp)
 */
export async function upsertVolumeSnapshots(snapshots: VolumeSnapshot[]): Promise<boolean> {
  const supabase = getSupabase()
  if (!supabase) return false

  const { error } = await supabase
    .from('volume_snapshots')
    .upsert(snapshots, {
      onConflict: 'pool_address,timestamp',
      ignoreDuplicates: false
    })

  if (error) {
    console.error('[Supabase] Failed to upsert volume snapshots:', error)
    return false
  }

  return true
}

/**
 * Get aggregated volume for a time period
 */
export async function getAggregatedVolume(
  period: '24h' | '7d' | '1m' | 'all'
): Promise<{ history: { timestamp: number; volume: number; trades: number }[]; total: number; poolCount: number } | null> {
  const supabase = getSupabase()
  if (!supabase) return null

  // Calculate time boundaries
  const now = Date.now()
  let startTime: number
  let bucketSize: 'hour' | 'day'

  switch (period) {
    case '24h':
      startTime = now - 24 * 60 * 60 * 1000
      bucketSize = 'hour'
      break
    case '7d':
      startTime = now - 7 * 24 * 60 * 60 * 1000
      bucketSize = 'hour' // 4-hour buckets handled in post-processing
      break
    case '1m':
      startTime = now - 30 * 24 * 60 * 60 * 1000
      bucketSize = 'day'
      break
    case 'all':
      startTime = 0
      bucketSize = 'day'
      break
  }

  // Query volume snapshots
  let query = supabase
    .from('volume_snapshots')
    .select('timestamp, volume_usd, trades, pool_address')
    .order('timestamp', { ascending: true })

  if (startTime > 0) {
    query = query.gte('timestamp', startTime)
  }

  const { data, error } = await query

  if (error) {
    console.error('[Supabase] Failed to fetch volume data:', error)
    return null
  }

  if (!data || data.length === 0) {
    return { history: [], total: 0, poolCount: 0 }
  }

  // Aggregate by time bucket
  const bucketMs = bucketSize === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  const aggregated = new Map<number, { volume: number; trades: number }>()
  const pools = new Set<string>()

  for (const row of data) {
    pools.add(row.pool_address)

    // For 7d, use 4-hour buckets
    let bucket: number
    if (period === '7d') {
      bucket = Math.floor(row.timestamp / (4 * 60 * 60 * 1000)) * (4 * 60 * 60 * 1000)
    } else {
      bucket = Math.floor(row.timestamp / bucketMs) * bucketMs
    }

    const existing = aggregated.get(bucket) || { volume: 0, trades: 0 }
    aggregated.set(bucket, {
      volume: existing.volume + row.volume_usd,
      trades: existing.trades + row.trades
    })
  }

  const history = Array.from(aggregated.entries())
    .map(([timestamp, data]) => ({
      timestamp,
      volume: data.volume,
      trades: data.trades
    }))
    .sort((a, b) => a.timestamp - b.timestamp)

  const total = history.reduce((sum, h) => sum + h.volume, 0)

  return {
    history,
    total,
    poolCount: pools.size
  }
}

/**
 * Get sync status for a pool
 */
export async function getSyncStatus(poolAddress: string): Promise<SyncStatus | null> {
  const supabase = getSupabase()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('sync_status')
    .select('*')
    .eq('pool_address', poolAddress)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    console.error('[Supabase] Failed to get sync status:', error)
    return null
  }

  return data
}

/**
 * Update sync status for a pool
 */
export async function updateSyncStatus(status: Partial<SyncStatus> & { pool_address: string }): Promise<boolean> {
  const supabase = getSupabase()
  if (!supabase) return false

  const { error } = await supabase
    .from('sync_status')
    .upsert({
      ...status,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'pool_address'
    })

  if (error) {
    console.error('[Supabase] Failed to update sync status:', error)
    return false
  }

  return true
}

/**
 * Get all pools that need syncing
 */
export async function getPoolsToSync(): Promise<SyncStatus[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  // Get pools that haven't been synced in the last hour
  const oneHourAgo = Date.now() - 60 * 60 * 1000

  const { data, error } = await supabase
    .from('sync_status')
    .select('*')
    .or(`last_synced_timestamp.lt.${oneHourAgo},status.eq.pending,status.eq.error`)
    .order('last_synced_timestamp', { ascending: true })
    .limit(10)

  if (error) {
    console.error('[Supabase] Failed to get pools to sync:', error)
    return []
  }

  return data || []
}

/**
 * Register a new pool for syncing
 */
export async function registerPool(pool: {
  pool_address: string
  token_mint: string
  token_symbol: string
  token_name: string
}): Promise<boolean> {
  const supabase = getSupabase()
  if (!supabase) return false

  // Insert pool info
  const { error: poolError } = await supabase
    .from('pools')
    .upsert({
      ...pool,
      total_volume_usd: 0,
      total_trades: 0,
      created_at: new Date().toISOString()
    }, {
      onConflict: 'pool_address'
    })

  if (poolError) {
    console.error('[Supabase] Failed to register pool:', poolError)
    return false
  }

  // Initialize sync status
  const { error: syncError } = await supabase
    .from('sync_status')
    .upsert({
      pool_address: pool.pool_address,
      last_synced_timestamp: 0,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'pool_address'
    })

  if (syncError) {
    console.error('[Supabase] Failed to init sync status:', syncError)
    return false
  }

  return true
}

/**
 * Get total stats across all pools
 */
export async function getTotalStats(): Promise<{
  totalVolume24h: number
  totalVolume7d: number
  totalVolumeAll: number
  totalTrades: number
  poolCount: number
} | null> {
  const supabase = getSupabase()
  if (!supabase) return null

  const now = Date.now()
  const oneDayAgo = now - 24 * 60 * 60 * 1000
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

  // Get 24h volume
  const { data: data24h } = await supabase
    .from('volume_snapshots')
    .select('volume_usd, trades, pool_address')
    .gte('timestamp', oneDayAgo)

  // Get 7d volume
  const { data: data7d } = await supabase
    .from('volume_snapshots')
    .select('volume_usd, trades')
    .gte('timestamp', sevenDaysAgo)

  // Get all time volume
  const { data: dataAll } = await supabase
    .from('volume_snapshots')
    .select('volume_usd, trades')

  const pools24h = new Set(data24h?.map(d => d.pool_address) || [])

  return {
    totalVolume24h: data24h?.reduce((sum, d) => sum + d.volume_usd, 0) || 0,
    totalVolume7d: data7d?.reduce((sum, d) => sum + d.volume_usd, 0) || 0,
    totalVolumeAll: dataAll?.reduce((sum, d) => sum + d.volume_usd, 0) || 0,
    totalTrades: dataAll?.reduce((sum, d) => sum + d.trades, 0) || 0,
    poolCount: pools24h.size
  }
}
