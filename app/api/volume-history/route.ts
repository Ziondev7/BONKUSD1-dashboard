import { NextResponse } from "next/server"

const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"

// BONK.fun uses Raydium LaunchLab - graduated tokens go to CPMM or Standard AMM V4 pools
const BONKFUN_POOL_TYPES = ["cpmm", "standard"]

// Tokens to exclude (stablecoins, major tokens - not BONK.fun launched)
const EXCLUDED_SYMBOLS = ["WLFI", "USD1", "USDC", "USDT", "SOL", "WSOL", "RAY", "FREYA", "REAL", "AOL"]

// Cache
interface CacheEntry {
  data: any
  timestamp: number
}

let volumeCache: CacheEntry | null = null
const CACHE_TTL = 2 * 60 * 1000 // 2 minutes cache

// Fetch with timeout utility
async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response> {
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

// Check if token should be excluded (not a BONK.fun token)
function shouldExclude(symbol?: string): boolean {
  if (!symbol) return false
  const s = symbol.toUpperCase()
  return EXCLUDED_SYMBOLS.some(excluded => s === excluded || s.includes(excluded))
}

// Fetch BONK.fun/USD1 pools from Raydium and get per-pool volume data
async function fetchRaydiumVolumeData(): Promise<{
  pools: Array<{
    id: string
    symbol: string
    volume24h: number
    volume7d: number
    volume30d: number
    tvl: number
  }>
  totalVolume24h: number
  totalVolume7d: number
  totalVolume30d: number
  totalTvl: number
  poolCount: number
}> {
  const pools: Array<{
    id: string
    symbol: string
    volume24h: number
    volume7d: number
    volume30d: number
    tvl: number
  }> = []

  let totalVolume24h = 0
  let totalVolume7d = 0
  let totalVolume30d = 0
  let totalTvl = 0

  try {
    const pageSize = 500
    const maxPages = 5

    const processPool = (pool: any) => {
      const mintA = pool.mintA?.address
      const mintB = pool.mintB?.address
      const symbolA = pool.mintA?.symbol || "?"
      const symbolB = pool.mintB?.symbol || "?"

      // Check if USD1 is one of the tokens
      const isAUSD1 = mintA === USD1_MINT
      const isBUSD1 = mintB === USD1_MINT

      if (!isAUSD1 && !isBUSD1) return

      // Get the paired token (the BONK.fun launched token)
      const pairedSymbol = isAUSD1 ? symbolB : symbolA

      // Exclude non-BONK.fun tokens
      if (shouldExclude(pairedSymbol)) return

      const volume24h = pool.day?.volume || 0
      const volume7d = pool.week?.volume || 0
      const volume30d = pool.month?.volume || 0
      const tvl = pool.tvl || 0

      totalVolume24h += volume24h
      totalVolume7d += volume7d
      totalVolume30d += volume30d
      totalTvl += tvl

      pools.push({
        id: pool.id,
        symbol: pairedSymbol,
        volume24h,
        volume7d,
        volume30d,
        tvl,
      })
    }

    // Fetch pool types in parallel
    const fetchPoolType = async (poolType: string) => {
      const url = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=${poolType}&poolSortField=volume&sortType=desc&pageSize=${pageSize}&page=1`

      try {
        const response = await fetchWithTimeout(url)
        if (!response.ok) {
          console.error(`[Volume] Raydium API error for ${poolType}:`, response.status)
          return
        }

        const json = await response.json()
        if (!json.success || !json.data?.data) return

        json.data.data.forEach(processPool)

        // Fetch additional pages if needed
        const totalCount = json.data.count || json.data.data.length
        const totalPages = Math.min(Math.ceil(totalCount / pageSize), maxPages)

        if (totalPages > 1) {
          const pagePromises = []
          for (let page = 2; page <= totalPages; page++) {
            const pageUrl = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=${poolType}&poolSortField=volume&sortType=desc&pageSize=${pageSize}&page=${page}`
            pagePromises.push(
              fetchWithTimeout(pageUrl, 8000)
                .then(res => res.ok ? res.json() : null)
                .catch(() => null)
            )
          }

          const results = await Promise.all(pagePromises)
          results.forEach(result => {
            if (result?.success && result.data?.data) {
              result.data.data.forEach(processPool)
            }
          })
        }
      } catch (error) {
        console.error(`[Volume] Error fetching ${poolType} pools:`, error)
      }
    }

    await Promise.all(BONKFUN_POOL_TYPES.map(fetchPoolType))

    // Sort by 24h volume descending
    pools.sort((a, b) => b.volume24h - a.volume24h)

    console.log(`[Volume] Raydium data: ${pools.length} BONK.fun/USD1 pools, 24h: $${totalVolume24h.toLocaleString()}, TVL: $${totalTvl.toLocaleString()}`)
  } catch (error) {
    console.error("[Volume] Error fetching Raydium data:", error)
  }

  return {
    pools,
    totalVolume24h,
    totalVolume7d,
    totalVolume30d,
    totalTvl,
    poolCount: pools.length,
  }
}

