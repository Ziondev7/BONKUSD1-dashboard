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
  Users,
  Droplets,
  BarChart3,
} from "lucide-react"
import Image from "next/image"
import type { Token } from "@/lib/types"
import { formatNumber, formatPrice, formatAge, isNewToken, cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"

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
  proMode?: boolean
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

// Memoized mini sparkline component with hover interactivity
const MiniSparkline = memo(function MiniSparkline({
  change24h,
  address
}: {
  change24h: number
  address: string
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
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

  const pointsArray = chartData.map((v, i) => ({
    x: (i / (chartData.length - 1)) * width,
    y: height - ((v - min) / range) * height,
    value: v,
  }))

  const pathString = pointsArray.map(p => `${p.x},${p.y}`).join(' ')

  // Fill path for area under the line
  const fillPath = `M 0,${height} L ${pathString} L ${width},${height} Z`

  return (
    <div className="relative group">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-14 h-6 cursor-crosshair"
        preserveAspectRatio="none"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {/* Gradient definition */}
        <defs>
          <linearGradient id={`spark-grad-${address.slice(0,8)}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Area fill - shown on hover */}
        <path
          d={fillPath}
          fill={`url(#spark-grad-${address.slice(0,8)})`}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        />

        {/* Line */}
        <polyline
          points={pathString}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Interactive hover areas */}
        {pointsArray.map((point, i) => (
          <g key={i}>
            <rect
              x={point.x - width / chartData.length / 2}
              y={0}
              width={width / chartData.length}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(i)}
            />
            {hoveredIndex === i && (
              <circle
                cx={point.x}
                cy={point.y}
                r={3}
                fill={color}
                className="animate-pulse"
              />
            )}
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredIndex !== null && (
        <div
          className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#0a0a0c] border border-white/10 px-2 py-1 rounded text-[10px] font-mono text-white whitespace-nowrap z-50 pointer-events-none"
        >
          {((pointsArray[hoveredIndex].value - 100) >= 0 ? '+' : '')}{(pointsArray[hoveredIndex].value - 100).toFixed(2)}%
        </div>
      )}
    </div>
  )
})


// Mobile Token Card Component
const TokenCard = memo(function TokenCard({
  token,
  index,
  isFavorite,
  isHot,
  isNew,
  onToggleFavorite,
  onSelectToken,
  onOpenTradeModal,
  onCopyAddress,
  copiedAddress,
}: {
  token: Token
  index: number
  isFavorite: boolean
  isHot: boolean
  isNew: boolean
  onToggleFavorite: () => void
  onSelectToken: () => void
  onOpenTradeModal: () => void
  onCopyAddress: (e: React.MouseEvent) => void
  copiedAddress: string | null
}) {
  const isPositive = token.change24h >= 0
  const liqMcapRatio = token.mcap > 0 ? Math.min((token.liquidity / token.mcap) * 100, 100) : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      onClick={onSelectToken}
      className={cn(
        "token-card-mobile glass-card-solid p-4 cursor-pointer transition-all active:scale-[0.98]",
        isHot && "border-danger/30 bg-danger/5",
        token.priceDirection === 'up' && "price-up",
        token.priceDirection === 'down' && "price-down"
      )}
    >
      {/* Card Header - Rank, Token Info, Status Badges */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Favorite & Rank */}
          <div className="flex flex-col items-center gap-1">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite()
              }}
              className="text-white/30 active:text-bonk transition-colors p-1 -m-1"
            >
              <Star className={cn("w-5 h-5", isFavorite && "fill-bonk text-bonk")} />
            </motion.button>
            <span className="text-white/30 font-mono text-xs tabular-nums">#{index + 1}</span>
          </div>

          {/* Token Logo & Info */}
          <TokenLogo token={token} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-white font-mono font-bold truncate" title={token.name}>
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
                onClick={onCopyAddress}
                className="text-white/30 active:text-bonk transition-colors p-1 -m-1"
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

        {/* 24h Change Badge */}
        <div className={cn(
          "flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-mono text-sm font-bold whitespace-nowrap",
          isPositive ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
        )}>
          {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          {isPositive ? "+" : ""}{token.change24h.toFixed(2)}%
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white/[0.02] rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <BarChart3 className="w-3 h-3 text-white/30" />
            <span className="text-white/30 font-mono text-[9px] uppercase tracking-wider">MCap</span>
          </div>
          <p className="text-white font-mono text-sm font-bold tabular-nums">{formatNumber(token.mcap)}</p>
        </div>
        <div className="bg-white/[0.02] rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-white/30 font-mono text-[9px]">$</span>
            <span className="text-white/30 font-mono text-[9px] uppercase tracking-wider">Price</span>
          </div>
          <p className="text-white font-mono text-sm tabular-nums">{formatPrice(token.price)}</p>
        </div>
        <div className="bg-white/[0.02] rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Droplets className="w-3 h-3 text-white/30" />
            <span className="text-white/30 font-mono text-[9px] uppercase tracking-wider">Liq</span>
          </div>
          <p className="text-white font-mono text-sm tabular-nums">{formatNumber(token.liquidity)}</p>
          <div className="liq-bar mt-1.5">
            <div className="liq-bar-fill" style={{ width: `${liqMcapRatio}%` }} />
          </div>
        </div>
        <div className="bg-white/[0.02] rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Flame className="w-3 h-3 text-white/30" />
            <span className="text-white/30 font-mono text-[9px] uppercase tracking-wider">Volume</span>
          </div>
          <p className="text-white font-mono text-sm tabular-nums">{formatNumber(token.volume24h)}</p>
        </div>
      </div>

      {/* Sparkline */}
      <div className="mb-4 px-1">
        <MiniSparkline change24h={token.change24h} address={token.address} />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSelectToken()
          }}
          className="flex-1 py-2.5 bg-white/[0.04] border border-white/[0.06] text-white rounded-lg font-mono text-xs font-bold transition-all active:bg-white/[0.08] flex items-center justify-center gap-2"
        >
          Details
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpenTradeModal()
          }}
          className="flex-1 py-2.5 bg-bonk text-black rounded-lg font-mono text-xs font-bold transition-all active:bg-bonk/90 flex items-center justify-center gap-2 glow-bonk"
        >
          TRADE
          <Image src="/trojan-horse.png" alt="Trojan" width={14} height={14} unoptimized />
        </button>
      </div>
    </motion.div>
  )
})

