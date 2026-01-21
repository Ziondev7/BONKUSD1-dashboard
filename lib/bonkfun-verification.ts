/**
 * BonkFun Token Verification Module
 *
 * This module provides a centralized, authoritative way to verify if a token
 * was launched via BonkFun (LetsBonk platform on Raydium LaunchLab).
 *
 * Source of Truth: Dune Analytics query that identifies tokens created via
 * LaunchLab with the LetsBonk platform configuration, paired with USD1.
 *
 * This replaces the unreliable pool-type string matching approach.
 */

// Dune API configuration
const DUNE_API = "https://api.dune.com/api/v1"
const DUNE_TOKEN_LIST_QUERY_ID = "6575979" // BonkFun token mint list query

// Cache configuration
const TOKEN_LIST_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours - token list changes slowly
const VERIFICATION_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours - token origin never changes

// BonkFun program identifiers (for on-chain verification fallback)
export const BONKFUN_PROGRAMS = {
  // Raydium LaunchLab program - creates tokens via initialize_v2
  LAUNCHLAB_PROGRAM: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  // BonkFun/LetsBonk platform config - must be in accounts to identify BonkFun
  PLATFORM_CONFIG: "FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1",
  // BonkFun graduation program
  GRADUATE_PROGRAM: "boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4",
} as const

// ============================================
// TYPES
// ============================================

interface DuneTokenListRow {
  token_mint: string
}

interface DuneTokenListResponse {
  execution_id: string
  query_id: number
  state: string
  result?: {
    rows: DuneTokenListRow[]
    metadata: {
      column_names: string[]
      result_set_bytes: number
      total_row_count: number
    }
  }
}

interface TokenListCache {
  tokens: Set<string>
  timestamp: number
  source: "dune" | "fallback"
}

interface VerificationResult {
  isBonkFun: boolean
  confidence: "high" | "medium" | "low"
  source: "dune-whitelist" | "program-check" | "cache" | "unknown"
}

// ============================================
// IN-MEMORY CACHE
// ============================================

let tokenListCache: TokenListCache | null = null

// Individual token verification cache (for tokens not in whitelist)
const verificationCache = new Map<string, { result: VerificationResult; timestamp: number }>()

// ============================================
// DUNE WHITELIST FETCHER
// ============================================

/**
 * Fetch the authoritative list of BonkFun token mints from Dune Analytics.
 * This query returns all tokens created via LaunchLab with LetsBonk platform,
 * paired with USD1.
 */
export async function fetchBonkFunWhitelist(): Promise<Set<string>> {
  // Check cache first
  if (tokenListCache && Date.now() - tokenListCache.timestamp < TOKEN_LIST_CACHE_TTL) {
    console.log(`[BonkFun] Using cached whitelist (${tokenListCache.tokens.size} tokens, source: ${tokenListCache.source})`)
    return tokenListCache.tokens
  }

  const duneApiKey = process.env.DUNE_API_KEY
  if (!duneApiKey) {
    console.warn("[BonkFun] No DUNE_API_KEY configured - cannot fetch authoritative whitelist")
    return tokenListCache?.tokens || new Set()
  }

  try {
    console.log("[BonkFun] Fetching authoritative token whitelist from Dune...")

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30s timeout

    const response = await fetch(
      `${DUNE_API}/query/${DUNE_TOKEN_LIST_QUERY_ID}/results?limit=150000`,
      {
        signal: controller.signal,
        headers: {
          "x-dune-api-key": duneApiKey,
          Accept: "application/json",
        },
      }
    )

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error("[BonkFun] Dune API error:", response.status)
      return tokenListCache?.tokens || new Set()
    }

    const data: DuneTokenListResponse = await response.json()

    if (data.state !== "QUERY_STATE_COMPLETED" || !data.result?.rows) {
      console.error("[BonkFun] Dune query not ready or no results")
      return tokenListCache?.tokens || new Set()
    }

    const tokens = new Set<string>()
    for (const row of data.result.rows) {
      if (row.token_mint && typeof row.token_mint === "string") {
        tokens.add(row.token_mint)
      }
    }

    console.log(`[BonkFun] Fetched ${tokens.size} verified BonkFun token mints from Dune`)

    // Update cache
    tokenListCache = {
      tokens,
      timestamp: Date.now(),
      source: "dune",
    }

    return tokens
  } catch (error) {
    console.error("[BonkFun] Error fetching whitelist:", error)
    return tokenListCache?.tokens || new Set()
  }
}

