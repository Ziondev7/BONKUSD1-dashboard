import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ============================================
// NUMBER FORMATTING
// ============================================

export function formatNumber(num: number | string | undefined): string {
  if (num === undefined || num === null) return "$0"
  const n = typeof num === "string" ? Number.parseFloat(num) : num
  if (isNaN(n)) return "$0"
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
  return `$${n.toFixed(2)}`
}

export function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toFixed(0)
}

export function formatPrice(price: number | string | undefined): string {
  if (price === undefined || price === null) return "$0"
  const p = typeof price === "string" ? Number.parseFloat(price) : price
  if (isNaN(p)) return "$0"
  if (p < 0.00000001) return `$${p.toExponential(2)}`
  if (p < 0.0001) return `$${p.toFixed(8)}`
  if (p < 0.01) return `$${p.toFixed(6)}`
  if (p < 1) return `$${p.toFixed(4)}`
  if (p < 1000) return `$${p.toFixed(2)}`
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

export function formatPercent(value: number, includeSign = true): string {
  const sign = includeSign && value > 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

// ============================================
// TIME FORMATTING
// ============================================

export function formatAge(created: number | null): string {
  if (!created) return "—"
  const now = Date.now()
  if (created > now) return "now"
  const diff = now - created
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return "now"
}

export function formatTimeAgo(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const seconds = Math.floor(diff / 1000)
  
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function isNewToken(created: number | null): boolean {
  if (!created) return false
  return Date.now() - created < 86400000 // 24 hours
}

// ============================================
// TOKEN HELPERS
// ============================================

export function getTokenEmoji(name?: string): string {
  if (!name) return "🪙"
  const n = name.toLowerCase()
  if (n.includes("dog") || n.includes("doge") || n.includes("shib") || n.includes("inu")) return "🐕"
  if (n.includes("cat") || n.includes("kitty") || n.includes("meow")) return "🐱"
  if (n.includes("frog") || n.includes("pepe")) return "🐸"
  if (n.includes("moon")) return "🌙"
  if (n.includes("sun") || n.includes("sol")) return "☀️"
  if (n.includes("rocket") || n.includes("launch")) return "🚀"
  if (n.includes("fire") || n.includes("burn")) return "🔥"
  if (n.includes("diamond")) return "💎"
  if (n.includes("gold")) return "🥇"
  if (n.includes("money") || n.includes("cash") || n.includes("dollar")) return "💵"
  if (n.includes("ai") || n.includes("bot") || n.includes("gpt")) return "🤖"
  if (n.includes("trump")) return "🇺🇸"
  if (n.includes("elon") || n.includes("musk")) return "🚗"
  if (n.includes("bonk")) return "🔨"
  return "🪙"
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

// ============================================
// CHART DATA GENERATION
// ============================================

export function generateChartData(
  currentMcap: number,
  change24h: number,
  points = 24
): number[] {
  const change = change24h / 100
  const volatility = Math.min(Math.abs(change) * 0.5, 0.15)
  
  const data: number[] = []
  let value = 100
  const target = 100 * (1 + change)
  
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1)
    const trendPull = (target - value) * 0.15
    const noise = (Math.random() - 0.5) * volatility * 100
    const hourVolatility = Math.sin(i * 0.5) * 0.3 + 1
    
    value += trendPull + noise * hourVolatility
    
    if (i === points - 1) {
      value = target
    }
    
    data.push(value)
  }
  
  return data
}

// Deterministic chart data based on token address (for consistent rendering)
export function generateDeterministicChartData(
  tokenAddress: string,
  change24h: number,
  points = 24
): number[] {
  const seed = tokenAddress.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
  const pseudoRandom = (i: number) => {
    const x = Math.sin(seed + i * 12.9898) * 43758.5453
    return x - Math.floor(x)
  }
  
  const change = change24h / 100
  const volatility = Math.min(Math.abs(change) * 0.5, 0.15)
  
  const data: number[] = []
  let value = 100
  const target = 100 * (1 + change)
  
  for (let i = 0; i < points; i++) {
    const trendPull = (target - value) * 0.15
    const noise = (pseudoRandom(i) - 0.5) * volatility * 100
    const hourVolatility = Math.sin(i * 0.5) * 0.3 + 1
    
    value += trendPull + noise * hourVolatility
    
    if (i === points - 1) {
      value = target
    }
    
    data.push(value)
  }
  
  return data
}

// ============================================
// INPUT SANITIZATION & VALIDATION
// ============================================

/**
 * Sanitize search input to prevent XSS and injection attacks
 */
export function sanitizeSearchInput(input: string): string {
  return input
    // Remove control characters and null bytes
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    // Remove Unicode direction overrides and other special characters
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '')
    // Remove potential HTML/script tags
    .replace(/[<>]/g, '')
    // Remove quotes, backticks, semicolons, and backslashes
    .replace(/['"`;\\/]/g, '')
    // Collapse multiple spaces into single space
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) // Limit length
}

/**
 * Validate Solana address format
 */
export function isValidSolanaAddress(address: string): boolean {
  // Base58 characters only, 32-44 chars typical for Solana
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
  return base58Regex.test(address)
}

/**
 * Safely parse number with fallback
 */
export function safeParseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !isNaN(value)) return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    return isNaN(parsed) ? fallback : parsed
  }
  return fallback
}

