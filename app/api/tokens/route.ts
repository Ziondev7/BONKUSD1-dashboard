import { NextResponse } from "next/server"
import { fetchBonkFunWhitelist, getWhitelistStatus } from "@/lib/bonkfun-verification"

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  USD1_MINT: "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
  DEXSCREENER_API: "https://api.dexscreener.com",
  RAYDIUM_API: "https://api-v3.raydium.io",
  GECKOTERMINAL_API: "https://api.geckoterminal.com/api/v2",
  EXCLUDED_SYMBOLS: ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"],
  MAX_MCAP_LIQUIDITY_RATIO: 100,
  MIN_LIQUIDITY_USD: 100,
  CACHE_TTL: 15 * 1000, // 15 seconds for blazing fast updates
  STALE_WHILE_REVALIDATE: 45 * 1000, // Serve stale for 45s while fetching
}

// ============================================
// IN-MEMORY CACHE WITH STALE-WHILE-REVALIDATE
// ============================================

// Cache entry is an immutable snapshot - replaced atomically
interface CacheSnapshot {
  readonly data: any[]
  readonly timestamp: number
}

// Mutable state for cache management
interface CacheState {
  // Current cache snapshot - replaced atomically to prevent race conditions
  snapshot: CacheSnapshot
  // Flag to prevent concurrent refreshes
  isRefreshing: boolean
  // Promise for in-flight refresh (allows waiting for same refresh)
  refreshPromise: Promise<void> | null
}

// CRITICAL: Cache snapshot is replaced atomically as a single object
// This prevents race conditions where data and timestamp could be inconsistent
let cacheState: CacheState = {
  snapshot: { data: [], timestamp: 0 },
  isRefreshing: false,
  refreshPromise: null,
}

// Helper to get current cache snapshot atomically
function getCacheSnapshot(): CacheSnapshot {
  return cacheState.snapshot
}

// Helper to set cache atomically - creates new immutable snapshot
function setCacheSnapshot(data: any[], timestamp: number): void {
  // Create new snapshot object (immutable pattern for atomic update)
  cacheState.snapshot = Object.freeze({ data, timestamp })
}

// BonkFun whitelist is now managed by lib/bonkfun-verification.ts
// This provides a single source of truth using Dune Analytics data

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

// BonkFun token verification is now handled by lib/bonkfun-verification.ts
// which uses the authoritative Dune Analytics whitelist

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

    // Fetch first page to get total count, then parallelize remaining pages
    // We fetch ALL USD1 pools - BonkFun filtering happens later via whitelist
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

    // Process pool - collects ALL USD1 pools, BonkFun filtering happens in fetchAllTokens
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

      // Track pool type for informational purposes
      const poolType = pool.type || pool.poolType || ""
      poolTypeMap.set(baseMint, poolType)

      const existing = poolMap.get(baseMint)
      const poolLiquidity = pool.tvl || 0

      // Keep the pool with highest liquidity for each token
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
          // Note: isBonkFun will be set later after whitelist verification
        })
      }
    }

    firstPools.forEach(processPool)

    // Fetch remaining pages in parallel
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
    console.log(`[Raydium] Fetched ${poolMap.size} USD1 pools (pending BonkFun verification)`)
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

