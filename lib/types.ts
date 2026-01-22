export interface Token {
  id: number
  name: string
  symbol: string
  address: string
  emoji: string
  imageUrl: string | null
  price: number
  priceNative: number
  change24h: number
  change1h: number
  volume24h: number
  liquidity: number
  mcap: number
  pairAddress: string
  dex: string
  url: string
  created: number | null
  txns24h: number
  buys24h: number
  sells24h: number
  twitter: string | null
  telegram: string | null
  website: string | null
  // Safety metrics
  safetyScore: number
  safetyLevel: 'safe' | 'caution' | 'risky'
  safetyWarnings: string[]
  // Real-time tracking
  prevPrice?: number
  priceDirection?: 'up' | 'down' | 'neutral'
  lastUpdate?: number
}

export interface Transaction {
  id: string
  symbol: string
  emoji: string
  type: "buy" | "sell"
  amount: number
  timestamp: number
}

export interface BannerState {
  type: "success" | "error" | "info" | "warning"
  title: string
  message: string
  dismissible?: boolean
}

export interface StatusState {
  type: "live" | "loading" | "error" | "syncing"
  text: string
  lastUpdate?: Date
}

export interface FilterState {
  sortBy: 'mcap' | 'volume' | 'change' | 'liquidity' | 'age'
  quickFilter: 'all' | 'gainers' | 'losers' | 'new' | 'hot'
  searchQuery: string
  showFavoritesOnly: boolean
  minVolume: number
  minLiquidity: number
}

export interface MetricsSnapshot {
  totalVolume: number
  totalLiquidity: number
  totalMcap: number
  tokenCount: number
  gainersCount: number
  losersCount: number
  avgChange24h: number
  timestamp: number
}

export interface ApiHealth {
  raydium?: boolean
  dexscreener: boolean
  geckoterminal: boolean
  onchain?: boolean // v2 API on-chain discovery health
}

export interface RpcHealth {
  [key: string]: {
    healthy: boolean
    errorCount: number
    requestCount: number
  }
}

export interface CacheStats {
  poolCache: { hit: boolean; age: number | null; count: number }
  metadataCache: { count: number }
  enrichedCache: { hit: boolean; age: number | null; count: number }
  storage: 'vercel-kv' | 'memory'
}

export interface ApiResponse {
  tokens: Token[]
  cached: boolean
  stale?: boolean
  timestamp: number
  age?: number
  health?: ApiHealth
  error?: string
  // v2 API specific fields
  discovery?: 'on-chain' | 'api'
  version?: 'v1' | 'v2'
  rpcHealth?: RpcHealth
  cacheStats?: CacheStats
}
