/**
 * Tokens API v2 - On-Chain Discovery
 *
 * Uses direct blockchain queries via getProgramAccounts for 100% accurate
 * USD1 pool discovery, then enriches with DexScreener/GeckoTerminal data.
 *
 * Architecture:
 * 1. On-chain discovery (Helius/Alchemy/Chainstack free tiers)
 * 2. Enrichment from free APIs (DexScreener, GeckoTerminal)
 * 3. Multi-layer caching to minimize API calls
 *
 * Free tier budget:
 * - Helius: 1M credits
 * - Alchemy: 30M CU/month
 * - Chainstack: 3M req/month
 * - DexScreener: Unlimited (300 req/min)
 * - GeckoTerminal: Unlimited
 */

import { NextResponse } from "next/server"
import { discoverUSD1Pools, PROGRAMS } from "@/lib/pool-discovery"
import { rpcManager } from "@/lib/rpc-manager"
import {
  getCachedPools,
  setCachedPools,
  getCachedEnrichedTokens,
  setCachedEnrichedTokens,
  getCacheStats,
  CACHE_TTL,
} from "@/lib/pool-cache"

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  USD1_MINT: PROGRAMS.USD1_MINT,
  DEXSCREENER_API: "https://api.dexscreener.com",
  GECKOTERMINAL_API: "https://api.geckoterminal.com/api/v2",
  EXCLUDED_SYMBOLS: ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"],
  MAX_MCAP_LIQUIDITY_RATIO: 100,
  MIN_LIQUIDITY_USD: 100,
}

// ============================================
// API HEALTH TRACKING
// ============================================

