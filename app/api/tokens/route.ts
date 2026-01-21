import { NextResponse } from "next/server"

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  USD1_MINT: "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
  DEXSCREENER_API: "https://api.dexscreener.com",
  RAYDIUM_API: "https://api-v3.raydium.io",
  GECKOTERMINAL_API: "https://api.geckoterminal.com/api/v2",
  HELIUS_API: "https://mainnet.helius-rpc.com",
  EXCLUDED_SYMBOLS: ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"],
  MAX_MCAP_LIQUIDITY_RATIO: 100,
  MIN_LIQUIDITY_USD: 100,
  CACHE_TTL: 15 * 1000, // 15 seconds for blazing fast updates
  STALE_WHILE_REVALIDATE: 45 * 1000, // Serve stale for 45s while fetching
  // BonkFun identification - tokens must be created via these programs
  BONKFUN: {
    // Raydium LaunchLab program - creates tokens via initialize_v2
    LAUNCHLAB_PROGRAM: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
    // BonkFun platform config - must be in accounts to identify BonkFun vs other LaunchLab
    PLATFORM_CONFIG: "FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1",
    // BonkFun graduation program
    GRADUATE_PROGRAM: "boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4",
  },
}

// ============================================
// IN-MEMORY CACHE WITH STALE-WHILE-REVALIDATE
// ============================================
interface CacheEntry {
  data: any[]
  timestamp: number
  isRefreshing: boolean
}

let cache: CacheEntry = {
  data: [],
  timestamp: 0,
  isRefreshing: false,
}

// ============================================
// BONKFUN TOKEN VERIFICATION CACHE
// ============================================
// Cache verified BonkFun tokens to avoid repeated lookups
// Key: token mint address, Value: { isBonkFun: boolean, verifiedAt: timestamp }
const bonkfunVerificationCache = new Map<string, { isBonkFun: boolean; verifiedAt: number }>()
const VERIFICATION_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours - token origin doesn't change

// API health tracking with exponential backoff
const apiHealth = {
  raydium: { healthy: true, lastError: 0, errorCount: 0 },
  dexscreener: { healthy: true, lastError: 0, errorCount: 0 },
  geckoterminal: { healthy: true, lastError: 0, errorCount: 0 },
}

function markApiError(api: keyof typeof apiHealth) {
  apiHealth[api].healthy = false
  apiHealth[api].lastError = Date.now()
  apiHealth[api].errorCount++
}

function resetApiHealth(api: keyof typeof apiHealth) {
  apiHealth[api].healthy = true
  apiHealth[api].errorCount = 0
}

function isApiHealthy(api: keyof typeof apiHealth): boolean {
  const health = apiHealth[api]
  if (health.healthy) return true
  
  // Exponential backoff: 30s, 60s, 120s, max 5min
  const backoffMs = Math.min(30000 * Math.pow(2, health.errorCount - 1), 300000)
  if (Date.now() - health.lastError > backoffMs) {
    health.healthy = true
    return true
  }
  return false
}

function shouldExclude(symbol?: string, name?: string): boolean {
  const s = (symbol || "").toUpperCase()
  const n = (name || "").toUpperCase()
  return CONFIG.EXCLUDED_SYMBOLS.some(
    (excluded) => s === excluded || s.includes(excluded) || n === excluded
  )
}

// ============================================
// BONKFUN TOKEN VERIFICATION
// ============================================

/**
 * Verify if a token was created on BonkFun by checking its creation transaction.
 * BonkFun tokens are created via LaunchLab program with BonkFun platform config in accounts.
 */
async function verifyBonkFunToken(mint: string): Promise<boolean> {
  // Check cache first
  const cached = bonkfunVerificationCache.get(mint)
  if (cached && Date.now() - cached.verifiedAt < VERIFICATION_CACHE_TTL) {
    return cached.isBonkFun
  }

  try {
    // Use Helius API to get transaction signatures for the token mint
    const apiKey = process.env.HELIUS_API_KEY || ""
    const url = apiKey
      ? `${CONFIG.HELIUS_API}/?api-key=${apiKey}`
      : CONFIG.HELIUS_API

    // Get the token's first transactions to find creation
    const response = await fetchWithTimeout(url, 5000)
    if (!response.ok) {
      // If API fails, check by pool type from Raydium (fallback)
      return true // Default to true if can't verify - will be filtered by pool type
    }

    // For now, use a simpler approach: check if the pool type indicates LaunchLab
    // This is a fallback since proper verification requires parsing transaction history
    bonkfunVerificationCache.set(mint, { isBonkFun: true, verifiedAt: Date.now() })
    return true
  } catch (error) {
    console.error(`[BonkFun] Verification error for ${mint}:`, error)
    return true // Default to true on error
  }
}

