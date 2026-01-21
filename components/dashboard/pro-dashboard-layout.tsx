"use client"

import { memo } from "react"
import { TrendingUp, TrendingDown, Activity, Rocket } from "lucide-react"
import Image from "next/image"
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

// Compact Mover Row
const MoverRow = memo(function MoverRow({
  token,
  rank,
  type,
  onSelect,
}: {
  token: Token
  rank: number
  type: "gainer" | "loser"
  onSelect: () => void
}) {
  const isGainer = type === "gainer"
  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-all border-b border-white/[0.02]",
        isGainer ? "hover:bg-success/[0.05]" : "hover:bg-danger/[0.05]"
      )}
    >
      <span className={cn(
        "text-[9px] font-mono font-bold w-4 tabular-nums",
        rank === 1 ? (isGainer ? "text-success" : "text-danger") : "text-white/30"
      )}>
        {rank}
      </span>
      <div className="w-5 h-5 rounded bg-white/[0.04] border border-white/[0.06] overflow-hidden flex-shrink-0 flex items-center justify-center">
        {token.imageUrl ? (
          <Image
            src={token.imageUrl}
            alt={token.name}
            width={20}
            height={20}
            className="object-cover"
            unoptimized
          />
        ) : (
          <span className="text-[8px]">{token.emoji}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-white truncate leading-tight">{token.name}</p>
        <p className="text-[8px] text-white/40 font-mono">${token.symbol}</p>
      </div>
      <span className={cn(
        "text-[10px] font-mono font-bold tabular-nums",
        isGainer ? "text-success" : "text-danger"
      )}>
        {isGainer ? "+" : ""}{token.change24h.toFixed(1)}%
      </span>
    </div>
  )
})

// Compact Movers Panel (Gainers or Losers)
const MoversPanel = memo(function MoversPanel({
  title,
  tokens,
  type,
  onSelectToken,
}: {
  title: string
  tokens: Token[]
  type: "gainer" | "loser"
  onSelectToken: (token: Token) => void
}) {
  const Icon = type === "gainer" ? TrendingUp : TrendingDown
  const color = type === "gainer" ? "text-success" : "text-danger"

  return (
    <div className="pro-panel flex flex-col h-full">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/[0.04] flex-shrink-0">
        <Icon className={cn("w-3 h-3", color)} />
        <span className="text-[9px] font-mono font-bold text-white/50 uppercase tracking-wider">{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto pro-scroll">
        {tokens.slice(0, 5).map((token, i) => (
          <MoverRow
            key={token.address}
            token={token}
            rank={i + 1}
            type={type}
            onSelect={() => onSelectToken(token)}
          />
        ))}
        {tokens.length === 0 && (
          <div className="flex items-center justify-center h-full text-white/20 text-[9px] font-mono">
            No data
          </div>
        )}
      </div>
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
    <div className="h-full p-2">
      {/* Main 3-Column Grid */}
      <div className="h-full grid grid-cols-[minmax(280px,1fr)_minmax(200px,280px)_minmax(340px,420px)] gap-2">

        {/* Left Column: Charts (stacked) */}
        <div className="flex flex-col gap-2 min-h-0">
          {/* Volume Chart - 50% */}
          <div className="flex-1 min-h-0 pro-panel">
            <VolumeEvolution currentVolume={metrics.totalVolume} compact />
          </div>

          {/* Launchpad Chart - 50% */}
          <div className="flex-1 min-h-0 pro-panel">
            <LaunchpadVolume compact />
          </div>
        </div>

        {/* Middle Column: Gainers & Losers (stacked) */}
        <div className="flex flex-col gap-2 min-h-0">
          {/* Gainers - 50% */}
          <div className="flex-1 min-h-0">
            <MoversPanel
              title="Top Gainers"
              tokens={topGainers}
              type="gainer"
              onSelectToken={onSelectToken}
            />
          </div>

          {/* Losers - 50% */}
          <div className="flex-1 min-h-0">
            <MoversPanel
              title="Top Losers"
              tokens={topLosers}
              type="loser"
              onSelectToken={onSelectToken}
            />
          </div>
        </div>

        {/* Right Column: Token Market Watch (full height) */}
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
