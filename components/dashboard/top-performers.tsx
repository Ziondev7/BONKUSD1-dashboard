"use client"

import { useState, useMemo, memo } from "react"
import { motion } from "framer-motion"
import { Trophy, TrendingUp, TrendingDown, Zap, ExternalLink, Flame, Crown } from "lucide-react"
import Image from "next/image"
import type { Token } from "@/lib/types"
import { formatNumber, generateDeterministicChartData } from "@/lib/utils"

interface TopPerformersProps {
  tokens: Token[]
  topGainers: Token[]
  topLosers: Token[]
  onSelectToken: (token: Token) => void
  compact?: boolean
}

const TokenLogo = memo(function TokenLogo({ 
  token, 
  size = "md" 
}: { 
  token: Token
  size?: "sm" | "md" | "lg" 
}) {
  const [hasError, setHasError] = useState(false)
  const sizeClasses = {
    sm: "w-10 h-10",
    md: "w-14 h-14",
    lg: "w-16 h-16",
  }[size]

  if (!token.imageUrl || hasError) {
    return (
      <div className={`${sizeClasses} rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-2xl`}>
        {token.emoji}
      </div>
    )
  }

  return (
    <div className={`${sizeClasses} rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden relative`}>
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

// Premium sparkline with gradient fill
const PremiumSparkline = memo(function PremiumSparkline({ token }: { token: Token }) {
  const chartData = useMemo(
    () => generateDeterministicChartData(token.address, token.change24h, 24),
    [token.address, token.change24h]
  )
  
  const isPositive = token.change24h >= 0
  
  const min = Math.min(...chartData)
  const max = Math.max(...chartData)
  const range = max - min || 1
  
  const width = 140
  const height = 48
  const padding = 2
  
  const points = chartData.map((value, i) => {
    const x = padding + (i / (chartData.length - 1)) * (width - padding * 2)
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')
  
  const fillPath = `M ${padding},${height - padding} L ${points} L ${width - padding},${height - padding} Z`
  
  const gradientId = `gradient-${token.address.slice(0, 8)}`
  const color = isPositive ? "#00FF88" : "#FF3B3B"
  
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-12" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width - padding}
        cy={height - padding - ((chartData[chartData.length - 1] - min) / range) * (height - padding * 2)}
        r="4"
        fill={color}
      >
        <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
})

// Individual performer card
const PerformerCard = memo(function PerformerCard({
  token,
  rank,
  isTopRank,
  accentColor,
  onSelect,
}: {
  token: Token
  rank: number
  isTopRank: boolean
  accentColor: "bonk" | "success"
  onSelect: () => void
}) {
  const isPositive = token.change24h >= 0
  const accent = accentColor === "bonk" ? {
    bg: "bg-bonk/5",
    border: "border-bonk/30",
    glow: "shadow-[0_0_30px_rgba(250,204,21,0.15)]",
    badge: "bg-bonk text-black",
    icon: Zap,
  } : {
    bg: "bg-success/5",
    border: "border-success/30",
    glow: "shadow-[0_0_30px_rgba(0,255,136,0.15)]",
    badge: "bg-success text-black",
    icon: Flame,
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.1 }}
      whileHover={{ y: -4, scale: 1.01 }}
      className={`relative group overflow-hidden rounded-xl border transition-all duration-300 ${
        isTopRank
          ? `${accent.bg} ${accent.border} ${accent.glow}`
          : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]"
      }`}
    >
      {/* Shine effect on hover */}
      {isTopRank && (
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none" />
      )}

      <div className="p-5 relative z-10">
        {/* Header: Rank & Change */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-1 rounded-lg font-mono ${
              isTopRank ? accent.badge : "bg-white/[0.06] text-white/60"
            }`}>
              #{String(rank).padStart(2, "0")}
            </span>
            {isTopRank && <Crown className="w-4 h-4 text-bonk" />}
          </div>
          <div className={`flex items-center gap-1 text-xs font-mono px-2 py-1 rounded-full ${
            isPositive ? "text-success bg-success/10" : "text-danger bg-danger/10"
          }`}>
            {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(token.change24h).toFixed(1)}%
          </div>
        </div>

        {/* Token Info */}
        <div className="flex items-center gap-4 mb-4">
          <div className="relative">
            <TokenLogo token={token} size={isTopRank ? "lg" : "md"} />
            {isTopRank && (
              <accent.icon size={16} className={`absolute -top-1 -right-1 ${accentColor === 'bonk' ? 'text-bonk fill-bonk' : 'text-success fill-success'}`} />
            )}
          </div>
          <div>
            <h3 className="text-lg font-bold text-white truncate w-28 leading-tight">{token.name}</h3>
            <p className="text-white/40 text-sm font-mono">${token.symbol}</p>
          </div>
        </div>

        {/* Chart */}
        <div className="mb-4">
          <PremiumSparkline token={token} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-white/30 mb-1">Market Cap</p>
            <p className="text-sm font-mono font-medium text-white">{formatNumber(token.mcap)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-white/30 mb-1 flex items-center gap-1">
              <Zap size={10} /> 24H Volume
            </p>
            <p className="text-sm font-mono font-medium text-white">{formatNumber(token.volume24h)}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
            }}
            className="flex-1 bg-white/[0.04] hover:bg-white/[0.08] text-white text-xs font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 border border-white/[0.06]"
          >
            Details <ExternalLink size={12} />
          </button>
          <a
            href={`https://trojan.com/@Vladgz?token=${token.address}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`flex-1 ${accentColor === 'bonk' ? 'bg-bonk hover:bg-bonk/90' : 'bg-success hover:bg-success/90'} text-black text-xs font-bold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2`}
          >
            Trade
            <Image src="/trojan-horse.png" alt="Trojan" width={14} height={14} unoptimized />
          </a>
        </div>
      </div>
    </motion.div>
  )
})

export function TopPerformers({ tokens, topGainers, topLosers, onSelectToken, compact = false }: TopPerformersProps) {
  if (tokens.length === 0 && topGainers.length === 0) {
    return compact ? null : (
      <section className="mb-10">
        <h2 className="text-lg font-bold text-white mb-5 flex items-center gap-3 font-mono">
          <Trophy className="w-5 h-5 text-bonk" />
          TOP PERFORMERS
        </h2>
        <div className="text-center py-12 text-white/40 font-mono glass-card-solid rounded-xl">
          NO DATA AVAILABLE
        </div>
      </section>
    )
  }

  // Compact mode for Pro Mode - Horizontal layout with gainers and losers
  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {/* Compact Gainers */}
        <div className="glass-card-solid p-3 pro-bento-item">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3 h-3 text-success" />
            <span className="text-[10px] font-mono font-bold text-white/60 uppercase tracking-wide">Gainers</span>
          </div>
          <div className="space-y-1.5">
            {topGainers.slice(0, 3).map((token, i) => (
              <div
                key={`compact-gainer-${token.id}`}
                onClick={() => onSelectToken(token)}
                className="flex items-center gap-2 p-1.5 rounded bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] cursor-pointer transition-all"
              >
                <span className={`text-[9px] font-bold px-1 py-0.5 rounded font-mono ${
                  i === 0 ? "bg-success/20 text-success" : "bg-white/[0.06] text-white/50"
                }`}>
                  #{i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-white truncate">{token.name}</p>
                  <p className="text-[9px] text-white/40 font-mono">${token.symbol}</p>
                </div>
                <span className="text-[10px] font-mono font-bold text-success">
                  +{token.change24h.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Compact Losers */}
        <div className="glass-card-solid p-3 pro-bento-item">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-3 h-3 text-danger" />
            <span className="text-[10px] font-mono font-bold text-white/60 uppercase tracking-wide">Losers</span>
          </div>
          <div className="space-y-1.5">
            {topLosers.slice(0, 3).map((token, i) => (
              <div
                key={`compact-loser-${token.id}`}
                onClick={() => onSelectToken(token)}
                className="flex items-center gap-2 p-1.5 rounded bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] cursor-pointer transition-all"
              >
                <span className={`text-[9px] font-bold px-1 py-0.5 rounded font-mono ${
                  i === 0 ? "bg-danger/20 text-danger" : "bg-white/[0.06] text-white/50"
                }`}>
                  #{i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-white truncate">{token.name}</p>
                  <p className="text-[9px] text-white/40 font-mono">${token.symbol}</p>
                </div>
                <span className="text-[10px] font-mono font-bold text-danger">
                  {token.change24h.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="mb-10 space-y-10">
      {/* Top by Market Cap */}
      <div>
        <div className="flex items-center gap-3 mb-5">
          <Trophy className="w-5 h-5 text-bonk" />
          <h2 className="font-mono font-bold text-sm tracking-wide">TOP PERFORMERS</h2>
          <span className="text-white/30 font-mono text-xs">// BY MARKET CAP</span>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {tokens.slice(0, 3).map((token, i) => (
            <PerformerCard
              key={token.id}
              token={token}
              rank={i + 1}
              isTopRank={i === 0}
              accentColor="bonk"
              onSelect={() => onSelectToken(token)}
            />
          ))}
        </div>
      </div>

      {/* Top Gainers & Top Losers - Same Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top Gainers */}
        {topGainers.length > 0 && (
          <div className="glass-card-solid p-5 rounded-xl">
            <div className="flex items-center gap-3 mb-5">
              <TrendingUp className="w-5 h-5 text-success" />
              <h2 className="font-mono font-bold text-sm tracking-wide">TOP GAINERS</h2>
              <span className="text-white/30 font-mono text-xs">// 24H</span>
            </div>

            <div className="space-y-3">
              {topGainers.slice(0, 3).map((token, i) => (
                <div
                  key={`gainer-${token.id}`}
                  onClick={() => onSelectToken(token)}
                  className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] hover:border-white/[0.08] transition-all cursor-pointer group"
                >
                  {/* Rank */}
                  <span className={`text-xs font-bold px-2 py-1 rounded font-mono ${
                    i === 0
                      ? "bg-success/20 text-success"
                      : "bg-white/[0.06] text-white/50"
                  }`}>
                    #{i + 1}
                  </span>

                  {/* Token Logo */}
                  <TokenLogo token={token} size="sm" />

                  {/* Token Info */}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-white text-sm truncate">{token.name}</h4>
                    <p className="text-white/40 text-xs font-mono">${token.symbol}</p>
                  </div>

                  {/* Market Cap */}
                  <div className="text-xs font-mono text-white/60 hidden sm:block">
                    {formatNumber(token.mcap)}
                  </div>

                  {/* Change */}
                  <div className={`flex items-center gap-1 text-sm font-mono font-bold text-success`}>
                    <TrendingUp size={14} />
                    {Math.abs(token.change24h).toFixed(1)}%
                  </div>

                  {/* Trade Button */}
                  <a
                    href={`https://trojan.com/@Vladgz?token=${token.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-bonk text-black hover:bg-bonk/80"
                  >
                    Trade
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Losers */}
        {topLosers.length > 0 && (
          <div className="glass-card-solid p-5 rounded-xl">
            <div className="flex items-center gap-3 mb-5">
              <TrendingDown className="w-5 h-5 text-danger" />
              <h2 className="font-mono font-bold text-sm tracking-wide">TOP LOSERS</h2>
              <span className="text-white/30 font-mono text-xs">// 24H</span>
            </div>

            <div className="space-y-3">
              {topLosers.slice(0, 3).map((token, i) => (
                <div
                  key={`loser-${token.id}`}
                  onClick={() => onSelectToken(token)}
                  className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] hover:border-white/[0.08] transition-all cursor-pointer group"
                >
                  {/* Rank */}
                  <span className={`text-xs font-bold px-2 py-1 rounded font-mono ${
                    i === 0
                      ? "bg-danger/20 text-danger"
                      : "bg-white/[0.06] text-white/50"
                  }`}>
                    #{i + 1}
                  </span>

                  {/* Token Logo */}
                  <TokenLogo token={token} size="sm" />

                  {/* Token Info */}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-white text-sm truncate">{token.name}</h4>
                    <p className="text-white/40 text-xs font-mono">${token.symbol}</p>
                  </div>

                  {/* Market Cap */}
                  <div className="text-xs font-mono text-white/60 hidden sm:block">
                    {formatNumber(token.mcap)}
                  </div>

                  {/* Change */}
                  <div className={`flex items-center gap-1 text-sm font-mono font-bold text-danger`}>
                    <TrendingDown size={14} />
                    {Math.abs(token.change24h).toFixed(1)}%
                  </div>

                  {/* Trade Button */}
                  <a
                    href={`https://trojan.com/@Vladgz?token=${token.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-bonk text-black hover:bg-bonk/80"
                  >
                    Trade
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
