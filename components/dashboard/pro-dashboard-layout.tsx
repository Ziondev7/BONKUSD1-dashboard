"use client"

import { memo } from "react"
import { motion } from "framer-motion"
import { TrendingUp, TrendingDown } from "lucide-react"
import { TickerTape } from "./ticker-tape"
import { VirtualizedTokenList } from "./virtualized-token-list"
import { VolumeEvolution } from "./volume-evolution"
import { LaunchpadVolume } from "./launchpad-volume"
import type { Token, MetricsSnapshot } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ProDashboardLayoutProps {
  tokens: Token[]
  filteredTokens: Token[]
  metrics: MetricsSnapshot
  isLoading: boolean
  favorites: Set<string>
  onToggleFavorite: (address: string) => void
  onSelectToken: (token: Token) => void
  onOpenTradeModal: (token: Token) => void
  sortBy: string
  onSortChange: (sort: string) => void
  topGainers: Token[]
  topLosers: Token[]
}

// Compact Gainers/Losers Panel
const GainersLosersPanel = memo(function GainersLosersPanel({
  topGainers,
  topLosers,
  onSelectToken,
}: {
  topGainers: Token[]
  topLosers: Token[]
  onSelectToken: (token: Token) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 h-full">
      {/* Gainers */}
      <div className="pro-panel flex flex-col">
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/[0.04]">
          <TrendingUp className="w-3 h-3 text-success" />
          <span className="text-[9px] font-mono font-bold text-white/60 uppercase tracking-wider">Top Gainers</span>
        </div>
        <div className="flex-1 overflow-y-auto pro-scroll">
          {topGainers.slice(0, 5).map((token, i) => (
            <div
              key={token.address}
              onClick={() => onSelectToken(token)}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-all",
                "hover:bg-success/[0.05] border-b border-white/[0.02]"
              )}
            >
              <span className={cn(
                "text-[9px] font-mono font-bold w-4",
                i === 0 ? "text-success" : "text-white/30"
              )}>
                #{i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-white truncate">{token.name}</p>
                <p className="text-[8px] text-white/40 font-mono">${token.symbol}</p>
              </div>
              <span className="text-[10px] font-mono font-bold text-success tabular-nums">
                +{token.change24h.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Losers */}
      <div className="pro-panel flex flex-col">
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/[0.04]">
          <TrendingDown className="w-3 h-3 text-danger" />
          <span className="text-[9px] font-mono font-bold text-white/60 uppercase tracking-wider">Top Losers</span>
        </div>
        <div className="flex-1 overflow-y-auto pro-scroll">
          {topLosers.slice(0, 5).map((token, i) => (
            <div
              key={token.address}
              onClick={() => onSelectToken(token)}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-all",
                "hover:bg-danger/[0.05] border-b border-white/[0.02]"
              )}
            >
              <span className={cn(
                "text-[9px] font-mono font-bold w-4",
                i === 0 ? "text-danger" : "text-white/30"
              )}>
                #{i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-white truncate">{token.name}</p>
                <p className="text-[8px] text-white/40 font-mono">${token.symbol}</p>
              </div>
              <span className="text-[10px] font-mono font-bold text-danger tabular-nums">
                {token.change24h.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})

// Compact Chart Panel Wrapper - passthrough for charts with their own headers
const ChartPanel = memo(function ChartPanel({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="pro-panel flex flex-col h-full overflow-hidden">
      {children}
    </div>
  )
})

export const ProDashboardLayout = memo(function ProDashboardLayout({
  tokens,
  filteredTokens,
  metrics,
  isLoading,
  favorites,
  onToggleFavorite,
  onSelectToken,
  onOpenTradeModal,
  sortBy,
  onSortChange,
  topGainers,
  topLosers,
}: ProDashboardLayoutProps) {
  return (
    <div className="h-full flex flex-col gap-2 p-2">
      {/* Top: Ticker Tape Stats Bar */}
      <div className="flex-shrink-0">
        <TickerTape metrics={metrics} tokens={tokens} isLoading={isLoading} />
      </div>

      {/* Main Content Grid - Bento Box Layout */}
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_340px] gap-2">
        {/* Left: Charts & Movers */}
        <div className="grid grid-rows-[1fr_auto] gap-2 min-h-0">
          {/* Charts Row - 70% height */}
          <div className="grid grid-cols-2 gap-2 min-h-0">
            {/* Volume Chart */}
            <ChartPanel>
              <VolumeEvolution currentVolume={metrics.totalVolume} compact />
            </ChartPanel>

            {/* Launchpad Chart */}
            <ChartPanel>
              <LaunchpadVolume compact />
            </ChartPanel>
          </div>

          {/* Bottom Deck - Gainers/Losers - 30% height */}
          <div className="h-[180px]">
            <GainersLosersPanel
              topGainers={topGainers}
              topLosers={topLosers}
              onSelectToken={onSelectToken}
            />
          </div>
        </div>

        {/* Right: Token Market Watch */}
        <div className="pro-panel min-h-0">
          <VirtualizedTokenList
            tokens={filteredTokens}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
            onSelectToken={onSelectToken}
            onOpenTradeModal={onOpenTradeModal}
            isLoading={isLoading}
            sortBy={sortBy}
            onSortChange={onSortChange}
          />
        </div>
      </div>
    </div>
  )
})