// ============================================
// TOKEN VERIFICATION
// ============================================

/**
 * Verify if a token mint address is a legitimate BonkFun token.
 * Uses the Dune whitelist as the primary source of truth.
 */
export async function verifyBonkFunToken(mintAddress: string): Promise<VerificationResult> {
  // Check individual verification cache first
  const cached = verificationCache.get(mintAddress)
  if (cached && Date.now() - cached.timestamp < VERIFICATION_CACHE_TTL) {
    return cached.result
  }

  // Check against the authoritative Dune whitelist
  const whitelist = await fetchBonkFunWhitelist()

  if (whitelist.size > 0) {
    const isBonkFun = whitelist.has(mintAddress)
    const result: VerificationResult = {
      isBonkFun,
      confidence: "high",
      source: "dune-whitelist",
    }

    // Cache the result
    verificationCache.set(mintAddress, { result, timestamp: Date.now() })
    return result
  }

  // Fallback: If whitelist is unavailable, we cannot verify
  // Return unknown rather than assuming true (previous bug)
  const result: VerificationResult = {
    isBonkFun: false,
    confidence: "low",
    source: "unknown",
  }

  verificationCache.set(mintAddress, { result, timestamp: Date.now() })
  return result
}

/**
 * Batch verify multiple token mints.
 * Returns a Set of verified BonkFun token addresses.
 */
export async function filterBonkFunTokens(mintAddresses: string[]): Promise<Set<string>> {
  const whitelist = await fetchBonkFunWhitelist()
  const verified = new Set<string>()

  if (whitelist.size === 0) {
    console.warn("[BonkFun] Whitelist unavailable - returning empty set (strict mode)")
    return verified
  }

  for (const mint of mintAddresses) {
    if (whitelist.has(mint)) {
      verified.add(mint)
    }
  }

  console.log(`[BonkFun] Verified ${verified.size}/${mintAddresses.length} tokens against whitelist`)
  return verified
}

/**
 * Check if a token is in the BonkFun whitelist (synchronous check against cache).
 * Returns null if whitelist is not yet loaded.
 */
export function isInBonkFunWhitelist(mintAddress: string): boolean | null {
  if (!tokenListCache) {
    return null // Whitelist not loaded
  }
  return tokenListCache.tokens.has(mintAddress)
}

/**
 * Get the current whitelist status for debugging/monitoring.
 */
export function getWhitelistStatus(): {
  loaded: boolean
  tokenCount: number
  source: "dune" | "fallback" | "none"
  ageMs: number
  isStale: boolean
} {
  if (!tokenListCache) {
    return {
      loaded: false,
      tokenCount: 0,
      source: "none",
      ageMs: 0,
      isStale: true,
    }
  }

  const ageMs = Date.now() - tokenListCache.timestamp
  return {
    loaded: true,
    tokenCount: tokenListCache.tokens.size,
    source: tokenListCache.source,
    ageMs,
    isStale: ageMs > TOKEN_LIST_CACHE_TTL,
  }
}

/**
 * Force refresh the whitelist (bypasses cache).
 */
export async function refreshWhitelist(): Promise<number> {
  tokenListCache = null
  const whitelist = await fetchBonkFunWhitelist()
  return whitelist.size
}

/**
 * Clear all verification caches (for testing/debugging).
 */
export function clearVerificationCaches(): void {
  tokenListCache = null
  verificationCache.clear()
}
