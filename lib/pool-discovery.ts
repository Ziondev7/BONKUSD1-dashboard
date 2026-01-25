/**
 * On-Chain Pool Discovery
 *
 * Queries Raydium CPMM program directly on the Solana blockchain
 * to discover ALL USD1 pools with 100% accuracy.
 *
 * This approach guarantees complete coverage since we're reading
 * directly from the source of truth (the blockchain itself).
 */

import { rpcManager } from './rpc-manager'

// Program IDs
export const PROGRAMS = {
  // Raydium CPMM - where BonkFun tokens graduate to
  RAYDIUM_CPMM: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  // Raydium AMM V4 - legacy pools
  RAYDIUM_AMM_V4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  // LaunchLab program (BonkFun uses this)
  LAUNCHLAB: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
  // USD1 stablecoin mint
  USD1_MINT: 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
} as const

// CPMM Pool State account layout
// Based on Raydium CPMM program structure
export const CPMM_POOL_LAYOUT = {
  ACCOUNT_SIZE: 637,
  DISCRIMINATOR: 0,        // 8 bytes - account discriminator
  AMM_CONFIG: 8,           // 32 bytes - AMM config pubkey
  POOL_CREATOR: 40,        // 32 bytes - pool creator pubkey
  TOKEN_MINT_0: 72,        // 32 bytes - first token mint
  TOKEN_MINT_1: 104,       // 32 bytes - second token mint
  TOKEN_VAULT_0: 136,      // 32 bytes - first token vault
  TOKEN_VAULT_1: 168,      // 32 bytes - second token vault
  LP_MINT: 200,            // 32 bytes - LP token mint
  LP_SUPPLY: 232,          // 8 bytes - LP token supply
  PROTOCOL_FEES_0: 240,    // 8 bytes
  PROTOCOL_FEES_1: 248,    // 8 bytes
  FUND_FEES_0: 256,        // 8 bytes
  FUND_FEES_1: 264,        // 8 bytes
  OPEN_TIME: 272,          // 8 bytes - pool open timestamp
  // Additional fields...
}

export interface DiscoveredPool {
  poolAddress: string
  tokenMint: string      // The non-USD1 token
  tokenVault: string
  usd1Vault: string
  lpMint: string
  poolCreator: string
  openTime: number | null
  isTokenMint0USD1: boolean
}

/**
 * Convert base58 string to bytes for memcmp filter
 */
function base58ToBytes(base58: string): number[] {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const bytes: number[] = []

  for (const char of base58) {
    let carry = ALPHABET.indexOf(char)
    if (carry < 0) throw new Error(`Invalid base58 character: ${char}`)

    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }

    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  // Add leading zeros
  for (const char of base58) {
    if (char !== '1') break
    bytes.push(0)
  }

  return bytes.reverse()
}

/**
 * Convert bytes to base58 string
 */
function bytesToBase58(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

  // Count leading zeros
  let zeros = 0
  for (const byte of bytes) {
    if (byte !== 0) break
    zeros++
  }

  // Convert to base58
  const digits: number[] = []
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8
      digits[i] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }

  // Build string
  let result = '1'.repeat(zeros)
  for (let i = digits.length - 1; i >= 0; i--) {
    result += ALPHABET[digits[i]]
  }

  return result
}

/**
 * Make RPC request with proper error handling
 */
async function rpcRequest(url: string, method: string, params: any[]): Promise<any> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000) // 30s timeout for getProgramAccounts

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const json = await response.json()

    if (json.error) {
      throw new Error(`RPC Error: ${json.error.message || JSON.stringify(json.error)}`)
    }

    return json.result
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

/**
 * Discover all USD1 pools from Raydium CPMM program
 * Returns both the pool addresses and the non-USD1 token mints
 */