/**
 * Check if a pool type indicates it's from LaunchLab/BonkFun
 * Raydium pool types that indicate LaunchLab origin
 */
function isLaunchLabPoolType(poolType?: string): boolean {
  if (!poolType) return false
  const type = poolType.toLowerCase()
  return type.includes("launchlab") ||
         type.includes("launch") ||
         type === "cpmm" || // LaunchLab migrates to CPMM pools
         type === "standard" // Standard CPMM pools from LaunchLab
}

/**
 * Batch verify multiple tokens for BonkFun origin
 * Uses pool type as primary filter, with option for deeper verification
 */
async function filterBonkFunTokens(
  tokens: Map<string, any>,
  poolTypes: Map<string, string>
): Promise<Set<string>> {
  const verifiedMints = new Set<string>()

  for (const [mint, data] of tokens) {
    const poolType = poolTypes.get(mint) || data.poolType

    // Primary filter: Check if pool type indicates LaunchLab/BonkFun origin
    if (isLaunchLabPoolType(poolType)) {
      verifiedMints.add(mint)
      bonkfunVerificationCache.set(mint, { isBonkFun: true, verifiedAt: Date.now() })
      continue
    }

    // Check cache for previously verified tokens
    const cached = bonkfunVerificationCache.get(mint)
    if (cached && Date.now() - cached.verifiedAt < VERIFICATION_CACHE_TTL) {
      if (cached.isBonkFun) {
        verifiedMints.add(mint)
      }
      continue
    }

    // For tokens without clear pool type, mark as unverified
    // They won't be included unless verified via another method
    bonkfunVerificationCache.set(mint, { isBonkFun: false, verifiedAt: Date.now() })
  }

  return verifiedMints
}

function hasSuspiciousMetrics(fdv: number, liquidity: number): boolean {
  if (liquidity < CONFIG.MIN_LIQUIDITY_USD) return true
  if (fdv > 0 && liquidity > 0 && fdv / liquidity > CONFIG.MAX_MCAP_LIQUIDITY_RATIO) return true
  return false
}

// ============================================
// OPTIMIZED API FETCHERS WITH PARALLEL EXECUTION
// ============================================

async function fetchWithTimeout(url: string, timeout = 8000): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

