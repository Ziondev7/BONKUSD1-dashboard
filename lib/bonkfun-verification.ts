/**
 * BonkFun Token Verification Module
 *
 * This module verifies if a token was launched via BonkFun (LetsBonk platform).
 * Uses Helius API (free tier) to check on-chain data.
 * Persists verified tokens to Vercel KV for fast subsequent loads.
 *
 * BonkFun tokens are identified by:
 * 1. Created via Raydium LaunchLab program with LetsBonk platform config
 * 2. Graduated to Raydium CPMM pools via the BonkFun graduate program
 */

// ============================================
// CONFIGURATION
// ============================================

// BonkFun program identifiers (on-chain verification)
export const BONKFUN_PROGRAMS = {
  // Raydium LaunchLab program - creates tokens via initialize_v2
  LAUNCHLAB_PROGRAM: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  // BonkFun/LetsBonk platform config - must be in accounts to identify BonkFun
  PLATFORM_CONFIG: "FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1",
  // BonkFun graduation program - migrates tokens to Raydium
  GRADUATE_PROGRAM: "boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4",
  // Raydium CPMM program - graduated pools use this
  RAYDIUM_CPMM: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
} as const

// Cache configuration
const WHITELIST_CACHE_TTL = 30 * 60 * 1000 // 30 minutes for in-memory cache
const VERIFICATION_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours - token origin never changes
const KV_CACHE_KEY = "bonkfun:verified_tokens"
const KV_CACHE_TTL = 7 * 24 * 60 * 60 // 7 days in seconds for KV

// Rate limiting - VERY conservative to avoid 429 errors
const RATE_LIMIT_DELAY_MS = 500 // 500ms between each API call (2 RPS max)
const BATCH_SIZE = 1 // Process 1 token at a time to stay under rate limits

// ============================================
// TYPES
// ============================================

interface VerificationResult {
  isBonkFun: boolean
  confidence: "high" | "medium" | "low"
  source: "helius-history" | "program-check" | "pool-authority" | "cache" | "kv-cache" | "unknown"
}

interface TokenListCache {
  tokens: Set<string>
  timestamp: number
  source: "helius" | "on-chain" | "fallback" | "kv"
}

interface HeliusParsedTransaction {
  signature: string
  type: string
  source: string
  fee: number
  slot: number
  timestamp: number
  nativeTransfers: Array<{
    fromUserAccount: string
    toUserAccount: string
    amount: number
  }>
  tokenTransfers: Array<{
    fromUserAccount: string
    toUserAccount: string
    mint: string
    tokenAmount: number
  }>
  accountData: Array<{
    account: string
    nativeBalanceChange: number
    tokenBalanceChanges: Array<{
      mint: string
      rawTokenAmount: { tokenAmount: string; decimals: number }
    }>
  }>
  instructions: Array<{
    programId: string
    accounts: string[]
    data: string
    innerInstructions?: Array<{
      programId: string
      accounts: string[]
    }>
  }>
}

// ============================================
// IN-MEMORY CACHE
// ============================================

let tokenListCache: TokenListCache | null = null
const verificationCache = new Map<string, { result: VerificationResult; timestamp: number }>()

// Track if verification is already in progress to prevent concurrent runs
let verificationInProgress = false
let verificationPromise: Promise<Set<string>> | null = null

// ============================================
// VERCEL KV HELPERS
// ============================================

async function loadFromKV(): Promise<Set<string> | null> {
  const kvUrl = process.env.KV_REST_API_URL
  const kvToken = process.env.KV_REST_API_TOKEN

  if (!kvUrl || !kvToken) {
    console.log("[BonkFun] No KV credentials - skipping KV cache")
    return null
  }

  try {
    const response = await fetch(`${kvUrl}/get/${KV_CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    })

    if (!response.ok) {
      console.log(`[BonkFun] KV fetch failed: ${response.status}`)
      return null
    }

    const data = await response.json()
    if (data.result) {
      const tokens = JSON.parse(data.result)
      console.log(`[BonkFun] Loaded ${tokens.length} verified tokens from KV cache`)
      return new Set(tokens)
    }
    return null
  } catch (error) {
    console.warn("[BonkFun] Error loading from KV:", error)
    return null
  }
}

async function saveToKV(tokens: Set<string>): Promise<void> {
  const kvUrl = process.env.KV_REST_API_URL
  const kvToken = process.env.KV_REST_API_TOKEN

  if (!kvUrl || !kvToken) return

  try {
    const tokensArray = Array.from(tokens)
    await fetch(`${kvUrl}/set/${KV_CACHE_KEY}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kvToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: JSON.stringify(tokensArray), ex: KV_CACHE_TTL }),
    })
    console.log(`[BonkFun] Saved ${tokens.size} verified tokens to KV cache`)
  } catch (error) {
    console.warn("[BonkFun] Error saving to KV:", error)
  }
}

