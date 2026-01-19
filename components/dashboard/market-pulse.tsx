"use client"

import { useMemo, memo, useState } from "react"
import { motion } from "framer-motion"
import { TrendingUp, TrendingDown, Activity, Zap } from "lucide-react"
import Image from "next/image"
import type { Token } from "@/lib/types"
import { formatNumber, generateDeterministicChartData } from "@/lib/utils"

interface MarketPulseProps {
  tokens: Token[]
  totalVolume: number
  onSelectToken: (token: Token) => void
}

const TokenLogo = memo(function TokenLogo({ token, size = 20 }: { token: Token; size?: number }) {
  const [hasError, setHasError] = useState(false)
  
  if (!token.imageUrl || hasError) {
    return (
      <div
        className="rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-xs"
        style={{ width: size, height: size }}
      >
        {token.emoji}
      </div>
    )
  }
  
  return (
    <div
      className="rounded-lg bg-white/[0.04] border border-white/[0.08] overflow-hidden relative"
      style={{ width: size, height: size }}
    >
      <Image src={token.imageUrl} alt={token.name} fill className="object-cover" onError={() => setHasError(true)} unoptimized />
    </div>
  )
})

const MiniChart = memo(function MiniChart({ token }: { token: Token }) {
  const chartData = useMemo(
    () => generateDeterministicChartData(token.address, token.change24h, 12),
    [token.address, token.change24h]
  )
  
  const isPositive = token.change24h >= 0
  const min = Math.min(...chartData)
  const max = Math.max(...chartData)
  const range = max - min || 1
  
  const width = 50
  const height = 20
  
  const points = chartData.map((v, i) => {
    const x = (i / (chartData.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x},${y}`
  }).join(' ')
  
  const color = isPositive ? "#00FF88" : "#FF3B3B"
  
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-12 h-5" preserveAspectRatio="none">
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

export function MarketPulse({ tokens, totalVolume, onSelectToken }: MarketPulseProps) {
  const { topByVolume, biggestGainers, biggestLosers, activeCount } = useMemo(() => {
    const sorted = [...tokens].sort((a, b) => b.volume24h - a.volume24h)
    const gainers = [...tokens]
      .sort((a, b) => b.change24h - a.change24h)
      .filter((t) => t.change24h > 0)
      .slice(0, 4)
    const losers = [...tokens]
      .sort((a, b) => a.change24h - b.change24h)
      .filter((t) => t.change24h < 0)
      .slice(0, 4)
    const active = tokens.filter((t) => t.volume24h > 1000).length

    return {
      topByVolume: sorted.slice(0, 5),
      biggestGainers: gainers,
      biggestLosers: losers,
      activeCount: active,
    }
  }, [tokens])

  const maxVolume = topByVolume[0]?.volume24h || 1

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mb-10"
    >
      <div className="flex items-center gap-3 mb-5">
        <Activity className="w-5 h-5 text-bonk" />
        <h2 className="font-mono font-bold text-sm tracking-wide">MARKET PULSE</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top 5 by Volume */}
        <div className="lg:col-span-2 glass-card-solid p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-white/30 text-[10px] font-mono tracking-[0.15em] uppercase mb-1">
                TOP 5 BY VOLUME (24H)
              </p>
              <p className="text-2xl font-mono font-bold text-bonk tabular-nums">
                {formatNumber(totalVolume)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-white/30 text-[10px] font-mono tracking-[0.15em] uppercase mb-1">
                ACTIVE TOKENS
              </p>
              <p className="text-xl font-mono font-bold text-white tabular-nums">{activeCount}</p>
            </div>
          </div>

          <div className="space-y-3">
            {topByVolume.map((token, i) => {
              const widthPercent = (token.volume24h / maxVolume) * 100
              return (
                <motion.button
                  key={token.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.05 }}
                  whileHover={{ x: 4 }}
                  onClick={() => onSelectToken(token)}
                  className="w-full text-left group"
                >
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="text-white/30 font-mono text-xs w-4 tabular-nums">{i + 1}</span>
                    <TokenLogo token={token} size={24} />
                    <span className="font-mono text-sm font-bold text-white truncate flex-1">
                      ${token.symbol}
                    </span>
                    <MiniChart token={token} />
                    <span className="font-mono text-xs text-white/50 tabular-nums w-20 text-right">
                      {formatNumber(token.volume24h)}
                    </span>
                  </div>
                  <div className="ml-8 h-2 bg-white/[0.04] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${widthPercent}%` }}
                      transition={{ delay: 0.5 + i * 0.05, duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
                      className="h-full bg-gradient-to-r from-bonk/70 to-bonk rounded-full group-hover:from-bonk group-hover:to-bonk/80 transition-colors"
                      style={{ boxShadow: "0 0 10px rgba(250, 204, 21, 0.3)" }}
                    />
                  </div>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* Gainers & Losers */}
        <div className="space-y-4">
          {/* Top Gainers */}
          <div className="glass-card-solid p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-success" />
              <p className="text-[10px] font-mono font-bold text-success tracking-[0.15em]">TOP GAINERS</p>
            </div>
            <div className="space-y-1.5">
              {biggestGainers.map((token, i) => (
                <motion.button
                  key={token.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.05 }}
                  whileHover={{ x: 2 }}
                  onClick={() => onSelectToken(token)}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <TokenLogo token={token} size={24} />
                    <span className="font-mono text-xs font-bold text-white">${token.symbol}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MiniChart token={token} />
                    <span className="font-mono text-xs font-bold text-success w-14 text-right tabular-nums">
                      +{token.change24h.toFixed(1)}%
                    </span>
                  </div>
                </motion.button>
              ))}
              {biggestGainers.length === 0 && (
                <p className="text-white/30 text-xs font-mono text-center py-2">No gainers</p>
              )}
            </div>
          </div>

          {/* Top Losers */}
          <div className="glass-card-solid p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="w-4 h-4 text-danger" />
              <p className="text-[10px] font-mono font-bold text-danger tracking-[0.15em]">TOP LOSERS</p>
            </div>
            <div className="space-y-1.5">
              {biggestLosers.map((token, i) => (
                <motion.button
                  key={token.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.05 }}
                  whileHover={{ x: 2 }}
                  onClick={() => onSelectToken(token)}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <TokenLogo token={token} size={24} />
                    <span className="font-mono text-xs font-bold text-white">${token.symbol}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MiniChart token={token} />
                    <span className="font-mono text-xs font-bold text-danger w-14 text-right tabular-nums">
                      {token.change24h.toFixed(1)}%
                    </span>
                  </div>
                </motion.button>
              ))}
              {biggestLosers.length === 0 && (
                <p className="text-white/30 text-xs font-mono text-center py-2">No losers</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
