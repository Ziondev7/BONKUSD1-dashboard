"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import dynamic from "next/dynamic"
import { useTokens, useFavorites, useSoundPreference } from "@/hooks/use-tokens"
// import { useDataFreshness, useNewPoolDetection } from "@/hooks/use-realtime"
import { ErrorBoundary } from "@/components/error-boundary"
import { sanitizeSearchInput, formatNumber } from "@/lib/utils"
import { MetricsGrid } from "./dashboard/metrics-grid"
import { VolumeAnalytics } from "./dashboard/volume-analytics"
// import { StaleDataBanner, NewPoolNotification } from "./dashboard/realtime-indicators"

// Dynamic import FloatingNav with SSR disabled to prevent hydration mismatch
// (status indicator depends on client-side data fetching)
const FloatingNav = dynamic(() => import("./dashboard/floating-nav").then(mod => ({ default: mod.FloatingNav })), {
  ssr: false,
})
// import { VolumeEvolution } from "./dashboard/volume-evolution"
import { TopPerformers } from "./dashboard/top-performers"
import { TokenFilters } from "./dashboard/token-filters"
import { TokenTable } from "./dashboard/token-table"
import { TokenDetailDrawer } from "./dashboard/token-detail-drawer"
import { TradeConfirmModal } from "./dashboard/trade-confirm-modal"
import { DashboardFooter } from "./dashboard/footer"
import { BackToTop } from "./dashboard/back-to-top"
import { InfoBanner } from "./dashboard/info-banner"
import { DesignSwitcher } from "./design-switcher"
import type { Token, BannerState } from "@/lib/types"

const TOKENS_PER_PAGE = 50

interface BonkDashboardProps {
  initialTokens?: Token[] | null
}

