"use client"

import { memo } from "react"
import { motion } from "framer-motion"
import { Activity, Droplets, Layers, TrendingUp, TrendingDown, BarChart3, Zap } from "lucide-react"
import { formatNumber } from "@/lib/utils"
import type { MetricsSnapshot, Token } from "@/lib/types"

interface TickerTapeProps {
  metrics: MetricsSnapshot
  tokens: Token[]
  isLoading?: boolean
}

const TickerItem = memo(function TickerItem({
  icon: Icon,
  label,
  value,
  subValue,
  color = "bonk",
  isLoading = false,
}: {
  icon: React.ElementType
  label: string
  value: string
  subValue?: string
  color?: "bonk" | "success" | "danger"
  isLoading?: boolean
}) {
  const colorClass = {
    bonk: "text-bonk",
    success: "text-success",
    danger: "text-danger",
  }[color]

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.02] border border-white/[0.04] rounded-md">
      <Icon className={`w-3.5 h-3.5 ${colorClass}`} />
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] text-white/40 font-mono uppercase tracking-wider">{label}</span>
        {isLoading ? (
          <div className="w-12 h-4 skeleton rounded" />
        ) : (
          <>
            <span className="text-sm font-mono font-bold text-white tabular-nums">{value}</span>
            {subValue && (
              <span className={`text-[10px] font-mono ${colorClass}`}>{subValue}</span>
            )}
          </>
        )}
      </div>
    </div>
  )
})

export const TickerTape = memo(function TickerTape({
  metrics,
  tokens,
  isLoading = false,
}: TickerTapeProps) {
  // Calculate additional metrics
  const gainersPercent = metrics.tokenCount > 0
    ? Math.round((metrics.gainersCount / metrics.tokenCount) * 100)
    : 50

  // Find top mover
  const topMover = tokens.length > 0
    ? [...tokens].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))[0]
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-1"
    >
      {/* Token Count */}
      <TickerItem
        icon={Layers}
        label="Pairs"
        value={metrics.tokenCount.toString()}
        color="bonk"
        isLoading={isLoading}
      />

      {/* Volume 24h */}
      <TickerItem
        icon={Activity}
        label="Vol"
        value={formatNumber(metrics.totalVolume)}
        color="bonk"
        isLoading={isLoading}
      />

      {/* Total Liquidity */}
      <TickerItem
        icon={Droplets}
        label="Liq"
        value={formatNumber(metrics.totalLiquidity)}
        color="success"
        isLoading={isLoading}
      />

      {/* Market Cap */}
      <TickerItem
        icon={BarChart3}
        label="MCap"
        value={formatNumber(metrics.totalMcap)}
        subValue={`${metrics.avgChange24h >= 0 ? "+" : ""}${metrics.avgChange24h.toFixed(1)}%`}
        color={metrics.avgChange24h >= 0 ? "success" : "danger"}
        isLoading={isLoading}
      />

      {/* Market Sentiment */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.02] border border-white/[0.04] rounded-md">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-success" />
          <span className="text-[10px] font-mono font-bold text-success tabular-nums">{gainersPercent}%</span>
        </div>
        <div className="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-success to-success/60 transition-all duration-500"
            style={{ width: `${gainersPercent}%` }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <TrendingDown className="w-3.5 h-3.5 text-danger" />
          <span className="text-[10px] font-mono font-bold text-danger tabular-nums">{100 - gainersPercent}%</span>
        </div>
      </div>

      {/* Top Mover */}
      {topMover && !isLoading && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.02] border border-white/[0.04] rounded-md">
          <Zap className="w-3.5 h-3.5 text-bonk" />
          <span className="text-[9px] text-white/40 font-mono uppercase">Top</span>
          <span className="text-[10px] font-mono font-bold text-white truncate max-w-[60px]">
            ${topMover.symbol}
          </span>
          <span className={`text-[10px] font-mono font-bold ${topMover.change24h >= 0 ? "text-success" : "text-danger"}`}>
            {topMover.change24h >= 0 ? "+" : ""}{topMover.change24h.toFixed(1)}%
          </span>
        </div>
      )}
    </motion.div>
  )
})
