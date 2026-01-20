#!/usr/bin/env npx ts-node

/**
 * BONKUSD1 Volume Validation Script
 *
 * Compares computed volume from our API against external sources
 * to verify accuracy and identify discrepancies.
 *
 * Usage:
 *   npx ts-node scripts/validate-volume.ts
 *   # or
 *   npm run validate-volume
 */

const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
const RAYDIUM_API = "https://api-v3.raydium.io"
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2"
const DEXSCREENER_API = "https://api.dexscreener.com"

interface PoolData {
  id: string
  symbol: string
  raydiumVolume24h: number
  geckoVolume24h: number
  dexscreenerVolume24h: number
  tvl: number
}

interface ValidationResult {
  pool: string
  symbol: string
  raydium: number
  gecko: number
  dexscreener: number
  avgVolume: number
  maxDiff: number
  maxDiffPercent: number
  status: "OK" | "WARNING" | "ERROR"
}

// Fetch helper with timeout
async function fetchJson(url: string, timeout = 10000): Promise<any> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

// Get pools from Raydium
async function getRaydiumPools(): Promise<Map<string, PoolData>> {
  console.log("📡 Fetching pools from Raydium...")
  const pools = new Map<string, PoolData>()

  try {
    for (const poolType of ["cpmm", "standard"]) {
      const url = `${RAYDIUM_API}/pools/info/mint?mint1=${USD1_MINT}&poolType=${poolType}&poolSortField=liquidity&sortType=desc&pageSize=50&page=1`
      const json = await fetchJson(url)

      if (!json.success || !json.data?.data) continue

      for (const pool of json.data.data) {
        const mintA = pool.mintA?.address
        const mintB = pool.mintB?.address
        const isAUSD1 = mintA === USD1_MINT

        if (!isAUSD1 && mintB !== USD1_MINT) continue

        const symbol = isAUSD1 ? pool.mintB?.symbol : pool.mintA?.symbol
        if (!symbol || ["USD1", "USDC", "USDT", "SOL", "WSOL", "RAY"].includes(symbol.toUpperCase())) continue

        pools.set(pool.id, {
          id: pool.id,
          symbol,
          raydiumVolume24h: pool.day?.volume || 0,
          geckoVolume24h: 0,
          dexscreenerVolume24h: 0,
          tvl: pool.tvl || 0,
        })
      }
    }

    console.log(`   Found ${pools.size} BONK.fun/USD1 pools`)
  } catch (error) {
    console.error("❌ Raydium fetch error:", error)
  }

  return pools
}

// Get volume from GeckoTerminal for a specific pool
async function getGeckoVolume(poolAddress: string): Promise<number> {
  try {
    const url = `${GECKOTERMINAL_API}/networks/solana/pools/${poolAddress}`
    const json = await fetchJson(url)
    return parseFloat(json.data?.attributes?.volume_usd?.h24) || 0
  } catch {
    return 0
  }
}

// Get volume from DexScreener for a specific pool
async function getDexScreenerVolume(poolAddress: string): Promise<number> {
  try {
    const url = `${DEXSCREENER_API}/latest/dex/pairs/solana/${poolAddress}`
    const json = await fetchJson(url)
    return parseFloat(json.pair?.volume?.h24) || 0
  } catch {
    return 0
  }
}

// Validate a single pool
async function validatePool(pool: PoolData): Promise<ValidationResult> {
  // Fetch from other sources
  const [geckoVolume, dexVolume] = await Promise.all([
    getGeckoVolume(pool.id),
    getDexScreenerVolume(pool.id),
  ])

  pool.geckoVolume24h = geckoVolume
  pool.dexscreenerVolume24h = dexVolume

  // Calculate metrics
  const volumes = [pool.raydiumVolume24h, geckoVolume, dexVolume].filter(v => v > 0)
  const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0
  const maxVolume = Math.max(...volumes, 1)
  const minVolume = Math.min(...volumes.filter(v => v > 0), maxVolume)
  const maxDiff = maxVolume - minVolume
  const maxDiffPercent = avgVolume > 0 ? (maxDiff / avgVolume) * 100 : 0

  // Determine status
  let status: "OK" | "WARNING" | "ERROR" = "OK"
  if (maxDiffPercent > 50) {
    status = "ERROR"
  } else if (maxDiffPercent > 20) {
    status = "WARNING"
  }

  return {
    pool: pool.id.slice(0, 8) + "...",
    symbol: pool.symbol,
    raydium: pool.raydiumVolume24h,
    gecko: geckoVolume,
    dexscreener: dexVolume,
    avgVolume,
    maxDiff,
    maxDiffPercent,
    status,
  }
}

