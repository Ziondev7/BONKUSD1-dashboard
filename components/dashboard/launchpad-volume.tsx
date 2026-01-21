"use client"

import { useState, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import useSWR from "swr"
import {
  TrendingUp,
  TrendingDown,
  Rocket,
  Activity,
} from "lucide-react"
import { formatNumber, formatCompactNumber, cn } from "@/lib/utils"

// Categories for stacked chart
const CATEGORIES = ["pumpdotfun", "bonk", "moonshot", "bags", "believe"] as const
type Category = typeof CATEGORIES[number]

// Category colors for the stacked chart
const CATEGORY_COLORS: Record<Category, { bg: string; hover: string; label: string }> = {
  pumpdotfun: { bg: "bg-[#00dc82]", hover: "bg-[#00ff96]", label: "Pump.fun" },
  bonk: { bg: "bg-[#f7931a]", hover: "bg-[#ffaa33]", label: "BONK" },
  moonshot: { bg: "bg-[#8b5cf6]", hover: "bg-[#a78bfa]", label: "Moonshot" },
  bags: { bg: "bg-[#06b6d4]", hover: "bg-[#22d3ee]", label: "Bags" },
  believe: { bg: "bg-[#ec4899]", hover: "bg-[#f472b6]", label: "Believe" },
}

// Hex colors for inline styles
const CATEGORY_HEX: Record<Category, string> = {
  pumpdotfun: "#00dc82",
  bonk: "#f7931a",
  moonshot: "#8b5cf6",
  bags: "#06b6d4",
  believe: "#ec4899",
}

interface StackedVolumeDataPoint {
  timestamp: number
  volumes: Record<Category, number>
  total: number
  isWeekly?: boolean
}

interface LaunchpadVolumeResponse {
  history: StackedVolumeDataPoint[]
  stats: {
    current: number
    previous: number
    change: number
    peak: number
    low: number
    average: number
    totalVolume: number
    categoryTotals: Record<Category, number>
  }
  period: string
  dataPoints: number
  cached?: boolean
  categories: readonly Category[]
  source?: string
}

const PERIODS = [
  { id: "daily", label: "DAILY" },
  { id: "weekly", label: "WEEKLY" },
]

const fetcher = (url: string) => fetch(url).then(res => res.json())

// Stacked bar chart component for launchpad volume
function LaunchpadChart({
  data,
  period
}: {
  data: StackedVolumeDataPoint[]
  period: string
}) {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null)

  const totals = data.map(d => d.total)
  const max = Math.max(...totals) * 1.1

  // Get full date string for tooltip
  const getFullDateLabel = (timestamp: number): string => {
    const date = new Date(timestamp)
    if (period === "daily") {
      return date.toLocaleDateString([], {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      })
    } else {
      return `Week of ${date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })}`
    }
  }

  // Generate time labels for x-axis
  const timeLabels = useMemo(() => {
    if (data.length < 2) return []
    const labels: { index: number; label: string }[] = []
    const step = Math.max(1, Math.floor(data.length / 6))

    for (let i = 0; i < data.length; i += step) {
      const date = new Date(data[i].timestamp)
      const label = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      labels.push({ index: i, label })
    }
    return labels
  }, [data])

  if (data.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-white/30 font-mono text-sm">
        Not enough data points
      </div>
    )
  }

  const barWidth = Math.max(2, Math.min(12, (100 / data.length) * 0.7))

  return (
    <div className="relative h-56">
      {/* Chart container */}
      <div className="absolute inset-0 flex items-end justify-between px-1 pb-8">
        {data.map((d, i) => {
          const totalHeightPercent = max > 0 ? (d.total / max) * 100 : 0
          const isHovered = hoveredBar === i

          return (
            <div
              key={i}
              className="relative flex flex-col items-center justify-end h-full"
              style={{ width: `${barWidth}%` }}
              onMouseEnter={() => setHoveredBar(i)}
              onMouseLeave={() => setHoveredBar(null)}
            >
              {/* Stacked bars - render from bottom to top */}
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(totalHeightPercent, 2)}%` }}
                transition={{ duration: 0.5, delay: i * 0.01 }}
                className={cn(
                  "w-full rounded-t-sm cursor-pointer transition-all duration-150 flex flex-col-reverse overflow-hidden",
                  isHovered && "shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                )}
                style={{ minHeight: '4px' }}
              >
                {CATEGORIES.map((cat) => {
                  const catVolume = d.volumes[cat] || 0
                  const catPercent = d.total > 0 ? (catVolume / d.total) * 100 : 0
                  if (catPercent === 0) return null

                  return (
                    <div
                      key={cat}
                      style={{
                        height: `${catPercent}%`,
                        backgroundColor: CATEGORY_HEX[cat],
                        opacity: isHovered ? 1 : 0.85,
                      }}
                      className="w-full transition-opacity duration-150"
                    />
                  )
                })}
              </motion.div>
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
            <div className="bg-[#0a0a0c] border border-white/20 rounded-lg px-3 py-2 shadow-xl min-w-[180px]">
              <p className="text-white font-mono text-xs font-bold mb-2 border-b border-white/10 pb-1">
                {getFullDateLabel(data[hoveredBar].timestamp)}
              </p>
              {/* Category breakdown */}
              <div className="space-y-1">
                {CATEGORIES.map((cat) => {
                  const vol = data[hoveredBar].volumes[cat] || 0
                  if (vol === 0) return null
                  return (
                    <div key={cat} className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-2 h-2 rounded-sm"
                          style={{ backgroundColor: CATEGORY_HEX[cat] }}
                        />
                        <span className="text-white/70">{CATEGORY_COLORS[cat].label}</span>
                      </div>
                      <span className="text-white font-mono font-medium">
                        ${formatCompactNumber(vol)}
                      </span>
                    </div>
                  )
                })}
              </div>
              {/* Total */}
              <div className="flex items-center justify-between mt-2 pt-1 border-t border-white/10 text-xs">
                <span className="text-white/50">Total</span>
                <span className="text-white font-mono font-bold">
                  ${formatCompactNumber(data[hoveredBar].total)}
                </span>
              </div>
              {/* Arrow */}
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-white/20" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface LaunchpadVolumeProps {
  compact?: boolean
}

export function LaunchpadVolume({ compact = false }: LaunchpadVolumeProps) {
  const [period, setPeriod] = useState("daily")

  const { data, error, isLoading } = useSWR<LaunchpadVolumeResponse>(
    `/api/launchpad-volume?period=${period}`,
    fetcher,
    {
      refreshInterval: 300000, // Refresh every 5 minutes
      revalidateOnFocus: false,
    }
  )

  const displayVolume = data?.stats.totalVolume || data?.stats.current || 0
  const isPositive = (data?.stats.change ?? 0) >= 0

  // Compact mode for Pro Mode
  if (compact) {
    return (
      <div className="h-full flex flex-col">
        {/* Compact Header */}
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-white/[0.04] flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <Rocket className="w-3 h-3 text-success" />
            <span className="text-[9px] font-mono font-bold text-white/50 uppercase tracking-wider">Launchpad</span>
            <span className="text-sm font-mono font-black text-white ml-1">
              ${displayVolume > 0 ? formatCompactNumber(displayVolume) : "—"}
            </span>
            {data && (
              <span className={cn(
                "flex items-center gap-0.5 text-[9px] font-mono font-bold",
                isPositive ? "text-success" : "text-danger"
              )}>
                {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {isPositive ? "+" : ""}{data.stats.change.toFixed(1)}%
              </span>
            )}
          </div>
          {/* Compact Period Selector */}
          <div className="flex items-center gap-0.5 bg-white/[0.03] border border-white/[0.06] rounded p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[8px] font-mono font-bold transition-all",
                  period === p.id
                    ? "bg-success text-black"
                    : "text-white/40 hover:text-white"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Compact Legend */}
        {data && data.history.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2.5 py-1 border-b border-white/[0.02] flex-shrink-0">
            {CATEGORIES.map((cat) => {
              const total = data.stats.categoryTotals?.[cat] || 0
              if (total === 0) return null
              return (
                <div key={cat} className="flex items-center gap-1">
                  <div
                    className="w-1.5 h-1.5 rounded-sm"
                    style={{ backgroundColor: CATEGORY_HEX[cat] }}
                  />
                  <span className="text-[8px] font-mono text-white/40">
                    {CATEGORY_COLORS[cat].label}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Compact Chart */}
        <div className="flex-1 min-h-0 p-2">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="w-4 h-4 border-2 border-success border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-danger font-mono text-[10px]">
              Failed to load
            </div>
          ) : data && data.history.length > 0 ? (
            <div className="h-full">
              <LaunchpadChart data={data.history} period={period} />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-white/30 font-mono text-[10px]">
              No data
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mb-10"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <Rocket className="w-5 h-5 text-success" />
          <h2 className="font-mono font-bold text-sm tracking-wide">LAUNCHPAD VOLUME</h2>
          <span className="text-white/30 font-mono text-xs">// BONK/USD1 PAIRS</span>

          {/* Data source indicator */}
          {data?.source && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-success/10 border border-success/20">
              <Activity className="w-3 h-3 text-success" />
              <span className="text-[10px] font-bold text-success tracking-wide">
                {data.source === "dune-weekly" ? "WEEKLY DATA" : "DAILY DATA"}
              </span>
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
                  ? "bg-success text-black"
                  : "text-white/50 hover:text-white hover:bg-white/[0.04]"
              )}
            >
              {p.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Main Chart Card */}
      <div className="glass-card-solid p-6 border-success/10">
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

        {/* Legend */}
        {data && data.history.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 mb-4">
            {CATEGORIES.map((cat) => {
              const total = data.stats.categoryTotals?.[cat] || 0
              if (total === 0) return null
              return (
                <div key={cat} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: CATEGORY_HEX[cat] }}
                  />
                  <span className="text-xs font-mono text-white/70">
                    {CATEGORY_COLORS[cat].label}
                  </span>
                  <span className="text-xs font-mono text-white/40">
                    ${formatCompactNumber(total)}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Chart */}
        {isLoading ? (
          <div className="h-56 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-success border-t-transparent rounded-full animate-spin" />
              <span className="text-white/30 font-mono text-xs">Loading launchpad data...</span>
            </div>
          </div>
        ) : error ? (
          <div className="h-56 flex items-center justify-center text-danger font-mono text-sm">
            Failed to load launchpad volume
          </div>
        ) : data && data.history.length > 0 ? (
          <LaunchpadChart data={data.history} period={period} />
        ) : (
          <div className="h-56 flex items-center justify-center text-white/30 font-mono text-sm">
            No launchpad data available - ensure DUNE_API_KEY is configured
          </div>
        )}

        {/* Bottom Stats Grid */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/[0.04]">
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
                  ? new Date(data.history[0].timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })
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
                  ? new Date(data.history[data.history.length - 1].timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })
                  : "—"
                }
              </p>
            </div>
            <div className="text-center">
              <p className="text-white/30 text-[10px] font-mono uppercase tracking-wider mb-1">
                Trend
              </p>
              <p className={cn(
                "font-mono font-bold flex items-center justify-center gap-1",
                isPositive ? "text-success" : "text-danger"
              )}>
                {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {isPositive ? "Bullish" : "Bearish"}
              </p>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  )
}