// Generate simple volume history from current data
// Note: Raydium doesn't provide historical OHLCV, so we show aggregate data
function generateVolumeHistory(
  totalVolume: number,
  period: string
): Array<{ timestamp: number; volume: number }> {
  const now = Date.now()
  const history: Array<{ timestamp: number; volume: number }> = []

  let points: number
  let intervalMs: number

  switch (period) {
    case "24h":
      points = 24
      intervalMs = 60 * 60 * 1000
      break
    case "7d":
      points = 7
      intervalMs = 24 * 60 * 60 * 1000
      break
    case "1m":
      points = 30
      intervalMs = 24 * 60 * 60 * 1000
      break
    case "all":
      points = 12
      intervalMs = 7 * 24 * 60 * 60 * 1000
      break
    default:
      points = 24
      intervalMs = 60 * 60 * 1000
  }

  // Distribute volume evenly (this is an approximation since Raydium only provides aggregates)
  const volumePerInterval = totalVolume / points

  for (let i = points - 1; i >= 0; i--) {
    const timestamp = now - (i * intervalMs)
    history.push({
      timestamp,
      volume: Math.round(volumePerInterval),
    })
  }

  return history
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const period = url.searchParams.get("period") || "24h"

  // Check cache
  if (volumeCache && Date.now() - volumeCache.timestamp < CACHE_TTL) {
    const cached = volumeCache.data
    const volumeForPeriod = period === "24h" ? cached.totalVolume24h
      : period === "7d" ? cached.totalVolume7d
      : period === "1m" ? cached.totalVolume30d
      : cached.totalVolume30d

    const history = generateVolumeHistory(volumeForPeriod, period)

    return NextResponse.json({
      history,
      stats: {
        current: volumeForPeriod,
        previous: volumeForPeriod,
        change: 0,
        peak: Math.round(volumeForPeriod / (period === "24h" ? 24 : period === "7d" ? 7 : 30)),
        low: Math.round(volumeForPeriod / (period === "24h" ? 24 : period === "7d" ? 7 : 30)),
        average: Math.round(volumeForPeriod / (period === "24h" ? 24 : period === "7d" ? 7 : 30)),
        totalVolume: volumeForPeriod,
      },
      period,
      dataPoints: history.length,
      cached: true,
      source: "raydium",
      poolCount: cached.poolCount,
      topPools: cached.pools.slice(0, 5).map((p: any) => ({
        symbol: p.symbol,
        volume24h: p.volume24h,
      })),
    })
  }

  // Fetch fresh data
  const data = await fetchRaydiumVolumeData()

  // Cache the result
  volumeCache = {
    data,
    timestamp: Date.now(),
  }

  const volumeForPeriod = period === "24h" ? data.totalVolume24h
    : period === "7d" ? data.totalVolume7d
    : period === "1m" ? data.totalVolume30d
    : data.totalVolume30d

  const history = generateVolumeHistory(volumeForPeriod, period)

  return NextResponse.json({
    history,
    stats: {
      current: volumeForPeriod,
      previous: volumeForPeriod,
      change: 0,
      peak: Math.round(volumeForPeriod / (period === "24h" ? 24 : period === "7d" ? 7 : 30)),
      low: Math.round(volumeForPeriod / (period === "24h" ? 24 : period === "7d" ? 7 : 30)),
      average: Math.round(volumeForPeriod / (period === "24h" ? 24 : period === "7d" ? 7 : 30)),
      totalVolume: volumeForPeriod,
    },
    period,
    dataPoints: history.length,
    cached: false,
    source: "raydium",
    poolCount: data.poolCount,
    topPools: data.pools.slice(0, 5).map(p => ({
      symbol: p.symbol,
      volume24h: p.volume24h,
    })),
  })
}

export const runtime = "edge"
