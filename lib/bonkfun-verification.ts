/**
 * BonkFun Token Verification Module
 *
 * This module verifies if a token was launched via BonkFun (LetsBonk platform).
 * Uses Helius API (free tier) to check on-chain data.
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
const WHITELIST_CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const VERIFICATION_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours - token origin never changes

// ============================================
// TYPES
// ============================================

interface VerificationResult {
  isBonkFun: boolean
  confidence: "high" | "medium" | "low"
  source: "helius-history" | "program-check" | "pool-authority" | "cache" | "unknown"
}

interface TokenListCache {
  tokens: Set<string>
  timestamp: number
  source: "helius" | "on-chain" | "fallback"
}

interface HeliusSignature {
  signature: string
  slot: number
  err: null | object
  memo: string | null
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

// ============================================
// HELIUS API HELPERS
// ============================================

function getHeliusRpcUrl(): string | null {
  const apiKey = process.env.HELIUS_API_KEY
  if (!apiKey) return null
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`
}

function getHeliusApiUrl(): string | null {
  const apiKey = process.env.HELIUS_API_KEY
  if (!apiKey) return null
  return `https://api.helius.xyz/v0`
}

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
 * This is faster than checking individual tokens.
 */
async function checkPoolOriginViaHelius(poolAddress: string): Promise<boolean> {
  const heliusApiKey = process.env.HELIUS_API_KEY
  if (!heliusApiKey) return false

  try {
    const signaturesUrl = `https://api.helius.xyz/v0/addresses/${poolAddress}/transactions?api-key=${heliusApiKey}&limit=3`

    const response = await fetch(signaturesUrl, {
      headers: { Accept: "application/json" },
    })

    if (!response.ok) return false

    const transactions: HeliusParsedTransaction[] = await response.json()

    // Check the pool creation transaction
    for (const tx of transactions) {
      if (!tx.instructions) continue

      for (const ix of tx.instructions) {
        // Check if graduate program created this pool
        if (ix.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM) {
          return true
        }

        // Check if CPMM pool was created with BonkFun involvement
        if (ix.programId === BONKFUN_PROGRAMS.RAYDIUM_CPMM) {
          // Look for graduate program in inner instructions
          if (ix.innerInstructions) {
            for (const inner of ix.innerInstructions) {
              if (inner.programId === BONKFUN_PROGRAMS.GRADUATE_PROGRAM) {
                return true
              }
            }
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
// BATCH VERIFICATION (Optimized)
// ============================================

/**
 * Batch verify tokens by checking pool authorities.
 * This is more efficient than checking each token individually.
 */
export async function verifyPoolsViaBonkFun(
  pools: Array<{ mint: string; poolAddress: string; poolType?: string }>
): Promise<Set<string>> {
  const verified = new Set<string>()
  const heliusApiKey = process.env.HELIUS_API_KEY

  if (!heliusApiKey) {
    console.warn("[BonkFun] No HELIUS_API_KEY - cannot verify BonkFun tokens")
    return verified
  }

  // Filter out pools without valid pool addresses
  const validPools = pools.filter((p) => p.poolAddress && p.poolAddress.length > 30)

  console.log(`[BonkFun] Verifying ${validPools.length} pools via Helius (from ${pools.length} total)...`)

  // Batch check pools (with rate limiting)
  // Helius free tier: 10 RPS, so we process 5 pools per batch with 1s delay
  // (each pool may need 2 API calls: token origin + pool origin)
  const BATCH_SIZE = 5
  const DELAY_MS = 1000 // 1s between batches to stay within free tier limits

  for (let i = 0; i < validPools.length; i += BATCH_SIZE) {
    const batch = validPools.slice(i, i + BATCH_SIZE)

    const results = await Promise.all(
      batch.map(async (pool) => {
        // Check cache first
        const cached = verificationCache.get(pool.mint)
        if (cached && Date.now() - cached.timestamp < VERIFICATION_CACHE_TTL) {
          return { mint: pool.mint, isBonkFun: cached.result.isBonkFun }
        }

        // Check TOKEN MINT origin AND pool origin in PARALLEL
        // Token: Looks for BonkFun's LaunchLab program with platform config
        // Pool: Looks for BonkFun graduation program involvement
        const [tokenResult, poolResult] = await Promise.all([
          checkTokenOriginViaHelius(pool.mint),
          pool.poolAddress ? checkPoolOriginViaHelius(pool.poolAddress) : Promise.resolve(false),
        ])

        const isBonkFun = tokenResult.isBonkFun || poolResult

        // Cache result
        verificationCache.set(pool.mint, {
          result: {
            isBonkFun,
            confidence: isBonkFun ? "high" : "medium",
            source: tokenResult.isBonkFun ? tokenResult.source : "pool-authority",
          },
          timestamp: Date.now(),
        })

        return { mint: pool.mint, isBonkFun }
      })
    )

    for (const result of results) {
      if (result.isBonkFun) {
        verified.add(result.mint)
      }
    }

    // Rate limit delay
    if (i + BATCH_SIZE < validPools.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
    }

    // Progress log every 50 pools
    if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= validPools.length) {
      console.log(`[BonkFun] Progress: ${Math.min(i + BATCH_SIZE, validPools.length)}/${validPools.length} pools checked, ${verified.size} verified`)
    }
  }

  console.log(`[BonkFun] Verified ${verified.size}/${validPools.length} as genuine BonkFun tokens`)

  // Update whitelist cache
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
  // Check cache first
  if (tokenListCache && Date.now() - tokenListCache.timestamp < WHITELIST_CACHE_TTL) {
    console.log(
      `[BonkFun] Using cached whitelist (${tokenListCache.tokens.size} tokens, source: ${tokenListCache.source})`
    )
    return tokenListCache.tokens
  }

  // Return empty set - whitelist will be populated during pool verification
  // This prevents the strict mode from blocking all data
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
  source: "helius" | "on-chain" | "fallback" | "none"
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
 * Clear all caches.
 */
export function clearVerificationCaches(): void {
  tokenListCache = null
  verificationCache.clear()
}
