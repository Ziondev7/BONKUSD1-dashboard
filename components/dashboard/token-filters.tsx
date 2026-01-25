"use client"

import { useState, useRef, useEffect } from "react"
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
  Command,
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
  compact?: boolean
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
  compact = false,
}: TokenFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Keyboard shortcut: "/" to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if already typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const activeFiltersCount = [
    quickFilter !== "all",
    showFavoritesOnly,
    minVolume > 0,
    minLiquidity > 0,
    searchQuery.length > 0,
  ].filter(Boolean).length

  // Generate active filter chips
  const activeFilterChips = []
  if (quickFilter !== "all") {
    const filter = QUICK_FILTERS.find(f => f.id === quickFilter)
    if (filter) activeFilterChips.push({ id: 'quickFilter', label: filter.label, onRemove: () => onQuickFilterChange("all") })
  }
  if (showFavoritesOnly) {
    activeFilterChips.push({ id: 'favorites', label: 'Watchlist', onRemove: onToggleFavorites })
  }
  if (minVolume > 0) {
    const preset = VOLUME_PRESETS.find(p => p.value === minVolume)
    activeFilterChips.push({ id: 'volume', label: `Vol: ${preset?.label || formatNumber(minVolume)}`, onRemove: () => onMinVolumeChange(0) })
  }
  if (minLiquidity > 0) {
    const preset = LIQUIDITY_PRESETS.find(p => p.value === minLiquidity)
    activeFilterChips.push({ id: 'liquidity', label: `Liq: ${preset?.label || formatNumber(minLiquidity)}`, onRemove: () => onMinLiquidityChange(0) })
  }

  const clearAllFilters = () => {
    onQuickFilterChange("all")
    if (showFavoritesOnly) onToggleFavorites()
    onMinVolumeChange(0)
    onMinLiquidityChange(0)
    onSearchChange("")
  }

  // Compact layout for Pro Mode
  if (compact) {
    return (
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        {/* Compact Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="w-full pl-9 pr-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg font-mono text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-bonk/30 transition-all"
          />
        </div>

        {/* Compact Quick Filters */}
        <div className="flex items-center gap-1">
          {QUICK_FILTERS.map((filter) => {
            const Icon = filter.icon
            const isActive = quickFilter === filter.id
            return (
              <button
                key={filter.id}
                onClick={() => onQuickFilterChange(filter.id)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-mono text-[10px] font-bold transition-all",
                  isActive
                    ? "bg-bonk text-black"
                    : "bg-white/[0.03] text-white/50 hover:text-white hover:bg-white/[0.06]"
                )}
              >
                {Icon && <Icon size={12} />}
                {filter.label}
              </button>
            )
          })}
        </div>

        {/* Compact Sort */}
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value)}
          className="appearance-none px-2.5 py-1.5 pr-7 bg-white/[0.03] border border-white/[0.06] rounded-md font-mono text-[10px] font-bold text-white/60 focus:outline-none focus:border-bonk/30 cursor-pointer"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value} className="bg-[#0a0a0c]">
              {option.label}
            </option>
          ))}
        </select>

        {/* Watchlist Toggle */}
        <button
          onClick={onToggleFavorites}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-mono text-[10px] font-bold transition-all",
            showFavoritesOnly
              ? "bg-bonk text-black"
              : "bg-white/[0.03] text-white/50 hover:text-white hover:bg-white/[0.06]"
          )}
        >
          <Star size={12} />
          {favoritesCount > 0 && <span>({favoritesCount})</span>}
        </button>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="mb-8 space-y-4"
    >
      {/* Main Filter Row */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors",
            isSearchFocused ? "text-bonk" : "text-white/30"
          )} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            placeholder="Search by name, symbol, or address..."
            className="w-full pl-11 pr-20 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl font-mono text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-bonk/30 focus:bg-white/[0.05] focus:ring-2 focus:ring-bonk/20 transition-all"
            aria-label="Search tokens"
          />
          {/* Keyboard shortcut hint */}
          {!searchQuery && !isSearchFocused && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-white/20 pointer-events-none">
              <span className="text-[10px] font-mono">Press</span>
              <kbd className="px-1.5 py-0.5 bg-white/[0.06] border border-white/[0.1] rounded text-[10px] font-mono">/</kbd>
            </div>
          )}
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Clear search"
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

      {/* Active Filter Chips */}
      <AnimatePresence>
        {activeFilterChips.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 flex-wrap"
          >
            <span className="text-white/30 text-xs font-mono label-uppercase">Active:</span>
            {activeFilterChips.map((chip) => (
              <motion.button
                key={chip.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={chip.onRemove}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bonk/10 border border-bonk/30 rounded-lg text-bonk text-xs font-mono font-bold hover:bg-bonk/20 transition-colors group"
              >
                {chip.label}
                <X className="w-3 h-3 group-hover:scale-110 transition-transform" />
              </motion.button>
            ))}
            <button
              onClick={clearAllFilters}
              className="text-xs font-mono text-white/40 hover:text-white transition-colors ml-2"
            >
              Clear all
            </button>
          </motion.div>
        )}
      </AnimatePresence>

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
