"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import dynamic from "next/dynamic"
import { useTokens, useFavorites, useSoundPreference } from "@/hooks/use-tokens"
import { ErrorBoundary } from "@/components/error-boundary"
import { sanitizeSearchInput } from "@/lib/utils"
import { MetricsGrid } from "./dashboard/metrics-grid"

// Dynamic import FloatingNav with SSR disabled to prevent hydration mismatch
// (status indicator depends on client-side data fetching)
const FloatingNav = dynamic(() => import("./dashboard/floating-nav").then(mod => ({ default: mod.FloatingNav })), {
  ssr: false,
})
import { VolumeEvolution } from "./dashboard/volume-evolution"
import { LaunchpadVolume } from "./dashboard/launchpad-volume"
import { TopPerformers } from "./dashboard/top-performers"
import { TokenFilters } from "./dashboard/token-filters"
import { TokenTable } from "./dashboard/token-table"
import { TokenDetailDrawer } from "./dashboard/token-detail-drawer"
import { TradeConfirmModal } from "./dashboard/trade-confirm-modal"
import { DashboardFooter } from "./dashboard/footer"
import { BackToTop } from "./dashboard/back-to-top"
import { InfoBanner } from "./dashboard/info-banner"
import type { Token, BannerState } from "@/lib/types"

const TOKENS_PER_PAGE = 50

export function BonkDashboard() {
  // Custom hooks for data fetching
  const { enabled: soundEnabled, toggle: toggleSound } = useSoundPreference()
  const { tokens, isLoading, status, metrics, lastRefresh, refresh, apiHealth } = useTokens({
    refreshInterval: 10000, // 10 seconds for blazing fast updates
    enableSound: soundEnabled,
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
  const tokenTableRef = useRef<HTMLDivElement>(null)

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
      {/* Grain texture overlay */}
      <div className="grain-overlay" aria-hidden="true" />

      {/* Animated mesh gradient background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-0 left-1/4 w-[900px] h-[900px] bg-[radial-gradient(ellipse_at_center,_rgba(250,204,21,0.08)_0%,_transparent_60%)] mesh-gradient" />
        <div
          className="absolute top-1/3 right-0 w-[700px] h-[700px] bg-[radial-gradient(ellipse_at_center,_rgba(0,255,136,0.05)_0%,_transparent_60%)] mesh-gradient"
          style={{ animationDelay: "-10s" }}
        />
        <div
          className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-[radial-gradient(ellipse_at_center,_rgba(250,204,21,0.05)_0%,_transparent_60%)] mesh-gradient"
          style={{ animationDelay: "-20s" }}
        />
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
      />

      {/* Main Content */}
      <main className="relative z-10 max-w-[1600px] mx-auto px-4 md:px-6 py-6 pt-36">
        <ErrorBoundary>
          {/* Error Banner */}
          {banner && (
            <InfoBanner banner={banner} onDismiss={() => setBanner(null)} />
          )}

          {/* Metrics Grid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <MetricsGrid metrics={metrics} tokens={tokens} isLoading={isLoading} />
          </motion.div>

          {/* Volume Evolution Chart */}
          <VolumeEvolution currentVolume={metrics.totalVolume} />

          {/* Launchpad Volume Chart */}
          <LaunchpadVolume />

          {/* Top Performers */}
          <TopPerformers
            tokens={tokens.slice(0, 3)}
            topGainers={topGainers}
            topLosers={topLosers}
            onSelectToken={handleSelectToken}
          />

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
    </div>
  )
}
