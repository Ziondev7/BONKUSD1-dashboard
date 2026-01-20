"use client"

import React, { memo, useState, useCallback } from "react"
import { motion } from "framer-motion"
import {
  TrendingUp,
  TrendingDown,
  Star,
  Copy,
  Check,
  Flame,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ExternalLink,
  ChevronRight,
} from "lucide-react"
import Image from "next/image"
import type { Token } from "@/lib/types"
import { formatNumber, formatPrice, formatAge, isNewToken, cn } from "@/lib/utils"

interface TokenCardProps {
  token: Token
  index: number
  isFavorite: boolean
  isHot: boolean
  onToggleFavorite: (address: string) => void
  onSelect: (token: Token) => void
  onTrade: (token: Token) => void
}

// Memoized token logo for cards
const CardTokenLogo = memo(function CardTokenLogo({ token }: { token: Token }) {
  const [hasError, setHasError] = useState(false)

  if (!token.imageUrl || hasError) {
    return (
      <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-xl">
        {token.emoji}
      </div>
    )
  }

  return (
    <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden relative">
      <Image
        src={token.imageUrl}
        alt={token.name}
        fill
        className="object-cover"
        onError={() => setHasError(true)}
        unoptimized
      />
    </div>
  )
})

// Mini sparkline for cards
const CardSparkline = memo(function CardSparkline({
  change24h,
  address,
}: {
  change24h: number
  address: string
}) {
  const isPositive = change24h >= 0
  const color = isPositive ? "#00FF88" : "#FF3B3B"

  // Generate deterministic chart data
  const seed = address.split("").reduce((a, b) => a + b.charCodeAt(0), 0)
  const pseudoRandom = (i: number) => {
    const x = Math.sin(seed + i * 12.9898) * 43758.5453
    return x - Math.floor(x)
  }

  const change = change24h / 100
  const volatility = Math.min(Math.abs(change) * 0.4, 0.12)
  const points = 16

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

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const width = 100
  const height = 32

  const linePoints = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * height
      return `${x},${y}`
    })
    .join(" ")

  // Create gradient fill path
  const fillPoints = `0,${height} ${linePoints} ${width},${height}`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-8" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${address.slice(0, 8)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill={`url(#grad-${address.slice(0, 8)})`} />
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
})

// Safety indicator for cards
const CardSafetyBadge = memo(function CardSafetyBadge({
  level,
  score,
}: {
  level: "safe" | "caution" | "risky"
  score: number
}) {
  const config = {
    safe: { icon: ShieldCheck, color: "text-success", bg: "bg-success/10" },
    caution: { icon: Shield, color: "text-bonk", bg: "bg-bonk/10" },
    risky: { icon: ShieldAlert, color: "text-danger", bg: "bg-danger/10" },
  }[level]

  const Icon = config.icon

  return (
    <div className={cn("flex items-center gap-1 px-2 py-1 rounded-md", config.bg)}>
      <Icon className={cn("w-3 h-3", config.color)} />
      <span className={cn("text-[10px] font-bold font-mono", config.color)}>{score}</span>
    </div>
  )
})

