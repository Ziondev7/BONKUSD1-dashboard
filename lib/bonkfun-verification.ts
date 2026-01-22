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
const KV_CACHE_TTL = 24 * 60 * 60 // 24 hours in seconds for KV (reduced from 7 days)

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

// Three-state verification outcome to handle inconclusive results properly
type VerificationOutcome =
  | { status: 'verified'; isBonkFun: true; confidence: 'high' | 'medium' }
  | { status: 'verified'; isBonkFun: false }
  | { status: 'inconclusive'; reason: 'rate_limited' | 'api_error' | 'timeout' | 'no_pool_address' | 'invalid_input' }

// Pending retry entry for tokens with inconclusive verification
interface PendingRetryEntry {
  mint: string
  poolAddress: string
  attempts: number
  lastAttempt: number
  reason: string
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

// Queue of tokens with inconclusive verification results for retry
const pendingRetry = new Map<string, PendingRetryEntry>()
const MAX_RETRY_ATTEMPTS = 5
const RETRY_BACKOFF_BASE_MS = 60000 // 1 minute base

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
 * Fallback verification: Check if a token MINT was created via BonkFun.
 * Used when pool address is unavailable or pool verification fails.
 * Returns VerificationOutcome with proper three-state handling.
 */
async function checkTokenMintOriginViaHelius(mintAddress: string): Promise<VerificationOutcome> {
  const heliusApiKey = process.env.HELIUS_API_KEY
  if (!heliusApiKey) {
    return { status: 'inconclusive', reason: 'api_error' }
  }

  if (!mintAddress || mintAddress.length < 30) {
    return { status: 'inconclusive', reason: 'invalid_input' }
  }

  try {
    // Get transactions for this token mint
    const signaturesUrl = `https://api.helius.xyz/v0/addresses/${mintAddress}/transactions?api-key=${heliusApiKey}&limit=10`

    const response = await fetch(signaturesUrl, {
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      if (response.status === 429) {
        return { status: 'inconclusive', reason: 'rate_limited' }
      }
      return { status: 'inconclusive', reason: 'api_error' }
    }

    const transactions: HeliusParsedTransaction[] = await response.json()

    for (const tx of transactions) {
      if (!tx.instructions) continue

      for (const ix of tx.instructions) {
        // Check for LaunchLab program with BonkFun platform config
        if (ix.programId === BONKFUN_PROGRAMS.LAUNCHLAB_PROGRAM) {
          if (ix.accounts?.includes(BONKFUN_PROGRAMS.PLATFORM_CONFIG)) {
            return { status: 'verified', isBonkFun: true, confidence: 'high' }
          }
          // LaunchLab without platform config - could be from different platform
          return { status: 'verified', isBonkFun: true, confidence: 'medium' }
        }

        // Check for graduate program involvement
        if (ix.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM) {
          return { status: 'verified', isBonkFun: true, confidence: 'high' }
        }

        // Check inner instructions
        if (ix.innerInstructions) {
          for (const inner of ix.innerInstructions) {
            if (
              inner.programId === BONKFUN_PROGRAMS.LAUNCHLAB_PROGRAM ||
              inner.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM
            ) {
              return { status: 'verified', isBonkFun: true, confidence: 'medium' }
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
            return { status: 'verified', isBonkFun: true, confidence: 'medium' }
          }
        }
      }
    }

    // No BonkFun programs found - definitively not BonkFun
    return { status: 'verified', isBonkFun: false }
  } catch (error) {
    console.error(`[BonkFun] Error checking mint origin for ${mintAddress.slice(0, 8)}...: ${error}`)
    return { status: 'inconclusive', reason: 'api_error' }
  }
}

/**
 * Check if a Raydium pool was created by BonkFun graduation.
 * This checks the POOL address, not the token mint.
 * Returns VerificationOutcome with proper three-state handling.
 */
async function checkPoolOriginViaHeliusWithOutcome(poolAddress: string): Promise<VerificationOutcome> {
  const heliusApiKey = process.env.HELIUS_API_KEY
  if (!heliusApiKey) {
    return { status: 'inconclusive', reason: 'api_error' }
  }

  if (!poolAddress || poolAddress.length < 30) {
    return { status: 'inconclusive', reason: 'no_pool_address' }
  }

  try {
    const signaturesUrl = `https://api.helius.xyz/v0/addresses/${poolAddress}/transactions?api-key=${heliusApiKey}&limit=5`

    const response = await fetch(signaturesUrl, {
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      if (response.status === 429) {
        return { status: 'inconclusive', reason: 'rate_limited' }
      }
      return { status: 'inconclusive', reason: 'api_error' }
    }

    const transactions: HeliusParsedTransaction[] = await response.json()

    // Check the pool creation transaction for BonkFun involvement
    for (const tx of transactions) {
      if (!tx.instructions) continue

      for (const ix of tx.instructions) {
        // Check if graduate program created this pool
        if (ix.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM) {
          return { status: 'verified', isBonkFun: true, confidence: 'high' }
        }

        // Check if LaunchLab program was involved
        if (ix.programId === BONKFUN_PROGRAMS.LAUNCHLAB_PROGRAM) {
          return { status: 'verified', isBonkFun: true, confidence: 'high' }
        }

        // Check if CPMM pool was created with BonkFun involvement
        if (ix.programId === BONKFUN_PROGRAMS.RAYDIUM_CPMM) {
          if (ix.innerInstructions) {
            for (const inner of ix.innerInstructions) {
              if (
                inner.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM ||
                inner.programId === BONKFUN_PROGRAMS.LAUNCHLAB_PROGRAM
              ) {
                return { status: 'verified', isBonkFun: true, confidence: 'high' }
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
              return { status: 'verified', isBonkFun: true, confidence: 'high' }
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
            return { status: 'verified', isBonkFun: true, confidence: 'medium' }
          }
        }
      }
    }

    // No BonkFun programs found - definitively not BonkFun
    return { status: 'verified', isBonkFun: false }
  } catch (error) {
    console.error(`[BonkFun] Error checking pool origin for ${poolAddress.slice(0, 8)}...: ${error}`)
    return { status: 'inconclusive', reason: 'api_error' }
  }
}

/**
 * Verify a token using multiple methods in sequence.
 * Returns as soon as a definitive result is found.
 * Falls back to token mint verification if pool verification fails.
 */
async function verifyTokenWithFallbacks(
  mint: string,
  poolAddress?: string
): Promise<VerificationOutcome> {
  // Method 1: Check pool origin (preferred - most reliable)
  if (poolAddress && poolAddress.length >= 30) {
    const poolResult = await checkPoolOriginViaHeliusWithOutcome(poolAddress)
    if (poolResult.status === 'verified') {
      return poolResult
    }
    // If inconclusive, try fallback
    console.log(`[BonkFun] Pool check inconclusive for ${mint.slice(0, 8)}..., trying mint verification`)
  }

  // Method 2: Check token mint origin (fallback)
  const mintResult = await checkTokenMintOriginViaHelius(mint)
  return mintResult
}

/**
 * Check if a Raydium pool was created by BonkFun graduation.
 * This checks the POOL address, not the token mint.
 * @deprecated Use checkPoolOriginViaHeliusWithOutcome for better error handling
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

  // Step 1: Load existing verified tokens from KV cache
  const kvCached = await loadFromKV()

  if (kvCached && kvCached.size > 0) {
    // Add all cached tokens to verified set
    kvCached.forEach(mint => verified.add(mint))

    // Step 2: Identify NEW tokens not in cache
    const newPools = pools.filter(p =>
      p.mint &&
      p.mint.length > 30 &&
      !kvCached.has(p.mint)
    )

    if (newPools.length === 0) {
      console.log(`[BonkFun] Using ${kvCached.size} tokens from KV cache, no new tokens to verify`)
      tokenListCache = {
        tokens: kvCached,
        timestamp: Date.now(),
        source: "kv",
      }
      return verified
    }

    console.log(`[BonkFun] Found ${newPools.length} new tokens to verify (${kvCached.size} already cached)`)

    // Step 3: Verify only new tokens with fallback support
    let newVerifiedCount = 0
    let inconclusiveCount = 0

    for (let i = 0; i < newPools.length; i++) {
      const pool = newPools[i]

      // Check in-memory cache first
      const cached = verificationCache.get(pool.mint)
      if (cached && Date.now() - cached.timestamp < VERIFICATION_CACHE_TTL) {
        if (cached.result.isBonkFun) {
          verified.add(pool.mint)
          newVerifiedCount++
        }
        continue
      }

      // Rate limit
      if (i > 0) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS))
      }

      // Use new verification with fallbacks
      const result = await verifyTokenWithFallbacks(pool.mint, pool.poolAddress)

      if (result.status === 'verified') {
        // Only cache definitive results
        const cacheResult: VerificationResult = {
          isBonkFun: result.isBonkFun,
          confidence: result.isBonkFun ? result.confidence : 'high',
          source: 'pool-authority',
        }
        verificationCache.set(pool.mint, { result: cacheResult, timestamp: Date.now() })

        if (result.isBonkFun) {
          verified.add(pool.mint)
          newVerifiedCount++
        }
      } else {
        // Inconclusive - add to retry queue (don't cache false negatives)
        inconclusiveCount++
        pendingRetry.set(pool.mint, {
          mint: pool.mint,
          poolAddress: pool.poolAddress,
          attempts: 1,
          lastAttempt: Date.now(),
          reason: result.reason
        })
      }

      // Progress log
      if ((i + 1) % 20 === 0) {
        console.log(`[BonkFun] New token progress: ${i + 1}/${newPools.length}, ${newVerifiedCount} verified, ${inconclusiveCount} inconclusive`)
      }
    }

    // Step 4: Update KV with new verified tokens
    if (newVerifiedCount > 0) {
      console.log(`[BonkFun] Adding ${newVerifiedCount} new verified tokens to cache (${inconclusiveCount} pending retry)`)
      await saveToKV(verified)
    }

    tokenListCache = {
      tokens: verified,
      timestamp: Date.now(),
      source: "helius",
    }

    return verified
  }

  // COLD START: No KV cache - verify all pools
  const validPools = pools.filter((p) => p.mint && p.mint.length > 30)
  console.log(`[BonkFun] Cold start - verifying ${validPools.length} pools via Helius...`)
  console.log(`[BonkFun] This will take ~${Math.ceil(validPools.length * RATE_LIMIT_DELAY_MS / 1000 / 60)} minutes (rate limited to avoid 429 errors)`)

  let successCount = 0
  let inconclusiveCount = 0

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

    // Rate limit delay
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS))
    }

    // Use new verification with fallbacks
    const result = await verifyTokenWithFallbacks(pool.mint, pool.poolAddress)

    if (result.status === 'verified') {
      // Only cache definitive results
      const cacheResult: VerificationResult = {
        isBonkFun: result.isBonkFun,
        confidence: result.isBonkFun ? result.confidence : 'high',
        source: 'pool-authority',
      }
      verificationCache.set(pool.mint, { result: cacheResult, timestamp: Date.now() })

      if (result.isBonkFun) {
        verified.add(pool.mint)
        successCount++
      }
    } else {
      // Inconclusive - add to retry queue
      inconclusiveCount++
      pendingRetry.set(pool.mint, {
        mint: pool.mint,
        poolAddress: pool.poolAddress,
        attempts: 1,
        lastAttempt: Date.now(),
        reason: result.reason
      })
    }

    // Progress log every 50 tokens
    if ((i + 1) % 50 === 0) {
      console.log(`[BonkFun] Progress: ${i + 1}/${validPools.length} checked, ${verified.size} verified, ${inconclusiveCount} inconclusive`)
    }
  }

  console.log(`[BonkFun] Completed: ${verified.size}/${validPools.length} verified as BonkFun tokens (${inconclusiveCount} pending retry)`)

  // Save to KV
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

/**
 * Process tokens in the retry queue with exponential backoff.
 * Called by cron job to retry failed verifications.
 */
export async function processRetryQueue(): Promise<{ processed: number; verified: number; remaining: number }> {
  const now = Date.now()
  let processed = 0
  let verified = 0

  const toProcess: PendingRetryEntry[] = []

  for (const [mint, entry] of pendingRetry) {
    if (entry.attempts >= MAX_RETRY_ATTEMPTS) {
      // Give up after max attempts - remove from queue
      pendingRetry.delete(mint)
      continue
    }

    const backoffMs = Math.min(
      RETRY_BACKOFF_BASE_MS * Math.pow(2, entry.attempts - 1),
      3600000 // Max 1 hour
    )

    if (now - entry.lastAttempt >= backoffMs) {
      toProcess.push(entry)
    }
  }

  if (toProcess.length === 0) {
    return { processed: 0, verified: 0, remaining: pendingRetry.size }
  }

  console.log(`[BonkFun] Processing ${toProcess.length} tokens from retry queue...`)

  for (const entry of toProcess) {
    // Retry verification with fallbacks
    const result = await verifyTokenWithFallbacks(entry.mint, entry.poolAddress)
    processed++

    if (result.status === 'verified') {
      pendingRetry.delete(entry.mint)

      if (result.isBonkFun) {
        verified++

        // Add to KV cache
        const kvCached = await loadFromKV()
        if (kvCached) {
          kvCached.add(entry.mint)
          await saveToKV(kvCached)
        }

        // Update in-memory cache
        if (tokenListCache) {
          tokenListCache.tokens.add(entry.mint)
        }
      }
    } else {
      // Still inconclusive - update attempt count
      entry.attempts++
      entry.lastAttempt = now
      entry.reason = result.reason
    }

    // Rate limit between retries
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS))
  }

  console.log(`[BonkFun] Retry queue: ${processed} processed, ${verified} verified, ${pendingRetry.size} remaining`)

  return { processed, verified, remaining: pendingRetry.size }
}

/**
 * Get retry queue status for monitoring.
 */
export function getRetryQueueStatus(): { size: number; entries: Array<{ mint: string; attempts: number; reason: string }> } {
  const entries = Array.from(pendingRetry.values()).map(e => ({
    mint: e.mint.slice(0, 8) + '...',
    attempts: e.attempts,
    reason: e.reason
  }))
  return { size: pendingRetry.size, entries: entries.slice(0, 10) } // Return first 10
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