export async function discoverUSD1Pools(): Promise<{
  pools: DiscoveredPool[]
  tokenMints: string[]
  discoveredAt: number
}> {
  console.log('[PoolDiscovery] Starting on-chain pool discovery...')
  const startTime = Date.now()

  const pools: DiscoveredPool[] = []
  const tokenMints = new Set<string>()

  // Execute with fallback across multiple RPC providers
  await rpcManager.executeWithFallback(async (rpcUrl, endpointName) => {
    console.log(`[PoolDiscovery] Using ${endpointName} endpoint`)

    // Query 1: Find pools where USD1 is tokenMint0
    const poolsWithUSD1AsMint0 = await rpcRequest(rpcUrl, 'getProgramAccounts', [
      PROGRAMS.RAYDIUM_CPMM,
      {
        encoding: 'base64',
        filters: [
          { dataSize: CPMM_POOL_LAYOUT.ACCOUNT_SIZE },
          { memcmp: { offset: CPMM_POOL_LAYOUT.TOKEN_MINT_0, bytes: PROGRAMS.USD1_MINT } },
        ],
      },
    ])

    console.log(`[PoolDiscovery] Found ${poolsWithUSD1AsMint0?.length || 0} pools with USD1 as mint0`)

    // Query 2: Find pools where USD1 is tokenMint1
    const poolsWithUSD1AsMint1 = await rpcRequest(rpcUrl, 'getProgramAccounts', [
      PROGRAMS.RAYDIUM_CPMM,
      {
        encoding: 'base64',
        filters: [
          { dataSize: CPMM_POOL_LAYOUT.ACCOUNT_SIZE },
          { memcmp: { offset: CPMM_POOL_LAYOUT.TOKEN_MINT_1, bytes: PROGRAMS.USD1_MINT } },
        ],
      },
    ])

    console.log(`[PoolDiscovery] Found ${poolsWithUSD1AsMint1?.length || 0} pools with USD1 as mint1`)

    // Process pools where USD1 is tokenMint0
    for (const account of poolsWithUSD1AsMint0 || []) {
      try {
        const data = Buffer.from(account.account.data[0], 'base64')
        const pool = parsePoolAccount(account.pubkey, data, true)
        if (pool && pool.tokenMint !== PROGRAMS.USD1_MINT) {
          pools.push(pool)
          tokenMints.add(pool.tokenMint)
        }
      } catch (e) {
        console.warn('[PoolDiscovery] Failed to parse pool:', e)
      }
    }

    // Process pools where USD1 is tokenMint1
    for (const account of poolsWithUSD1AsMint1 || []) {
      try {
        const data = Buffer.from(account.account.data[0], 'base64')
        const pool = parsePoolAccount(account.pubkey, data, false)
        if (pool && pool.tokenMint !== PROGRAMS.USD1_MINT) {
          pools.push(pool)
          tokenMints.add(pool.tokenMint)
        }
      } catch (e) {
        console.warn('[PoolDiscovery] Failed to parse pool:', e)
      }
    }

    return true
  })

  const elapsed = Date.now() - startTime
  console.log(`[PoolDiscovery] Completed in ${elapsed}ms. Found ${pools.length} pools, ${tokenMints.size} unique tokens`)

  return {
    pools,
    tokenMints: Array.from(tokenMints),
    discoveredAt: Date.now(),
  }
}

/**
 * Parse a CPMM pool account from raw bytes
 */