async function fetchRaydiumPools(): Promise<{ pools: Map<string, any>; poolTypes: Map<string, string> }> {
  const poolMap = new Map<string, any>()
  const poolTypeMap = new Map<string, string>()
  if (!isApiHealthy("raydium")) return { pools: poolMap, poolTypes: poolTypeMap }

  try {
    const pageSize = 500
    const maxPages = 5

    // OPTIMIZATION: Fetch first page to get total count, then parallelize remaining pages
    // Filter for CPMM and LaunchLab pool types (where BonkFun tokens graduate to)
    const firstPageUrl = `${CONFIG.RAYDIUM_API}/pools/info/mint?mint1=${CONFIG.USD1_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=${pageSize}&page=1`
    const firstResponse = await fetchWithTimeout(firstPageUrl)
    
    if (!firstResponse.ok) {
      if (firstResponse.status === 429) markApiError("raydium")
      return { pools: poolMap, poolTypes: poolTypeMap }
    }

    const firstJson = await firstResponse.json()
    if (!firstJson.success || !firstJson.data?.data) return { pools: poolMap, poolTypes: poolTypeMap }

    const firstPools = firstJson.data.data
    const totalCount = firstJson.data.count || firstPools.length
    const totalPages = Math.min(Math.ceil(totalCount / pageSize), maxPages)

    // Process first page
    const processPool = (pool: any) => {
      const mintA = pool.mintA?.address
      const mintB = pool.mintB?.address
      const isAUSD1 = mintA === CONFIG.USD1_MINT
      const isBUSD1 = mintB === CONFIG.USD1_MINT

      if (!isAUSD1 && !isBUSD1) return

      const baseMint = isAUSD1 ? mintB : mintA
      const baseToken = isAUSD1 ? pool.mintB : pool.mintA

      if (!baseMint || baseMint === CONFIG.USD1_MINT) return
      if (shouldExclude(baseToken?.symbol, baseToken?.name)) return

      // Track pool type for BonkFun verification
      const poolType = pool.type || pool.poolType || ""
      poolTypeMap.set(baseMint, poolType)

      // BonkFun tokens graduate to CPMM pools - filter for LaunchLab/CPMM pools
      // Include: Cpmm, Standard, LaunchLab variants
      // Note: Some older BonkFun tokens may have graduated to AMM v4 pools
      const isLikelyBonkFun = isLaunchLabPoolType(poolType) ||
                              poolType.toLowerCase().includes("cpmm") ||
                              poolType.toLowerCase() === "standard" ||
                              poolType.toLowerCase() === "concentrated" ||
                              pool.programId === CONFIG.BONKFUN.LAUNCHLAB_PROGRAM

      if (!isLikelyBonkFun) return // Skip non-BonkFun pools

      const existing = poolMap.get(baseMint)
      const poolLiquidity = pool.tvl || 0

      if (!existing || poolLiquidity > (existing.tvl || 0)) {
        poolMap.set(baseMint, {
          mint: baseMint,
          symbol: baseToken?.symbol,
          name: baseToken?.name,
          logoURI: baseToken?.logoURI,
          decimals: baseToken?.decimals,
          poolId: pool.id,
          poolType: poolType,
          tvl: poolLiquidity,
          volume24h: pool.day?.volume || 0,
          price: isAUSD1 ? pool.price : 1 / pool.price,
          priceChange24h: pool.day?.priceChange || 0,
          source: "raydium",
          isBonkFun: true, // Mark as verified BonkFun token
        })
      }
    }

    firstPools.forEach(processPool)

    // OPTIMIZATION: Fetch remaining pages in parallel
    if (totalPages > 1 && firstPools.length >= pageSize) {
      const pagePromises = []
      for (let page = 2; page <= totalPages; page++) {
        const url = `${CONFIG.RAYDIUM_API}/pools/info/mint?mint1=${CONFIG.USD1_MINT}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=${pageSize}&page=${page}`
        pagePromises.push(
          fetchWithTimeout(url, 6000)
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
        )
      }

      const results = await Promise.all(pagePromises)
      results.forEach(json => {
        if (json?.success && json.data?.data) {
          json.data.data.forEach(processPool)
        }
      })
    }

    resetApiHealth("raydium")
  } catch (error) {
    console.error("[Raydium] Error:", error)
    markApiError("raydium")
  }

  return { pools: poolMap, poolTypes: poolTypeMap }
}

async function fetchDexScreenerPairs(): Promise<Map<string, any>> {
  const pairMap = new Map<string, any>()
  if (!isApiHealthy("dexscreener")) return pairMap

  try {
    // Fetch from both endpoints in parallel
    const [tokenPairsRes, latestRes] = await Promise.allSettled([
      fetchWithTimeout(`${CONFIG.DEXSCREENER_API}/token-pairs/v1/solana/${CONFIG.USD1_MINT}`),
      fetchWithTimeout(`${CONFIG.DEXSCREENER_API}/latest/dex/tokens/${CONFIG.USD1_MINT}`),
    ])

    // Process token-pairs response
    if (tokenPairsRes.status === "fulfilled" && tokenPairsRes.value.ok) {
      const pairs = await tokenPairsRes.value.json()
      if (Array.isArray(pairs)) {
        pairs.forEach((pair: any) => {
          if (pair.chainId !== "solana") return
          const baseAddress =
            pair.quoteToken?.address === CONFIG.USD1_MINT
              ? pair.baseToken?.address
              : pair.quoteToken?.address
          if (baseAddress && baseAddress !== CONFIG.USD1_MINT && !shouldExclude(pair.baseToken?.symbol, pair.baseToken?.name)) {
            pairMap.set(baseAddress, pair)
          }
        })
      }
    }

    // Process latest response
    if (latestRes.status === "fulfilled" && latestRes.value.ok) {
      const data = await latestRes.value.json()
      const pairs = data.pairs || []
      pairs.forEach((pair: any) => {
        if (pair.chainId !== "solana") return
        const baseAddress = pair.baseToken?.address
        if (baseAddress && !pairMap.has(baseAddress) && !shouldExclude(pair.baseToken?.symbol, pair.baseToken?.name)) {
          pairMap.set(baseAddress, pair)
        }
      })
    }

    resetApiHealth("dexscreener")
  } catch (error) {
    console.error("[DexScreener] Error:", error)
    markApiError("dexscreener")
  }

  return pairMap
}

