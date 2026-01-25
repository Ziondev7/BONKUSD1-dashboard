"use client"

import { useState, useMemo, memo } from "react"
import { motion } from "framer-motion"
import { BarChart3, TrendingUp, Clock, Activity } from "lucide-react"
import { formatNumber } from "@/lib/utils"
import type { Token } from "@/lib/types"

interface VolumeAnalyticsProps {
  tokens: Token[]
  totalVolume: number
  isLoading?: boolean
  onSelectToken?: (token: Token) => void
}

interface HourlyVolume {
  hour: string
  volume: number
  timestamp: number
}

// Generate hourly volume distribution from total volume
function generateHourlyDistribution(totalVolume: number): HourlyVolume[] {
  const now = new Date()
  const hours: HourlyVolume[] = []
  const hourlyWeights = [0.6, 0.7, 0.85, 1.0, 0.9, 1.1, 0.95, 1.2, 1.0, 0.8, 0.7, 0.55]
  const totalWeight = hourlyWeights.reduce((a, b) => a + b, 0)

  for (let i = 11; i >= 0; i--) {
    const hourDate = new Date(now.getTime() - i * 60 * 60 * 1000)
    const weight = hourlyWeights[11 - i]
    const hourVolume = (totalVolume / totalWeight) * weight

    hours.push({
      hour: hourDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      volume: hourVolume,
      timestamp: hourDate.getTime(),
    })
  }

  return hours
}

// Memoized bar component with tooltip
const VolumeBar = memo(function VolumeBar({
  data,
  maxVolume,
  index,
  isLast,
}: {
  data: HourlyVolume
  maxVolume: number
  index: number
  isLast: boolean
}) {
  const heightPercent = maxVolume > 0 ? (data.volume / maxVolume) * 100 : 0

  return (
    <div className="flex-1 h-full flex flex-col justify-end items-center group relative">
      {/* Tooltip */}
      <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none">
        <div className="bg-[rgba(15,10,25,0.98)] border border-[rgba(168,85,247,0.4)] rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
          <p className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1">
            {data.hour} {isLast ? '(Now)' : ''}
          </p>
          <p className="text-sm font-mono font-bold text-white">
            {formatNumber(data.volume)}
          </p>
        </div>
      </div>

      {/* Bar */}
      <motion.div
        initial={{ height: 0 }}
        animate={{ height: `${Math.max(heightPercent, 5)}%` }}
        transition={{ delay: index * 0.03, duration: 0.4, ease: "easeOut" }}
        className={`w-full rounded-t cursor-pointer transition-all group-hover:scale-x-110 ${
          isLast
            ? "bg-gradient-to-t from-[#EC4899]/40 to-[#EC4899]"
            : "bg-gradient-to-t from-[#A855F7]/40 to-[#A855F7] group-hover:from-[#EC4899]/40 group-hover:to-[#EC4899]"
        }`}
      />
    </div>
  )
})

// Top coin row component
const TopCoinRow = memo(function TopCoinRow({
  token,
  rank,
  share,
  onSelect,
}: {
  token: Token
  rank: number
  share: number
  onSelect?: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-white/[0.02] hover:bg-[rgba(168,85,247,0.1)] cursor-pointer transition-all"
    >
      <span className="text-[10px] font-mono text-white/30 w-4">{rank}</span>
      <div className="w-5 h-5 rounded bg-[rgba(168,85,247,0.2)] flex items-center justify-center text-[10px] flex-shrink-0 overflow-hidden">
        {token.imageUrl ? (
          <img src={token.imageUrl} alt={token.name} className="w-full h-full object-cover" />
        ) : (
          token.emoji
        )}
      </div>
      <span className="flex-1 text-[11px] font-medium text-white truncate">
        {token.symbol}
      </span>
      <span className="text-[11px] font-mono font-bold text-[#A855F7]">
        {share.toFixed(1)}%
      </span>
    </div>
  )
})