export function BonkDashboard({ initialTokens }: BonkDashboardProps) {
  // Custom hooks for data fetching
  const { enabled: soundEnabled, toggle: toggleSound } = useSoundPreference()
  const { tokens, isLoading, status, metrics, lastRefresh, refresh, apiHealth } = useTokens({
    refreshInterval: 10000, // 10 seconds for blazing fast updates
    enableSound: soundEnabled,
    initialData: initialTokens || undefined,
  })
  const { favorites, toggleFavorite, count: favoritesCount } = useFavorites()


  // Refresh countdown state
  const [nextRefreshIn, setNextRefreshIn] = useState(10)

  // Update countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastRefresh) {
        const elapsed = Math.floor((Date.now() - lastRefresh.getTime()) / 1000)
        const remaining = Math.max(0, 10 - (elapsed % 10))
        setNextRefreshIn(remaining)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [lastRefresh])

  // UI State
  const [banner, setBanner] = useState<BannerState | null>(null)
  const [sortBy, setSortBy] = useState("mcap")
  const [searchQuery, setSearchQuery] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [quickFilter, setQuickFilter] = useState("all")
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [selectedToken, setSelectedToken] = useState<Token | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [tradeToken, setTradeToken] = useState<Token | null>(null)
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("all")
  const [minVolume, setMinVolume] = useState(0)
  const [minLiquidity, setMinLiquidity] = useState(0)
  const [proMode, setProMode] = useState(false)
  const tokenTableRef = useRef<HTMLDivElement>(null)

  // Pro Mode toggle
  const toggleProMode = useCallback(() => {
    setProMode(prev => !prev)
  }, [])

  // Handlers
  const handleSelectToken = useCallback((token: Token) => {
    setSelectedToken(token)
    setIsDrawerOpen(true)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false)
  }, [])

  const handleOpenTradeModal = useCallback((token: Token) => {
    setTradeToken(token)
    setIsTradeModalOpen(true)
  }, [])

  const handleCloseTradeModal = useCallback(() => {
    setIsTradeModalOpen(false)
  }, [])

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab)
    setShowFavoritesOnly(false)
    setCurrentPage(1)

    switch (tab) {
      case "movers":
        setQuickFilter("hot")
        setSortBy("volume")
        break
      case "new":
        setQuickFilter("new")
        setSortBy("mcap")
        break
      case "trending":
        setQuickFilter("gainers")
        setSortBy("change")
        break
      case "watchlist":
        setQuickFilter("all")
        setShowFavoritesOnly(true)
        break
      default:
        setQuickFilter("all")
        setSortBy("mcap")
    }
  }, [])

  const handleScrollToContent = useCallback(() => {
    setTimeout(() => {
      tokenTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 100)
  }, [])

  // Filtering & Sorting - Memoized for performance
  const filteredTokens = useMemo(() => {
    return tokens
      .filter((t) => {
        // Search filter
        const matchesSearch =
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.address.toLowerCase().includes(searchQuery.toLowerCase())

        if (!matchesSearch) return false
        if (showFavoritesOnly && !favorites.has(t.address)) return false
        if (minVolume > 0 && t.volume24h < minVolume) return false
        if (minLiquidity > 0 && t.liquidity < minLiquidity) return false

        // Quick filters
        switch (quickFilter) {
          case "gainers":
            return t.change24h > 0
          case "losers":
            return t.change24h < 0
          case "new":
            return t.created && Date.now() - t.created < 86400000
          case "hot":
            const volumeThreshold =
              tokens.length > 0
                ? [...tokens].sort((a, b) => b.volume24h - a.volume24h)[Math.floor(tokens.length * 0.2)]?.volume24h || 0
                : 0
            return t.volume24h >= volumeThreshold
          default:
            return true
        }
      })
      .sort((a, b) => {
        // Special sorting for quick filters
        if (quickFilter === "gainers") return b.change24h - a.change24h
        if (quickFilter === "losers") return a.change24h - b.change24h
        if (quickFilter === "new") return (b.created || 0) - (a.created || 0)

        // Default sorting
        switch (sortBy) {
          case "volume":
            return b.volume24h - a.volume24h
          case "change":
            return b.change24h - a.change24h
          case "liquidity":
            return b.liquidity - a.liquidity
          default:
            return b.mcap - a.mcap
        }
      })
  }, [tokens, searchQuery, showFavoritesOnly, favorites, quickFilter, sortBy, minVolume, minLiquidity])

  // Pagination
  const totalPages = Math.ceil(filteredTokens.length / TOKENS_PER_PAGE)
  const paginatedTokens = filteredTokens.slice(
    (currentPage - 1) * TOKENS_PER_PAGE,
    currentPage * TOKENS_PER_PAGE
  )

  // Reset page when filters change
  const handleFilterChange = useCallback((setter: (value: any) => void, value: any) => {
    setter(value)
    setCurrentPage(1)
  }, [])

  // Sanitized search handler to prevent XSS
  const handleSearchChange = useCallback((value: string) => {
    const sanitized = sanitizeSearchInput(value)
    setSearchQuery(sanitized)
    setCurrentPage(1)
  }, [])

  // Top performers data
  const topGainers = useMemo(() => {
    return [...tokens]
      .filter((t) => t.change24h > 0)
      .sort((a, b) => b.change24h - a.change24h)
      .slice(0, 3)
  }, [tokens])

  const topLosers = useMemo(() => {
    return [...tokens]
      .filter((t) => t.change24h < 0)
      .sort((a, b) => a.change24h - b.change24h)
      .slice(0, 3)
  }, [tokens])

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (quickFilter !== "all") count++
    if (showFavoritesOnly) count++
    if (minVolume > 0) count++
    if (minLiquidity > 0) count++
    if (searchQuery) count++
    return count
  }, [quickFilter, showFavoritesOnly, minVolume, minLiquidity, searchQuery])

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      {/* Animated Grid Background */}
      <div className="animated-grid-bg" aria-hidden="true" />

      {/* Floating Particles */}
      <div className="particles-container" aria-hidden="true">
        <div className="particle" style={{ left: '5%', animationDelay: '0s' }} />
        <div className="particle" style={{ left: '15%', animationDelay: '3s' }} />
        <div className="particle" style={{ left: '25%', animationDelay: '1s' }} />
        <div className="particle" style={{ left: '35%', animationDelay: '4s' }} />
        <div className="particle" style={{ left: '45%', animationDelay: '2s' }} />
        <div className="particle" style={{ left: '55%', animationDelay: '5s' }} />
        <div className="particle" style={{ left: '65%', animationDelay: '1.5s' }} />
        <div className="particle" style={{ left: '75%', animationDelay: '3.5s' }} />
        <div className="particle" style={{ left: '85%', animationDelay: '2.5s' }} />
        <div className="particle" style={{ left: '95%', animationDelay: '4.5s' }} />
      </div>

      {/* Grain texture overlay */}
      <div className="grain-overlay" aria-hidden="true" />

      {/* Animated mesh gradient background - Gradient Glass Purple/Pink */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-0 left-1/4 w-[900px] h-[900px] bg-[radial-gradient(ellipse_at_center,_rgba(168,85,247,0.12)_0%,_transparent_60%)] blob-float" />
        <div className="absolute top-1/3 right-0 w-[700px] h-[700px] bg-[radial-gradient(ellipse_at_center,_rgba(236,72,153,0.08)_0%,_transparent_60%)] blob-float-reverse" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-[radial-gradient(ellipse_at_center,_rgba(168,85,247,0.06)_0%,_transparent_60%)] blob-float-slow" />
      </div>

      {/* Floating Navigation */}
      <FloatingNav
        status={status}
        onRefresh={refresh}
        tokenCount={tokens.length}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        soundEnabled={soundEnabled}
        onToggleSound={toggleSound}
        lastRefresh={lastRefresh}
        onScrollToContent={handleScrollToContent}
        activeFiltersCount={activeFiltersCount}
        totalVolume={metrics.totalVolume}
        proMode={proMode}
        onToggleProMode={toggleProMode}
      />

      {/* Main Content */}
      <main className={`relative z-10 mx-auto px-4 md:px-6 ${
        proMode
          ? "h-[calc(100vh-140px)] pt-36 max-w-full overflow-hidden"
          : "max-w-[1600px] py-6 pt-44"
      }`}>
        <ErrorBoundary>

          {/* Error Banner */}
          {banner && (
            <InfoBanner banner={banner} onDismiss={() => setBanner(null)} />
          )}

          {proMode ? (
            /* PRO MODE LAYOUT - Expansive Dashboard (Layout 1 V2) */
            <div className="h-full flex gap-0">
              {/* Left: Expansive Data Cards Panel */}
              <div className="flex-1 h-full flex flex-col overflow-hidden pr-0" style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.02) 0%, transparent 100%)' }}>
                {/* 4-Column Metrics Grid */}
                <div className="flex-shrink-0 p-4 pb-3">
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: "USD1 PAIRS", value: metrics.tokenCount.toString(), icon: "📊" },
                      { label: "24H VOLUME", value: formatNumber(metrics.totalVolume), icon: "📈" },
                      { label: "LIQUIDITY", value: formatNumber(metrics.totalLiquidity), icon: "💧" },
                      { label: "MARKET CAP", value: formatNumber(metrics.totalMcap), icon: "💎" },
                    ].map((metric, i) => (
                      <div
                        key={metric.label}
                        className="bg-[rgba(20,15,35,0.8)] border border-[rgba(168,85,247,0.2)] rounded-lg p-4 text-center"
                      >
                        <p className="text-2xl font-bold font-mono text-white tabular-nums">
                          {isLoading ? (
                            <span className="inline-block w-16 h-6 bg-white/[0.06] rounded animate-pulse" />
                          ) : (
                            metric.value
                          )}
                        </p>
                        <p className="text-[9px] text-white/40 font-mono uppercase tracking-wider mt-1">
                          {metric.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Two-Column Section: Performers + Movers */}
                <div className="flex-1 overflow-hidden grid grid-cols-2 gap-4 px-4 pb-4">
                  {/* Left Column: Top Performers List */}
                  <div className="bg-[rgba(20,15,35,0.6)] border border-[rgba(168,85,247,0.2)] rounded-lg overflow-hidden flex flex-col">
                    <div className="px-4 py-3 bg-gradient-to-r from-[rgba(168,85,247,0.15)] to-[rgba(236,72,153,0.08)] border-b border-[rgba(168,85,247,0.2)] flex items-center gap-2">
                      <span>👑</span>
                      <span className="text-xs font-bold text-white">TOP BY MARKET CAP</span>
                    </div>
                    <div className="flex-1 overflow-y-auto scrollbar-hide">
                      {tokens.slice(0, 5).map((token, i) => {
                        const isPositive = token.change24h >= 0
                        return (
                          <div
                            key={token.id}
                            onClick={() => handleSelectToken(token)}
                            className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.03] cursor-pointer transition-colors hover:bg-[rgba(168,85,247,0.05)]"
                          >
                            <span className={`w-6 h-6 flex items-center justify-center text-xs font-bold font-mono rounded-md ${
                              i === 0
                                ? "bg-gradient-to-r from-[#A855F7] to-[#EC4899] text-white"
                                : "bg-white/[0.05] text-white/50"
                            }`}>
                              {i + 1}
                            </span>
                            <div className="w-9 h-9 rounded-lg bg-[rgba(168,85,247,0.15)] border border-white/10 overflow-hidden flex items-center justify-center text-lg flex-shrink-0">
                              {token.imageUrl ? (
                                <img src={token.imageUrl} alt={token.name} className="w-full h-full object-cover" />
                              ) : (
                                token.emoji
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{token.name}</p>
                              <p className="text-xs text-white/40 font-mono">{formatNumber(token.mcap)}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <span className={`text-sm font-mono font-semibold ${isPositive ? "text-success" : "text-danger"}`}>
                                {isPositive ? "+" : ""}{token.change24h.toFixed(1)}%
                              </span>
                              <p className="text-[10px] text-white/30 font-mono">{formatNumber(token.volume24h)}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Right Column: Gainers + Losers stacked */}
                  <div className="flex flex-col gap-4">
                    {/* Top Gainers Card */}
                    <div className="flex-1 bg-[rgba(20,15,35,0.6)] border border-[rgba(168,85,247,0.2)] rounded-lg overflow-hidden flex flex-col">
                      <div className="px-4 py-2.5 bg-[rgba(168,85,247,0.05)] border-b border-[rgba(168,85,247,0.15)] flex items-center gap-2">
                        <span className="text-success">📈</span>
                        <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider">TOP GAINERS</span>
                      </div>
                      <div className="flex-1 overflow-y-auto scrollbar-hide">
                        {topGainers.slice(0, 4).map((token, i) => (
                          <div
                            key={`g-${token.id}`}
                            onClick={() => handleSelectToken(token)}
                            className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.02] cursor-pointer hover:bg-success/5 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-white/30">{i + 1}</span>
                              <span className="text-sm font-medium text-white">{token.symbol}</span>
                            </div>
                            <span className="text-sm font-mono font-bold text-success">
                              +{token.change24h.toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Top Losers Card */}
                    <div className="flex-1 bg-[rgba(20,15,35,0.6)] border border-[rgba(168,85,247,0.2)] rounded-lg overflow-hidden flex flex-col">
                      <div className="px-4 py-2.5 bg-[rgba(168,85,247,0.05)] border-b border-[rgba(168,85,247,0.15)] flex items-center gap-2">
                        <span className="text-danger">📉</span>
                        <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider">TOP LOSERS</span>
                      </div>
                      <div className="flex-1 overflow-y-auto scrollbar-hide">
                        {topLosers.slice(0, 4).map((token, i) => (
                          <div
                            key={`l-${token.id}`}
                            onClick={() => handleSelectToken(token)}
                            className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.02] cursor-pointer hover:bg-danger/5 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-white/30">{i + 1}</span>
                              <span className="text-sm font-medium text-white">{token.symbol}</span>
                            </div>
                            <span className="text-sm font-mono font-bold text-danger">
                              {token.change24h.toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Narrow Token Table Panel (340px) */}
              <div className="w-[340px] flex-shrink-0 h-full flex flex-col border-l border-[rgba(168,85,247,0.15)]" style={{ background: 'rgba(10, 8, 18, 0.5)' }}>
                {/* Search */}
                <div className="p-3 border-b border-[rgba(168,85,247,0.15)]">
                  <div className="relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      placeholder="Search tokens..."
                      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2.5 text-xs font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-[#A855F7]/30"
                    />
                  </div>
                </div>

                {/* Filter Chips */}
                <div className="px-3 py-2 border-b border-[rgba(168,85,247,0.15)] flex gap-1.5 flex-wrap">
                  {[
                    { id: "all", label: "All" },
                    { id: "gainers", label: "↑" },
                    { id: "losers", label: "↓" },
                    { id: "hot", label: "🔥" },
                    { id: "new", label: "New" },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => handleFilterChange(setQuickFilter, filter.id)}
                      className={`px-2.5 py-1 text-[9px] font-mono font-bold rounded transition-all ${
                        quickFilter === filter.id
                          ? "bg-gradient-to-r from-[#A855F7] to-[#EC4899] text-white"
                          : "bg-white/[0.03] border border-white/[0.06] text-white/50 hover:text-white"
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                  <button
                    onClick={() => handleFilterChange(setShowFavoritesOnly, !showFavoritesOnly)}
                    className={`px-2.5 py-1 text-[9px] font-mono font-bold rounded transition-all ${
                      showFavoritesOnly
                        ? "bg-gradient-to-r from-[#A855F7] to-[#EC4899] text-white"
                        : "bg-white/[0.03] border border-white/[0.06] text-white/50 hover:text-white"
                    }`}
                  >
                    ★
                  </button>
                </div>

                {/* Compact Table */}
                <div className="flex-1 overflow-hidden">
                  <TokenTable
                    tokens={paginatedTokens}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                    totalTokens={filteredTokens.length}
                    favorites={favorites}
                    onToggleFavorite={toggleFavorite}
                    sortBy={sortBy}
                    onSortChange={(v) => handleFilterChange(setSortBy, v)}
                    onSelectToken={handleSelectToken}
                    onOpenTradeModal={handleOpenTradeModal}
                    isLoading={isLoading}
                    proMode
                  />
                </div>
              </div>
            </div>
          ) : (
            /* NORMAL LAYOUT - Vertical scroll */
            <>
              {/* Metrics Grid */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <MetricsGrid metrics={metrics} tokens={tokens} isLoading={isLoading} />
              </motion.div>

              {/* Volume Analytics */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mt-8"
              >
                <VolumeAnalytics
                  tokens={tokens}
                  totalVolume={metrics.totalVolume}
                  isLoading={isLoading}
                  onSelectToken={handleSelectToken}
                />
              </motion.div>

              {/* Top Performers */}
              <div className="mt-6">
                <TopPerformers
                  tokens={tokens.slice(0, 3)}
                  topGainers={topGainers}
                  topLosers={topLosers}
                  onSelectToken={handleSelectToken}
                />
              </div>

              {/* Token Table Section */}
              <div ref={tokenTableRef} className="scroll-mt-32">
                <TokenFilters
                  sortBy={sortBy}
                  onSortChange={(v) => handleFilterChange(setSortBy, v)}
                  searchQuery={searchQuery}
                  onSearchChange={handleSearchChange}
                  quickFilter={quickFilter}
                  onQuickFilterChange={(v) => handleFilterChange(setQuickFilter, v)}
                  showFavoritesOnly={showFavoritesOnly}
                  onToggleFavorites={() => handleFilterChange(setShowFavoritesOnly, !showFavoritesOnly)}
                  favoritesCount={favoritesCount}
                  minVolume={minVolume}
                  onMinVolumeChange={(v) => handleFilterChange(setMinVolume, v)}
                  minLiquidity={minLiquidity}
                  onMinLiquidityChange={(v) => handleFilterChange(setMinLiquidity, v)}
                />

                <TokenTable
                  tokens={paginatedTokens}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  totalTokens={filteredTokens.length}
                  favorites={favorites}
                  onToggleFavorite={toggleFavorite}
                  sortBy={sortBy}
                  onSortChange={(v) => handleFilterChange(setSortBy, v)}
                  onSelectToken={handleSelectToken}
                  onOpenTradeModal={handleOpenTradeModal}
                  isLoading={isLoading}
                />
              </div>

              {/* Footer */}
              <DashboardFooter />
            </>
          )}
        </ErrorBoundary>
      </main>

      {/* Token Detail Drawer */}
      <TokenDetailDrawer
        token={selectedToken}
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
      />

      {/* Trade Confirmation Modal */}
      <TradeConfirmModal
        token={tradeToken}
        isOpen={isTradeModalOpen}
        onClose={handleCloseTradeModal}
        onConfirm={() => {}}
      />

      {/* Back to Top */}
      <BackToTop />

      {/* Design Switcher - Preview different themes */}
      <DesignSwitcher />

    </div>
  )
}