// ============================================
// HELIUS API HELPERS
// ============================================

/**
 * Check if a token was created via BonkFun by examining its transaction history.
 * Looks for involvement of BonkFun programs in early transactions.
 */
async function checkTokenOriginViaHelius(mintAddress: string): Promise<VerificationResult> {
  const heliusApiKey = process.env.HELIUS_API_KEY
  if (!heliusApiKey) {
    return { isBonkFun: false, confidence: "low", source: "unknown" }
  }

  try {
    // Get the first few signatures for this token mint
    const signaturesUrl = `https://api.helius.xyz/v0/addresses/${mintAddress}/transactions?api-key=${heliusApiKey}&limit=5`

    const response = await fetch(signaturesUrl, {
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited - don't log every time, just return unknown
        return { isBonkFun: false, confidence: "low", source: "unknown" }
      }
      console.warn(`[BonkFun] Helius API error for ${mintAddress}: ${response.status}`)
      return { isBonkFun: false, confidence: "low", source: "unknown" }
    }

    const transactions: HeliusParsedTransaction[] = await response.json()

    // Check if any transaction involves BonkFun programs
    for (const tx of transactions) {
      if (!tx.instructions) continue

      for (const ix of tx.instructions) {
        // Check if LaunchLab program was involved
        if (ix.programId === BONKFUN_PROGRAMS.LAUNCHLAB_PROGRAM) {
          // Check if BonkFun platform config is in accounts
          if (ix.accounts?.includes(BONKFUN_PROGRAMS.PLATFORM_CONFIG)) {
            return { isBonkFun: true, confidence: "high", source: "helius-history" }
          }
        }

        // Check if graduate program was involved (for graduated tokens)
        if (ix.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM) {
          return { isBonkFun: true, confidence: "high", source: "helius-history" }
        }

        // Check inner instructions too
        if (ix.innerInstructions) {
          for (const inner of ix.innerInstructions) {
            if (
              inner.programId === BONKFUN_PROGRAMS.LAUNCHLAB_PROGRAM ||
              inner.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM
            ) {
              return { isBonkFun: true, confidence: "high", source: "helius-history" }
            }
          }
        }
      }
    }

    // No BonkFun programs found
    return { isBonkFun: false, confidence: "medium", source: "helius-history" }
  } catch (error) {
    console.error(`[BonkFun] Error checking token origin: ${error}`)
    return { isBonkFun: false, confidence: "low", source: "unknown" }
  }
}

/**
 * Check if a Raydium pool was created by BonkFun graduation.
 * This checks the POOL address, not the token mint.
 */
