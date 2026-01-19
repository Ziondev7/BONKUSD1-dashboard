"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Search,
  SlidersHorizontal,
  TrendingUp,
  TrendingDown,
  Flame,
  Star,
  Clock,
  X,
  ChevronDown,
  Heart,
} from "lucide-react"
import { cn, formatNumber } from "@/lib/utils"

interface TokenFiltersProps {
  sortBy: string
  onSortChange: (value: string) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  quickFilter: string
  onQuickFilterChange: (filter: string) => void
  showFavoritesOnly: boolean
  onToggleFavorites: () => void
  favoritesCount: number
  minVolume: number
  onMinVolumeChange: (value: number) => void
  minLiquidity: number
  onMinLiquidityChange: (value: number) => void
}

const QUICK_FILTERS = [
  { id: "all", label: "All", icon: null },
  { id: "gainers", label: "Gainers", icon: TrendingUp, color: "text-success" },
  { id: "losers", label: "Losers", icon: TrendingDown, color: "text-danger" },
  { id: "hot", label: "Hot", icon: Flame, color: "text-danger" },
  { id: "new", label: "New", icon: Clock, color: "text-success" },
]

const SORT_OPTIONS = [
  { value: "mcap", label: "Market Cap" },
  { value: "volume", label: "Volume 24h" },
  { value: "change", label: "24h Change" },
  { value: "liquidity", label: "Liquidity" },
]

const VOLUME_PRESETS = [
  { value: 0, label: "Any" },
  { value: 1000, label: "$1K+" },
  { value: 10000, label: "$10K+" },
  { value: 50000, label: "$50K+" },
  { value: 100000, label: "$100K+" },
]

const LIQUIDITY_PRESETS = [
  { value: 0, label: "Any" },
  { value: 1000, label: "$1K+" },
  { value: 5000, label: "$5K+" },
  { value: 10000, label: "$10K+" },
  { value: 50000, label: "$50K+" },
]

export function TokenFilters({
  sortBy,
  onSortChange,
  searchQuery,
  onSearchChange,
  quickFilter,
  onQuickFilterChange,
  showFavoritesOnly,
  onToggleFavorites,
  favoritesCount,
  minVolume,
  onMinVolumeChange,
  minLiquidity,
  onMinLiquidityChange,
}: TokenFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const activeFiltersCount = [
    quickFilter !== "all",
    showFavoritesOnly,
    minVolume > 0,
    minLiquidity > 0,
    searchQuery.length > 0,
  ].filter(Boolean).length

  const clearAllFilters = () => {
    onQuickFilterChange("all")
    if (showFavoritesOnly) onToggleFavorites()
    onMinVolumeChange(0)
    onMinLiquidityChange(0)
    onSearchChange("")
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="mb-6 space-y-4"
    >
      {/* Main Filter Row */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, symbol, or address..."
            className="w-full pl-11 pr-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl font-mono text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-bonk/30 focus:bg-white/[0.05] transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded transition-colors"
            >
              <X className="w-4 h-4 text-white/40" />
            </button>
          )}
        </div>

        {/* Quick Filters */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
          {QUICK_FILTERS.map((filter) => {
            const Icon = filter.icon
            const isActive = quickFilter === filter.id

            return (
              <motion.button
                key={filter.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onQuickFilterChange(filter.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-lg font-mono text-xs font-bold whitespace-nowrap transition-all border",
                  isActive
                    ? "bg-bonk text-black border-bonk"
                    : "bg-white/[0.03] border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06]"
                )}
              >
                {Icon && <Icon size={14} className={isActive ? "" : filter.color} />}
                {filter.label}
              </motion.button>
            )
          })}

          {/* Favorites Toggle */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onToggleFavorites}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg font-mono text-xs font-bold whitespace-nowrap transition-all border",
              showFavoritesOnly
                ? "bg-bonk text-black border-bonk"
                : "bg-white/[0.03] border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06]"
            )}
          >
            <Star size={14} className={showFavoritesOnly ? "" : "text-bonk"} />
            Watchlist
            {favoritesCount > 0 && (
              <span className={cn(
                "px-1.5 py-0.5 rounded text-[10px]",
                showFavoritesOnly ? "bg-black/20" : "bg-bonk/20 text-bonk"
              )}>
                {favoritesCount}
              </span>
            )}
          </motion.button>
        </div>

        {/* Sort & Advanced Toggle */}
        <div className="flex items-center gap-2">
          {/* Sort Dropdown */}
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              className="appearance-none px-4 py-2.5 pr-10 bg-white/[0.03] border border-white/[0.06] rounded-lg font-mono text-xs font-bold text-white focus:outline-none focus:border-bonk/30 cursor-pointer"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-[#0a0a0c]">
                  Sort: {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
          </div>

          {/* Advanced Filters Toggle */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg font-mono text-xs font-bold transition-all border",
              showAdvanced || activeFiltersCount > 0
                ? "bg-bonk/10 border-bonk/30 text-bonk"
                : "bg-white/[0.03] border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06]"
            )}
          >
            <SlidersHorizontal size={14} />
            Filters
            {activeFiltersCount > 0 && (
              <span className="px-1.5 py-0.5 bg-bonk text-black rounded text-[10px]">
                {activeFiltersCount}
              </span>
            )}
          </motion.button>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      <AnimatePresence>
        {showAdvanced && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="glass-card-solid p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-xs font-bold text-white/60 uppercase tracking-[0.15em]">
                  Advanced Filters
                </h3>
                {activeFiltersCount > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="text-xs font-mono text-bonk hover:text-bonk/80 transition-colors"
                  >
                    Clear All
                  </button>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {/* Min Volume */}
                <div>
                  <label className="block text-white/40 text-[10px] font-mono uppercase tracking-wider mb-2">
                    Minimum Volume (24h)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {VOLUME_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        onClick={() => onMinVolumeChange(preset.value)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg font-mono text-xs transition-all border",
                          minVolume === preset.value
                            ? "bg-bonk text-black border-bonk"
                            : "bg-white/[0.03] border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06]"
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Min Liquidity */}
                <div>
                  <label className="block text-white/40 text-[10px] font-mono uppercase tracking-wider mb-2">
                    Minimum Liquidity
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {LIQUIDITY_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        onClick={() => onMinLiquidityChange(preset.value)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg font-mono text-xs transition-all border",
                          minLiquidity === preset.value
                            ? "bg-bonk text-black border-bonk"
                            : "bg-white/[0.03] border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06]"
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