const apiHealth = {
  onchain: { healthy: true, lastError: 0, errorCount: 0 },
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

  const backoffMs = Math.min(30000 * Math.pow(2, health.errorCount - 1), 300000)
  if (Date.now() - health.lastError > backoffMs) {
    health.healthy = true
    return true
  }
  return false
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function shouldExclude(symbol?: string, name?: string): boolean {
  const s = (symbol || "").toUpperCase()
  const n = (name || "").toUpperCase()
  return CONFIG.EXCLUDED_SYMBOLS.some(
    (excluded) => s === excluded || s.includes(excluded) || n === excluded
  )
}

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

function hasSuspiciousMetrics(fdv: number, liquidity: number): boolean {
  if (liquidity < CONFIG.MIN_LIQUIDITY_USD) return true
  if (fdv > 0 && liquidity > 0 && fdv / liquidity > CONFIG.MAX_MCAP_LIQUIDITY_RATIO) return true
  return false
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

function calculateSafetyScore(token: {
  liquidity: number
  mcap: number
  volume24h: number
  txns24h: number
  buys24h: number
  sells24h: number
  created: number | null
  hasSocials: boolean
}): { score: number; level: "safe" | "caution" | "risky"; warnings: string[] } {
  let score = 0
  const warnings: string[] = []

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

  if (token.liquidity >= 50000) score += 30
  else if (token.liquidity >= 10000) score += 20
  else if (token.liquidity >= 5000) score += 10
  else warnings.push("Low liquidity")

  const liqRatio = token.mcap > 0 ? (token.liquidity / token.mcap) * 100 : 0
  if (liqRatio >= 10) score += 20
  else if (liqRatio >= 5) score += 15
  else if (liqRatio >= 2) score += 10
  else warnings.push("Low liq/mcap ratio")

  if (token.txns24h >= 100) score += 20
  else if (token.txns24h >= 50) score += 15
  else if (token.txns24h >= 20) score += 10
  else if (token.txns24h < 10) warnings.push("Low trading activity")

  const totalTxns = token.buys24h + token.sells24h
  if (totalTxns > 0) {
    const buyRatio = token.buys24h / totalTxns
    if (buyRatio >= 0.35 && buyRatio <= 0.65) score += 15
    else if (buyRatio >= 0.25 && buyRatio <= 0.75) score += 10
    else warnings.push("Unbalanced buy/sell")
  }

  if (token.created) {
    const ageHours = (Date.now() - token.created) / (1000 * 60 * 60)
    if (ageHours >= 72) score += 10
    else if (ageHours >= 24) score += 7
    else if (ageHours >= 6) score += 4
    else warnings.push("Very new token")
  } else {
    warnings.push("Unknown age")
  }

  if (token.hasSocials) score += 5

  score = Math.max(0, score)

  let level: "safe" | "caution" | "risky"
  if (score >= 70) level = "safe"
  else if (score >= 40) level = "caution"
  else level = "risky"

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
// DEXSCREENER ENRICHMENT (FREE)
// ============================================

async function fetchDexScreenerDataForMints(mints: string[]): Promise<Map<string, any>> {
  const pairMap = new Map<string, any>()
  if (!isApiHealthy("dexscreener") || mints.length === 0) return pairMap

  // Batch in groups of 30 (DexScreener limit)
  const batches: string[][] = []
  for (let i = 0; i < mints.length; i += 30) {
    batches.push(mints.slice(i, i + 30))
  }

  console.log(`[DexScreener] Fetching data for ${mints.length} tokens in ${batches.length} batches`)

  const batchPromises = batches.map(async (batch, index) => {
    try {
      // Add small delay between batches to avoid rate limits
      if (index > 0) {
        await new Promise((r) => setTimeout(r, 200))
      }

      const response = await fetchWithTimeout(
        `${CONFIG.DEXSCREENER_API}/latest/dex/tokens/${batch.join(",")}`
      )

      if (response.ok) {
        const data = await response.json()
        const pairs = data.pairs || []

        for (const pair of pairs) {
          if (pair.chainId !== "solana") continue

          // Find the USD1 pair
          const isBaseUSD1 = pair.baseToken?.address === CONFIG.USD1_MINT
          const isQuoteUSD1 = pair.quoteToken?.address === CONFIG.USD1_MINT

          if (!isBaseUSD1 && !isQuoteUSD1) continue

          const tokenAddress = isQuoteUSD1 ? pair.baseToken?.address : pair.quoteToken?.address
          if (!tokenAddress) continue

          const existing = pairMap.get(tokenAddress)
          const newVolume = pair.volume?.h24 || 0
          const existingVolume = existing?.volume?.h24 || 0

          // Keep the pair with higher volume
          if (!existing || newVolume > existingVolume) {
            pairMap.set(tokenAddress, pair)
          }
        }
      } else if (response.status === 429) {
        markApiError("dexscreener")
      }
    } catch (e) {
      console.warn(`[DexScreener] Batch ${index} error:`, e)
    }
  })

  await Promise.allSettled(batchPromises)
  resetApiHealth("dexscreener")

  console.log(`[DexScreener] Got data for ${pairMap.size} tokens`)
  return pairMap
}

// Also fetch from USD1 token pairs endpoint for additional coverage
async function fetchDexScreenerUSD1Pairs(): Promise<Map<string, any>> {
  const pairMap = new Map<string, any>()
  if (!isApiHealthy("dexscreener")) return pairMap

  try {
    const response = await fetchWithTimeout(
      `${CONFIG.DEXSCREENER_API}/token-pairs/v1/solana/${CONFIG.USD1_MINT}`
    )

    if (response.ok) {
      const pairs = await response.json()
      if (Array.isArray(pairs)) {
        for (const pair of pairs) {
          if (pair.chainId !== "solana") continue

          const isQuoteUSD1 = pair.quoteToken?.address === CONFIG.USD1_MINT
          const tokenAddress = isQuoteUSD1 ? pair.baseToken?.address : pair.quoteToken?.address

          if (tokenAddress && tokenAddress !== CONFIG.USD1_MINT) {
            const existing = pairMap.get(tokenAddress)
            if (!existing || (pair.volume?.h24 || 0) > (existing.volume?.h24 || 0)) {
              pairMap.set(tokenAddress, pair)
            }
          }
        }
      }
    }
    resetApiHealth("dexscreener")
  } catch (e) {
    console.warn("[DexScreener] USD1 pairs error:", e)
    markApiError("dexscreener")
  }

  return pairMap
}

// ============================================
// GECKOTERMINAL ENRICHMENT (FREE)
// ============================================

async function fetchGeckoTerminalData(): Promise<Map<string, any>> {
  const poolMap = new Map<string, any>()
  if (!isApiHealthy("geckoterminal")) return poolMap

  try {
    const maxPages = 5
    const pageUrls = Array.from({ length: maxPages }, (_, i) =>
      `${CONFIG.GECKOTERMINAL_API}/networks/solana/tokens/${CONFIG.USD1_MINT}/pools?page=${i + 1}&include=base_token,quote_token`
    )

    const pageResults = await Promise.all(
      pageUrls.map((url) =>
        fetchWithTimeout(url, 6000)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
      )
    )

    for (const json of pageResults) {
      if (!json) continue

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

        if (!tokenData) continue

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
            txns24h: (attrs.transactions?.h24?.buys || 0) + (attrs.transactions?.h24?.sells || 0),
            buys24h: attrs.transactions?.h24?.buys || 0,
            sells24h: attrs.transactions?.h24?.sells || 0,
            fdv: Number.parseFloat(attrs.fdv_usd) || 0,
            createdAt: attrs.pool_created_at,
          })
        }
      }
    }

    resetApiHealth("geckoterminal")
  } catch (e) {
    console.warn("[GeckoTerminal] Error:", e)
    markApiError("geckoterminal")
  }

  console.log(`[GeckoTerminal] Got data for ${poolMap.size} tokens`)
  return poolMap
}