// Individual token card
export const TokenCard = memo(function TokenCard({
  token,
  index,
  isFavorite,
  isHot,
  onToggleFavorite,
  onSelect,
  onTrade,
}: TokenCardProps) {
  const [copiedAddress, setCopiedAddress] = useState(false)
  const isPositive = token.change24h >= 0
  const isNew = isNewToken(token.created)
  const liqMcapRatio = token.mcap > 0 ? Math.min((token.liquidity / token.mcap) * 100, 100) : 0

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      try {
        await navigator.clipboard.writeText(token.address)
        setCopiedAddress(true)
        setTimeout(() => setCopiedAddress(false), 2000)
      } catch (err) {
        console.error("Failed to copy:", err)
      }
    },
    [token.address]
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      onClick={() => onSelect(token)}
      className={cn(
        "glass-card-solid p-4 cursor-pointer transition-all active:scale-[0.98]",
        isHot && "border-danger/30 bg-danger/5",
        token.priceDirection === "up" && "border-success/20",
        token.priceDirection === "down" && "border-danger/20"
      )}
    >
      {/* Header: Logo, Name, Badges */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <CardTokenLogo token={token} />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-mono font-bold text-white truncate max-w-[120px]">
                {token.name}
              </h3>
              {isNew && (
                <span className="badge-new badge-neon px-1.5 py-0.5 text-[9px] font-mono font-bold rounded">
                  NEW
                </span>
              )}
              {isHot && (
                <Flame className="w-4 h-4 text-danger animate-pulse" />
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-white/40 text-xs font-mono">${token.symbol}</span>
              <button
                onClick={handleCopy}
                className="text-white/30 hover:text-bonk transition-colors"
              >
                {copiedAddress ? (
                  <Check className="w-3 h-3 text-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <CardSafetyBadge
            level={token.safetyLevel || "caution"}
            score={token.safetyScore || 50}
          />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite(token.address)
            }}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
          >
            <Star
              className={cn("w-4 h-4", isFavorite ? "fill-bonk text-bonk" : "text-white/30")}
            />
          </motion.button>
        </div>
      </div>

      {/* Sparkline */}
      <div className="mb-3">
        <CardSparkline change24h={token.change24h} address={token.address} />
      </div>

      {/* Price and Change */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-0.5">
            Price
          </p>
          <p className="text-white font-mono font-bold">{formatPrice(token.price)}</p>
        </div>
        <div className="text-right">
          <p className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-0.5">
            24h Change
          </p>
          <div
            className={cn(
              "flex items-center justify-end gap-1 font-mono font-bold",
              isPositive ? "text-success" : "text-danger"
            )}
          >
            {isPositive ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )}
            {isPositive ? "+" : ""}
            {token.change24h.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <p className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-0.5">
            MCap
          </p>
          <p className="text-white font-mono text-sm font-bold">{formatNumber(token.mcap)}</p>
        </div>
        <div>
          <p className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-0.5">
            Volume
          </p>
          <p className="text-white font-mono text-sm">{formatNumber(token.volume24h)}</p>
        </div>
        <div>
          <p className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-0.5">
            Age
          </p>
          <p
            className={cn("font-mono text-sm", isNew ? "text-success" : "text-white/60")}
          >
            {formatAge(token.created)}
          </p>
        </div>
      </div>

      {/* Liquidity Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-white/40 text-[10px] font-mono uppercase tracking-wider">
            Liquidity
          </p>
          <p className="text-white/60 text-[10px] font-mono">{formatNumber(token.liquidity)}</p>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-bonk/50 to-bonk rounded-full transition-all"
            style={{ width: `${liqMcapRatio}%` }}
          />
        </div>
        <p className="text-white/30 text-[9px] font-mono mt-0.5 text-right">
          {liqMcapRatio.toFixed(1)}% of MCap
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onTrade(token)
          }}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-bonk hover:bg-bonk/90 text-black rounded-lg font-mono font-bold text-sm transition-all active:scale-95"
        >
          TRADE
          <Image src="/trojan-horse.png" alt="Trojan" width={16} height={16} unoptimized />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSelect(token)
          }}
          className="p-2.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-white/60" />
        </button>
      </div>
    </motion.div>
  )
})

// Token card grid for mobile
interface TokenCardGridProps {
  tokens: Token[]
  currentPage: number
  favorites: Set<string>
  onToggleFavorite: (address: string) => void
  onSelectToken: (token: Token) => void
  onOpenTradeModal: (token: Token) => void
  isLoading?: boolean
}

// Enhanced skeleton card with shimmer effects
function SkeletonCard({ index = 0 }: { index?: number }) {
  const staggerClass = `skeleton-stagger-${(index % 6) + 1}`

  return (
    <div className="skeleton-card relative p-4">
      {/* Header skeleton */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl skeleton-glow ${staggerClass}`} />
          <div className="space-y-2">
            <div className={`h-4 w-24 skeleton ${staggerClass}`} />
            <div className={`h-3 w-16 skeleton ${staggerClass}`} style={{ animationDelay: '0.1s' }} />
          </div>
        </div>
        <div className={`h-6 w-14 rounded-md skeleton ${staggerClass}`} />
      </div>

      {/* Sparkline skeleton */}
      <div className={`h-8 w-full rounded skeleton-glow mb-3 ${staggerClass}`} />

      {/* Price/Change skeleton */}
      <div className="flex justify-between mb-3">
        <div className="space-y-1">
          <div className="h-2 w-10 skeleton-text" />
          <div className={`h-5 w-20 skeleton ${staggerClass}`} />
        </div>
        <div className="space-y-1 text-right">
          <div className="h-2 w-12 skeleton-text ml-auto" />
          <div className={`h-5 w-16 skeleton ${staggerClass}`} />
        </div>
      </div>

      {/* Stats grid skeleton */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-1">
            <div className="h-2 w-8 skeleton-text" />
            <div className={`h-4 w-full skeleton skeleton-stagger-${i}`} />
          </div>
        ))}
      </div>

      {/* Liquidity bar skeleton */}
      <div className="mb-4">
        <div className="flex justify-between mb-1">
          <div className="h-2 w-14 skeleton-text" />
          <div className="h-2 w-10 skeleton-text" />
        </div>
        <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
          <div className="h-full w-3/5 skeleton-glow rounded-full" />
        </div>
      </div>

      {/* Action buttons skeleton */}
      <div className="flex items-center gap-2">
        <div className={`flex-1 h-10 rounded-lg skeleton-glow ${staggerClass}`} />
        <div className={`w-10 h-10 rounded-lg skeleton ${staggerClass}`} />
      </div>
    </div>
  )
}

export function TokenCardGrid({
  tokens,
  currentPage,
  favorites,
  onToggleFavorite,
  onSelectToken,
  onOpenTradeModal,
  isLoading = false,
}: TokenCardGridProps) {
  // Calculate volume threshold for "hot" tokens
  const volumeThreshold =
    tokens.length > 0
      ? [...tokens].sort((a, b) => b.volume24h - a.volume24h)[
          Math.floor(tokens.length * 0.2)
        ]?.volume24h || 0
      : 0

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[...Array(6)].map((_, i) => (
          <SkeletonCard key={i} index={i} />
        ))}
      </div>
    )
  }

  if (tokens.length === 0) {
    return (
      <div className="glass-card-solid p-8 text-center">
        <Star className="w-12 h-12 text-white/10 mx-auto mb-4" />
        <h3 className="text-lg font-mono font-bold text-white/60 mb-2">No tokens found</h3>
        <p className="text-white/40 text-sm font-mono">
          Try adjusting your filters or search query
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {tokens.map((token, i) => {
        const globalIndex = (currentPage - 1) * 50 + i
        const isHot = token.volume24h >= volumeThreshold && token.change24h > 5

        return (
          <TokenCard
            key={token.address}
            token={token}
            index={i}
            isFavorite={favorites.has(token.address)}
            isHot={isHot}
            onToggleFavorite={onToggleFavorite}
            onSelect={onSelectToken}
            onTrade={onOpenTradeModal}
          />
        )
      })}
    </div>
  )
}
