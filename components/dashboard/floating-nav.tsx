"use client"

import { useState, useEffect, useCallback } from "react"
import { RefreshCw, Volume2, VolumeX, Filter, Zap, Activity, LayoutGrid, Rows3 } from "lucide-react"
import Image from "next/image"
import { motion, AnimatePresence } from "framer-motion"
import type { StatusState } from "@/lib/types"
import { formatCompactNumber } from "@/lib/utils"
import { useProMode } from "@/components/providers/pro-mode-provider"

interface FloatingNavProps {
  status: StatusState
  onRefresh: () => Promise<void> | void
  tokenCount: number
  activeTab: string
  onTabChange: (tab: string) => void
  soundEnabled: boolean
  onToggleSound: () => void
  lastRefresh: Date | null
  onScrollToContent?: () => void
  activeFiltersCount?: number
  totalVolume?: number
}

const TABS = [
  { id: "all", label: "ALL", icon: null },
  { id: "movers", label: "TOP MOVERS", icon: Zap },
  { id: "new", label: "NEW", icon: null },
  { id: "trending", label: "TRENDING", icon: Activity },
  { id: "watchlist", label: "WATCHLIST", icon: null },
]

export function FloatingNav({
  status,
  onRefresh,
  tokenCount,
  activeTab,
  onTabChange,
  soundEnabled,
  onToggleSound,
  lastRefresh,
  onScrollToContent,
  activeFiltersCount = 0,
  totalVolume = 0,
}: FloatingNavProps) {
  const [scrolled, setScrolled] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { isProMode, toggleProMode } = useProMode()

  // Prevent hydration mismatch by only rendering dynamic content after mount
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    let ticking = false
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setScrolled(window.scrollY > 30)
          ticking = false
        })
        ticking = true
      }
    }
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await onRefresh()
    } catch (error) {
      console.error("[FloatingNav] Refresh error:", error)
    } finally {
      setIsRefreshing(false)
    }
  }, [onRefresh, isRefreshing])

  return (
    <nav
      className={`fixed left-1/2 -translate-x-1/2 z-50 transition-all duration-300 w-[98%] max-w-[1600px]
        ${isProMode ? "top-1" : scrolled ? "top-2" : "top-4"}`}
    >
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        className={`glass-card-elevated transition-all duration-300 ${
          scrolled ? "shadow-2xl" : ""
        } ${isProMode ? "pro-nav-compact" : ""}`}
      >
        {/* Top Row: Brand + Metrics + Actions */}
        <div className={`px-4 md:px-6 flex items-center justify-between ${
          isProMode ? "py-2" : "py-3"
        } ${!isProMode ? "border-b border-white/5" : ""}`}>
          {/* Left: Brand & Status */}
          <div className="flex items-center gap-4 md:gap-6">
            {/* Logo */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className={`relative ${isProMode ? "w-8 h-8" : "w-10 h-10 md:w-11 md:h-11"}`}
              title="Back to top"
            >
              <Image
                src="/logo.png"
                alt="BONKUSD1"
                width={isProMode ? 32 : 44}
                height={isProMode ? 32 : 44}
                className={`object-contain ${isProMode ? "drop-shadow-[0_0_10px_rgba(250,204,21,0.3)]" : "drop-shadow-[0_0_20px_rgba(250,204,21,0.5)]"}`}
                priority
              />
            </motion.button>

            {/* Brand name */}
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className={`font-black tracking-tight hidden sm:flex items-center gap-1 hover:opacity-80 transition-opacity ${
                isProMode ? "text-base" : "text-xl"
              }`}
              title="Back to top"
            >
              <span className="text-white">BONK</span>
              <span className="text-bonk text-glow-bonk">USD1</span>
            </button>

            {/* Live Status - suppressHydrationWarning since status can differ between server/client */}
            <div className="hidden md:flex items-center gap-3 border-l border-white/10 pl-4" suppressHydrationWarning>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
                <div className="relative">
                  <div
                    suppressHydrationWarning
                    className={`w-2 h-2 rounded-full ${
                      status.type === "live"
                        ? "bg-success"
                        : status.type === "error"
                          ? "bg-danger"
                          : "bg-bonk"
                    }`}
                  />
                  <div
                    suppressHydrationWarning
                    className={`absolute inset-0 rounded-full animate-ping ${
                      status.type === "live"
                        ? "bg-success"
                        : status.type === "error"
                          ? "bg-danger"
                          : "bg-bonk"
                    }`}
                    style={{ animationDuration: "2s" }}
                  />
                </div>
                <span
                  suppressHydrationWarning
                  className={`text-[10px] font-bold tracking-[0.15em] uppercase ${
                    status.type === "live"
                      ? "text-success"
                      : status.type === "error"
                        ? "text-danger"
                        : "text-bonk"
                  }`}
                >
                  {status.type === "live" ? "LIVE" : status.type === "error" ? "OFFLINE" : "SYNCING"}
                </span>
              </div>
            </div>

            {/* Metrics Pills */}
            <div className="hidden lg:flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
                <span className="text-white/40 text-[10px] font-mono uppercase tracking-wider">Pairs</span>
                <span className="font-mono text-sm text-bonk font-bold">{tokenCount}</span>
              </div>
              
              {totalVolume > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
                  <span className="text-white/40 text-[10px] font-mono uppercase tracking-wider">Vol</span>
                  <span className="font-mono text-sm text-success font-bold">
                    ${formatCompactNumber(totalVolume)}
                  </span>
                </div>
              )}
            </div>

            {/* Active Filters Badge */}
            <AnimatePresence>
              {activeFiltersCount > 0 && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-bonk/10 border border-bonk/20"
                >
                  <Filter className="w-3 h-3 text-bonk" />
                  <span className="text-[10px] font-bold text-bonk tracking-wide">
                    {activeFiltersCount} FILTER{activeFiltersCount > 1 ? "S" : ""}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 md:gap-3">
            {/* Last Update Time - only show after mount to prevent hydration mismatch */}
            {mounted && lastRefresh && (
              <span className="hidden lg:block text-[10px] text-white/30 font-mono">
                {lastRefresh.toLocaleTimeString()}
              </span>
            )}

            {/* Pro Mode Toggle */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={toggleProMode}
              className={`hidden lg:flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                isProMode
                  ? "bg-bonk/20 border-bonk/40 text-bonk"
                  : "bg-white/[0.03] border-white/[0.06] text-white/60 hover:bg-white/[0.06] hover:border-white/10"
              }`}
              title={isProMode ? "Switch to Standard Mode" : "Switch to Pro Mode"}
            >
              {isProMode ? (
                <Rows3 size={16} />
              ) : (
                <LayoutGrid size={16} />
              )}
              <span className="text-[10px] font-bold tracking-wider uppercase">
                {isProMode ? "PRO" : "STD"}
              </span>
            </motion.button>

            {/* Refresh Button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-bonk/30 transition-all disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw
                size={18}
                className={`text-white/60 hover:text-bonk transition-colors ${
                  isRefreshing ? "animate-spin" : ""
                }`}
              />
            </motion.button>

            {/* X/Twitter Link */}
            <motion.a
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              href="https://x.com/BONKUSD1"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-bonk hover:bg-bonk/90 text-black px-4 md:px-5 py-2.5 rounded-lg font-bold text-sm transition-all glow-bonk"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span className="hidden md:inline">Follow</span>
            </motion.a>
          </div>
        </div>

        {/* Bottom Row: Navigation Tabs - Hidden in Pro Mode */}
        {!isProMode && (
          <div className="px-4 md:px-6 py-2 flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id
              const Icon = tab.icon

              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    onTabChange(tab.id)
                    onScrollToContent?.()
                  }}
                  className={`relative px-4 py-2 rounded-lg font-mono text-xs font-bold tracking-wide whitespace-nowrap transition-all duration-200 flex items-center gap-2 ${
                    isActive
                      ? "bg-bonk text-black shadow-[0_0_20px_rgba(250,204,21,0.3)]"
                      : "text-white/50 hover:text-white hover:bg-white/[0.04]"
                  }`}
                >
                  {Icon && <Icon size={14} />}
                  {tab.label}
                </button>
              )
            })}
          </div>
        )}
      </motion.div>
    </nav>
  )
}
