/**
 * Helius API client for fetching on-chain Solana data
 * Used to get historical swap transactions for volume tracking
 */

const HELIUS_API_KEY = process.env.HELIUS_API_KEY
const HELIUS_RPC_URL = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : null

// USD1 token mint address
const USD1_MINT = "E4Q4Dk1RCSoYLkfSxpC7VscUWeLWCHyjbdmByfdn6JJ8"

// Raydium CPMM program ID (for parsing swaps)
const RAYDIUM_CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"

interface HeliusTransaction {
  signature: string
  timestamp: number
  slot: number
  fee: number
  feePayer: string
  instructions: HeliusInstruction[]
  tokenTransfers?: TokenTransfer[]
  nativeTransfers?: NativeTransfer[]
  events?: {
    swap?: SwapEvent
  }
}

interface HeliusInstruction {
  programId: string
  accounts: string[]
  data: string
  innerInstructions?: HeliusInstruction[]
}

interface TokenTransfer {
  fromUserAccount: string
  toUserAccount: string
  fromTokenAccount: string
  toTokenAccount: string
  tokenAmount: number
  mint: string
  tokenStandard: string
}

interface NativeTransfer {
  fromUserAccount: string
  toUserAccount: string
  amount: number
}

interface SwapEvent {
  nativeInput?: { account: string; amount: string }
  nativeOutput?: { account: string; amount: string }
  tokenInputs?: { userAccount: string; tokenAccount: string; mint: string; rawTokenAmount: { tokenAmount: string; decimals: number } }[]
  tokenOutputs?: { userAccount: string; tokenAccount: string; mint: string; rawTokenAmount: { tokenAmount: string; decimals: number } }[]
  innerSwaps?: any[]
}

export interface ParsedSwap {
  signature: string
  timestamp: number
  poolAddress: string
  tokenMint: string
  tokenSymbol?: string
  volumeUsd: number
  type: 'buy' | 'sell'
}

export interface VolumeDataPoint {
  timestamp: number
  volume: number
  trades: number
}

/**
 * Get parsed transaction history for a pool address
 */
export async function getPoolTransactions(
  poolAddress: string,
  options: {
    before?: string
    until?: string
    limit?: number
  } = {}
): Promise<HeliusTransaction[]> {
  if (!HELIUS_API_KEY) {
    console.warn('[Helius] No API key configured')
    return []
  }

  const url = `https://api.helius.xyz/v0/addresses/${poolAddress}/transactions?api-key=${HELIUS_API_KEY}`

  const params = new URLSearchParams()
  if (options.before) params.append('before', options.before)
  if (options.until) params.append('until', options.until)
  if (options.limit) params.append('limit', options.limit.toString())

  const fullUrl = params.toString() ? `${url}&${params.toString()}` : url

  try {
    const response = await fetch(fullUrl)
    if (!response.ok) {
      throw new Error(`Helius API error: ${response.status}`)
    }
    return response.json()
  } catch (error) {
    console.error('[Helius] Failed to fetch transactions:', error)
    return []
  }
}

/**
 * Parse swap transactions to extract volume data
 */
export function parseSwapTransactions(
  transactions: HeliusTransaction[],
  poolAddress: string
): ParsedSwap[] {
  const swaps: ParsedSwap[] = []

  for (const tx of transactions) {
    // Check if this is a Raydium CPMM swap
    const isRaydiumSwap = tx.instructions?.some(
      ix => ix.programId === RAYDIUM_CPMM_PROGRAM
    )

    if (!isRaydiumSwap) continue

    // Look for USD1 token transfers to calculate volume
    const usd1Transfers = tx.tokenTransfers?.filter(
      t => t.mint === USD1_MINT
    ) || []

    if (usd1Transfers.length === 0) continue

    // Calculate total USD1 volume (USD1 has 6 decimals, so amount is already in USD)
    const totalUsd1 = usd1Transfers.reduce((sum, t) => sum + t.tokenAmount, 0)

    // Determine if buy or sell based on transfer direction
    const isBuy = usd1Transfers.some(t =>
      t.toTokenAccount.includes(poolAddress) || t.toUserAccount.includes(poolAddress)
    )

    swaps.push({
      signature: tx.signature,
      timestamp: tx.timestamp * 1000, // Convert to milliseconds
      poolAddress,
      tokenMint: '', // Will be filled by caller
      volumeUsd: totalUsd1,
      type: isBuy ? 'buy' : 'sell'
    })
  }

  return swaps
}

