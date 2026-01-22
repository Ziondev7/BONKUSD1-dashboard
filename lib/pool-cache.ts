/**
 * Pool Discovery Cache
 *
 * Caches discovered USD1 pools to minimize on-chain queries.
 * Uses Vercel KV for persistence with in-memory fallback.
 *
 * Cache Strategy:
 * - Pool list: 5 minute TTL (new pools are rare)
 * - Token metadata: 1 hour TTL (rarely changes)
 * - Price data: 15 second TTL (changes frequently)
 */

import type { DiscoveredPool } from './pool-discovery'

// Cache TTLs
export const CACHE_TTL = {
  POOL_LIST: 5 * 60 * 1000,        // 5 minutes - new pools are rare
  TOKEN_METADATA: 60 * 60 * 1000,  // 1 hour - rarely changes
  PRICE_DATA: 15 * 1000,           // 15 seconds - changes often
  ENRICHED_TOKENS: 30 * 1000,      // 30 seconds - balance freshness vs API calls
}

// Cache keys
const CACHE_KEYS = {
  POOL_LIST: 'pools:usd1:list',
  POOL_DISCOVERY_TIME: 'pools:usd1:discovered_at',
  TOKEN_METADATA: 'tokens:metadata',
  ENRICHED_TOKENS: 'tokens:enriched',
}

// In-memory cache fallback
interface MemoryCache {
  pools: {
    data: DiscoveredPool[]
    tokenMints: string[]
    timestamp: number
  } | null
  tokenMetadata: Map<string, any>
  enrichedTokens: {
    data: any[]
    timestamp: number
  } | null
}

const memoryCache: MemoryCache = {
  pools: null,
  tokenMetadata: new Map(),
  enrichedTokens: null,
}

// Type for Vercel KV
interface KVClient {
  get: (key: string) => Promise<unknown | null>
  set: (key: string, value: unknown, options?: { ex?: number }) => Promise<string | null>
}

/**
 * Dynamically load Vercel KV if available
 */
async function getKV(): Promise<KVClient | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null
  }

  try {
    const module = await import('@vercel/kv')
    return module.kv as KVClient
  } catch {
    return null
  }
}

// ============================================
// POOL LIST CACHE
// ============================================

export interface CachedPoolData {
  pools: DiscoveredPool[]
  tokenMints: string[]
  discoveredAt: number
}

/**
 * Get cached pool list
 */
export async function getCachedPools(): Promise<CachedPoolData | null> {
  const kv = await getKV()

  if (kv) {
    try {
      const cached = await kv.get(CACHE_KEYS.POOL_LIST)
      if (cached) {
        const data = typeof cached === 'string' ? JSON.parse(cached) : cached as CachedPoolData

        // Check if cache is still valid
        if (Date.now() - data.discoveredAt < CACHE_TTL.POOL_LIST) {
          return data
        }
      }
    } catch (e) {
      console.warn('[PoolCache] KV read error:', e)
    }
  }

  // Fallback to memory
  if (memoryCache.pools && Date.now() - memoryCache.pools.timestamp < CACHE_TTL.POOL_LIST) {
    return {
      pools: memoryCache.pools.data,
      tokenMints: memoryCache.pools.tokenMints,
      discoveredAt: memoryCache.pools.timestamp,
    }
  }

  return null
}

/**
 * Save pool list to cache
 */
export async function setCachedPools(pools: DiscoveredPool[], tokenMints: string[]): Promise<void> {
  const data: CachedPoolData = {
    pools,
    tokenMints,
    discoveredAt: Date.now(),
  }

  // Save to memory immediately
  memoryCache.pools = {
    data: pools,
    tokenMints,
    timestamp: Date.now(),
  }

  // Try to persist to KV
  const kv = await getKV()
  if (kv) {
    try {
      await kv.set(CACHE_KEYS.POOL_LIST, JSON.stringify(data), {
        ex: Math.ceil(CACHE_TTL.POOL_LIST / 1000), // TTL in seconds
      })
    } catch (e) {
      console.warn('[PoolCache] KV write error:', e)
    }
  }
}

/**
 * Check if pool cache needs refresh
 */
export async function needsPoolRefresh(): Promise<boolean> {
  const cached = await getCachedPools()
  if (!cached) return true
  return Date.now() - cached.discoveredAt >= CACHE_TTL.POOL_LIST
}

// ============================================
// TOKEN METADATA CACHE
// ============================================

export interface TokenMetadata {
  mint: string
  symbol?: string
  name?: string
  decimals: number
  logoURI?: string
  coingeckoId?: string
  cachedAt: number
}

/**
 * Get cached token metadata
 */
export async function getCachedTokenMetadata(mint: string): Promise<TokenMetadata | null> {
  // Check memory first
  const memCached = memoryCache.tokenMetadata.get(mint)
  if (memCached && Date.now() - memCached.cachedAt < CACHE_TTL.TOKEN_METADATA) {
    return memCached
  }

  // Try KV
  const kv = await getKV()
  if (kv) {
    try {
      const cached = await kv.get(`${CACHE_KEYS.TOKEN_METADATA}:${mint}`)
      if (cached) {
        const data = typeof cached === 'string' ? JSON.parse(cached) : cached as TokenMetadata
        if (Date.now() - data.cachedAt < CACHE_TTL.TOKEN_METADATA) {
          // Update memory cache
          memoryCache.tokenMetadata.set(mint, data)
          return data
        }
      }
    } catch {
      // Ignore KV errors
    }
  }

  return null
}