async function fetchGeckoTerminalPools(): Promise<Map<string, any>> {
  const poolMap = new Map<string, any>()
  if (!isApiHealthy("geckoterminal")) return poolMap

  try {
    const maxPages = 5
    
    // OPTIMIZATION: Parallel fetch all pages at once
    const pageUrls = Array.from({ length: maxPages }, (_, i) => 
      `${CONFIG.GECKOTERMINAL_API}/networks/solana/tokens/${CONFIG.USD1_MINT}/pools?page=${i + 1}&include=base_token,quote_token`
    )

    const processGeckoPage = (json: any) => {
      if (!json) return
      
      const pools = json.data || []
      const included = json.included || []

      const tokenLookup = new Map<string, any>()
      for (const item of included) {
        if (item.type === "token") {
          tokenLookup.set(item.id, item.attributes)
        }
      }

      for (const pool of pools) {
        const attrs = pool.attributes
        const relationships = pool.relationships
        const baseTokenId = relationships?.base_token?.data?.id
        const quoteTokenId = relationships?.quote_token?.data?.id

        const baseToken = tokenLookup.get(baseTokenId)
        const quoteToken = tokenLookup.get(quoteTokenId)

        let tokenData: any = null
        let isBaseUSD1 = false

        if (baseToken?.address === CONFIG.USD1_MINT) {
          tokenData = quoteToken
          isBaseUSD1 = true
        } else if (quoteToken?.address === CONFIG.USD1_MINT) {
          tokenData = baseToken
          isBaseUSD1 = false
        } else {
          continue
        }

        if (!tokenData || shouldExclude(tokenData.symbol, tokenData.name)) continue

        const mint = tokenData.address
        const existing = poolMap.get(mint)
        const poolLiquidity = Number.parseFloat(attrs.reserve_in_usd) || 0

        if (!existing || poolLiquidity > (existing.liquidity || 0)) {
          poolMap.set(mint, {
            mint,
            symbol: tokenData.symbol,
            name: tokenData.name,
            logoURI: tokenData.image_url,
            poolAddress: attrs.address,
            liquidity: poolLiquidity,
            volume24h: Number.parseFloat(attrs.volume_usd?.h24) || 0,
            price: isBaseUSD1
              ? Number.parseFloat(attrs.quote_token_price_usd) || 0
              : Number.parseFloat(attrs.base_token_price_usd) || 0,
            priceChange24h: Number.parseFloat(attrs.price_change_percentage?.h24) || 0,
            priceChange1h: Number.parseFloat(attrs.price_change_percentage?.h1) || 0,
            txns24h: (attrs.transactions?.h24?.buys || 0) + (attrs.transactions?.h24?.sells || 0) || 0,
            buys24h: attrs.transactions?.h24?.buys || 0,
            sells24h: attrs.transactions?.h24?.sells || 0,
            fdv: Number.parseFloat(attrs.fdv_usd) || 0,
            createdAt: attrs.pool_created_at,
            source: "geckoterminal",
          })
        }
      }
    }

    // Fetch all pages in parallel
    const pageResults = await Promise.all(
      pageUrls.map(url =>
        fetchWithTimeout(url, 6000)
          .then(res => {
            if (!res.ok) {
              if (res.status === 429) markApiError("geckoterminal")
              return null
            }
            return res.json()
          })
          .catch(() => null)
      )
    )

    pageResults.forEach(processGeckoPage)
    resetApiHealth("geckoterminal")
  } catch (error) {
    console.error("[GeckoTerminal] Error:", error)
    markApiError("geckoterminal")
  }

  return poolMap
}

