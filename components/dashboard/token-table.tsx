"use client"

import React from "react"

import { useState, useCallback, useMemo, memo } from "react"
import { motion } from "framer-motion"
import {
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Star,
  ArrowUpDown,
  Flame,
  Zap,
  ExternalLink,
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react"
import Image from "next/image"
import type { Token } from "@/lib/types"
import { formatNumber, formatPrice, formatAge, isNewToken, cn, getSafetyWarningExplanation } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { TokenCardGrid } from "./token-cards"

interface TokenTableProps {
  tokens: Token[]
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  totalTokens: number
  favorites: Set<string>
  onToggleFavorite: (address: string) => void
  sortBy: string
  onSortChange: (value: string) => void
  onSelectToken: (token: Token) => void
  onOpenTradeModal: (token: Token) => void
  isLoading?: boolean
}

// Memoized token logo component
const TokenLogo = memo(function TokenLogo({ token }: { token: Token }) {
  const [hasError, setHasError] = useState(false)

  if (!token.imageUrl || hasError) {
    return (
      <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-lg">
        {token.emoji}
      </div>
    )
  }

  return (
    <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] overflow-hidden relative">
      <Image
        src={token.imageUrl || "/placeholder.svg"}
        alt={token.name}
        fill
        className="object-cover"
        onError={() => setHasError(true)}
        unoptimized
      />
    </div>
  )
})

