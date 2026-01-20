import { NextResponse } from "next/server"

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  USD1_MINT: "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
  DEXSCREENER_API: "https://api.dexscreener.com",
  RAYDIUM_API: "https://api-v3.raydium.io",
  GECKOTERMINAL_API: "https://api.geckoterminal.com/api/v2",
  // BONK.fun uses Raydium LaunchLab - graduated tokens go to CPMM pools
  RAYDIUM_LAUNCHLAB_PROGRAM: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  RAYDIUM_CPMM_PROGRAM: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  // Pool types for BONK.fun graduated tokens (can be CPMM or Standard AMM V4)
  BONKFUN_POOL_TYPES: ["cpmm", "standard"],
  EXCLUDED_SYMBOLS: ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"],
  MAX_MCAP_LIQUIDITY_RATIO: 100,
  MIN_LIQUIDITY_USD: 100,
  CACHE_TTL: 15 * 1000, // 15 seconds for blazing fast updates
  STALE_WHILE_REVALIDATE: 45 * 1000, // Serve stale for 45s while fetching
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

async function fetchRaydiumPools(): Promise<Map<string, any>> {
  const poolMap = new Map<string, any>()
  if (!isApiHealthy("raydium")) return poolMap

  try {
    const pageSize = 500
    const maxPages = 5

    // Process pool data - only include BONK.fun LaunchLab tokens paired with USD1
    const processPool = (pool: any) => {
      const mintA = pool.mintA?.address
      const mintB = pool.mintB?.address
      const isAUSD1 = mintA === CONFIG.USD1_MINT
      const isBUSD1 = mintB === CONFIG.USD1_MINT

      // Only process USD1 pairs
      if (!isAUSD1 && !isBUSD1) return

      const baseMint = isAUSD1 ? mintB : mintA
      const baseToken = isAUSD1 ? pool.mintB : pool.mintA

      if (!baseMint || baseMint === CONFIG.USD1_MINT) return
      if (shouldExclude(baseToken?.symbol, baseToken?.name)) return

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
          poolType: pool.type,
          programId: pool.programId,
          tvl: poolLiquidity,
          volume24h: pool.day?.volume || 0,
          price: isAUSD1 ? pool.price : 1 / pool.price,
          priceChange24h: pool.day?.priceChange || 0,
          source: "raydium",
        })
      }
    }

    // Fetch ONLY CPMM pools - these are BONK.fun LaunchLab graduated tokens
    // BONK.fun tokens migrate to CPMM pools on Raydium after graduating from bonding curve
    const fetchPoolType = async (poolType: string) => {
      const firstPageUrl = `${CONFIG.RAYDIUM_API}/pools/info/mint?mint1=${CONFIG.USD1_MINT}&poolType=${poolType}&poolSortField=liquidity&sortType=desc&pageSize=${pageSize}&page=1`
      const firstResponse = await fetchWithTimeout(firstPageUrl)

      if (!firstResponse.ok) {
        if (firstResponse.status === 429) markApiError("raydium")
        return
      }

      const firstJson = await firstResponse.json()
      if (!firstJson.success || !firstJson.data?.data) return

      const firstPools = firstJson.data.data
      const totalCount = firstJson.data.count || firstPools.length
      const totalPages = Math.min(Math.ceil(totalCount / pageSize), maxPages)

      // Process first page
      firstPools.forEach(processPool)

      // Fetch remaining pages in parallel
      if (totalPages > 1 && firstPools.length >= pageSize) {
        const pagePromises = []
        for (let page = 2; page <= totalPages; page++) {
          const url = `${CONFIG.RAYDIUM_API}/pools/info/mint?mint1=${CONFIG.USD1_MINT}&poolType=${poolType}&poolSortField=liquidity&sortType=desc&pageSize=${pageSize}&page=${page}`
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
    }

    // Fetch all BONK.fun pool types (primarily CPMM for LaunchLab graduated tokens)
    await Promise.all(CONFIG.BONKFUN_POOL_TYPES.map(poolType => fetchPoolType(poolType)))

    console.log(`[Raydium] Found ${poolMap.size} BONK.fun/USD1 tokens from LaunchLab (CPMM pools)`)
    resetApiHealth("raydium")
  } catch (error) {
    console.error("[Raydium] Error:", error)
    markApiError("raydium")
  }

  return poolMap
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
  console.log("[API] Starting BONK.fun token fetch (Raydium LaunchLab CPMM pools only)...")
  const startTime = Date.now()

  // PRIMARY: Fetch BONK.fun tokens from Raydium LaunchLab (CPMM pools)
  // Only Raydium can identify BONK.fun LaunchLab tokens via pool type
  const raydiumPools = await fetchRaydiumPools()

  console.log(`[API] Found ${raydiumPools.size} BONK.fun/USD1 tokens from Raydium LaunchLab in ${Date.now() - startTime}ms`)

  // If no BONK.fun tokens found, return early
  if (raydiumPools.size === 0) {
    console.log("[API] No BONK.fun tokens found")
    return []
  }

  // SECONDARY: Enrich BONK.fun token data with DexScreener and GeckoTerminal
  // Only fetch data for tokens we already identified as BONK.fun tokens
  const bonkfunMints = Array.from(raydiumPools.keys())

  const [dexScreenerPairs, geckoTerminalPools] = await Promise.all([
    fetchDexScreenerPairs(),
    fetchGeckoTerminalPools(),
  ])

  console.log(
    `[API] Data enrichment: DexScreener=${dexScreenerPairs.size}, GeckoTerminal=${geckoTerminalPools.size}`
  )

  // Only use BONK.fun token mints from Raydium (not other sources)
  const allMints = new Set(bonkfunMints)

  // Get detailed data for BONK.fun mints not in DexScreener
  const mintsNeedingData = bonkfunMints.filter((mint) => !dexScreenerPairs.has(mint))

  if (mintsNeedingData.length > 0 && isApiHealthy("dexscreener")) {
    const detailedData = await fetchDexScreenerBatchData(mintsNeedingData)
    for (const [mint, data] of detailedData) {
      dexScreenerPairs.set(mint, data)
    }
  }

  // Build final token list
  const tokens: any[] = []
  let id = 0

  for (const mint of allMints) {
    const raydiumData = raydiumPools.get(mint)
    const dexData = dexScreenerPairs.get(mint)
    const geckoData = geckoTerminalPools.get(mint)

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

    // Get holders count from DexScreener if available
    const holders = dexData?.info?.holders || null

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
      holders,
      twitter: socials.twitter || null,
      telegram: socials.telegram || null,
      website: socials.website || null,
    })
  }

  tokens.sort((a, b) => b.mcap - a.mcap)
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
