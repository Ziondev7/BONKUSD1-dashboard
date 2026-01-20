"use client"

import { useState, useMemo, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import useSWR from "swr"
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  RefreshCw,
  Clock,
  Database,
  BarChart3
} from "lucide-react"
import { formatNumber, formatCompactNumber, cn } from "@/lib/utils"

// ============================================
// TYPES
// ============================================

interface VolumeDataPoint {
  timestamp: number
  volume: number
  poolCount?: number
}

interface TopPool {
  symbol: string
  volume24h: number
  tvl: number
}

interface VolumeResponse {
  history: VolumeDataPoint[]
  stats: {
    current: number
    previous: number
    change: number
    peak: number
    low: number
    average: number
    totalVolume: number
  }
  poolCount: number
  topPools: TopPool[]
  raydiumVolume24h: number
  source: string
  interval: string
  dataPoints: number
  lastUpdated: number
  cached?: boolean
  cacheAge?: number
}

// ============================================
// CONSTANTS
// ============================================

const INTERVALS = [
  { id: "24h", label: "24H", description: "Last 24 hours" },
  { id: "7d", label: "7D", description: "Last 7 days" },
  { id: "30d", label: "30D", description: "Last 30 days" },
  { id: "all", label: "ALL", description: "All time" },
]

const fetcher = (url: string) => fetch(url).then(res => res.json())

// ============================================
// VOLUME CHART COMPONENT
// ============================================

