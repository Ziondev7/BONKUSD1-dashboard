"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import { Activity, Droplets, Layers, TrendingUp, TrendingDown, BarChart3 } from "lucide-react"
import { formatNumber } from "@/lib/utils"
import type { Token, MetricsSnapshot } from "@/lib/types"

interface MetricsGridProps {
  metrics: MetricsSnapshot
  tokens: Token[]
  isLoading?: boolean
}

export function MetricsGrid({ metrics, tokens, isLoading = false }: MetricsGridProps) {
  const { marketSentiment, topMover } = useMemo(() => {
    if (tokens.length === 0) return { marketSentiment: 50, topMover: null }
    
    const sentiment = (metrics.gainersCount / metrics.tokenCount) * 100
    const sorted = [...tokens].sort((a, b) => b.change24h - a.change24h)
    const topMover = sorted[0]
    
    return { marketSentiment: sentiment || 50, topMover }
  }, [tokens, metrics])

  const liqToMcapRatio = metrics.totalMcap > 0 
    ? ((metrics.totalLiquidity / metrics.totalMcap) * 100).toFixed(1)
    : "0"

  const cards = [
    {
      id: "pairs",
      icon: Layers,
      label: "USD1 PAIRS",
      value: metrics.tokenCount.toString(),
      subValue: `${metrics.gainersCount} up · ${metrics.losersCount} down`,
      color: "bonk",
      delay: 0,
    },
    {
      id: "volume",
      icon: Activity,
      label: "24H VOLUME",
      value: formatNumber(metrics.totalVolume),
      subValue: topMover ? `Top: $${topMover.symbol}` : undefined,
      color: "success",
      delay: 0.05,
    },
    {
      id: "liquidity",
      icon: Droplets,
      label: "TOTAL LIQUIDITY",
      value: formatNumber(metrics.totalLiquidity),
      subValue: `${liqToMcapRatio}% of mcap`,
      color: "bonk",
      delay: 0.1,
    },
    {
      id: "mcap",
      icon: BarChart3,
      label: "TOTAL MARKET CAP",
      value: formatNumber(metrics.totalMcap),
      subValue: `Avg: ${metrics.avgChange24h >= 0 ? "+" : ""}${metrics.avgChange24h.toFixed(1)}%`,
      color: "success",
      delay: 0.15,
    },
  ]

  return (
    <div className="space-y-6 mb-10">
      {/* Main Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon
          const colorClass = card.color === "bonk" ? "text-bonk" : "text-success"
          const bgClass = card.color === "bonk" ? "bg-bonk/10" : "bg-success/10"

          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: card.delay, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              className="glass-card-solid p-5 card-hover group"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`p-2 rounded-lg ${bgClass} transition-transform group-hover:scale-110`}>
                  <Icon className={`w-4 h-4 ${colorClass}`} />
                </div>
                <span className="text-white/40 text-[10px] font-mono tracking-[0.15em] uppercase">
                  {card.label}
                </span>
              </div>
              
              <p className="text-2xl md:text-3xl font-black font-mono text-white tracking-tight tabular-nums">
                {isLoading ? (
                  <span className="inline-block w-24 h-8 bg-white/[0.06] rounded animate-pulse" />
                ) : (
                  card.value
                )}
              </p>
              
              {card.subValue && (
                <p className="text-white/30 text-xs font-mono mt-1.5 truncate">
                  {isLoading ? (
                    <span className="inline-block w-20 h-3 bg-white/[0.04] rounded animate-pulse" />
                  ) : (
                    card.subValue
                  )}
                </p>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Market Sentiment Bar */}
      
    </div>
  )
}
