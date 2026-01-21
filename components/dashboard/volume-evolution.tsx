"use client"

import { useState, useMemo, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import useSWR from "swr"
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  BarChart3,
  Clock,
  Zap,
  ArrowUp,
  ArrowDown,
  Minus,
  AlertTriangle,
  Info
} from "lucide-react"
import { formatNumber, formatCompactNumber, cn } from "@/lib/utils"

interface VolumeDataPoint {
  timestamp: number
  volume: number
  trades?: number
}

interface VolumeHistoryResponse {
  history: VolumeDataPoint[]
  stats: {
    current: number
    previous: number
    change: number
    peak: number
    low: number
    average: number
    totalVolume: number
    poolCount?: number
  }
  period: string
  dataPoints: number
  cached?: boolean
  synthetic?: boolean
  poolCount?: number
  ohlcvCoverage?: number // Percentage of volume covered by real OHLCV data
  dataSource?: "ohlcv" | "snapshots" | "synthetic" // Source of the data
}

const PERIODS = [
  { id: "24h", label: "24H" },
  { id: "7d", label: "7D" },
  { id: "1m", label: "1M" },
  { id: "all", label: "ALL" },
]

const fetcher = (url: string) => fetch(url).then(res => res.json())

// Yellow candlestick bar chart component
function VolumeChart({ 
  data, 
  isPositive,
  period 
}: { 
  data: VolumeDataPoint[]
  isPositive: boolean 
  period: string
}) {
  const [hoveredBar, setHoveredBar] = useState<{ index: number; x: number; y: number } | null>(null)
  
  const volumes = data.map(d => d.volume)
  const max = Math.max(...volumes) * 1.1
  const min = 0

  // Format time label based on period
  const formatTimeLabel = (timestamp: number): string => {
    const date = new Date(timestamp)
    if (period === "24h") {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (period === "7d") {
      return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit' })
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  }

  // Get full date string for tooltip
  const getFullDateLabel = (timestamp: number): string => {
    const date = new Date(timestamp)
    if (period === "24h") {
      return date.toLocaleString([], { 
        weekday: 'short',
        hour: '2-digit', 
        minute: '2-digit'
      })
    } else if (period === "7d") {
      return date.toLocaleDateString([], { 
        weekday: 'long',
        month: 'short',
        day: 'numeric'
      })
    } else if (period === "1m") {
      return date.toLocaleDateString([], { 
        weekday: 'long',
        month: 'long', 
        day: 'numeric',
        year: 'numeric'
      })
    } else {
      // All time - show month/year for monthly candles
      return date.toLocaleDateString([], { 
        month: 'long', 
        year: 'numeric'
      })
    }
  }

  // Generate time labels for x-axis
  const timeLabels = useMemo(() => {
    if (data.length < 2) return []
    const labels: { index: number; label: string }[] = []
    const step = Math.max(1, Math.floor(data.length / 6))
    
    for (let i = 0; i < data.length; i += step) {
      const date = new Date(data[i].timestamp)
      let label: string
      if (period === "24h") {
        label = date.getHours().toString().padStart(2, '0') + ':00'
      } else if (period === "7d") {
        label = date.toLocaleDateString([], { weekday: 'short' })
      } else if (period === "1m") {
        label = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      } else {
        // All time - show month abbreviation for monthly candles
        label = date.toLocaleDateString([], { month: 'short' })
      }
      labels.push({ index: i, label })
    }
    return labels
  }, [data, period])

  if (data.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-white/30 font-mono text-sm">
        Not enough data points
      </div>
    )
  }

  const barWidth = Math.max(2, Math.min(12, (100 / data.length) * 0.7))
  const gap = Math.max(1, (100 / data.length) * 0.3)

  return (
    <div className="relative h-56">
      {/* Chart container */}
      <div className="absolute inset-0 flex items-end justify-between px-1 pb-8">
        {data.map((d, i) => {
          const heightPercent = max > 0 ? ((d.volume - min) / (max - min)) * 100 : 0
          const isHovered = hoveredBar?.index === i
          
          return (
            <div
              key={i}
              className="relative flex flex-col items-center justify-end h-full"
              style={{ width: `${barWidth}%` }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setHoveredBar({ 
                  index: i, 
                  x: rect.left + rect.width / 2,
                  y: rect.top
                })
              }}
              onMouseLeave={() => setHoveredBar(null)}
            >
              {/* The candle/bar */}
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(heightPercent, 2)}%` }}
                transition={{ duration: 0.5, delay: i * 0.01 }}
                className={cn(
                  "w-full rounded-t-sm cursor-pointer transition-all duration-150",
                  isHovered 
                    ? "bg-bonk shadow-[0_0_15px_rgba(250,204,21,0.6)]" 
                    : "bg-bonk/70 hover:bg-bonk"
                )}
                style={{
                  minHeight: '4px',
                }}
              />
            </div>
          )
        })}
      </div>

      {/* X-axis time labels */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1 text-[10px] font-mono text-white/30">
        {timeLabels.map((item, i) => (
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
        {hoveredBar !== null && data[hoveredBar.index] && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute z-50 pointer-events-none"
            style={{
              left: `${(hoveredBar.index / data.length) * 100}%`,
              bottom: '100%',
              transform: 'translateX(-50%)',
              marginBottom: '8px'
            }}
          >
            <div className="bg-[#0a0a0c] border border-bonk/30 rounded-lg px-3 py-2 shadow-[0_0_20px_rgba(250,204,21,0.2)]">
              <p className="text-bonk font-mono text-xs font-bold mb-1">
                {getFullDateLabel(data[hoveredBar.index].timestamp)}
              </p>
              <p className="text-white font-mono text-sm font-bold">
                ${formatNumber(data[hoveredBar.index].volume)}
              </p>
              {/* Arrow */}
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-bonk/30" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Stats card component
function StatCard({ 
  label, 
  value, 
  icon: Icon, 
  change,
  color = "default"
}: { 
  label: string
  value: string
  icon: any
  change?: number
  color?: "default" | "success" | "danger"
}) {
  const colorClasses = {
    default: "text-white/40",
    success: "text-success",
    danger: "text-danger",
  }

  return (
    <div className="glass-card-solid p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("w-4 h-4", colorClasses[color])} />
        <span className="text-white/40 text-[10px] font-mono tracking-[0.15em] uppercase">
          {label}
        </span>
      </div>
      <p className="text-xl font-mono font-bold text-white">{value}</p>
      {change !== undefined && (
        <div className={cn(
          "flex items-center gap-1 mt-1 text-xs font-mono",
          change >= 0 ? "text-success" : "text-danger"
        )}>
          {change >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
          {Math.abs(change).toFixed(1)}%
        </div>
      )}
    </div>
  )
}

interface VolumeEvolutionProps {
  currentVolume?: number // Real-time volume from tokens API to sync with metrics grid
}

export function VolumeEvolution({ currentVolume }: VolumeEvolutionProps) {
  const [period, setPeriod] = useState("24h")
  
  const { data, error, isLoading } = useSWR<VolumeHistoryResponse>(
    `/api/volume-history?period=${period}`,
    fetcher,
    {
      refreshInterval: 60000, // Refresh every minute
      revalidateOnFocus: false,
    }
  )

  // Always use total volume for the period (sum of all bar values)
  const displayVolume = data?.stats.totalVolume || currentVolume || 0

  const isPositive = (data?.stats.change ?? 0) >= 0

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="mb-10"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-bonk" />
          <h2 className="font-mono font-bold text-sm tracking-wide">VOLUME EVOLUTION</h2>
          <span className="text-white/30 font-mono text-xs">// USD1 PAIRS</span>
          {/* Data quality indicators */}
          {data?.dataSource === "synthetic" || data?.synthetic ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bonk/10 border border-bonk/20" title="Historical data unavailable - showing estimated distribution based on current 24h volume">
              <AlertTriangle className="w-3 h-3 text-bonk" />
              <span className="text-[10px] font-bold text-bonk tracking-wide">ESTIMATED</span>
            </div>
          ) : data?.dataSource === "snapshots" ? (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-success/10 border border-success/20"
              title={`Historical data from ${data.dataPoints} stored snapshots - accurate rolling 24h volume over time`}
            >
              <Activity className="w-3 h-3 text-success" />
              <span className="text-[10px] font-bold text-success tracking-wide">HISTORICAL DATA</span>
            </div>
          ) : data?.dataSource === "ohlcv" || (data?.ohlcvCoverage && data.ohlcvCoverage > 0) ? (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-success/10 border border-success/20"
              title={`Real OHLCV data from top ${data.poolCount || 0} pools covering ${(data.ohlcvCoverage || 0).toFixed(0)}% of total volume`}
            >
              <Activity className="w-3 h-3 text-success" />
              <span className="text-[10px] font-bold text-success tracking-wide">
                {(data.ohlcvCoverage || 0) >= 80 ? "LIVE DATA" : `${(data.ohlcvCoverage || 0).toFixed(0)}% COVERAGE`}
              </span>
            </div>
          ) : null}

          {/* Pool count badge */}
          {data?.poolCount && data.poolCount > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 border border-white/10" title="Number of active BONK.fun/USD1 pools">
              <span className="text-[10px] font-mono text-white/50">{data.poolCount} pools</span>
            </div>
          )}
        </div>

        {/* Period Selector */}
        <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-lg p-1">
          {PERIODS.map((p) => (
            <motion.button
              key={p.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setPeriod(p.id)}
              className={cn(
                "px-4 py-1.5 rounded-md font-mono text-xs font-bold transition-all",
                period === p.id
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
        {/* Chart Header Stats */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-white/40 text-[10px] font-mono tracking-[0.15em] uppercase mb-1">
              TOTAL VOLUME ({period.toUpperCase()})
            </p>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-mono font-black text-white">
                ${displayVolume > 0 ? formatCompactNumber(displayVolume) : "—"}
              </span>
              {data && (
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
                <p className="text-white font-bold">{formatNumber(data.stats.peak)}</p>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <p className="text-white/30 mb-0.5">Low</p>
                <p className="text-white font-bold">{formatNumber(data.stats.low)}</p>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <p className="text-white/30 mb-0.5">Avg</p>
                <p className="text-white font-bold">{formatNumber(data.stats.average)}</p>
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
          <div className="h-56 flex items-center justify-center text-danger font-mono text-sm">
            Failed to load volume history
          </div>
        ) : data && data.history.length > 0 ? (
          <VolumeChart data={data.history} isPositive={isPositive} period={period} />
        ) : (
          <div className="h-56 flex items-center justify-center text-white/30 font-mono text-sm">
            No volume data available
          </div>
        )}

        {/* Bottom Stats Grid */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6 pt-6 border-t border-white/[0.04]">
            <div className="text-center">
              <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-1">
                Active Pools
              </p>
              <p className="text-white font-mono font-bold">{data.poolCount || data.dataPoints}</p>
            </div>
            <div className="text-center">
              <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-1">
                Data Points
              </p>
              <p className="text-white font-mono font-bold">{data.dataPoints}</p>
            </div>
            <div className="text-center">
              <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-1">
                Period Start
              </p>
              <p className="text-white font-mono font-bold">
                {data.history.length > 0
                  ? new Date(data.history[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : "—"
                }
              </p>
            </div>
            <div className="text-center">
              <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-1">
                Latest Update
              </p>
              <p className="text-white font-mono font-bold">
                {data.history.length > 0
                  ? new Date(data.history[data.history.length - 1].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : "—"
                }
              </p>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  )
}