function VolumeChart({
  data,
  interval
}: {
  data: VolumeDataPoint[]
  interval: string
}) {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null)

  const volumes = data.map(d => d.volume)
  const max = Math.max(...volumes) * 1.1
  const min = 0

  // Format time label based on interval
  const getTimeLabel = useCallback((timestamp: number): string => {
    const date = new Date(timestamp)
    switch (interval) {
      case "24h":
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      case "7d":
        return date.toLocaleDateString([], { weekday: 'short' })
      case "30d":
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      case "all":
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      default:
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  }, [interval])

  // Full date for tooltip
  const getFullDate = useCallback((timestamp: number): string => {
    const date = new Date(timestamp)
    switch (interval) {
      case "24h":
        return date.toLocaleString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      case "7d":
        return date.toLocaleDateString([], {
          weekday: 'long',
          month: 'short',
          day: 'numeric'
        })
      default:
        return date.toLocaleDateString([], {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
    }
  }, [interval])

  // Generate x-axis labels
  const xLabels = useMemo(() => {
    if (data.length < 2) return []
    const labels: { index: number; label: string }[] = []
    const step = Math.max(1, Math.floor(data.length / 6))

    for (let i = 0; i < data.length; i += step) {
      labels.push({
        index: i,
        label: getTimeLabel(data[i].timestamp)
      })
    }
    return labels
  }, [data, getTimeLabel])

  if (data.length < 2) {
    return (
      <div className="h-56 flex items-center justify-center text-white/30 font-mono text-sm">
        <div className="flex flex-col items-center gap-2">
          <BarChart3 className="w-8 h-8 opacity-50" />
          <span>Not enough data points</span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-56">
      {/* Chart container */}
      <div className="absolute inset-0 flex items-end justify-between px-1 pb-8">
        {data.map((d, i) => {
          const heightPercent = max > 0 ? ((d.volume - min) / (max - min)) * 100 : 0
          const isHovered = hoveredBar === i

          return (
            <div
              key={i}
              className="relative flex flex-col items-center justify-end h-full"
              style={{ width: `${Math.max(2, 85 / data.length)}%` }}
              onMouseEnter={() => setHoveredBar(i)}
              onMouseLeave={() => setHoveredBar(null)}
            >
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(heightPercent, 2)}%` }}
                transition={{ duration: 0.4, delay: i * 0.005 }}
                className={cn(
                  "w-full rounded-t-sm cursor-pointer transition-all duration-150",
                  isHovered
                    ? "bg-bonk shadow-[0_0_15px_rgba(250,204,21,0.6)]"
                    : "bg-bonk/70 hover:bg-bonk"
                )}
                style={{ minHeight: '4px' }}
              />
            </div>
          )
        })}
      </div>

      {/* X-axis labels */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1 text-[10px] font-mono text-white/30">
        {xLabels.map((item, i) => (
          <span
            key={i}
            className="text-center"
            style={{
              position: 'absolute',
              left: `${(item.index / data.length) * 100}%`,
              transform: 'translateX(-50%)'
            }}
          >
            {item.label}
          </span>
        ))}
      </div>

      {/* Grid lines */}
      <div className="absolute inset-0 pointer-events-none pb-8">
        {[0.25, 0.5, 0.75].map((ratio, i) => (
          <div
            key={i}
            className="absolute w-full border-t border-dashed border-white/[0.04]"
            style={{ bottom: `${ratio * 100}%` }}
          />
        ))}
      </div>

      {/* Tooltip */}
      <AnimatePresence>
        {hoveredBar !== null && data[hoveredBar] && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute z-50 pointer-events-none"
            style={{
              left: `${(hoveredBar / data.length) * 100}%`,
              bottom: '100%',
              transform: 'translateX(-50%)',
              marginBottom: '8px'
            }}
          >
            <div className="bg-[#0a0a0c] border border-bonk/30 rounded-lg px-3 py-2 shadow-[0_0_20px_rgba(250,204,21,0.2)]">
              <p className="text-bonk font-mono text-xs font-bold mb-1">
                {getFullDate(data[hoveredBar].timestamp)}
              </p>
              <p className="text-white font-mono text-sm font-bold">
                ${formatNumber(data[hoveredBar].volume)}
              </p>
              {data[hoveredBar].poolCount && (
                <p className="text-white/50 font-mono text-[10px] mt-0.5">
                  {data[hoveredBar].poolCount} pools
                </p>
              )}
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-bonk/30" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================================
// TOP POOLS COMPONENT
// ============================================

function TopPoolsList({ pools }: { pools: TopPool[] }) {
  if (!pools || pools.length === 0) return null

  return (
    <div className="mt-6 pt-6 border-t border-white/[0.04]">
      <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-3">
        TOP POOLS BY LIQUIDITY
      </p>
      <div className="flex flex-wrap gap-2">
        {pools.map((pool, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:border-bonk/30 transition-colors"
          >
            <span className="text-bonk font-mono font-bold text-sm">${pool.symbol}</span>
            <div className="w-px h-4 bg-white/10" />
            <span className="text-white/40 font-mono text-xs">
              TVL: ${formatCompactNumber(pool.tvl)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================
// MAIN COMPONENT
// ============================================

interface VolumeEvolutionProps {
  currentVolume?: number
}

export function VolumeEvolution({ currentVolume }: VolumeEvolutionProps) {
  const [interval, setInterval] = useState("24h")

  const { data, error, isLoading, mutate } = useSWR<VolumeResponse>(
    `/api/volume?interval=${interval}`,
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  )

  // Use currentVolume from props for 24h to match metrics grid
  const displayVolume = interval === "24h" && currentVolume
    ? currentVolume
    : (data?.stats.totalVolume || 0)

  const isPositive = (data?.stats.change ?? 0) >= 0

  // Format last updated time
  const lastUpdatedText = useMemo(() => {
    if (!data?.lastUpdated) return null
    const seconds = Math.floor((Date.now() - data.lastUpdated) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  }, [data?.lastUpdated])

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="mb-10"
    >
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <Activity className="w-5 h-5 text-bonk" />
          <h2 className="font-mono font-bold text-sm tracking-wide">TOTAL VOLUME</h2>
          <span className="text-white/30 font-mono text-xs">// BONK.FUN × USD1</span>

          {/* Source badge */}
          {data?.source && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-success/10 border border-success/20">
              <Database className="w-3 h-3 text-success" />
              <span className="text-[10px] font-bold text-success tracking-wide uppercase">
                {data.source}
              </span>
            </div>
          )}

          {/* Pool count */}
          {data?.poolCount && (
            <span className="text-white/30 font-mono text-xs">
              {data.poolCount} pools
            </span>
          )}
        </div>

        {/* Interval Selector */}
        <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-lg p-1 overflow-x-auto">
          {INTERVALS.map((p) => (
            <motion.button
              key={p.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setInterval(p.id)}
              title={p.description}
              className={cn(
                "px-3 py-1.5 rounded-md font-mono text-xs font-bold transition-all whitespace-nowrap",
                interval === p.id
                  ? "bg-bonk text-black"
                  : "text-white/50 hover:text-white hover:bg-white/[0.04]"
              )}
            >
              {p.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Main Chart Card */}
      <div className="glass-card-solid p-6">
        {/* Chart Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-white/40 text-[10px] font-mono tracking-[0.15em] uppercase">
                TOTAL VOLUME ({interval.toUpperCase()})
              </p>
              {data?.cached && (
                <span className="text-white/20 text-[9px] font-mono">
                  (cached)
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-mono font-black text-white">
                ${displayVolume > 0 ? formatCompactNumber(displayVolume) : "—"}
              </span>
              {data && data.stats.change !== 0 && (
                <span className={cn(
                  "flex items-center gap-1 text-sm font-mono font-bold",
                  isPositive ? "text-success" : "text-danger"
                )}>
                  {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {isPositive ? "+" : ""}{data.stats.change.toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          {/* Mini Stats */}
          {data && (
            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="text-center">
                <p className="text-white/30 mb-0.5">Peak</p>
                <p className="text-white font-bold">${formatCompactNumber(data.stats.peak)}</p>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <p className="text-white/30 mb-0.5">Low</p>
                <p className="text-white font-bold">${formatCompactNumber(data.stats.low)}</p>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <p className="text-white/30 mb-0.5">Avg</p>
                <p className="text-white font-bold">${formatCompactNumber(data.stats.average)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Chart */}
        {isLoading ? (
          <div className="h-56 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-bonk border-t-transparent rounded-full animate-spin" />
              <span className="text-white/30 font-mono text-xs">Loading volume data...</span>
            </div>
          </div>
        ) : error ? (
          <div className="h-56 flex flex-col items-center justify-center text-danger font-mono text-sm gap-3">
            <span>Failed to load volume data</span>
            <button
              onClick={() => mutate()}
              className="flex items-center gap-2 px-3 py-1.5 bg-danger/10 border border-danger/30 rounded-lg text-xs hover:bg-danger/20 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        ) : data && data.history.length > 0 ? (
          <VolumeChart data={data.history} interval={interval} />
        ) : (
          <div className="h-56 flex items-center justify-center text-white/30 font-mono text-sm">
            <div className="flex flex-col items-center gap-2">
              <BarChart3 className="w-8 h-8 opacity-50" />
              <span>No volume data available</span>
            </div>
          </div>
        )}

        {/* Top Pools */}
        {data?.topPools && <TopPoolsList pools={data.topPools} />}

        {/* Bottom Stats Grid */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6 pt-6 border-t border-white/[0.04]">
            <div className="text-center">
              <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-1">
                Pools
              </p>
              <p className="text-white font-mono font-bold">{data.poolCount}</p>
            </div>
            <div className="text-center">
              <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-1">
                Data Points
              </p>
              <p className="text-white font-mono font-bold">{data.dataPoints}</p>
            </div>
            <div className="text-center">
              <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-1">
                Raydium 24h
              </p>
              <p className="text-white font-mono font-bold">
                ${formatCompactNumber(data.raydiumVolume24h)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-1">
                Source
              </p>
              <p className="text-success font-mono font-bold uppercase text-sm">
                {data.source}
              </p>
            </div>
            <div className="text-center">
              <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-1">
                Updated
              </p>
              <p className="text-white font-mono font-bold flex items-center justify-center gap-1">
                <Zap className="w-3 h-3 text-success" />
                {lastUpdatedText || "Now"}
              </p>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  )
}