// ============================================
// MAIN TOKEN FETCHER - ON-CHAIN FIRST
// ============================================

async function fetchAllTokensV2(): Promise<any[]> {
  console.log("[API-v2] Starting on-chain + API hybrid fetch...")
  const startTime = Date.now()

  // STEP 1: Get discovered pools (from cache or on-chain)
  let poolData = await getCachedPools()
  let discoverySource = "cache"

  if (!poolData) {
    console.log("[API-v2] Cache miss - discovering pools on-chain...")
    try {
      const discovery = await discoverUSD1Pools()
      poolData = {
        pools: discovery.pools,
        tokenMints: discovery.tokenMints,
        discoveredAt: discovery.discoveredAt,
      }
      await setCachedPools(discovery.pools, discovery.tokenMints)
      discoverySource = "on-chain"
      resetApiHealth("onchain")
    } catch (e) {
      console.error("[API-v2] On-chain discovery failed:", e)
      markApiError("onchain")
      // Return empty if we have no cached data
      return []
    }
  }

  const { tokenMints } = poolData
  console.log(`[API-v2] Pool discovery (${discoverySource}): ${tokenMints.length} tokens in ${Date.now() - startTime}ms`)

  // STEP 2: Enrich with DexScreener and GeckoTerminal data (parallel)
  const enrichStart = Date.now()
  const [dexScreenerData, dexScreenerUSD1, geckoData] = await Promise.all([
    fetchDexScreenerDataForMints(tokenMints),
    fetchDexScreenerUSD1Pairs(),
    fetchGeckoTerminalData(),
  ])

  // Merge DexScreener data
  for (const [mint, data] of dexScreenerUSD1) {
    if (!dexScreenerData.has(mint)) {
      dexScreenerData.set(mint, data)
    }
  }

  console.log(`[API-v2] Enrichment completed in ${Date.now() - enrichStart}ms: DexScreener=${dexScreenerData.size}, GeckoTerminal=${geckoData.size}`)

  // STEP 3: Build token list
  const tokens: any[] = []
  let id = 0

  for (const mint of tokenMints) {
    const dexData = dexScreenerData.get(mint)
    const gData = geckoData.get(mint)

    // Skip if we have no data at all
    if (!dexData && !gData) continue

    const symbol = dexData?.baseToken?.symbol || gData?.symbol || "???"
    const name = dexData?.baseToken?.name || gData?.name || "Unknown"

    if (shouldExclude(symbol, name)) continue

    const price = dexData?.priceUsd
      ? Number.parseFloat(dexData.priceUsd)
      : gData?.price || 0

    const liquidity = dexData?.liquidity?.usd
      ? Number.parseFloat(dexData.liquidity.usd)
      : gData?.liquidity || 0

    const fdv = dexData?.fdv
      ? Number.parseFloat(dexData.fdv)
      : gData?.fdv || price * 1000000000

    const volume24h = dexData?.volume?.h24
      ? Number.parseFloat(dexData.volume.h24)
      : gData?.volume24h || 0

    const change24h = dexData?.priceChange?.h24
      ? Number.parseFloat(dexData.priceChange.h24)
      : gData?.priceChange24h || 0

    const change1h = dexData?.priceChange?.h1
      ? Number.parseFloat(dexData.priceChange.h1)
      : gData?.priceChange1h || 0

    if (hasSuspiciousMetrics(fdv, liquidity)) continue
    if (price <= 0) continue

    const socials = extractSocialLinks(dexData)
    const hasSocials = !!(socials.twitter || socials.telegram || socials.website)

    const txns24h = (dexData?.txns?.h24?.buys || 0) + (dexData?.txns?.h24?.sells || 0) || gData?.txns24h || 0
    const buys24h = dexData?.txns?.h24?.buys || gData?.buys24h || 0
    const sells24h = dexData?.txns?.h24?.sells || gData?.sells24h || 0
    const created = dexData?.pairCreatedAt || (gData?.createdAt ? new Date(gData.createdAt).getTime() : null)

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
      name,
      symbol,
      address: mint,
      emoji: getTokenEmoji(name),
      imageUrl: dexData?.info?.imageUrl || gData?.logoURI || null,
      price,
      priceNative: dexData?.priceNative ? Number.parseFloat(dexData.priceNative) : 0,
      change24h,
      change1h,
      volume24h,
      liquidity,
      mcap: fdv,
      pairAddress: dexData?.pairAddress || gData?.poolAddress || "",
      dex: dexData?.dexId || "raydium",
      url: dexData?.url || `https://dexscreener.com/solana/${mint}`,
      created,
      txns24h,
      buys24h,
      sells24h,
      twitter: socials.twitter || null,
      telegram: socials.telegram || null,
      website: socials.website || null,
      safetyScore: safety.score,
      safetyLevel: safety.level,
      safetyWarnings: safety.warnings,
      isBonkFun: true,
      poolType: "cpmm",
      discoverySource,
    })
  }

  // Sort by market cap
  tokens.sort((a, b) => b.mcap - a.mcap)

  console.log(`[API-v2] Completed in ${Date.now() - startTime}ms with ${tokens.length} tokens`)

  return tokens
}