// Mobile Skeleton Card
function SkeletonCard({ index }: { index: number }) {
  return (
    <div className="token-card-mobile glass-card-solid p-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 skeleton rounded" />
          <div className="w-10 h-10 skeleton rounded-lg" />
          <div>
            <div className="skeleton h-4 w-24 rounded mb-1.5" style={{ animationDelay: `${index * 50}ms` }} />
            <div className="skeleton h-3 w-16 rounded" style={{ animationDelay: `${index * 50 + 25}ms` }} />
          </div>
        </div>
        <div className="skeleton h-8 w-20 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white/[0.02] rounded-lg p-3">
            <div className="skeleton h-3 w-12 rounded mb-2" style={{ animationDelay: `${index * 50 + i * 25}ms` }} />
            <div className="skeleton h-4 w-16 rounded" style={{ animationDelay: `${index * 50 + i * 25 + 10}ms` }} />
          </div>
        ))}
      </div>
      <div className="skeleton h-6 w-full rounded mb-4" />
      <div className="flex gap-3">
        <div className="skeleton h-10 flex-1 rounded-lg" />
        <div className="skeleton h-10 flex-1 rounded-lg" />
      </div>
    </div>
  )
}

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
  proMode = false,
}: TokenTableProps) {
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)
  const isMobile = useIsMobile()

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
        `text-left font-mono text-[10px] tracking-[0.15em] uppercase cursor-pointer hover:text-white transition-colors bg-[#0F0B18] ${proMode ? "py-2 px-3" : "py-4 px-4"}`,
        sortBy === sortKey ? "text-bonk" : "text-white/40"
      )}
      style={{ width }}
    >
      <div className="flex items-center gap-1.5">
        {label}
        <ArrowUpDown className={cn("w-3 h-3", sortBy === sortKey ? "text-bonk" : "opacity-30")} />
      </div>
    </th>
  )

  return (
    <div className={`glass-card-solid overflow-hidden shimmer-effect ${proMode ? "h-full flex flex-col" : ""}`} role="region" aria-label="Token list">
      {/* Mobile Card View */}
      {isMobile ? (
        <div className="p-4 space-y-4">
          {isLoading ? (
            [...Array(5)].map((_, i) => <SkeletonCard key={i} index={i} />)
          ) : tokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Star className="w-12 h-12 text-white/10 mb-4" />
              <h3 className="text-lg font-mono font-bold text-white/60 mb-2">
                No tokens found
              </h3>
              <p className="text-white/40 text-sm font-mono max-w-md px-4">
                {totalTokens === 0
                  ? "Click the star icon on any token to add it to your watchlist"
                  : "Try adjusting your filters or search query"
                }
              </p>
            </div>
          ) : (
            tokens.map((token, i) => {
              const isHot = token.volume24h >= volumeThreshold && token.change24h > 5
              const globalIndex = (currentPage - 1) * 50 + i
              const isFavorite = favorites.has(token.address)
              const isNew = isNewToken(token.created)

              return (
                <TokenCard
                  key={token.address}
                  token={token}
                  index={globalIndex}
                  isFavorite={isFavorite}
                  isHot={isHot}
                  isNew={isNew}
                  onToggleFavorite={() => onToggleFavorite(token.address)}
                  onSelectToken={() => onSelectToken(token)}
                  onOpenTradeModal={() => onOpenTradeModal(token)}
                  onCopyAddress={(e) => handleCopyAddress(token.address, e)}
                  copiedAddress={copiedAddress}
                />
              )
            })
          )}
        </div>
      ) : (
      /* Desktop Table View */
      <div className={`overflow-x-auto overflow-y-auto ${proMode ? "flex-1" : "max-h-[calc(100vh-300px)]"}`}>
        <table className="w-full" role="grid" aria-label="Token data table">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-[rgba(168,85,247,0.2)]">
              {proMode ? (
                /* Ultra-compact Pro Mode header: #, Token, MCap, BUY */
                <>
                  <th className="text-left text-white/40 font-mono text-[8px] tracking-wider uppercase bg-[rgba(15,11,24,0.95)] py-2 px-3 w-[30px]">
                    #
                  </th>
                  <th className="text-left text-white/40 font-mono text-[8px] tracking-wider uppercase bg-[rgba(15,11,24,0.95)] py-2 px-3">
                    TOKEN
                  </th>
                  <th
                    onClick={() => onSortChange("mcap")}
                    className={cn(
                      "text-left font-mono text-[8px] tracking-wider uppercase cursor-pointer hover:text-white transition-colors bg-[rgba(15,11,24,0.95)] py-2 px-3 w-[65px]",
                      sortBy === "mcap" ? "text-bonk" : "text-white/40"
                    )}
                  >
                    MCAP
                  </th>
                  <th className="text-left text-white/40 font-mono text-[8px] tracking-wider uppercase bg-[rgba(15,11,24,0.95)] py-2 px-3 w-[55px]" />
                </>
              ) : (
                /* Full Desktop header */
                <>
                  <th className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase bg-[#0F0B18] py-4 px-4 w-[80px]">
                    #
                  </th>
                  <th className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase bg-[#0F0B18] py-4 px-4 w-[200px]">
                    TOKEN
                  </th>
                  <SortHeader label="MCAP" sortKey="mcap" width="120px" />
                  <th className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase py-4 px-4 w-[100px] bg-[#0F0B18]">
                    PRICE
                  </th>
                  <SortHeader label="24H" sortKey="change" width="120px" />
                  <SortHeader label="VOL" sortKey="volume" width="120px" />
                  <SortHeader label="LIQ/MCAP" sortKey="liquidity" width="120px" />
                  <th className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase py-4 px-4 w-[60px] bg-[#0F0B18]">
                    AGE
                  </th>
                  <th className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase py-4 px-4 w-[90px] bg-[#0F0B18]">
                    HOLDERS
                  </th>
                  <th className="text-left text-white/40 font-mono text-[10px] tracking-[0.15em] uppercase bg-[#0F0B18] py-4 px-4 w-[100px]" />
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(10)].map((_, i) => <SkeletonRow key={i} index={i} />)
            ) : tokens.length === 0 ? (
              <tr>
                <td colSpan={proMode ? 4 : 10} className={proMode ? "py-8" : "py-16"}>
                  <div className="flex flex-col items-center justify-center text-center">
                    <Star className={`text-white/10 mb-3 ${proMode ? "w-8 h-8" : "w-12 h-12"}`} />
                    <h3 className={`font-mono font-bold text-white/60 mb-1 ${proMode ? "text-sm" : "text-lg"}`}>
                      No tokens found
                    </h3>
                    <p className={`text-white/40 font-mono max-w-md ${proMode ? "text-[10px]" : "text-sm"}`}>
                      {totalTokens === 0
                        ? "Add tokens to your watchlist"
                        : "Try adjusting your filters"
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

                if (proMode) {
                  /* Ultra-compact Pro Mode row: #, Token+Change, MCap, BUY */
                  return (
                    <tr
                      key={token.address}
                      onClick={() => onSelectToken(token)}
                      className="border-b border-white/[0.03] cursor-pointer transition-all hover:bg-[rgba(168,85,247,0.05)]"
                    >
                      {/* Rank */}
                      <td className="py-2.5 px-3">
                        <span className="text-white/40 font-mono text-[11px] tabular-nums">
                          {globalIndex + 1}
                        </span>
                      </td>

                      {/* Token: Name + Change % */}
                      <td className="py-2.5 px-3">
                        <div className="min-w-0">
                          <p className="text-white font-mono font-semibold text-[11px] truncate max-w-[100px]" title={token.name}>
                            {token.name}
                          </p>
                          <span className={cn(
                            "text-[9px] font-mono font-bold",
                            isPositive ? "text-success" : "text-danger"
                          )}>
                            {isPositive ? "+" : ""}{token.change24h.toFixed(1)}%
                          </span>
                        </div>
                      </td>

                      {/* MCap */}
                      <td className="py-2.5 px-3">
                        <p className="text-white font-mono font-semibold text-[11px] tabular-nums">
                          {formatNumber(token.mcap)}
                        </p>
                      </td>

                      {/* BUY Button */}
                      <td className="py-2.5 px-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpenTradeModal(token)
                          }}
                          className="px-2 py-1 bg-gradient-to-r from-[#A855F7] to-[#EC4899] text-white rounded text-[9px] font-bold font-mono transition-all hover:opacity-90 active:scale-95"
                          aria-label={`Buy ${token.symbol}`}
                        >
                          BUY
                        </button>
                      </td>
                    </tr>
                  )
                }

                /* Full Desktop row */
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
                      <div className="flex items-center gap-2">
                        <motion.button
                          whileHover={{ scale: 1.15, rotate: 15 }}
                          whileTap={{ scale: 0.9, rotate: -15 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleFavorite(token.address)
                          }}
                          className={cn(
                            "text-white/30 hover:text-bonk transition-colors focus-visible-bonk",
                            isFavorite && "star-interactive active"
                          )}
                          aria-label={isFavorite ? "Remove from watchlist" : "Add to watchlist"}
                          aria-pressed={isFavorite}
                        >
                          <Star className={cn("w-4 h-4", isFavorite && "fill-bonk text-bonk")} />
                        </motion.button>
                        <span className="text-white/40 font-mono tabular-nums text-sm w-6">
                          {globalIndex + 1}
                        </span>
                      </div>
                    </td>

                    {/* Token Info */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <TokenLogo token={token} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
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
                          <p className="text-white/40 font-mono text-xs">${token.symbol}</p>
                        </div>
                      </div>
                    </td>

                    {/* Market Cap */}
                    <td className="py-4 px-4">
                      <p className="text-white font-mono font-bold number-display text-sm">
                        {formatNumber(token.mcap)}
                      </p>
                    </td>

                    {/* Price */}
                    <td className="py-4 px-4">
                      <p className="text-white font-mono text-sm price-value">
                        {formatPrice(token.price)}
                      </p>
                    </td>

                    {/* 24h Change */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-1">
                        <MiniSparkline change24h={token.change24h} address={token.address} />
                        <span className={cn(
                          "inline-flex items-center gap-0.5 font-mono font-bold text-sm",
                          isPositive ? "text-success" : "text-danger"
                        )}>
                          {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {isPositive ? "+" : ""}{token.change24h.toFixed(1)}%
                        </span>
                      </div>
                    </td>

                    {/* Volume */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-1">
                        <p className="text-white font-mono tabular-nums text-sm">{formatNumber(token.volume24h)}</p>
                        {isHot && <Flame className="w-3.5 h-3.5 text-danger animate-pulse" />}
                      </div>
                    </td>

                    {/* Liquidity */}
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

                    {/* Holders */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-white/30" />
                        <span className="text-white font-mono text-sm tabular-nums">
                          {token.holders ? token.holders.toLocaleString() : "—"}
                        </span>
                      </div>
                    </td>

                    {/* Action */}
                    <td className="py-4 px-4">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenTradeModal(token)
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-bonk hover:bg-bonk/90 text-black rounded-lg font-mono text-xs font-bold transition-all whitespace-nowrap glow-bonk active:scale-95"
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
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        proMode ? (
          /* Compact Pro Mode pagination */
          <div className="border-t border-[rgba(168,85,247,0.15)] flex items-center justify-between px-3 py-2">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-1.5 text-white/40 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] font-mono text-white/50">
              <span className="text-white font-bold">{currentPage}</span>
              <span className="mx-1">/</span>
              <span>{totalPages}</span>
            </span>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-1.5 text-white/40 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* Full Desktop pagination */
          <div className="border-t border-white/[0.04] flex items-center justify-center gap-2 px-5 py-4">
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
        )
      )}
    </div>
  )
}