// Format number for display
function formatUSD(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`
  if (n >= 1000) return `$${(n / 1000).toFixed(2)}K`
  return `$${n.toFixed(2)}`
}

// Main validation function
async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════╗")
  console.log("║         BONKUSD1 VOLUME VALIDATION SCRIPT                     ║")
  console.log("║         Comparing volume across data sources                   ║")
  console.log("╚═══════════════════════════════════════════════════════════════╝")
  console.log("")

  // Step 1: Get pools from Raydium
  const pools = await getRaydiumPools()

  if (pools.size === 0) {
    console.error("❌ No pools found. Exiting.")
    process.exit(1)
  }

  // Step 2: Select top 5 pools by TVL for validation
  const topPools = Array.from(pools.values())
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 5)

  console.log("")
  console.log("🔍 Validating top 5 pools by TVL...")
  console.log("   (comparing Raydium, GeckoTerminal, and DexScreener)")
  console.log("")

  // Step 3: Validate each pool
  const results: ValidationResult[] = []

  for (const pool of topPools) {
    console.log(`   Checking ${pool.symbol}...`)
    const result = await validatePool(pool)
    results.push(result)

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // Step 4: Display results
  console.log("")
  console.log("═══════════════════════════════════════════════════════════════")
  console.log("                        VALIDATION RESULTS                      ")
  console.log("═══════════════════════════════════════════════════════════════")
  console.log("")

  // Header
  console.log("┌──────────┬──────────────┬──────────────┬──────────────┬────────────┬────────┐")
  console.log("│ Symbol   │ Raydium      │ GeckoTerm    │ DexScreener  │ Diff %     │ Status │")
  console.log("├──────────┼──────────────┼──────────────┼──────────────┼────────────┼────────┤")

  for (const r of results) {
    const symbolPad = r.symbol.padEnd(8).slice(0, 8)
    const raydiumPad = formatUSD(r.raydium).padStart(12)
    const geckoPad = formatUSD(r.gecko).padStart(12)
    const dexPad = formatUSD(r.dexscreener).padStart(12)
    const diffPad = `${r.maxDiffPercent.toFixed(1)}%`.padStart(10)

    const statusIcon = r.status === "OK" ? "✅" : r.status === "WARNING" ? "⚠️ " : "❌"

    console.log(`│ ${symbolPad} │${raydiumPad} │${geckoPad} │${dexPad} │${diffPad} │ ${statusIcon}    │`)
  }

  console.log("└──────────┴──────────────┴──────────────┴──────────────┴────────────┴────────┘")

  // Step 5: Summary
  console.log("")
  console.log("═══════════════════════════════════════════════════════════════")
  console.log("                           SUMMARY                              ")
  console.log("═══════════════════════════════════════════════════════════════")

  const okCount = results.filter(r => r.status === "OK").length
  const warnCount = results.filter(r => r.status === "WARNING").length
  const errorCount = results.filter(r => r.status === "ERROR").length

  const totalRaydium = results.reduce((sum, r) => sum + r.raydium, 0)
  const totalGecko = results.reduce((sum, r) => sum + r.gecko, 0)
  const totalDex = results.reduce((sum, r) => sum + r.dexscreener, 0)
  const avgDiffPercent = results.reduce((sum, r) => sum + r.maxDiffPercent, 0) / results.length

  console.log("")
  console.log(`   ✅ OK:      ${okCount} pools (diff < 20%)`)
  console.log(`   ⚠️  WARNING: ${warnCount} pools (diff 20-50%)`)
  console.log(`   ❌ ERROR:   ${errorCount} pools (diff > 50%)`)
  console.log("")
  console.log(`   Total 24h Volume (Raydium):     ${formatUSD(totalRaydium)}`)
  console.log(`   Total 24h Volume (GeckoTerm):   ${formatUSD(totalGecko)}`)
  console.log(`   Total 24h Volume (DexScreener): ${formatUSD(totalDex)}`)
  console.log(`   Average Difference:             ${avgDiffPercent.toFixed(1)}%`)
  console.log("")

  // Step 6: Tolerance explanation
  console.log("═══════════════════════════════════════════════════════════════")
  console.log("                    TOLERANCE EXPLANATION                       ")
  console.log("═══════════════════════════════════════════════════════════════")
  console.log("")
  console.log("   Volume discrepancies between sources are expected due to:")
  console.log("")
  console.log("   1. Time window differences - APIs may use slightly different")
  console.log("      24-hour windows (rolling vs fixed)")
  console.log("")
  console.log("   2. Data refresh rates - Raydium updates more frequently")
  console.log("      than GeckoTerminal/DexScreener")
  console.log("")
  console.log("   3. Price conversion - USD volume calculated at different")
  console.log("      price points during the period")
  console.log("")
  console.log("   ACCEPTABLE TOLERANCE: < 20% difference is considered normal")
  console.log("")
  console.log("═══════════════════════════════════════════════════════════════")

  // Exit with appropriate code
  if (errorCount > 0) {
    console.log("")
    console.log("⚠️  Some pools have significant discrepancies. Manual review recommended.")
    process.exit(1)
  } else {
    console.log("")
    console.log("✅ All pools within acceptable tolerance!")
    process.exit(0)
  }
}

// Run
main().catch(error => {
  console.error("Fatal error:", error)
  process.exit(1)
})
