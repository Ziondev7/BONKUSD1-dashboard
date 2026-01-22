/**
 * High-Precision Decimal Handling for DeFi
 *
 * This module provides utilities for handling token prices with high precision,
 * avoiding JavaScript's floating-point limitations for very small numbers
 * (e.g., memecoin prices like 0.000000000001234567890).
 *
 * JavaScript's Number type has ~15-17 significant digits of precision.
 * For prices smaller than 1e-15, precision loss occurs.
 *
 * This module:
 * 1. Preserves full precision by storing prices as strings
 * 2. Provides safe parsing that handles scientific notation
 * 3. Provides formatting functions that maintain precision for display
 * 4. Provides comparison functions for sorting
 */

// ============================================
// CONSTANTS
// ============================================

// Maximum safe digits for JavaScript number (IEEE 754)
const MAX_SAFE_DIGITS = 15

// Minimum price we consider valid (anything smaller is likely 0 or error)
const MIN_VALID_PRICE = 1e-20

// Maximum price we consider valid (sanity check)
const MAX_VALID_PRICE = 1e15

// ============================================
// TYPES
// ============================================

export interface PrecisePrice {
  // Original value as string (full precision)
  raw: string
  // Numeric value (may have precision loss for very small numbers)
  value: number
  // Number of decimal places in the original
  decimals: number
  // Whether precision was potentially lost in conversion
  precisionLost: boolean
  // Scientific notation representation
  scientific: string
}

// ============================================
// PARSING FUNCTIONS
// ============================================

/**
 * Parse a price value to PrecisePrice, preserving full precision.
 * Handles numbers, strings, scientific notation, and edge cases.
 */
export function parsePrice(input: unknown): PrecisePrice {
  // Handle null/undefined
  if (input === null || input === undefined) {
    return {
      raw: "0",
      value: 0,
      decimals: 0,
      precisionLost: false,
      scientific: "0",
    }
  }

  // Handle number input
  if (typeof input === "number") {
    if (!isFinite(input) || isNaN(input)) {
      return {
        raw: "0",
        value: 0,
        decimals: 0,
        precisionLost: false,
        scientific: "0",
      }
    }

    // Convert to string, preserving as much precision as possible
    const raw = input.toPrecision(17)
    return parsePrice(raw)
  }

  // Handle string input
  if (typeof input === "string") {
    const trimmed = input.trim()

    // Handle empty string
    if (trimmed === "" || trimmed === "0") {
      return {
        raw: "0",
        value: 0,
        decimals: 0,
        precisionLost: false,
        scientific: "0",
      }
    }

    // Remove any currency symbols
    const cleaned = trimmed.replace(/[$,]/g, "")

    // Parse the numeric value
    const value = parseFloat(cleaned)

    if (!isFinite(value) || isNaN(value)) {
      return {
        raw: "0",
        value: 0,
        decimals: 0,
        precisionLost: false,
        scientific: "0",
      }
    }

    // Validate range
    if (Math.abs(value) < MIN_VALID_PRICE) {
      return {
        raw: "0",
        value: 0,
        decimals: 0,
        precisionLost: false,
        scientific: "0",
      }
    }

    if (Math.abs(value) > MAX_VALID_PRICE) {
      return {
        raw: cleaned,
        value: value,
        decimals: 0,
        precisionLost: true,
        scientific: value.toExponential(6),
      }
    }

    // Count decimal places in original string
    let decimals = 0
    if (cleaned.includes(".")) {
      const decimalPart = cleaned.split(".")[1] || ""
      // Handle scientific notation
      if (decimalPart.toLowerCase().includes("e")) {
        const [mantissa, exp] = decimalPart.toLowerCase().split("e")
        decimals = mantissa.length - parseInt(exp, 10)
      } else {
        decimals = decimalPart.length
      }
    }

    // Check for scientific notation in input
    if (cleaned.toLowerCase().includes("e")) {
      const [mantissa, expStr] = cleaned.toLowerCase().split("e")
      const exp = parseInt(expStr, 10)
      if (exp < 0) {
        decimals = Math.abs(exp) + (mantissa.includes(".") ? mantissa.split(".")[1].length : 0)
      }
    }

    // Determine if precision was potentially lost
    const precisionLost = decimals > MAX_SAFE_DIGITS

    return {
      raw: cleaned,
      value,
      decimals,
      precisionLost,
      scientific: value.toExponential(6),
    }
  }

  // Unknown type - return zero
  return {
    raw: "0",
    value: 0,
    decimals: 0,
    precisionLost: false,
    scientific: "0",
  }
}

/**
 * Safely parse a price from API response, handling various formats.
 * Returns a number for compatibility, but logs warnings for precision loss.
 */
export function safeParseApiPrice(value: unknown, source?: string): number {
  const parsed = parsePrice(value)

  if (parsed.precisionLost && parsed.value > 0) {
    console.warn(
      `[Decimal] Precision loss for price from ${source || "unknown"}: ` +
      `${parsed.raw} -> ${parsed.value} (${parsed.decimals} decimals)`
    )
  }

  return parsed.value
}

// ============================================
// FORMATTING FUNCTIONS
// ============================================