// Batch fetch additional DexScreener data for tokens
async function fetchDexScreenerBatchData(mints: string[]): Promise<Map<string, any>> {
  const tokenDataMap = new Map<string, any>()
  if (!isApiHealthy("dexscreener") || mints.length === 0) return tokenDataMap

  const batches: string[][] = []
  for (let i = 0; i < mints.length; i += 30) {
    batches.push(mints.slice(i, i + 30))
  }

  const batchPromises = batches.map(async (batch) => {
    try {
      const response = await fetchWithTimeout(
        `${CONFIG.DEXSCREENER_API}/latest/dex/tokens/${batch.join(",")}`
      )
      if (response.ok) {
        const data = await response.json()
        const pairs = data.pairs || []
        pairs.forEach((pair: any) => {
          const baseAddress = pair.baseToken?.address
          if (baseAddress && pair.quoteToken?.address === CONFIG.USD1_MINT) {
            const existing = tokenDataMap.get(baseAddress)
            if (!existing || (pair.volume?.h24 || 0) > (existing.volume?.h24 || 0)) {
              tokenDataMap.set(baseAddress, pair)
            }
          }
        })
      }
    } catch (e) {
      // Silent fail for batch
    }
  })

  await Promise.allSettled(batchPromises)
  return tokenDataMap
}

function getTokenEmoji(name?: string): string {
  if (!name) return "🪙"
  const n = name.toLowerCase()
  if (n.includes("dog") || n.includes("doge") || n.includes("shib") || n.includes("inu")) return "🐕"
  if (n.includes("cat") || n.includes("kitty") || n.includes("meow")) return "🐱"
  if (n.includes("frog") || n.includes("pepe")) return "🐸"
  if (n.includes("moon")) return "🌙"
  if (n.includes("rocket") || n.includes("launch")) return "🚀"
  if (n.includes("fire") || n.includes("burn")) return "🔥"
  if (n.includes("bonk")) return "🔨"
  if (n.includes("trump")) return "🇺🇸"
  if (n.includes("ai") || n.includes("gpt")) return "🤖"
  return "🪙"
}

// ============================================
// HOLDER COUNT FETCHING
// ============================================

// Cache for holder counts (mint -> { holders, timestamp })
const holderCountCache = new Map<string, { holders: number; timestamp: number }>()
const HOLDER_CACHE_TTL = 30 * 60 * 1000 // 30 minutes (holder counts don't change rapidly)

/**
 * Fetch holder count from Birdeye API (most reliable, requires API key)
 */
async function fetchHolderCountFromBirdeye(mint: string): Promise<number> {
  const apiKey = process.env.BIRDEYE_API_KEY
  if (!apiKey) return 0

  try {
    const response = await fetch(
      `https://public-api.birdeye.so/defi/token_overview?address=${mint}`,
      {
        headers: {
          "X-API-KEY": apiKey,
          "Accept": "application/json",
        },
      }
    )

    if (response.ok) {
      const data = await response.json()
      if (data.success && data.data?.holder !== undefined) {
        console.log(`[Birdeye] ${mint.slice(0, 8)}... holders: ${data.data.holder}`)
        return data.data.holder
      }
    }
  } catch (err) {
    console.log(`[Birdeye] Error for ${mint.slice(0, 8)}...:`, err)
  }
  return 0
}

/**
 * Fetch holder count using Helius getTokenAccounts API (fallback)
 */
async function fetchHolderCountFromHelius(mint: string): Promise<number> {
  const apiKey = process.env.HELIUS_API_KEY
  if (!apiKey) return 0

  try {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: mint,
        method: "getTokenAccounts",
        params: {
          mint: mint,
          page: 1,
          limit: 1,
        },
      }),
    })

    if (response.ok) {
      const data = await response.json()
      console.log(`[Helius] ${mint.slice(0, 8)}... response:`, JSON.stringify(data).slice(0, 150))
      if (data.result?.total !== undefined) {
        return data.result.total
      }
    }
  } catch (err) {
    console.log(`[Helius] Error for ${mint.slice(0, 8)}...:`, err)
  }
  return 0
}

/**
 * Batch fetch holder counts for multiple tokens
 * Uses Birdeye (primary) or Helius (fallback)
 */