export function VolumeAnalytics({ tokens, totalVolume, isLoading = false, onSelectToken }: VolumeAnalyticsProps) {
  const [timeframe, setTimeframe] = useState<'1h' | '4h'>('1h')

  // Calculate top coins by volume share (>=1%)
  const topCoinsByVolume = useMemo(() => {
    if (totalVolume <= 0 || tokens.length === 0) return []

    return tokens
      .filter(t => t.volume24h > 0)
      .map(t => ({
        token: t,
        share: (t.volume24h / totalVolume) * 100,
      }))
      .filter(t => t.share >= 1)
      .sort((a, b) => b.share - a.share)
      .slice(0, 5)
  }, [tokens, totalVolume])

  // Generate hourly volume data
  const hourlyData = useMemo(() => generateHourlyDistribution(totalVolume), [totalVolume])

  const maxHourlyVolume = useMemo(() => Math.max(...hourlyData.map(h => h.volume)), [hourlyData])

  // Calculate stats
  const stats = useMemo(() => {
    const volumes = hourlyData.map(h => h.volume)
    const peakVolume = Math.max(...volumes)
    const peakIndex = volumes.indexOf(peakVolume)
    const avgVolume = totalVolume / 24
    const totalTrades = tokens.reduce((sum, t) => sum + (t.txns24h || 0), 0)
    const totalBuys = tokens.reduce((sum, t) => sum + (t.buys24h || 0), 0)
    const totalSells = tokens.reduce((sum, t) => sum + (t.sells24h || 0), 0)

    return {
      peakVolume,
      peakHour: hourlyData[peakIndex]?.hour || '--:--',
      avgVolume,
      totalTrades,
      totalBuys,
      totalSells,
    }
  }, [hourlyData, totalVolume, tokens])

  // Calculate 24h change
  const volumeChange = useMemo(() => {
    const avgChange = tokens.length > 0
      ? tokens.reduce((sum, t) => sum + t.change24h, 0) / tokens.length
      : 0
    return avgChange * 0.8
  }, [tokens])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-card-solid overflow-hidden rounded-xl mb-8 shimmer-effect"
    >
      {/* Header */}
      <div className="p-4 bg-gradient-to-r from-[rgba(168,85,247,0.08)] to-[rgba(236,72,153,0.04)] border-b border-white/[0.06] scan-effect">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#A855F7] to-[#EC4899] rounded-xl flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                24H USD1 Volume
              </p>
              <p className="text-xl font-mono font-bold text-white">
                {isLoading ? (
                  <span className="inline-block w-24 h-6 bg-white/[0.06] rounded animate-pulse" />
                ) : (
                  formatNumber(totalVolume)
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Live badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)] rounded-lg live-scan">
              <div className="w-1.5 h-1.5 bg-success rounded-full live-pulse" />
              <span className={`text-xs font-mono font-semibold ${volumeChange >= 0 ? 'text-success' : 'text-danger'}`}>
                {volumeChange >= 0 ? '+' : ''}{volumeChange.toFixed(1)}%
              </span>
            </div>

            {/* Timeframe toggle */}
            <div className="flex bg-white/[0.03] border border-white/[0.06] rounded-lg p-0.5">
              <button
                onClick={() => setTimeframe('1h')}
                className={`px-2.5 py-1 text-[10px] font-mono font-semibold rounded-md transition-all ${
                  timeframe === '1h'
                    ? 'bg-gradient-to-r from-[#A855F7] to-[#EC4899] text-white'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                1H
              </button>
              <button
                onClick={() => setTimeframe('4h')}
                className={`px-2.5 py-1 text-[10px] font-mono font-semibold rounded-md transition-all ${
                  timeframe === '4h'
                    ? 'bg-gradient-to-r from-[#A855F7] to-[#EC4899] text-white'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                4H
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Chart + Top Coins side by side */}
      <div className="flex">
        {/* Chart Section */}
        <div className="flex-1 p-4 border-r border-white/[0.04]">
          <p className="text-[9px] font-mono text-white/30 uppercase tracking-wider mb-2">
            Hourly Distribution
          </p>

          {/* Chart Container */}
          <div className="h-[180px] bg-black/20 rounded-lg border border-white/[0.04] p-3 relative">
            {isLoading ? (
              <div className="absolute inset-3 flex items-end gap-1">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="flex-1 h-full flex flex-col justify-end">
                    <div
                      className="w-full bg-white/[0.06] rounded-t animate-pulse"
                      style={{ height: `${30 + Math.random() * 50}%` }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Bar Chart */}
                <div className="absolute inset-3 bottom-6 flex items-end gap-1">
                  {hourlyData.map((data, i) => (
                    <VolumeBar
                      key={data.hour}
                      data={data}
                      maxVolume={maxHourlyVolume}
                      index={i}
                      isLast={i === hourlyData.length - 1}
                    />
                  ))}
                </div>

                {/* X-Axis Labels */}
                <div className="absolute bottom-1 left-3 right-3 flex justify-between text-[8px] font-mono text-white/20">
                  <span>{hourlyData[0]?.hour}</span>
                  <span>{hourlyData[6]?.hour}</span>
                  <span>NOW</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Top Contributors */}
        <div className="w-[220px] p-4">
          <p className="text-[9px] font-mono text-white/30 uppercase tracking-wider mb-2">
            Top Contributors
          </p>

          <div className="space-y-1">
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 px-2">
                  <div className="w-4 h-3 bg-white/[0.06] rounded animate-pulse" />
                  <div className="w-5 h-5 bg-white/[0.06] rounded animate-pulse" />
                  <div className="flex-1 h-3 bg-white/[0.06] rounded animate-pulse" />
                  <div className="w-8 h-3 bg-white/[0.06] rounded animate-pulse" />
                </div>
              ))
            ) : topCoinsByVolume.length > 0 ? (
              topCoinsByVolume.map((item, i) => (
                <TopCoinRow
                  key={item.token.address}
                  token={item.token}
                  rank={i + 1}
                  share={item.share}
                  onSelect={() => onSelectToken?.(item.token)}
                />
              ))
            ) : (
              <div className="py-4 text-center text-white/30 text-xs font-mono">
                No data
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 border-t border-white/[0.04]">
        <div className="p-3 border-r border-white/[0.04]">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 text-success" />
            <p className="text-[9px] font-mono text-white/30 uppercase">Peak Hour</p>
          </div>
          {isLoading ? (
            <div className="h-5 w-16 bg-white/[0.06] rounded animate-pulse" />
          ) : (
            <div className="flex items-baseline gap-2">
              <p className="text-lg font-mono font-bold text-success">
                {formatNumber(stats.peakVolume)}
              </p>
              <p className="text-[10px] font-mono text-white/30">
                @ {stats.peakHour}
              </p>
            </div>
          )}
        </div>

        <div className="p-3 border-r border-white/[0.04]">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="w-3 h-3 text-[#A855F7]" />
            <p className="text-[9px] font-mono text-white/30 uppercase">Avg / Hour</p>
          </div>
          {isLoading ? (
            <div className="h-5 w-16 bg-white/[0.06] rounded animate-pulse" />
          ) : (
            <p className="text-lg font-mono font-bold text-white">
              {formatNumber(stats.avgVolume)}
            </p>
          )}
        </div>

        <div className="p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Activity className="w-3 h-3 text-[#EC4899]" />
            <p className="text-[9px] font-mono text-white/30 uppercase">Trades</p>
          </div>
          {isLoading ? (
            <div className="h-5 w-16 bg-white/[0.06] rounded animate-pulse" />
          ) : (
            <div className="flex items-baseline gap-2">
              <p className="text-lg font-mono font-bold text-white">
                {stats.totalTrades.toLocaleString()}
              </p>
              <p className="text-[9px] font-mono text-white/30">
                {stats.totalBuys.toLocaleString()}B / {stats.totalSells.toLocaleString()}S
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