/**
 * Format a price for display with appropriate precision.
 * Handles very small prices (micro-cap memecoins) gracefully.
 */
export function formatPrecisePrice(input: unknown): string {
  const parsed = parsePrice(input)

  if (parsed.value === 0) {
    return "$0"
  }

  const value = parsed.value

  // Very small prices - use subscript notation for zeros
  if (value < 0.0001 && value > 0) {
    return formatSubscriptPrice(value)
  }

  // Small prices (< $0.01)
  if (value < 0.01) {
    return `$${value.toFixed(6)}`
  }

  // Medium prices ($0.01 - $1)
  if (value < 1) {
    return `$${value.toFixed(4)}`
  }

  // Normal prices ($1 - $1000)
  if (value < 1000) {
    return `$${value.toFixed(2)}`
  }

  // Large prices
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/**
 * Format very small prices using subscript notation for leading zeros.
 * Example: 0.000001234 becomes $0.0₆1234
 *
 * This is a common DeFi UI pattern for displaying micro-cap token prices.
 */
export function formatSubscriptPrice(value: number): string {
  if (value === 0) return "$0"
  if (value >= 0.0001) return `$${value.toFixed(6)}`

  // Convert to string and find the significant digits
  const str = value.toFixed(20)
  const match = str.match(/^0\.0*/)

  if (!match) {
    return `$${value.toExponential(4)}`
  }

  // Count leading zeros after decimal point
  const leadingZeros = match[0].length - 2 // Subtract "0."

  // Get significant digits (up to 4)
  const significantPart = str.slice(match[0].length, match[0].length + 4)

  // Use subscript digits for the zero count
  const subscriptDigits = "₀₁₂₃₄₅₆₇₈₉"
  let subscript = ""
  for (const digit of leadingZeros.toString()) {
    subscript += subscriptDigits[parseInt(digit, 10)]
  }

  return `$0.0${subscript}${significantPart}`
}

/**
 * Format price for compact display (used in tables, cards).
 * Uses scientific notation for very small numbers.
 */
export function formatCompactPrice(input: unknown): string {
  const parsed = parsePrice(input)

  if (parsed.value === 0) {
    return "$0"
  }

  const value = parsed.value

  // Very small - use scientific notation
  if (value < 0.00000001) {
    return `$${value.toExponential(2)}`
  }

  // Small - show 8 decimal places
  if (value < 0.0001) {
    return `$${value.toFixed(8)}`
  }

  // Medium small
  if (value < 0.01) {
    return `$${value.toFixed(6)}`
  }

  // Small
  if (value < 1) {
    return `$${value.toFixed(4)}`
  }

  // Normal
  if (value < 1000) {
    return `$${value.toFixed(2)}`
  }

  // Large
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

// ============================================
// COMPARISON FUNCTIONS
// ============================================

/**
 * Compare two prices for sorting.
 * Handles string and number inputs.
 */
export function comparePrice(a: unknown, b: unknown): number {
  const parsedA = parsePrice(a)
  const parsedB = parsePrice(b)
  return parsedA.value - parsedB.value
}

/**
 * Check if two prices are approximately equal.
 * Uses relative tolerance for comparison.
 */
export function pricesEqual(a: unknown, b: unknown, tolerance = 0.0001): boolean {
  const parsedA = parsePrice(a)
  const parsedB = parsePrice(b)

  if (parsedA.value === 0 && parsedB.value === 0) {
    return true
  }

  if (parsedA.value === 0 || parsedB.value === 0) {
    return false
  }

  const diff = Math.abs(parsedA.value - parsedB.value)
  const avg = (Math.abs(parsedA.value) + Math.abs(parsedB.value)) / 2
  return diff / avg < tolerance
}

// ============================================
// ARITHMETIC FUNCTIONS (String-based for precision)
// ============================================

/**
 * Multiply a price by a quantity.
 * Returns a number (precision loss acceptable for totals).
 */
export function multiplyPrice(price: unknown, quantity: number): number {
  const parsed = parsePrice(price)
  return parsed.value * quantity
}

/**
 * Calculate percentage change between two prices.
 */
export function calculatePriceChange(oldPrice: unknown, newPrice: unknown): number {
  const old = parsePrice(oldPrice)
  const current = parsePrice(newPrice)

  if (old.value === 0) {
    return 0
  }

  return ((current.value - old.value) / old.value) * 100
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Check if a price value is valid and reasonable.
 */
export function isValidPrice(input: unknown): boolean {
  const parsed = parsePrice(input)
  return parsed.value > 0 && parsed.value < MAX_VALID_PRICE
}

/**
 * Check if a price is suspiciously small (potential data error).
 */
export function isSuspiciouslySmall(input: unknown, threshold = 1e-15): boolean {
  const parsed = parsePrice(input)
  return parsed.value > 0 && parsed.value < threshold
}

/**
 * Normalize a price to a reasonable range, returning null if invalid.
 */
export function normalizePrice(input: unknown): number | null {
  const parsed = parsePrice(input)

  if (parsed.value <= 0 || !isFinite(parsed.value)) {
    return null
  }

  if (parsed.value > MAX_VALID_PRICE) {
    return null
  }

  return parsed.value
}