// ============================================
// API HANDLER
// ============================================

export async function GET(request: Request) {
  const now = Date.now()
  const url = new URL(request.url)
  const forceRefresh = url.searchParams.get("force") === "true"

  // Check enriched tokens cache first
  if (!forceRefresh) {
    const cached = await getCachedEnrichedTokens()
    if (cached && Date.now() - cached.timestamp < CACHE_TTL.ENRICHED_TOKENS) {
      const cacheStats = await getCacheStats()
      return NextResponse.json({
        tokens: cached.tokens,
        cached: true,
        timestamp: cached.timestamp,
        age: Date.now() - cached.timestamp,
        discovery: "on-chain",
        version: "v2",
        health: {
          onchain: apiHealth.onchain.healthy,
          dexscreener: apiHealth.dexscreener.healthy,
          geckoterminal: apiHealth.geckoterminal.healthy,
        },
        rpcHealth: rpcManager.getHealthStatus(),
        cacheStats,
      })
    }
  }

  // Fetch fresh data
  try {
    const tokens = await fetchAllTokensV2()

    if (tokens.length > 0) {
      await setCachedEnrichedTokens(tokens)
    }

    const cacheStats = await getCacheStats()

    return NextResponse.json({
      tokens,
      cached: false,
      timestamp: now,
      discovery: "on-chain",
      version: "v2",
      health: {
        onchain: apiHealth.onchain.healthy,
        dexscreener: apiHealth.dexscreener.healthy,
        geckoterminal: apiHealth.geckoterminal.healthy,
      },
      rpcHealth: rpcManager.getHealthStatus(),
      cacheStats,
    })
  } catch (error) {
    console.error("[API-v2] Fatal error:", error)

    // Try to return cached data
    const cached = await getCachedEnrichedTokens()
    if (cached) {
      return NextResponse.json({
        tokens: cached.tokens,
        cached: true,
        stale: true,
        timestamp: cached.timestamp,
        error: "Using cached data due to error",
        discovery: "on-chain",
        version: "v2",
      })
    }

    return NextResponse.json(
      { tokens: [], error: "Unable to fetch token data" },
      { status: 500 }
    )
  }
}

export const runtime = "edge"