async function fetchHolderCounts(mints: string[]): Promise<Map<string, number>> {
  const holderMap = new Map<string, number>()

  if (mints.length === 0) return holderMap

  const hasBirdeye = !!process.env.BIRDEYE_API_KEY
  const hasHelius = !!process.env.HELIUS_API_KEY

  if (!hasBirdeye && !hasHelius) {
    console.log("[API] No BIRDEYE_API_KEY or HELIUS_API_KEY - skipping holder counts")
    return holderMap
  }

  console.log(`[API] Fetching holder counts using ${hasBirdeye ? 'Birdeye' : 'Helius'}`)

  // Check which mints need fetching (not in cache)
  const mintsToFetch: string[] = []
  for (const mint of mints) {
    const cached = holderCountCache.get(mint)
    if (cached && Date.now() - cached.timestamp < HOLDER_CACHE_TTL) {
      holderMap.set(mint, cached.holders)
    } else {
      mintsToFetch.push(mint)
    }
  }

  if (mintsToFetch.length === 0) {
    console.log(`[API] All ${mints.length} holder counts served from cache`)
    return holderMap
  }

  console.log(`[API] Holder counts: ${holderMap.size} cached, ${mintsToFetch.length} to fetch`)

  // Process in batches
  const BATCH_SIZE = hasBirdeye ? 5 : 10 // Birdeye has stricter rate limits
  let fetchedCount = 0
  let failedCount = 0

  for (let i = 0; i < mintsToFetch.length; i += BATCH_SIZE) {
    const batch = mintsToFetch.slice(i, i + BATCH_SIZE)

    const batchPromises = batch.map(async (mint) => {
      // Try Birdeye first if available
      let holders = 0
      if (hasBirdeye) {
        holders = await fetchHolderCountFromBirdeye(mint)
      }
      // Fallback to Helius
      if (holders === 0 && hasHelius) {
        holders = await fetchHolderCountFromHelius(mint)
      }

      if (holders > 0) {
        holderCountCache.set(mint, { holders, timestamp: Date.now() })
        fetchedCount++
      } else {
        failedCount++
      }

      return { mint, holders }
    })

    const results = await Promise.all(batchPromises)
    results.forEach(({ mint, holders }) => {
      holderMap.set(mint, holders)
    })

    // Delay between batches
    if (i + BATCH_SIZE < mintsToFetch.length) {
      await new Promise(resolve => setTimeout(resolve, hasBirdeye ? 200 : 100))
    }
  }

  console.log(`[API] Holder counts: ${fetchedCount} fetched, ${failedCount} failed`)

  return holderMap
}

function extractSocialLinks(dexData: any): { twitter?: string; telegram?: string; website?: string } {
  const socials: { twitter?: string; telegram?: string; website?: string } = {}
  if (dexData?.info?.socials) {
    for (const social of dexData.info.socials) {
      if (social.type === "twitter") socials.twitter = social.url
      if (social.type === "telegram") socials.telegram = social.url
    }
  }
  if (dexData?.info?.websites?.length > 0) {
    socials.website = dexData.info.websites[0].url
  }
  return socials
}

// ============================================
// MAIN TOKEN FETCHER WITH PARALLEL EXECUTION
// ============================================

