"use client"

import { memo, useCallback, useState, useRef } from "react"
import {
  Star,
  TrendingUp,
  TrendingDown,
  Copy,
  Check,
  Flame,
} from "lucide-react"
import Image from "next/image"
import type { Token } from "@/lib/types"
import { formatNumber, cn, isNewToken } from "@/lib/utils"

interface VirtualizedTokenListProps {
  tokens: Token[]
  favorites: Set<string>
  onToggleFavorite: (address: string) => void
  onSelectToken: (token: Token) => void
  onOpenTradeModal: (token: Token) => void
  isLoading?: boolean
  sortBy?: string
  onSortChange?: (sort: string) => void
}

// Column Header Component
const ColumnHeader = memo(function ColumnHeader({
  label,
  sortKey,
  currentSort,
  onSort,
  width,
  align = "left",
  className = "",
}: {
  label: string
  sortKey?: string
  currentSort?: string
  onSort?: (key: string) => void
  width: string
  align?: "left" | "right"
  className?: string
}) {
  const isActive = sortKey && currentSort === sortKey
  const canSort = !!sortKey && !!onSort

  return (
    <button
      onClick={() => canSort && onSort(sortKey)}
      className={cn(
        "text-[8px] font-mono uppercase tracking-wider transition-colors",
        isActive ? "text-bonk" : "text-white/30",
        canSort && "hover:text-white cursor-pointer",
        align === "right" && "text-right",
        className
      )}
      style={{ width }}
      disabled={!canSort}
    >
      {label}
    </button>
  )
})