async function checkPoolOriginViaHelius(poolAddress: string): Promise<boolean> {
  const heliusApiKey = process.env.HELIUS_API_KEY
  if (!heliusApiKey || !poolAddress || poolAddress.length < 30) return false

  try {
    const signaturesUrl = `https://api.helius.xyz/v0/addresses/${poolAddress}/transactions?api-key=${heliusApiKey}&limit=5`

    const response = await fetch(signaturesUrl, {
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      return false
    }

    const transactions: HeliusParsedTransaction[] = await response.json()

    // Check the pool creation transaction for BonkFun involvement
    for (const tx of transactions) {
      if (!tx.instructions) continue

      for (const ix of tx.instructions) {
        // Check if graduate program created this pool
        if (ix.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM) {
          return true
        }

        // Check if LaunchLab program was involved
        if (ix.programId === BONKFUN_PROGRAMS.LAUNCHLAB_PROGRAM) {
          return true
        }

        // Check if CPMM pool was created with BonkFun involvement
        if (ix.programId === BONKFUN_PROGRAMS.RAYDIUM_CPMM) {
          // Look for graduate/launchlab program in inner instructions
          if (ix.innerInstructions) {
            for (const inner of ix.innerInstructions) {
              if (
                inner.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM ||
                inner.programId === BONKFUN_PROGRAMS.LAUNCHLAB_PROGRAM
              ) {
                return true
              }
            }
          }
        }

        // Check all inner instructions
        if (ix.innerInstructions) {
          for (const inner of ix.innerInstructions) {
            if (
              inner.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM ||
              inner.programId === BONKFUN_PROGRAMS.LAUNCHLAB_PROGRAM
            ) {
              return true
            }
          }
        }
      }

      // Also check accountData for program involvement
      if (tx.accountData) {
        for (const acc of tx.accountData) {
          if (
            acc.account === BONKFUN_PROGRAMS.GRADUATE_PROGRAM ||
            acc.account === BONKFUN_PROGRAMS.LAUNCHLAB_PROGRAM ||
            acc.account === BONKFUN_PROGRAMS.PLATFORM_CONFIG
          ) {
            return true
          }
        }
      }
    }

    return false
  } catch {
    return false
  }
}

// ============================================
// BATCH VERIFICATION (Optimized with KV caching)
// ============================================

/**
 * Batch verify tokens by checking their origin.
 * Uses KV cache for persistence, only verifies new tokens.
 */
export async function verifyPoolsViaBonkFun(
  pools: Array<{ mint: string; poolAddress: string; poolType?: string }>
): Promise<Set<string>> {
  // If verification is already in progress, wait for it
  if (verificationInProgress && verificationPromise) {
    console.log("[BonkFun] Verification already in progress, waiting...")
    return verificationPromise
  }

  verificationInProgress = true
  verificationPromise = doVerification(pools)

  try {
    return await verificationPromise
  } finally {
    verificationInProgress = false
    verificationPromise = null
  }
}

async function doVerification(
  pools: Array<{ mint: string; poolAddress: string; poolType?: string }>
): Promise<Set<string>> {
  const verified = new Set<string>()
  const heliusApiKey = process.env.HELIUS_API_KEY

  if (!heliusApiKey) {
    console.warn("[BonkFun] No HELIUS_API_KEY - cannot verify BonkFun tokens")
    return verified
  }

  // Step 1: Try to load from KV cache first
  const kvCached = await loadFromKV()
  if (kvCached && kvCached.size > 0) {
    // Use cached data, update in-memory cache
    tokenListCache = {
      tokens: kvCached,
      timestamp: Date.now(),
      source: "kv",
    }
    console.log(`[BonkFun] Using ${kvCached.size} tokens from KV cache`)
    return kvCached
  }

  // Step 2: Filter to valid pools with pool addresses
  const validPools = pools.filter((p) => p.mint && p.mint.length > 30 && p.poolAddress && p.poolAddress.length > 30)
  console.log(`[BonkFun] No KV cache - verifying ${validPools.length} pools via Helius...`)
  console.log(`[BonkFun] This will take ~${Math.ceil(validPools.length * RATE_LIMIT_DELAY_MS / 1000 / 60)} minutes (rate limited to avoid 429 errors)`)

  // Step 3: Verify pools one at a time with rate limiting
  // We check the POOL address (not token mint) because BonkFun graduation happens on the pool
  let successCount = 0
  let errorCount = 0

  for (let i = 0; i < validPools.length; i++) {
    const pool = validPools[i]

    // Check in-memory cache first
    const cached = verificationCache.get(pool.mint)
    if (cached && Date.now() - cached.timestamp < VERIFICATION_CACHE_TTL) {
      if (cached.result.isBonkFun) {
        verified.add(pool.mint)
      }
      continue
    }

    // Rate limit delay BEFORE each request
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS))
    }

    // Check POOL origin (not token mint) - this is where BonkFun graduation happens
    const isBonkFun = await checkPoolOriginViaHelius(pool.poolAddress)

    // Cache the result
    const result: VerificationResult = {
      isBonkFun,
      confidence: isBonkFun ? "high" : "medium",
      source: "pool-authority",
    }
    verificationCache.set(pool.mint, { result, timestamp: Date.now() })

    if (isBonkFun) {
      verified.add(pool.mint)
      successCount++
    }

    // Progress log every 50 tokens
    if ((i + 1) % 50 === 0) {
      console.log(`[BonkFun] Progress: ${i + 1}/${validPools.length} checked, ${verified.size} verified`)
    }
  }

  console.log(`[BonkFun] Completed: ${verified.size}/${validPools.length} verified as BonkFun tokens`)

  // Step 4: Save to KV for next time
  if (verified.size > 0) {
    await saveToKV(verified)
  }

  // Update in-memory cache
  tokenListCache = {
    tokens: verified,
    timestamp: Date.now(),
    source: "helius",
  }

  return verified
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Fetch the BonkFun token whitelist.
 * Uses cached data if available, otherwise returns empty set.
 */