/**
 * Safely parse price with high precision handling for small memecoin prices
 * Prevents precision loss for very small numbers
 */
export function safeParsePrice(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'number') {
    return isNaN(value) || !isFinite(value) ? fallback : value
  }
  if (typeof value === 'string') {
    // Handle scientific notation
    if (value.includes('e') || value.includes('E')) {
      const parsed = parseFloat(value)
      return isNaN(parsed) || !isFinite(parsed) ? fallback : parsed
    }
    // For very high precision decimals, limit to 15 significant digits
    const parts = value.split('.')
    if (parts[1]?.length > 15) {
      const truncated = parts[0] + '.' + parts[1].slice(0, 15)
      const parsed = parseFloat(truncated)
      return isNaN(parsed) || !isFinite(parsed) ? fallback : parsed
    }
    const parsed = parseFloat(value)
    return isNaN(parsed) || !isFinite(parsed) ? fallback : parsed
  }
  return fallback
}

/**
 * Validate price sources and detect discrepancies
 * Returns the best price and any warnings
 */
export function validatePriceSources(
  sources: { name: string; price: number }[]
): { price: number; warning?: string } {
  const validSources = sources.filter(s => s.price > 0)
  
  if (validSources.length === 0) return { price: 0 }
  if (validSources.length === 1) return { price: validSources[0].price }
  
  const prices = validSources.map(s => s.price)
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length
  const maxDeviation = 0.15 // 15% tolerance
  
  const hasDiscrepancy = prices.some(p => 
    Math.abs(p - avg) / avg > maxDeviation
  )
  
  return {
    price: validSources[0].price, // Use primary source
    warning: hasDiscrepancy ? 'Price sources disagree by >15%' : undefined
  }
}

// ============================================
// PERFORMANCE HELPERS
// ============================================

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      func(...args)
    }, wait)
  }
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => {
        inThrottle = false
      }, limit)
    }
  }
}

// ============================================
// ERROR MESSAGE MAPPING
// ============================================

const ERROR_MESSAGES: Record<string, string> = {
  'ECONNREFUSED': 'Unable to connect to data source. Please try again.',
  'ENOTFOUND': 'Network error. Please check your connection.',
  'ETIMEDOUT': 'Request timed out. The servers may be busy.',
  'TIMEOUT': 'Request timed out. Please try again.',
  'timeout': 'Request timed out. Please try again.',
  '429': 'Too many requests. Please wait a moment.',
  '500': 'Server error. Please try again later.',
  '502': 'Server temporarily unavailable. Please try again.',
  '503': 'Service unavailable. Please try again later.',
  'Failed to fetch': 'Network error. Please check your connection.',
  'NetworkError': 'Network error. Please check your connection.',
  'AbortError': 'Request was cancelled. Please try again.',
}

/**
 * Convert technical error messages to user-friendly messages
 */
export function getUserFriendlyError(error: unknown): string {
  const defaultMessage = 'Something went wrong. Please refresh the page.'
  
  if (!error) return defaultMessage
  
  const errorString = error instanceof Error 
    ? error.message 
    : String(error)
  
  // Check for known error patterns
  for (const [key, friendly] of Object.entries(ERROR_MESSAGES)) {
    if (errorString.includes(key)) {
      return friendly
    }
  }
  
  // Don't expose technical details - return generic message
  return defaultMessage
}

// ============================================
// SAFETY SCORE HELPERS
// ============================================

const SAFETY_WARNING_EXPLANATIONS: Record<string, string> = {
  "Low liquidity": "Low liquidity means large trades may have high slippage. Consider trading smaller amounts.",
  "Low liq/mcap ratio": "Market cap is much higher than available liquidity. This increases price impact risk.",
  "Low trading activity": "Few recent trades. May be difficult to exit your position quickly.",
  "Unbalanced buy/sell": "Trading activity is heavily one-sided. This could indicate manipulation.",
  "Very new token": "Token created within 6 hours. Higher risk of rug pull or abandonment.",
  "Unknown age": "Cannot verify when this token was created. Exercise extra caution.",
  "Suspicious liquidity ratio": "Liquidity is unusually high relative to market cap. Data may be inaccurate.",
  "Abnormal transaction pattern": "Average transaction size is unusually small. Could indicate wash trading.",
}

/**
 * Get detailed explanation for a safety warning
 */
export function getSafetyWarningExplanation(warning: string): string {
  return SAFETY_WARNING_EXPLANATIONS[warning] || warning
}
