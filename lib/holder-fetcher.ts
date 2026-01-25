/**
 * Token Holder Count Fetcher
 *
 * Uses Helius getTokenAccounts API to fetch holder counts.
 * Free tier: 1M credits/month
 *
 * Strategy:
 * - Aggressive caching (1 hour TTL)
 * - Pagination through all accounts
 * - Batch processing with rate limiting
 */

import { getCachedHolderCount, setCachedHolderCount, getCachedHolderCountsBatch } from './pool-cache'

const HELIUS_API = 'https://mainnet.helius-rpc.com'
const MAX_ACCOUNTS_PER_REQUEST = 1000
const MAX_PAGES = 50 // Limit to ~50k holders max per token
const REQUEST_DELAY_MS = 100 // Delay between requests to avoid rate limits

/**
 * Fetch holder count for a single token using Helius getTokenAccounts
 */
export async function fetchHolderCount(mint: string): Promise<number | null> {
  const apiKey = process.env.HELIUS_API_KEY
  if (!apiKey) {
    console.warn('[HolderFetcher] No HELIUS_API_KEY configured')
    return null
  }

  // Check cache first
  const cached = await getCachedHolderCount(mint)
  if (cached !== null) {
    return cached
  }

  try {
    const url = `${HELIUS_API}/?api-key=${apiKey}`
    let cursor: string | undefined
    let totalHolders = 0
    let pageCount = 0

    // Paginate through all token accounts
    while (pageCount < MAX_PAGES) {
      const body: any = {
        jsonrpc: '2.0',
        id: `holder-${mint}-${pageCount}`,
        method: 'getTokenAccounts',
        params: {
          mint,
          limit: MAX_ACCOUNTS_PER_REQUEST,
          ...(cursor ? { cursor } : {}),
        },
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        console.error(`[HolderFetcher] API error for ${mint}: ${response.status}`)
        break
      }

      const json = await response.json()

      if (json.error) {
        console.error(`[HolderFetcher] RPC error for ${mint}:`, json.error)
        break
      }

      const accounts = json.result?.token_accounts || []
      totalHolders += accounts.length

      // Check if there are more pages
      cursor = json.result?.cursor
      if (!cursor || accounts.length < MAX_ACCOUNTS_PER_REQUEST) {
        break
      }

      pageCount++

      // Rate limiting delay
      if (pageCount < MAX_PAGES) {
        await new Promise(r => setTimeout(r, REQUEST_DELAY_MS))
      }
    }

    // Cache the result
    if (totalHolders > 0) {
      await setCachedHolderCount(mint, totalHolders)
    }

    return totalHolders
  } catch (error) {
    console.error(`[HolderFetcher] Error fetching holders for ${mint}:`, error)
    return null
  }
}

/**
 * Batch fetch holder counts for multiple tokens
 * Processes in parallel with rate limiting
 */
export async function fetchHolderCountsBatch(
  mints: string[],
  maxConcurrent = 3
): Promise<Map<string, number>> {
  const results = new Map<string, number>()

  // Get cached counts first
  const cached = await getCachedHolderCountsBatch(mints)
  for (const [mint, count] of cached) {
    results.set(mint, count)
  }

  // Find mints that need fetching
  const uncached = mints.filter(m => !results.has(m))

  if (uncached.length === 0) {
    return results
  }

  console.log(`[HolderFetcher] Fetching holder counts for ${uncached.length} tokens (${cached.size} cached)`)

  // Process in batches to avoid rate limits
  for (let i = 0; i < uncached.length; i += maxConcurrent) {
    const batch = uncached.slice(i, i + maxConcurrent)

    const batchResults = await Promise.all(
      batch.map(async (mint) => {
        const count = await fetchHolderCount(mint)
        return { mint, count }
      })
    )

    for (const { mint, count } of batchResults) {
      if (count !== null) {
        results.set(mint, count)
      }
    }

    // Delay between batches
    if (i + maxConcurrent < uncached.length) {
      await new Promise(r => setTimeout(r, 200))
    }
  }

  return results
}

/**
 * Fetch holder counts for top tokens only (to minimize API calls)
 * Returns a map of mint -> holder count
 */
export async function fetchTopTokenHolderCounts(
  tokens: Array<{ address: string; mcap: number }>,
  limit = 20
): Promise<Map<string, number>> {
  // Sort by mcap and take top N
  const topTokens = [...tokens]
    .sort((a, b) => b.mcap - a.mcap)
    .slice(0, limit)
    .map(t => t.address)

  return fetchHolderCountsBatch(topTokens)
}