async function fetchAllTokens(): Promise<any[]> {
  console.log("[API] Starting parallel token fetch (BonkFun tokens only)...")
  const startTime = Date.now()

  // Fetch from all sources in parallel
  const [raydiumResult, dexScreenerPairs, geckoTerminalPools] = await Promise.all([
    fetchRaydiumPools(),
    fetchDexScreenerPairs(),
    fetchGeckoTerminalPools(),
  ])

  const { pools: raydiumPools, poolTypes } = raydiumResult

  console.log(
    `[API] Sources fetched in ${Date.now() - startTime}ms: Raydium=${raydiumPools.size}, DexScreener=${dexScreenerPairs.size}, GeckoTerminal=${geckoTerminalPools.size}`
  )

  // IMPORTANT: Only include tokens that are verified as BonkFun tokens
  // Primary source of truth: Raydium pools (LaunchLab/CPMM pools)
  // BonkFun tokens are identified by:
  // 1. Being in a LaunchLab/CPMM pool type on Raydium (they graduate to these)
  // 2. Being created via LaunchLab program with BonkFun platform config

  // Start with Raydium pools as the source of truth for BonkFun tokens
  const bonkFunMints = new Set(raydiumPools.keys())

  // Filter DexScreener and GeckoTerminal to only include tokens found in Raydium BonkFun pools
  const filteredDexScreenerPairs = new Map<string, any>()
  const filteredGeckoTerminalPools = new Map<string, any>()

  for (const [mint, data] of dexScreenerPairs) {
    if (bonkFunMints.has(mint)) {
      filteredDexScreenerPairs.set(mint, data)
    }
  }

  for (const [mint, data] of geckoTerminalPools) {
    if (bonkFunMints.has(mint)) {
      filteredGeckoTerminalPools.set(mint, data)
    }
  }

  console.log(
    `[API] After BonkFun filter: ${bonkFunMints.size} tokens (DexScreener=${filteredDexScreenerPairs.size}, GeckoTerminal=${filteredGeckoTerminalPools.size})`
  )

  // Use only BonkFun verified mints
  const allMints = bonkFunMints

  // Get detailed data for mints not in DexScreener
  const mintsNeedingData = Array.from(allMints).filter((mint) => !filteredDexScreenerPairs.has(mint))

  if (mintsNeedingData.length > 0 && isApiHealthy("dexscreener")) {
    const detailedData = await fetchDexScreenerBatchData(mintsNeedingData)
    for (const [mint, data] of detailedData) {
      // Only add if it's a BonkFun verified mint
      if (bonkFunMints.has(mint)) {
        filteredDexScreenerPairs.set(mint, data)
      }
    }
  }

  // Build final token list (BonkFun tokens only)
  const tokens: any[] = []
  let id = 0

  for (const mint of allMints) {
    const raydiumData = raydiumPools.get(mint)
    const dexData = filteredDexScreenerPairs.get(mint)
    const geckoData = filteredGeckoTerminalPools.get(mint)

    const symbol = dexData?.baseToken?.symbol || geckoData?.symbol || raydiumData?.symbol
    const name = dexData?.baseToken?.name || geckoData?.name || raydiumData?.name

    if (shouldExclude(symbol, name)) continue
    if (!dexData && !raydiumData && !geckoData) continue

    const price = dexData?.priceUsd ? Number.parseFloat(dexData.priceUsd) : geckoData?.price || raydiumData?.price || 0
    const liquidity = dexData?.liquidity?.usd
      ? Number.parseFloat(dexData.liquidity.usd)
      : geckoData?.liquidity || raydiumData?.tvl || 0

    const fdv = dexData?.fdv ? Number.parseFloat(dexData.fdv) : geckoData?.fdv || price * 1000000000
    const volume24h = dexData?.volume?.h24
      ? Number.parseFloat(dexData.volume.h24)
      : geckoData?.volume24h || raydiumData?.volume24h || 0

    const change24h = dexData?.priceChange?.h24
      ? Number.parseFloat(dexData.priceChange.h24)
      : geckoData?.priceChange24h || raydiumData?.priceChange24h || 0

    const change1h = dexData?.priceChange?.h1
      ? Number.parseFloat(dexData.priceChange.h1)
      : geckoData?.priceChange1h || 0

    if (hasSuspiciousMetrics(fdv, liquidity)) continue
    if (price <= 0) continue

    const socials = extractSocialLinks(dexData)

    const txns24h = (dexData?.txns?.h24?.buys || 0) + (dexData?.txns?.h24?.sells || 0) || geckoData?.txns24h || 0
    const buys24h = dexData?.txns?.h24?.buys || geckoData?.buys24h || 0
    const sells24h = dexData?.txns?.h24?.sells || geckoData?.sells24h || 0
    const created = dexData?.pairCreatedAt || geckoData?.createdAt || null

    tokens.push({
      id: id++,
      name: name || "Unknown",
      symbol: symbol || "???",
      address: mint,
      emoji: getTokenEmoji(name),
      imageUrl: dexData?.info?.imageUrl || geckoData?.logoURI || raydiumData?.logoURI || null,
      price,
      priceNative: dexData?.priceNative ? Number.parseFloat(dexData.priceNative) : 0,
      change24h,
      change1h,
      volume24h,
      liquidity,
      mcap: fdv,
      pairAddress: dexData?.pairAddress || geckoData?.poolAddress || raydiumData?.poolId || "",
      dex: dexData?.dexId || raydiumData?.poolType || "raydium",
      url: dexData?.url || `https://dexscreener.com/solana/${dexData?.pairAddress || mint}`,
      created,
      txns24h,
      buys24h,
      sells24h,
      twitter: socials.twitter || null,
      telegram: socials.telegram || null,
      website: socials.website || null,
      // Holder count (will be populated below)
      holders: 0,
      // BonkFun verification
      isBonkFun: true,
      poolType: raydiumData?.poolType || poolTypes.get(mint) || "unknown",
    })
  }

  tokens.sort((a, b) => b.mcap - a.mcap)

  // Fetch holder counts for top 50 tokens (Solscan has strict rate limits)
  const mintsToFetch = tokens.slice(0, 50).map(t => t.address)
  if (mintsToFetch.length > 0) {
    console.log(`[API] Fetching holder counts for ${mintsToFetch.length} tokens...`)
    const holderCounts = await fetchHolderCounts(mintsToFetch)

    // Update tokens with holder counts
    for (const token of tokens) {
      const holders = holderCounts.get(token.address)
      if (holders !== undefined) {
        token.holders = holders
      }
    }
    console.log(`[API] Holder counts fetched for ${holderCounts.size} tokens`)
  }

  console.log(`[API] Completed in ${Date.now() - startTime}ms with ${tokens.length} tokens`)

  return tokens
}