/**
 * Save token metadata to cache
 */
export async function setCachedTokenMetadata(metadata: TokenMetadata): Promise<void> {
  const data = { ...metadata, cachedAt: Date.now() }

  // Save to memory
  memoryCache.tokenMetadata.set(metadata.mint, data)

  // Try KV
  const kv = await getKV()
  if (kv) {
    try {
      await kv.set(`${CACHE_KEYS.TOKEN_METADATA}:${metadata.mint}`, JSON.stringify(data), {
        ex: Math.ceil(CACHE_TTL.TOKEN_METADATA / 1000),
      })
    } catch {
      // Ignore KV errors
    }
  }
}

/**
 * Batch get token metadata
 */
export async function getCachedTokenMetadataBatch(mints: string[]): Promise<Map<string, TokenMetadata>> {
  const results = new Map<string, TokenMetadata>()
  const uncached: string[] = []

  // Check memory cache first
  for (const mint of mints) {
    const cached = memoryCache.tokenMetadata.get(mint)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL.TOKEN_METADATA) {
      results.set(mint, cached)
    } else {
      uncached.push(mint)
    }
  }

  // For remaining, try KV (if we have many uncached)
  if (uncached.length > 0) {
    const kv = await getKV()
    if (kv) {
      // Batch fetch from KV (one by one for now, could optimize with mget)
      for (const mint of uncached.slice(0, 50)) { // Limit to 50 to avoid too many requests
        try {
          const cached = await kv.get(`${CACHE_KEYS.TOKEN_METADATA}:${mint}`)
          if (cached) {
            const data = typeof cached === 'string' ? JSON.parse(cached) : cached as TokenMetadata
            if (Date.now() - data.cachedAt < CACHE_TTL.TOKEN_METADATA) {
              results.set(mint, data)
              memoryCache.tokenMetadata.set(mint, data)
            }
          }
        } catch {
          // Ignore individual errors
        }
      }
    }
  }

  return results
}

// ============================================
// ENRICHED TOKENS CACHE
// ============================================

/**
 * Get cached enriched tokens (final API response)
 */
export async function getCachedEnrichedTokens(): Promise<{ tokens: any[]; timestamp: number } | null> {
  // Check memory first
  if (memoryCache.enrichedTokens &&
      Date.now() - memoryCache.enrichedTokens.timestamp < CACHE_TTL.ENRICHED_TOKENS) {
    return memoryCache.enrichedTokens
  }

  // Try KV
  const kv = await getKV()
  if (kv) {
    try {
      const cached = await kv.get(CACHE_KEYS.ENRICHED_TOKENS)
      if (cached) {
        const data = typeof cached === 'string' ? JSON.parse(cached) : cached as { tokens: any[]; timestamp: number }
        if (Date.now() - data.timestamp < CACHE_TTL.ENRICHED_TOKENS) {
          memoryCache.enrichedTokens = { data: data.tokens, timestamp: data.timestamp }
          return data
        }
      }
    } catch {
      // Ignore KV errors
    }
  }

  return null
}

/**
 * Save enriched tokens to cache
 */
export async function setCachedEnrichedTokens(tokens: any[]): Promise<void> {
  const timestamp = Date.now()

  // Save to memory
  memoryCache.enrichedTokens = { data: tokens, timestamp }

  // Try KV
  const kv = await getKV()
  if (kv) {
    try {
      await kv.set(CACHE_KEYS.ENRICHED_TOKENS, JSON.stringify({ tokens, timestamp }), {
        ex: Math.ceil(CACHE_TTL.ENRICHED_TOKENS / 1000),
      })
    } catch {
      // Ignore KV errors
    }
  }
}

// ============================================
// CACHE STATS
// ============================================

export async function getCacheStats(): Promise<{
  poolCache: { hit: boolean; age: number | null; count: number }
  metadataCache: { count: number }
  enrichedCache: { hit: boolean; age: number | null; count: number }
  storage: 'vercel-kv' | 'memory'
}> {
  const kv = await getKV()
  const pools = await getCachedPools()
  const enriched = await getCachedEnrichedTokens()

  return {
    poolCache: {
      hit: !!pools,
      age: pools ? Date.now() - pools.discoveredAt : null,
      count: pools?.pools.length || 0,
    },
    metadataCache: {
      count: memoryCache.tokenMetadata.size,
    },
    enrichedCache: {
      hit: !!enriched,
      age: enriched ? Date.now() - enriched.timestamp : null,
      count: enriched?.tokens.length || 0,
    },
    storage: kv ? 'vercel-kv' : 'memory',
  }
}

/**
 * Clear all caches (for debugging/testing)
 */
export async function clearAllCaches(): Promise<void> {
  memoryCache.pools = null
  memoryCache.tokenMetadata.clear()
  memoryCache.enrichedTokens = null

  const kv = await getKV()
  if (kv) {
    try {
      await kv.set(CACHE_KEYS.POOL_LIST, null)
      await kv.set(CACHE_KEYS.ENRICHED_TOKENS, null)
    } catch {
      // Ignore errors
    }
  }
}