// Calculate token safety score based on multiple factors
function calculateSafetyScore(token: {
  liquidity: number
  mcap: number
  volume24h: number
  txns24h: number
  buys24h: number
  sells24h: number
  created: number | null
  hasSocials: boolean
}): { score: number; level: 'safe' | 'caution' | 'risky'; warnings: string[] } {
  let score = 0
  const warnings: string[] = []

  // Input validation - detect suspicious metrics
  if (token.liquidity > token.mcap * 10 && token.mcap > 0) {
    warnings.push("Suspicious liquidity ratio")
    score -= 15
  }
  
  if (token.txns24h > 0 && token.volume24h > 0) {
    const avgTxnSize = token.volume24h / token.txns24h
    if (avgTxnSize < 0.5) {
      warnings.push("Abnormal transaction pattern")
      score -= 10
    }
  }

  // Liquidity checks (max 30 points)
  if (token.liquidity >= 50000) score += 30
  else if (token.liquidity >= 10000) score += 20
  else if (token.liquidity >= 5000) score += 10
  else warnings.push("Low liquidity")

  // Liquidity to market cap ratio (max 20 points)
  const liqRatio = token.mcap > 0 ? (token.liquidity / token.mcap) * 100 : 0
  if (liqRatio >= 10) score += 20
  else if (liqRatio >= 5) score += 15
  else if (liqRatio >= 2) score += 10
  else warnings.push("Low liq/mcap ratio")

  // Trading activity (max 20 points)
  if (token.txns24h >= 100) score += 20
  else if (token.txns24h >= 50) score += 15
  else if (token.txns24h >= 20) score += 10
  else if (token.txns24h < 10) warnings.push("Low trading activity")

  // Buy/Sell balance (max 15 points) - healthy markets have balanced trading
  const totalTxns = token.buys24h + token.sells24h
  if (totalTxns > 0) {
    const buyRatio = token.buys24h / totalTxns
    if (buyRatio >= 0.35 && buyRatio <= 0.65) score += 15
    else if (buyRatio >= 0.25 && buyRatio <= 0.75) score += 10
    else warnings.push("Unbalanced buy/sell")
  }

  // Age check (max 10 points)
  if (token.created) {
    const ageHours = (Date.now() - token.created) / (1000 * 60 * 60)
    if (ageHours >= 72) score += 10
    else if (ageHours >= 24) score += 7
    else if (ageHours >= 6) score += 4
    else warnings.push("Very new token")
  } else {
    warnings.push("Unknown age")
  }

  // Social presence (max 5 points)
  if (token.hasSocials) score += 5

  // Ensure score doesn't go below 0
  score = Math.max(0, score)

  // Determine level
  let level: 'safe' | 'caution' | 'risky'
  if (score >= 70) level = 'safe'
  else if (score >= 40) level = 'caution'
  else level = 'risky'

  return { score: Math.min(score, 100), level, warnings }
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

  // Fetch BonkFun whitelist and all data sources in parallel
  const [bonkFunWhitelist, raydiumResult, dexScreenerPairs, geckoTerminalPools] = await Promise.all([
    fetchBonkFunWhitelist(),
    fetchRaydiumPools(),
    fetchDexScreenerPairs(),
    fetchGeckoTerminalPools(),
  ])

  const { pools: raydiumPools, poolTypes } = raydiumResult
  const whitelistStatus = getWhitelistStatus()

  console.log(
    `[API] Sources fetched in ${Date.now() - startTime}ms: ` +
    `Raydium=${raydiumPools.size}, DexScreener=${dexScreenerPairs.size}, ` +
    `GeckoTerminal=${geckoTerminalPools.size}, BonkFun Whitelist=${bonkFunWhitelist.size}`
  )

  // Determine verification mode based on whitelist availability
  const useWhitelist = bonkFunWhitelist.size > 0

  if (!useWhitelist) {
    console.warn("[API] BonkFun whitelist unavailable - using pool-type fallback filtering")
    console.warn("[API] Configure DUNE_API_KEY for authoritative BonkFun verification")
  }

  // Filter Raydium pools based on verification mode
  const verifiedRaydiumPools = new Map<string, any>()

  if (useWhitelist) {
    // PREFERRED: Use Dune whitelist as authoritative source
    for (const [mint, data] of raydiumPools) {
      if (bonkFunWhitelist.has(mint)) {
        verifiedRaydiumPools.set(mint, { ...data, isBonkFun: true, verifiedBy: "dune-whitelist" })
      }
    }
    console.log(`[API] Whitelist verification: ${verifiedRaydiumPools.size}/${raydiumPools.size} tokens verified`)
  } else {
    // FALLBACK: Use pool-type heuristic (less accurate but works without Dune)
    // BonkFun tokens typically use CPMM pools after graduation
    for (const [mint, data] of raydiumPools) {
      const poolType = (data.poolType || "").toLowerCase()
      const isLikelyBonkFun = poolType.includes("cpmm") ||
                              poolType.includes("launchlab") ||
                              poolType === "standard"
      if (isLikelyBonkFun) {
        verifiedRaydiumPools.set(mint, { ...data, isBonkFun: true, verifiedBy: "pool-type-heuristic" })
      }
    }
    console.log(`[API] Pool-type fallback: ${verifiedRaydiumPools.size}/${raydiumPools.size} tokens matched (may include non-BonkFun)`)
  }

  // The verified BonkFun mints from Raydium pools
  const bonkFunMints = new Set(verifiedRaydiumPools.keys())

  // Filter DexScreener and GeckoTerminal to only verified BonkFun tokens
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
    `[API] After BonkFun whitelist filter: ${bonkFunMints.size} verified tokens ` +
    `(filtered from ${raydiumPools.size} USD1 pools)`
  )

  // Use only verified BonkFun mints
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
    const raydiumData = verifiedRaydiumPools.get(mint)
    const dexData = filteredDexScreenerPairs.get(mint)
    const geckoData = filteredGeckoTerminalPools.get(mint)

    const symbol = dexData?.baseToken?.symbol || geckoData?.symbol || raydiumData?.symbol
    const name = dexData?.baseToken?.name || geckoData?.name || raydiumData?.name

    if (shouldExclude(symbol, name)) continue
    if (!dexData && !raydiumData && !geckoData) continue

    // Store raw price string for precision (before parsing to number)
    // This preserves full precision for very small prices like 0.000000000001234567890
    const priceRaw = dexData?.priceUsd || (geckoData?.price?.toString()) || (raydiumData?.price?.toString()) || "0"

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
    const hasSocials = !!(socials.twitter || socials.telegram || socials.website)
    
    const txns24h = (dexData?.txns?.h24?.buys || 0) + (dexData?.txns?.h24?.sells || 0) || geckoData?.txns24h || 0
    const buys24h = dexData?.txns?.h24?.buys || geckoData?.buys24h || 0
    const sells24h = dexData?.txns?.h24?.sells || geckoData?.sells24h || 0
    const created = dexData?.pairCreatedAt || geckoData?.createdAt || null

    // Calculate safety score
    const safety = calculateSafetyScore({
      liquidity,
      mcap: fdv,
      volume24h,
      txns24h,
      buys24h,
      sells24h,
      created,
      hasSocials,
    })

    tokens.push({
      id: id++,
      name: name || "Unknown",
      symbol: symbol || "???",
      address: mint,
      emoji: getTokenEmoji(name),
      imageUrl: dexData?.info?.imageUrl || geckoData?.logoURI || raydiumData?.logoURI || null,
      price,
      priceRaw, // Full precision price string for very small values
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
      // Safety metrics
      safetyScore: safety.score,
      safetyLevel: safety.level,
      safetyWarnings: safety.warnings,
      // BonkFun verification
      isBonkFun: true,
      poolType: raydiumData?.poolType || poolTypes.get(mint) || "unknown",
    })
  }

  tokens.sort((a, b) => b.mcap - a.mcap)
  console.log(`[API] Completed in ${Date.now() - startTime}ms with ${tokens.length} tokens`)
  
  return tokens
}