export async function fetchBonkFunWhitelist(): Promise<Set<string>> {
  // Check in-memory cache first
  if (tokenListCache && Date.now() - tokenListCache.timestamp < WHITELIST_CACHE_TTL) {
    console.log(
      `[BonkFun] Using cached whitelist (${tokenListCache.tokens.size} tokens, source: ${tokenListCache.source})`
    )
    return tokenListCache.tokens
  }

  // Try to load from KV
  const kvCached = await loadFromKV()
  if (kvCached && kvCached.size > 0) {
    tokenListCache = {
      tokens: kvCached,
      timestamp: Date.now(),
      source: "kv",
    }
    return kvCached
  }

  // Return empty set - whitelist will be populated during pool verification
  return tokenListCache?.tokens || new Set()
}

/**
 * Verify if a single token is a BonkFun token.
 */
export async function verifyBonkFunToken(mintAddress: string): Promise<VerificationResult> {
  // Check cache first
  const cached = verificationCache.get(mintAddress)
  if (cached && Date.now() - cached.timestamp < VERIFICATION_CACHE_TTL) {
    return cached.result
  }

  // Check whitelist
  if (tokenListCache?.tokens.has(mintAddress)) {
    return { isBonkFun: true, confidence: "high", source: "cache" }
  }

  // Verify via Helius
  const result = await checkTokenOriginViaHelius(mintAddress)

  // Cache result
  verificationCache.set(mintAddress, { result, timestamp: Date.now() })

  return result
}

/**
 * Batch filter tokens to only include verified BonkFun tokens.
 */
export async function filterBonkFunTokens(mintAddresses: string[]): Promise<Set<string>> {
  const whitelist = await fetchBonkFunWhitelist()
  const verified = new Set<string>()

  for (const mint of mintAddresses) {
    if (whitelist.has(mint)) {
      verified.add(mint)
    }
  }

  return verified
}

/**
 * Check if a token is in the cached whitelist (synchronous).
 */
export function isInBonkFunWhitelist(mintAddress: string): boolean | null {
  if (!tokenListCache) return null
  return tokenListCache.tokens.has(mintAddress)
}

/**
 * Get whitelist status for monitoring.
 */
export function getWhitelistStatus(): {
  loaded: boolean
  tokenCount: number
  source: "helius" | "on-chain" | "fallback" | "kv" | "none"
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
    isStale: ageMs > WHITELIST_CACHE_TTL,
  }
}

/**
 * Force refresh the whitelist.
 */
export async function refreshWhitelist(): Promise<number> {
  tokenListCache = null
  verificationCache.clear()
  return 0 // Whitelist is built during pool verification
}

/**
 * Clear all caches including KV.
 */
export async function clearVerificationCaches(): Promise<void> {
  tokenListCache = null
  verificationCache.clear()

  // Clear KV cache too
  const kvUrl = process.env.KV_REST_API_URL
  const kvToken = process.env.KV_REST_API_TOKEN
  if (kvUrl && kvToken) {
    try {
      await fetch(`${kvUrl}/del/${KV_CACHE_KEY}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${kvToken}` },
      })
      console.log("[BonkFun] Cleared KV cache")
    } catch {
      // Ignore errors
    }
  }
}