export const VirtualizedTokenList = memo(function VirtualizedTokenList({
  tokens,
  favorites,
  onToggleFavorite,
  onSelectToken,
  onOpenTradeModal,
  isLoading = false,
  sortBy = "mcap",
  onSortChange,
}: VirtualizedTokenListProps) {
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Calculate hot threshold
  const volumeThreshold = tokens.length > 0
    ? [...tokens].sort((a, b) => b.volume24h - a.volume24h)[Math.floor(tokens.length * 0.2)]?.volume24h || 0
    : 0

  // Handle copy address
  const handleCopyAddress = useCallback(async (address: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddress(address)
      setTimeout(() => setCopiedAddress(null), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }, [])

  // Simple non-virtualized list for now (react-window v2 has a different API)
  // This can be optimized later with proper virtualization
  const renderTokenRow = useCallback((token: Token, index: number) => {
    const isHot = token.volume24h >= volumeThreshold && token.change24h > 5
    const isFavorite = favorites.has(token.address)
    const isPositive = token.change24h >= 0
    const isNew = isNewToken(token.created)

    return (
      <div
        key={token.address}
        onClick={() => onSelectToken(token)}
        className={cn(
          "flex items-center gap-1.5 px-2 h-[52px] border-b border-white/[0.03] cursor-pointer transition-all",
          "hover:bg-bonk/[0.03]",
          isHot && "bg-danger/[0.02]"
        )}
      >
        {/* Rank & Favorite */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite(token.address)
          }}
          className="text-white/30 hover:text-bonk transition-colors flex-shrink-0 p-0.5"
        >
          <Star className={cn("w-3 h-3", isFavorite && "fill-bonk text-bonk")} />
        </button>
        <span className="text-white/30 font-mono text-[9px] w-5 flex-shrink-0 tabular-nums">
          {index + 1}
        </span>

        {/* Token Logo */}
        <div className="w-6 h-6 rounded bg-white/[0.04] border border-white/[0.06] overflow-hidden flex-shrink-0 flex items-center justify-center text-xs">
          {token.imageUrl ? (
            <Image
              src={token.imageUrl}
              alt={token.name}
              width={24}
              height={24}
              className="object-cover"
              unoptimized
            />
          ) : (
            token.emoji
          )}
        </div>

        {/* Token Name & Symbol */}
        <div className="flex-1 min-w-0 max-w-[90px]">
          <div className="flex items-center gap-1">
            <p className="text-[10px] font-bold text-white truncate">{token.name}</p>
            {isNew && (
              <span className="px-1 py-0.5 bg-success/20 text-success text-[7px] font-bold rounded">N</span>
            )}
            {isHot && (
              <Flame className="w-2.5 h-2.5 text-danger flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1">
            <p className="text-[9px] text-white/40 font-mono">${token.symbol}</p>
            <button
              onClick={(e) => handleCopyAddress(token.address, e)}
              className="text-white/20 hover:text-bonk transition-colors"
            >
              {copiedAddress === token.address ? (
                <Check className="w-2.5 h-2.5 text-success" />
              ) : (
                <Copy className="w-2.5 h-2.5" />
              )}
            </button>
          </div>
        </div>

        {/* Market Cap */}
        <div className="w-14 flex-shrink-0 text-right">
          <p className="text-[10px] font-mono text-white tabular-nums">
            {formatNumber(token.mcap)}
          </p>
        </div>

        {/* Volume */}
        <div className="w-12 flex-shrink-0 text-right hidden xl:block">
          <p className="text-[9px] font-mono text-white/60 tabular-nums">
            {formatNumber(token.volume24h)}
          </p>
        </div>

        {/* Liquidity */}
        <div className="w-12 flex-shrink-0 text-right hidden xl:block">
          <p className="text-[9px] font-mono text-white/60 tabular-nums">
            {formatNumber(token.liquidity)}
          </p>
        </div>

        {/* 24h Change */}
        <div className="w-14 flex-shrink-0 text-right">
          <span className={cn(
            "inline-flex items-center gap-0.5 text-[10px] font-mono font-bold tabular-nums",
            isPositive ? "text-success" : "text-danger"
          )}>
            {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {isPositive ? "+" : ""}{token.change24h.toFixed(1)}%
          </span>
        </div>

        {/* Trade Button - Icon only */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpenTradeModal(token)
          }}
          className="flex-shrink-0 p-1.5 bg-bonk/80 hover:bg-bonk text-black rounded transition-all"
          title={`Trade ${token.symbol}`}
        >
          <Image src="/trojan-horse.png" alt="Trade" width={12} height={12} unoptimized />
        </button>
      </div>
    )
  }, [favorites, volumeThreshold, copiedAddress, onToggleFavorite, onSelectToken, onOpenTradeModal, handleCopyAddress])

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      {/* Column Headers */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-2 py-2 border-b border-white/[0.06] bg-[rgba(5,5,5,0.98)]">
        <div className="w-3" /> {/* Star placeholder */}
        <ColumnHeader label="#" width="20px" />
        <div className="w-6" /> {/* Logo placeholder */}
        <ColumnHeader label="Token" width="90px" className="flex-1" />
        <ColumnHeader
          label="MCap"
          sortKey="mcap"
          currentSort={sortBy}
          onSort={onSortChange}
          width="56px"
          align="right"
        />
        <ColumnHeader
          label="Vol"
          sortKey="volume"
          currentSort={sortBy}
          onSort={onSortChange}
          width="48px"
          align="right"
          className="hidden xl:block"
        />
        <ColumnHeader
          label="Liq"
          sortKey="liquidity"
          currentSort={sortBy}
          onSort={onSortChange}
          width="48px"
          align="right"
          className="hidden xl:block"
        />
        <ColumnHeader
          label="24h"
          sortKey="change"
          currentSort={sortBy}
          onSort={onSortChange}
          width="56px"
          align="right"
        />
        <div className="w-8" /> {/* Trade button placeholder */}
      </div>

      {/* Token List - Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto pro-scroll">
        {isLoading ? (
          <div className="space-y-1 p-2">
            {[...Array(15)].map((_, i) => (
              <div key={i} className="h-[52px] skeleton rounded" />
            ))}
          </div>
        ) : tokens.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/30 font-mono text-xs">
            No tokens found
          </div>
        ) : (
          <div>
            {tokens.map((token, index) => renderTokenRow(token, index))}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="flex-shrink-0 px-2 py-1.5 border-t border-white/[0.04] bg-[rgba(5,5,5,0.95)]">
        <div className="flex items-center justify-between text-[9px] font-mono text-white/40">
          <span>{tokens.length} tokens</span>
          <span>Scroll to explore</span>
        </div>
      </div>
    </div>
  )
})