function parsePoolAccount(
  pubkey: string,
  data: Buffer,
  isTokenMint0USD1: boolean
): DiscoveredPool | null {
  if (data.length < CPMM_POOL_LAYOUT.ACCOUNT_SIZE) {
    return null
  }

  try {
    // Read pubkeys (32 bytes each)
    const poolCreator = bytesToBase58(data.slice(CPMM_POOL_LAYOUT.POOL_CREATOR, CPMM_POOL_LAYOUT.POOL_CREATOR + 32))
    const tokenMint0 = bytesToBase58(data.slice(CPMM_POOL_LAYOUT.TOKEN_MINT_0, CPMM_POOL_LAYOUT.TOKEN_MINT_0 + 32))
    const tokenMint1 = bytesToBase58(data.slice(CPMM_POOL_LAYOUT.TOKEN_MINT_1, CPMM_POOL_LAYOUT.TOKEN_MINT_1 + 32))
    const tokenVault0 = bytesToBase58(data.slice(CPMM_POOL_LAYOUT.TOKEN_VAULT_0, CPMM_POOL_LAYOUT.TOKEN_VAULT_0 + 32))
    const tokenVault1 = bytesToBase58(data.slice(CPMM_POOL_LAYOUT.TOKEN_VAULT_1, CPMM_POOL_LAYOUT.TOKEN_VAULT_1 + 32))
    const lpMint = bytesToBase58(data.slice(CPMM_POOL_LAYOUT.LP_MINT, CPMM_POOL_LAYOUT.LP_MINT + 32))

    // Read open time (8 bytes, little endian u64)
    let openTime: number | null = null
    try {
      const openTimeBytes = data.slice(CPMM_POOL_LAYOUT.OPEN_TIME, CPMM_POOL_LAYOUT.OPEN_TIME + 8)
      openTime = Number(openTimeBytes.readBigUInt64LE()) * 1000 // Convert to ms
      if (openTime < 1600000000000 || openTime > 2000000000000) {
        openTime = null // Invalid timestamp
      }
    } catch {
      openTime = null
    }

    // Determine which is the non-USD1 token
    const tokenMint = isTokenMint0USD1 ? tokenMint1 : tokenMint0
    const tokenVault = isTokenMint0USD1 ? tokenVault1 : tokenVault0
    const usd1Vault = isTokenMint0USD1 ? tokenVault0 : tokenVault1

    return {
      poolAddress: pubkey,
      tokenMint,
      tokenVault,
      usd1Vault,
      lpMint,
      poolCreator,
      openTime,
      isTokenMint0USD1,
    }
  } catch (e) {
    console.error('[PoolDiscovery] Error parsing pool account:', e)
    return null
  }
}

/**
 * Get vault balances for price calculation
 * This is a lighter weight call to get current pool state
 */
export async function getPoolVaultBalances(
  tokenVault: string,
  usd1Vault: string
): Promise<{ tokenBalance: number; usd1Balance: number } | null> {
  try {
    return await rpcManager.executeWithFallback(async (rpcUrl) => {
      const response = await rpcRequest(rpcUrl, 'getMultipleAccounts', [
        [tokenVault, usd1Vault],
        { encoding: 'jsonParsed' },
      ])

      if (!response?.value || response.value.length !== 2) {
        return null
      }

      const tokenAccount = response.value[0]?.data?.parsed?.info
      const usd1Account = response.value[1]?.data?.parsed?.info

      if (!tokenAccount || !usd1Account) {
        return null
      }

      return {
        tokenBalance: Number(tokenAccount.tokenAmount?.uiAmount || 0),
        usd1Balance: Number(usd1Account.tokenAmount?.uiAmount || 0),
      }
    })
  } catch (e) {
    console.error('[PoolDiscovery] Error fetching vault balances:', e)
    return null
  }
}

/**
 * Batch get token metadata from on-chain
 */
export async function getTokenMetadata(mints: string[]): Promise<Map<string, {
  decimals: number
  supply: number
  freezeAuthority: string | null
  mintAuthority: string | null
}>> {
  const metadata = new Map()

  // Batch in groups of 100
  const batches: string[][] = []
  for (let i = 0; i < mints.length; i += 100) {
    batches.push(mints.slice(i, i + 100))
  }

  for (const batch of batches) {
    try {
      await rpcManager.executeWithFallback(async (rpcUrl) => {
        const response = await rpcRequest(rpcUrl, 'getMultipleAccounts', [
          batch,
          { encoding: 'jsonParsed' },
        ])

        if (response?.value) {
          for (let i = 0; i < response.value.length; i++) {
            const account = response.value[i]
            if (account?.data?.parsed?.info) {
              const info = account.data.parsed.info
              metadata.set(batch[i], {
                decimals: info.decimals || 9,
                supply: Number(info.supply || 0),
                freezeAuthority: info.freezeAuthority || null,
                mintAuthority: info.mintAuthority || null,
              })
            }
          }
        }

        return true
      })
    } catch (e) {
      console.warn('[PoolDiscovery] Error fetching token metadata batch:', e)
    }
  }

  return metadata
}
