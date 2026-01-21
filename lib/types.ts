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
  // Holder count
  holders: number
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
  raydium: boolean
  dexscreener: boolean
  geckoterminal: boolean
}

export interface ApiResponse {
  tokens: Token[]
  cached: boolean
  stale?: boolean
  timestamp: number
  age?: number
  health?: ApiHealth
  error?: string
}