/**
 * Aggregate swaps into hourly volume buckets
 */
export function aggregateSwapsToHourly(swaps: ParsedSwap[]): VolumeDataPoint[] {
  const hourlyMap = new Map<number, { volume: number; trades: number }>()

  for (const swap of swaps) {
    // Round down to hour
    const hourTimestamp = Math.floor(swap.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000)

    const existing = hourlyMap.get(hourTimestamp) || { volume: 0, trades: 0 }
    hourlyMap.set(hourTimestamp, {
      volume: existing.volume + swap.volumeUsd,
      trades: existing.trades + 1
    })
  }

  // Convert to array and sort by timestamp
  return Array.from(hourlyMap.entries())
    .map(([timestamp, data]) => ({
      timestamp,
      volume: data.volume,
      trades: data.trades
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Aggregate swaps into daily volume buckets
 */
export function aggregateSwapsToDaily(swaps: ParsedSwap[]): VolumeDataPoint[] {
  const dailyMap = new Map<number, { volume: number; trades: number }>()

  for (const swap of swaps) {
    // Round down to day (UTC)
    const dayTimestamp = Math.floor(swap.timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000)

    const existing = dailyMap.get(dayTimestamp) || { volume: 0, trades: 0 }
    dailyMap.set(dayTimestamp, {
      volume: existing.volume + swap.volumeUsd,
      trades: existing.trades + 1
    })
  }

  return Array.from(dailyMap.entries())
    .map(([timestamp, data]) => ({
      timestamp,
      volume: data.volume,
      trades: data.trades
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Fetch all historical transactions for a pool (paginated)
 * WARNING: This can be expensive for very active pools
 */
export async function fetchAllPoolHistory(
  poolAddress: string,
  options: {
    startTime?: number // Unix timestamp in seconds
    endTime?: number
    onProgress?: (fetched: number) => void
  } = {}
): Promise<ParsedSwap[]> {
  if (!HELIUS_API_KEY) {
    console.warn('[Helius] No API key configured, skipping history fetch')
    return []
  }

  const allSwaps: ParsedSwap[] = []
  let lastSignature: string | undefined
  let totalFetched = 0
  const maxIterations = 100 // Safety limit

  for (let i = 0; i < maxIterations; i++) {
    const transactions = await getPoolTransactions(poolAddress, {
      before: lastSignature,
      limit: 100
    })

    if (transactions.length === 0) break

    const swaps = parseSwapTransactions(transactions, poolAddress)
    allSwaps.push(...swaps)
    totalFetched += transactions.length

    // Check if we've reached the start time
    const oldestTx = transactions[transactions.length - 1]
    if (options.startTime && oldestTx.timestamp < options.startTime) {
      // Filter out transactions before start time
      const filtered = allSwaps.filter(s => s.timestamp >= (options.startTime! * 1000))
      options.onProgress?.(totalFetched)
      return filtered
    }

    lastSignature = oldestTx.signature
    options.onProgress?.(totalFetched)

    // Rate limit: 10 requests per second for free tier
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  return allSwaps
}

/**
 * Check if Helius is configured
 */
export function isHeliusConfigured(): boolean {
  return !!HELIUS_API_KEY
}

/**
 * Get recent swaps since a timestamp
 */
export async function getRecentSwaps(
  poolAddress: string,
  sinceTimestamp: number
): Promise<ParsedSwap[]> {
  const transactions = await getPoolTransactions(poolAddress, { limit: 100 })
  const swaps = parseSwapTransactions(transactions, poolAddress)
  return swaps.filter(s => s.timestamp > sinceTimestamp)
}
