"use client"

import { useState, useEffect, useCallback } from "react"
import { RefreshCw, Volume2, VolumeX, Filter, Zap, Activity, LayoutGrid, Maximize2 } from "lucide-react"
import Image from "next/image"
import { motion, AnimatePresence } from "framer-motion"
import type { StatusState } from "@/lib/types"
import { formatCompactNumber } from "@/lib/utils"

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
  proMode?: boolean
  onToggleProMode?: () => void
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
  proMode = false,
  onToggleProMode,
}: FloatingNavProps) {
  const [scrolled, setScrolled] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [mounted, setMounted] = useState(false)

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
      className={`fixed left-1/2 -translate-x-1/2 z-50 transition-all duration-500 w-[98%] max-w-[1600px]
        ${scrolled ? "top-2" : "top-4"}`}
    >
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        className={`glass-card-elevated transition-all duration-300 ${
          scrolled ? "shadow-2xl" : ""
        }`}
      >
        {/* Top Row: Brand + Metrics + Actions */}
        <div className="px-4 md:px-6 py-3 flex items-center justify-between border-b border-white/5">
          {/* Left: Brand & Status */}
          <div className="flex items-center gap-4 md:gap-6">
            {/* Logo */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="relative w-12 h-12 md:w-14 md:h-14"
              title="Back to top"
            >
              <Image
                src="/logo.png"
                alt="BONKUSD1"
                width={56}
                height={56}
                className="object-contain drop-shadow-[0_0_20px_rgba(250,204,21,0.5)] logo-pulse"
                priority
              />
            </motion.button>

            {/* Brand name */}
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="font-black tracking-tight text-xl hidden sm:flex items-center gap-1 hover:opacity-80 transition-opacity"
              title="Back to top"
            >
              <span className="text-white">BONK</span>
              <span className="bg-gradient-to-r from-[#A855F7] to-[#EC4899] bg-clip-text text-transparent text-glow-bonk">USD1</span>
            </button>

            {/* Live Status - suppressHydrationWarning since status can differ between server/client */}
            <div className="hidden md:flex items-center gap-3 border-l border-white/10 pl-4" suppressHydrationWarning>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] live-scan">
                <div className="relative">
                  <div
                    suppressHydrationWarning
                    className={`w-2 h-2 rounded-full live-pulse ${
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
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-[2px_6px_2px_6px] bg-white/[0.03] border border-[rgba(168,85,247,0.2)]">
                <span className="text-white/40 text-[10px] font-mono uppercase tracking-wider">Pairs</span>
                <span className="font-mono text-sm text-[#C084FC] font-bold">{tokenCount}</span>
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
            {onToggleProMode && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onToggleProMode}
                className={`hidden md:flex items-center gap-2 px-3 py-2 rounded-[2px_6px_2px_6px] font-mono text-xs font-bold transition-all ${
                  proMode
                    ? "bg-gradient-to-r from-[#A855F7] to-[#EC4899] text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]"
                    : "bg-white/[0.03] border border-white/[0.06] text-white/60 hover:bg-white/[0.06] hover:text-white hover:border-bonk/30"
                }`}
                title={proMode ? "Exit Pro Mode" : "Enter Pro Mode"}
              >
                {proMode ? <Maximize2 size={14} /> : <LayoutGrid size={14} />}
                <span className="hidden lg:inline">PRO</span>
              </motion.button>
            )}

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
              className="flex items-center gap-2 bg-gradient-to-r from-[#A855F7] to-[#EC4899] hover:opacity-90 text-white px-4 md:px-5 py-2.5 rounded-[2px_8px_2px_8px] font-bold text-sm transition-all glow-bonk"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span className="hidden md:inline">Follow</span>
            </motion.a>
          </div>
        </div>

        {/* Bottom Row: Navigation Tabs */}
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
                className={`relative px-4 py-2 rounded-[2px_6px_2px_6px] font-mono text-xs font-bold tracking-wide whitespace-nowrap transition-all duration-200 flex items-center gap-2 ${
                  isActive
                    ? "bg-gradient-to-r from-[#A855F7] to-[#EC4899] text-white shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                    : "text-white/50 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                {Icon && <Icon size={14} />}
                {tab.label}
              </button>
            )
          })}
        </div>
      </motion.div>
    </nav>
  )
}