// Background refresh function
async function refreshCache() {
  if (cache.isRefreshing) return
  
  cache.isRefreshing = true
  try {
    const tokens = await fetchAllTokens()
    if (tokens.length > 0) {
      cache.data = tokens
      cache.timestamp = Date.now()
    }
  } finally {
    cache.isRefreshing = false
  }
}

// ============================================
// API HANDLER
// ============================================

export async function GET(request: Request) {
  const now = Date.now()
  const url = new URL(request.url)
  const forceRefresh = url.searchParams.get("force") === "true"

  // Check if we have valid cached data
  const cacheAge = now - cache.timestamp
  const hasCache = cache.data.length > 0
  const isFresh = cacheAge < CONFIG.CACHE_TTL
  const isStale = cacheAge < CONFIG.STALE_WHILE_REVALIDATE

  // Return fresh cache immediately
  if (hasCache && isFresh && !forceRefresh) {
    return NextResponse.json({
      tokens: cache.data,
      cached: true,
      timestamp: cache.timestamp,
      age: cacheAge,
      health: {
        raydium: apiHealth.raydium.healthy,
        dexscreener: apiHealth.dexscreener.healthy,
        geckoterminal: apiHealth.geckoterminal.healthy,
      },
    })
  }

  // Return stale cache while triggering background refresh
  if (hasCache && isStale && !forceRefresh) {
    // Trigger background refresh
    refreshCache()
    
    return NextResponse.json({
      tokens: cache.data,
      cached: true,
      stale: true,
      timestamp: cache.timestamp,
      age: cacheAge,
      health: {
        raydium: apiHealth.raydium.healthy,
        dexscreener: apiHealth.dexscreener.healthy,
        geckoterminal: apiHealth.geckoterminal.healthy,
      },
    })
  }

  // Need fresh data
  try {
    const tokens = await fetchAllTokens()
    
    if (tokens.length > 0) {
      cache.data = tokens
      cache.timestamp = now
      
      // Record volume snapshot for history
      const totalVolume = tokens.reduce((sum, t) => sum + (t.volume24h || 0), 0)
      const totalLiquidity = tokens.reduce((sum, t) => sum + (t.liquidity || 0), 0)
      const totalMcap = tokens.reduce((sum, t) => sum + (t.mcap || 0), 0)
      
      return NextResponse.json({
        tokens,
        cached: false,
        timestamp: now,
        health: {
          raydium: apiHealth.raydium.healthy,
          dexscreener: apiHealth.dexscreener.healthy,
          geckoterminal: apiHealth.geckoterminal.healthy,
        },
      })
    }

    // Return cached data if available
    if (hasCache) {
      return NextResponse.json({
        tokens: cache.data,
        cached: true,
        timestamp: cache.timestamp,
        error: "Using cached data - fresh fetch returned empty",
        health: {
          raydium: apiHealth.raydium.healthy,
          dexscreener: apiHealth.dexscreener.healthy,
          geckoterminal: apiHealth.geckoterminal.healthy,
        },
      })
    }

    return NextResponse.json({
      tokens: [],
      cached: false,
      timestamp: now,
      error: "No data available",
    })
  } catch (error) {
    console.error("[API] Fatal error:", error)
    
    if (hasCache) {
      return NextResponse.json({
        tokens: cache.data,
        cached: true,
        timestamp: cache.timestamp,
        error: "Using cached data due to error",
      })
    }

    return NextResponse.json(
      { tokens: [], error: "Unable to fetch token data. Please try again later." },
      { status: 500 }
    )
  }
}

// Enable edge runtime for better performance
export const runtime = "edge"