// Memoized mini sparkline component
const MiniSparkline = memo(function MiniSparkline({ 
  change24h, 
  address 
}: { 
  change24h: number
  address: string 
}) {
  const isPositive = change24h >= 0
  const color = isPositive ? "#00FF88" : "#FF3B3B"
  
  // Generate deterministic chart data based on address
  const chartData = useMemo(() => {
    const seed = address.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
    const pseudoRandom = (i: number) => {
      const x = Math.sin(seed + i * 12.9898) * 43758.5453
      return x - Math.floor(x)
    }
    
    const change = change24h / 100
    const volatility = Math.min(Math.abs(change) * 0.4, 0.12)
    const points = 12
    
    const data: number[] = []
    let value = 100
    const target = 100 * (1 + change)
    
    for (let i = 0; i < points; i++) {
      const trendPull = (target - value) * 0.2
      const noise = (pseudoRandom(i) - 0.5) * volatility * 80
      value += trendPull + noise
      if (i === points - 1) value = target
      data.push(value)
    }
    return data
  }, [address, change24h])

  const min = Math.min(...chartData)
  const max = Math.max(...chartData)
  const range = max - min || 1
  
  const width = 60
  const height = 24
  
  const points = chartData.map((v, i) => {
    const x = (i / (chartData.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-14 h-6" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
})

// Safety badge component
const SafetyBadge = memo(function SafetyBadge({
  level,
  score,
  warnings,
}: {
  level: "safe" | "caution" | "risky"
  score: number
  warnings: string[]
}) {
  const config = {
    safe: {
      icon: ShieldCheck,
      bg: "bg-success/10",
      border: "border-success/30",
      text: "text-success",
      label: "SAFE",
    },
    caution: {
      icon: Shield,
      bg: "bg-bonk/10",
      border: "border-bonk/30",
      text: "text-bonk",
      label: "CAUTION",
    },
    risky: {
      icon: ShieldAlert,
      bg: "bg-danger/10",
      border: "border-danger/30",
      text: "text-danger",
      label: "RISKY",
    },
  }[level]

  const Icon = config.icon

  return (
    <div className="group relative">
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold font-mono border",
          config.bg,
          config.border,
          config.text
        )}
      >
        <Icon className="w-3 h-3" />
        <span>{score}</span>
      </div>
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-[#0a0a0c] border border-white/10 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 min-w-[200px] max-w-[280px]">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={cn("w-4 h-4", config.text)} />
          <span className={cn("font-bold text-xs", config.text)}>{config.label}</span>
          <span className="text-white/40 text-xs ml-auto">{score}/100</span>
        </div>
        {warnings.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/[0.06]">
            {warnings.map((warning, i) => (
              <div key={i} className="text-[10px] text-white/50">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <AlertTriangle className="w-2.5 h-2.5 text-bonk flex-shrink-0" />
                  <span className="font-bold text-white/70">{warning}</span>
                </div>
                <p className="pl-4 text-white/40 leading-relaxed">
                  {getSafetyWarningExplanation(warning)}
                </p>
              </div>
            ))}
          </div>
        )}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-white/10" />
      </div>
    </div>
  )
})

// Skeleton row for loading state - deterministic widths to avoid hydration mismatch
const SKELETON_WIDTHS = [75, 90, 65, 80, 70, 85, 72, 88, 68, 78]

function SkeletonRow({ index = 0 }: { index?: number }) {
  return (
    <tr className="border-b border-white/[0.04]">
      {SKELETON_WIDTHS.map((width, i) => (
        <td key={i} className="py-4 px-4">
          <div 
            className="skeleton h-4 rounded" 
            style={{ width: `${width + (index * 3) % 20}%` }} 
          />
        </td>
      ))}
    </tr>
  )
}

export function TokenTable({
  tokens,
  currentPage,
  totalPages,
  onPageChange,
  totalTokens,
  favorites,
  onToggleFavorite,
  sortBy,
  onSortChange,
  onSelectToken,
  onOpenTradeModal,
  isLoading = false,
}: TokenTableProps) {
  const isMobile = useIsMobile()
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)

  const volumeThreshold = useMemo(() => {
    if (tokens.length === 0) return 0
    const sorted = [...tokens].sort((a, b) => b.volume24h - a.volume24h)
    return sorted[Math.floor(sorted.length * 0.2)]?.volume24h || 0
  }, [tokens])

  const handleCopyAddress = useCallback(async (address: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddress(address)
      setTimeout(() => setCopiedAddress(null), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }, [])

  const getPageNumbers = useCallback(() => {
    const pages: (number | string)[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (currentPage > 3) pages.push("...")
      
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)
      
      for (let i = start; i <= end; i++) pages.push(i)
      
      if (currentPage < totalPages - 2) pages.push("...")
      pages.push(totalPages)
    }

    return pages
  }, [currentPage, totalPages])

  const SortHeader = ({ label, sortKey, width }: { label: string; sortKey: string; width: string }) => (
    <th
      onClick={() => onSortChange(sortKey)}
      className={cn(
        "text-left font-mono text-[10px] tracking-[0.15em] uppercase py-4 px-4 cursor-pointer hover:text-white transition-colors",
        sortBy === sortKey ? "text-bonk" : "text-white/40"
      )}
      style={{ width, backgroundColor: "rgba(5, 5, 5, 0.95)" }}
    >
      <div className="flex items-center gap-1.5">
        {label}
        <ArrowUpDown className={cn("w-3 h-3", sortBy === sortKey ? "text-bonk" : "opacity-30")} />
      </div>
    </th>
  )

  // Mobile view - render card grid
  if (isMobile) {
    return (
      <div className="space-y-4">
        {/* Mobile Header */}
        <div className="flex items-center justify-between px-1">
          <h3 className="font-mono font-bold text-sm text-white">
            {totalTokens} TOKENS
          </h3>
          {totalPages > 1 && (
            <span className="text-white/30 text-xs font-mono">
              Page {currentPage} of {totalPages}
            </span>
          )}
        </div>

        {/* Card Grid */}
        <TokenCardGrid
          tokens={tokens}
          currentPage={currentPage}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onSelectToken={onSelectToken}
          onOpenTradeModal={onOpenTradeModal}
          isLoading={isLoading}
        />

        {/* Mobile Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-4 py-2.5 font-mono text-xs rounded-lg bg-white/[0.05] border border-white/[0.08] active:bg-white/[0.1] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              PREV
            </motion.button>

            <span className="font-mono text-sm text-white/60 min-w-[80px] text-center">
              {currentPage} / {totalPages}
            </span>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-4 py-2.5 font-mono text-xs rounded-lg bg-white/[0.05] border border-white/[0.08] active:bg-white/[0.1] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              NEXT
              <ChevronRight className="w-4 h-4" />
            </motion.button>
          </div>
        )}
      </div>
    )
  }

  // Desktop view - render table
  return (
    <div className="glass-card-solid overflow-hidden">
      {/* Table Header Summary */}
      <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="font-mono font-bold text-sm text-white">
            {totalTokens} TOKENS
          </h3>
          {totalPages > 1 && (
            <span className="text-white/30 text-xs font-mono">
              Page {currentPage} of {totalPages}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-white/40">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-success" />
            <span>Safe</span>
          </div>
          <div className="flex items-center gap-1">
            <Shield className="w-3 h-3 text-bonk" />
            <span>Caution</span>
          </div>
          <div className="flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-danger" />
            <span>Risky</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th 
                className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase py-4 px-4 w-[80px]"
                style={{ backgroundColor: "rgba(5, 5, 5, 0.95)" }}
              >
                #
              </th>
              <th 
                className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase py-4 px-4 w-[200px]"
                style={{ backgroundColor: "rgba(5, 5, 5, 0.95)" }}
              >
                TOKEN
              </th>
              <SortHeader label="MCAP" sortKey="mcap" width="120px" />
              <th 
                className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase py-4 px-4 w-[100px]"
                style={{ backgroundColor: "rgba(5, 5, 5, 0.95)" }}
              >
                PRICE
              </th>
              <SortHeader label="24H" sortKey="change" width="120px" />
              <SortHeader label="VOLUME" sortKey="volume" width="120px" />
              <SortHeader label="LIQ/MCAP" sortKey="liquidity" width="120px" />
              <th 
                className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase py-4 px-4 w-[60px]"
                style={{ backgroundColor: "rgba(5, 5, 5, 0.95)" }}
              >
                AGE
              </th>
              <th 
                className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase py-4 px-4 w-[70px]"
                style={{ backgroundColor: "rgba(5, 5, 5, 0.95)" }}
              >
                SAFETY
              </th>
              <th 
                className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase py-4 px-4 w-[100px]"
                style={{ backgroundColor: "rgba(5, 5, 5, 0.95)" }}
              />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(10)].map((_, i) => <SkeletonRow key={i} index={i} />)
            ) : tokens.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-16">
                  <div className="flex flex-col items-center justify-center text-center">
                    <Star className="w-12 h-12 text-white/10 mb-4" />
                    <h3 className="text-lg font-mono font-bold text-white/60 mb-2">
                      No tokens found
                    </h3>
                    <p className="text-white/40 text-sm font-mono max-w-md">
                      {totalTokens === 0 
                        ? "Click the star icon on any token to add it to your watchlist"
                        : "Try adjusting your filters or search query"
                      }
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              tokens.map((token, i) => {
                const isHot = token.volume24h >= volumeThreshold && token.change24h > 5
                const isPositive = token.change24h >= 0
                const globalIndex = (currentPage - 1) * 50 + i
                const isFavorite = favorites.has(token.address)
                const isNew = isNewToken(token.created)
                const liqMcapRatio = token.mcap > 0 ? Math.min((token.liquidity / token.mcap) * 100, 100) : 0

                return (
                  <tr
                    key={token.address}
                    onClick={() => onSelectToken(token)}
                    className={cn(
                      "border-b border-white/[0.03] cursor-pointer transition-all",
                      isHot ? "row-hot" : "row-hover",
                      token.priceDirection === 'up' && "price-up",
                      token.priceDirection === 'down' && "price-down"
                    )}
                  >
                    {/* Index & Favorite */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <motion.button
                          whileHover={{ scale: 1.2 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleFavorite(token.address)
                          }}
                          className="text-white/30 hover:text-bonk transition-colors"
                        >
                          <Star className={cn("w-4 h-4", isFavorite && "fill-bonk text-bonk")} />
                        </motion.button>
                        <span className="text-white/40 font-mono text-sm w-6 tabular-nums">
                          {globalIndex + 1}
                        </span>
                      </div>
                    </td>

                    {/* Token Info */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <TokenLogo token={token} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-white font-mono font-bold truncate max-w-[100px]" title={token.name}>
                              {token.name}
                            </p>
                            {isNew && (
                              <span className="badge-new badge-neon px-1.5 py-0.5 text-[9px] font-mono font-bold rounded">
                                NEW
                              </span>
                            )}
                            {isHot && (
                              <span className="badge-hot px-1.5 py-0.5 text-[9px] font-mono font-bold rounded flex items-center gap-0.5">
                                <Flame className="w-3 h-3" />
                                HOT
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-white/40 text-xs font-mono">${token.symbol}</p>
                            <button
                              onClick={(e) => handleCopyAddress(token.address, e)}
                              className="text-white/30 hover:text-bonk transition-colors"
                              title={`Copy: ${token.address}`}
                            >
                              {copiedAddress === token.address ? (
                                <Check className="w-3 h-3 text-success" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Market Cap */}
                    <td className="py-4 px-4">
                      <p className="text-white font-mono text-sm font-bold tabular-nums">
                        {formatNumber(token.mcap)}
                      </p>
                    </td>

                    {/* Price */}
                    <td className="py-4 px-4">
                      <p className="text-white font-mono text-sm tabular-nums">
                        {formatPrice(token.price)}
                      </p>
                    </td>

                    {/* 24h Change with Sparkline */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <MiniSparkline change24h={token.change24h} address={token.address} />
                        <span className={cn(
                          "inline-flex items-center gap-1 font-mono text-sm font-bold",
                          isPositive ? "text-success" : "text-danger"
                        )}>
                          {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {isPositive ? "+" : ""}{token.change24h.toFixed(2)}%
                        </span>
                      </div>
                    </td>

                    {/* Volume */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-mono text-sm tabular-nums">{formatNumber(token.volume24h)}</p>
                        {isHot && <Flame className="w-3.5 h-3.5 text-danger animate-pulse" />}
                      </div>
                    </td>

                    {/* Liquidity / MCAP Ratio */}
                    <td className="py-4 px-4">
                      <div className="w-24">
                        <p className="text-white font-mono text-sm mb-1 tabular-nums">{formatNumber(token.liquidity)}</p>
                        <div className="liq-bar">
                          <div className="liq-bar-fill" style={{ width: `${liqMcapRatio}%` }} />
                        </div>
                      </div>
                    </td>

                    {/* Age */}
                    <td className="py-4 px-4">
                      <p className={cn(
                        "font-mono text-sm",
                        isNew ? "text-success" : "text-white/40"
                      )} title={token.created ? new Date(token.created).toLocaleString() : "Unknown"}>
                        {formatAge(token.created)}
                      </p>
                    </td>

                    {/* Safety Score */}
                    <td className="py-4 px-4">
                      <SafetyBadge
                        level={token.safetyLevel || 'caution'}
                        score={token.safetyScore || 50}
                        warnings={token.safetyWarnings || []}
                      />
                    </td>

{/* Action */}
                                <td className="py-4 px-4">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onOpenTradeModal(token)
                                    }}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-bonk hover:bg-bonk/90 text-black rounded-lg font-mono font-bold text-xs transition-all whitespace-nowrap glow-bonk active:scale-95"
                                    aria-label={`Trade ${token.symbol} on Trojan`}
                                  >
                                    TRADE
                                    <Image src="/trojan-horse.png" alt="Trojan" width={14} height={14} unoptimized />
                                  </button>
                                </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-5 py-4 border-t border-white/[0.04] flex items-center justify-center gap-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="flex items-center gap-1 px-3 py-2 font-mono text-xs rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            PREV
          </motion.button>
          
          <div className="flex items-center gap-1">
            {getPageNumbers().map((page, idx) =>
              typeof page === "number" ? (
                <motion.button
                  key={idx}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => onPageChange(page)}
                  className={cn(
                    "font-mono text-xs min-w-[36px] py-2 rounded-lg transition-all",
                    currentPage === page
                      ? "bg-bonk text-black glow-bonk"
                      : "bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06]"
                  )}
                >
                  {page}
                </motion.button>
              ) : (
                <span key={idx} className="text-white/30 font-mono px-1">
                  ...
                </span>
              )
            )}
          </div>
          
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="flex items-center gap-1 px-3 py-2 font-mono text-xs rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            NEXT
            <ChevronRight className="w-4 h-4" />
          </motion.button>
        </div>
      )}
    </div>
  )
}