// Background refresh function with proper mutex and atomic updates
async function refreshCache(): Promise<void> {
  // If already refreshing, return the existing promise to avoid duplicate work
  if (cacheState.isRefreshing && cacheState.refreshPromise) {
    return cacheState.refreshPromise
  }

  // Create the refresh promise
  const doRefresh = async () => {
    try {
      const tokens = await fetchAllTokens()
      if (tokens.length > 0) {
        // ATOMIC UPDATE: Replace entire snapshot at once
        setCacheSnapshot(tokens, Date.now())
      }
    } finally {
      cacheState.isRefreshing = false
      cacheState.refreshPromise = null
    }
  }

  cacheState.isRefreshing = true
  cacheState.refreshPromise = doRefresh()
  return cacheState.refreshPromise
}

// ============================================
// API HANDLER
// ============================================

export async function GET(request: Request) {
  const now = Date.now()
  const url = new URL(request.url)
  const forceRefresh = url.searchParams.get("force") === "true"

  // Get current cache snapshot atomically
  const cache = getCacheSnapshot()
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
    // Trigger background refresh (non-blocking)
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
      // ATOMIC UPDATE: Replace entire cache snapshot at once
      setCacheSnapshot(tokens, now)

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

    // Return cached data if available (re-read in case it was updated)
    const latestCache = getCacheSnapshot()
    if (latestCache.data.length > 0) {
      return NextResponse.json({
        tokens: latestCache.data,
        cached: true,
        timestamp: latestCache.timestamp,
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

    // Re-read cache in case it was updated during our fetch
    const latestCache = getCacheSnapshot()
    if (latestCache.data.length > 0) {
      return NextResponse.json({
        tokens: latestCache.data,
        cached: true,
        timestamp: latestCache.timestamp,
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
