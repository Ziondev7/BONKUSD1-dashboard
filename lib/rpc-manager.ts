/**
 * Multi-Provider RPC Manager
 *
 * Rotates between multiple free Solana RPC providers to maximize
 * available credits and ensure high availability.
 *
 * Free Tiers:
 * - Helius: 1M credits (no expiry)
 * - Alchemy: 30M CU/month
 * - Chainstack: 3M req/month
 * - QuickNode: 10M credits (trial)
 * - Solana Public: Rate limited fallback
 */

export interface RPCEndpoint {
  name: string
  url: string
  weight: number
  healthy: boolean
  lastError: number
  errorCount: number
  requestCount: number
}

// RPC endpoints configuration - add your API keys to .env
const createEndpoints = (): RPCEndpoint[] => [
  {
    name: 'helius',
    url: process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : '',
    weight: 4, // Highest priority - fast getProgramAccounts
    healthy: true,
    lastError: 0,
    errorCount: 0,
    requestCount: 0,
  },
  {
    name: 'alchemy',
    url: process.env.ALCHEMY_API_KEY
      ? `https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
      : '',
    weight: 3,
    healthy: true,
    lastError: 0,
    errorCount: 0,
    requestCount: 0,
  },
  {
    name: 'chainstack',
    url: process.env.CHAINSTACK_API_KEY
      ? `https://solana-mainnet.core.chainstack.com/${process.env.CHAINSTACK_API_KEY}`
      : '',
    weight: 2,
    healthy: true,
    lastError: 0,
    errorCount: 0,
    requestCount: 0,
  },
  {
    name: 'quicknode',
    url: process.env.QUICKNODE_URL || '',
    weight: 2,
    healthy: true,
    lastError: 0,
    errorCount: 0,
    requestCount: 0,
  },
  {
    name: 'public',
    url: 'https://api.mainnet-beta.solana.com',
    weight: 1, // Last resort - rate limited
    healthy: true,
    lastError: 0,
    errorCount: 0,
    requestCount: 0,
  },
]

class RPCManager {
  private endpoints: RPCEndpoint[]
  private static instance: RPCManager | null = null

  constructor() {
    this.endpoints = createEndpoints().filter(e => e.url !== '')

    if (this.endpoints.length === 0) {
      // Always have at least the public endpoint
      this.endpoints = [{
        name: 'public',
        url: 'https://api.mainnet-beta.solana.com',
        weight: 1,
        healthy: true,
        lastError: 0,
        errorCount: 0,
        requestCount: 0,
      }]
    }

    console.log(`[RPCManager] Initialized with ${this.endpoints.length} endpoints: ${this.endpoints.map(e => e.name).join(', ')}`)
  }

  static getInstance(): RPCManager {
    if (!RPCManager.instance) {
      RPCManager.instance = new RPCManager()
    }
    return RPCManager.instance
  }

  /**
   * Get the next best endpoint using weighted selection
   */
  getNextEndpoint(): RPCEndpoint {
    const available = this.endpoints.filter(e => this.isHealthy(e))

    if (available.length === 0) {
      // Reset all endpoints if all are unhealthy
      this.endpoints.forEach(e => {
        e.healthy = true
        e.errorCount = 0
      })
      return this.endpoints[0]
    }

    // Weighted random selection
    const totalWeight = available.reduce((sum, e) => sum + e.weight, 0)
    let random = Math.random() * totalWeight

    for (const endpoint of available) {
      random -= endpoint.weight
      if (random <= 0) {
        return endpoint
      }
    }

    return available[available.length - 1]
  }

  /**
   * Get endpoint URL string
   */
  getEndpointUrl(): string {
    return this.getNextEndpoint().url
  }

  /**
   * Check if an endpoint is healthy (with exponential backoff)
   */
  private isHealthy(endpoint: RPCEndpoint): boolean {
    if (endpoint.healthy) return true

    // Exponential backoff: 30s, 60s, 120s, 240s, max 5min
    const backoffMs = Math.min(30000 * Math.pow(2, endpoint.errorCount - 1), 300000)

    if (Date.now() - endpoint.lastError > backoffMs) {
      endpoint.healthy = true
      return true
    }

    return false
  }

  /**
   * Mark an endpoint as having an error
   */
  markError(endpointName: string, error?: Error): void {
    const endpoint = this.endpoints.find(e => e.name === endpointName)
    if (endpoint) {
      endpoint.healthy = false
      endpoint.lastError = Date.now()
      endpoint.errorCount++
      console.warn(`[RPCManager] ${endpointName} error (count: ${endpoint.errorCount}):`, error?.message || 'Unknown error')
    }
  }

  /**
   * Mark an endpoint as successful
   */
  markSuccess(endpointName: string): void {
    const endpoint = this.endpoints.find(e => e.name === endpointName)
    if (endpoint) {
      endpoint.healthy = true
      endpoint.errorCount = 0
      endpoint.requestCount++
    }
  }

  /**
   * Execute a function with automatic fallback to other endpoints
   */
  async executeWithFallback<T>(
    fn: (url: string, endpointName: string) => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    const triedEndpoints = new Set<string>()
    let lastError: Error | null = null

    for (let i = 0; i < maxRetries; i++) {
      const endpoint = this.getNextEndpoint()

      // Skip if we already tried this endpoint
      if (triedEndpoints.has(endpoint.name)) {
        // Find another endpoint we haven't tried
        const untried = this.endpoints.find(e => !triedEndpoints.has(e.name) && this.isHealthy(e))
        if (!untried) break
        triedEndpoints.add(untried.name)

        try {
          const result = await fn(untried.url, untried.name)
          this.markSuccess(untried.name)
          return result
        } catch (e) {
          lastError = e as Error
          this.markError(untried.name, lastError)
          continue
        }
      }

      triedEndpoints.add(endpoint.name)

      try {
        const result = await fn(endpoint.url, endpoint.name)
        this.markSuccess(endpoint.name)
        return result
      } catch (e) {
        lastError = e as Error
        this.markError(endpoint.name, lastError)
        continue
      }
    }

    throw lastError || new Error('All RPC endpoints failed')
  }

  /**
   * Get health status of all endpoints
   */
  getHealthStatus(): Record<string, { healthy: boolean; errorCount: number; requestCount: number }> {
    const status: Record<string, { healthy: boolean; errorCount: number; requestCount: number }> = {}

    for (const endpoint of this.endpoints) {
      status[endpoint.name] = {
        healthy: this.isHealthy(endpoint),
        errorCount: endpoint.errorCount,
        requestCount: endpoint.requestCount,
      }
    }

    return status
  }
}

// Export singleton instance
export const rpcManager = RPCManager.getInstance()

// Export class for testing
export { RPCManager }
