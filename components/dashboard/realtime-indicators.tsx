"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Wifi,
  WifiOff,
  Clock,
  AlertTriangle,
  Sparkles,
  X,
  ExternalLink,
  Zap
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { DataFreshnessState, NewPoolInfo, WebSocketState } from "@/hooks/use-realtime"

// ============================================
// CONNECTION STATUS INDICATOR
// ============================================

interface ConnectionStatusProps {
  wsState: WebSocketState | null
  freshness: DataFreshnessState
  className?: string
}

export function ConnectionStatus({ wsState, freshness, className }: ConnectionStatusProps) {
  const isWebSocketConnected = wsState?.connected || false
  const hasRecentData = !freshness.isStale

  // Determine overall status
  let status: "live" | "delayed" | "offline"
  let statusText: string
  let StatusIcon: typeof Wifi

  if (isWebSocketConnected && hasRecentData) {
    status = "live"
    statusText = "Live"
    StatusIcon = Wifi
  } else if (hasRecentData) {
    status = "delayed"
    statusText = freshness.ageText
    StatusIcon = Clock
  } else if (freshness.isCriticallyStale) {
    status = "offline"
    statusText = "Stale"
    StatusIcon = WifiOff
  } else {
    status = "delayed"
    statusText = freshness.ageText
    StatusIcon = Clock
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Animated status dot */}
      <div className="relative">
        <div
          className={cn(
            "w-2 h-2 rounded-full",
            status === "live" && "bg-success",
            status === "delayed" && "bg-bonk",
            status === "offline" && "bg-danger"
          )}
        />
        {status === "live" && (
          <div className="absolute inset-0 w-2 h-2 rounded-full bg-success animate-ping opacity-75" />
        )}
      </div>

      {/* Status text */}
      <span
        className={cn(
          "text-xs font-mono",
          status === "live" && "text-success",
          status === "delayed" && "text-bonk",
          status === "offline" && "text-danger"
        )}
      >
        {statusText}
      </span>

      {/* WebSocket indicator (optional) */}
      {wsState && (
        <div
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono",
            isWebSocketConnected
              ? "bg-success/10 text-success"
              : "bg-white/5 text-white/30"
          )}
          title={isWebSocketConnected ? "WebSocket connected" : "WebSocket disconnected"}
        >
          <Zap className="w-2.5 h-2.5" />
          WS
        </div>
      )}
    </div>
  )
}

// ============================================
// STALE DATA BANNER
// ============================================

interface StaleDataBannerProps {
  freshness: DataFreshnessState
  onRefresh?: () => void
  className?: string
}

export function StaleDataBanner({ freshness, onRefresh, className }: StaleDataBannerProps) {
  if (!freshness.isStale) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2 rounded-lg",
        freshness.isCriticallyStale
          ? "bg-danger/10 border border-danger/20"
          : "bg-bonk/10 border border-bonk/20",
        className
      )}
    >
      <div className="flex items-center gap-2">
        {freshness.isCriticallyStale ? (
          <AlertTriangle className="w-4 h-4 text-danger" />
        ) : (
          <Clock className="w-4 h-4 text-bonk" />
        )}
        <span
          className={cn(
            "text-xs font-mono",
            freshness.isCriticallyStale ? "text-danger" : "text-bonk"
          )}
        >
          Data is {freshness.ageText} old
          {freshness.isCriticallyStale && " — prices may be inaccurate"}
        </span>
      </div>

      {onRefresh && (
        <button
          onClick={onRefresh}
          className={cn(
            "px-3 py-1 rounded text-xs font-mono font-bold transition-colors",
            freshness.isCriticallyStale
              ? "bg-danger/20 text-danger hover:bg-danger/30"
              : "bg-bonk/20 text-bonk hover:bg-bonk/30"
          )}
        >
          Refresh
        </button>
      )}
    </motion.div>
  )
}

// ============================================
// NEW POOL NOTIFICATION
// ============================================

interface NewPoolNotificationProps {
  pools: NewPoolInfo[]
  onDismiss: (address: string) => void
  onDismissAll: () => void
  className?: string
}

export function NewPoolNotification({
  pools,
  onDismiss,
  onDismissAll,
  className,
}: NewPoolNotificationProps) {
  if (pools.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        "fixed bottom-20 right-4 z-50 w-80 max-h-96 overflow-hidden",
        "bg-[#0a0a0c]/95 backdrop-blur-xl border border-success/30 rounded-xl shadow-2xl",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-success" />
          <span className="text-sm font-mono font-bold text-success">
            New Pools Detected
          </span>
          <span className="px-1.5 py-0.5 rounded bg-success/20 text-success text-[10px] font-bold">
            {pools.length}
          </span>
        </div>
        <button
          onClick={onDismissAll}
          className="p-1 rounded hover:bg-white/10 transition-colors"
          title="Dismiss all"
        >
          <X className="w-4 h-4 text-white/50" />
        </button>
      </div>

      {/* Pool list */}
      <div className="max-h-64 overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {pools.map((pool) => (
            <motion.div
              key={pool.address}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex items-center justify-between px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-white truncate">
                    {pool.symbol}
                  </span>
                  <span className="text-success text-[10px] font-bold px-1.5 py-0.5 bg-success/10 rounded">
                    NEW
                  </span>
                </div>
                <p className="text-xs text-white/40 truncate">{pool.name}</p>
              </div>

              <div className="flex items-center gap-2 ml-2">
                <a
                  href={`https://dexscreener.com/solana/${pool.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded hover:bg-white/10 transition-colors"
                  title="View on DexScreener"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-white/50" />
                </a>
                <button
                  onClick={() => onDismiss(pool.address)}
                  className="p-1.5 rounded hover:bg-white/10 transition-colors"
                  title="Dismiss"
                >
                  <X className="w-3.5 h-3.5 text-white/50" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Time indicator */}
      <div className="px-4 py-2 bg-white/5 text-center">
        <span className="text-[10px] font-mono text-white/30">
          Auto-detected from pool updates
        </span>
      </div>
    </motion.div>
  )
}

// ============================================
// LIVE PRICE FLASH
// ============================================

interface PriceFlashProps {
  direction: "up" | "down" | "neutral"
  children: React.ReactNode
  className?: string
}

export function PriceFlash({ direction, children, className }: PriceFlashProps) {
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (direction !== "neutral") {
      setFlash(true)
      const timeout = setTimeout(() => setFlash(false), 500)
      return () => clearTimeout(timeout)
    }
  }, [direction])

  return (
    <span
      className={cn(
        "transition-colors duration-500",
        flash && direction === "up" && "text-success bg-success/20",
        flash && direction === "down" && "text-danger bg-danger/20",
        className
      )}
    >
      {children}
    </span>
  )
}

// ============================================
// REFRESH COUNTDOWN
// ============================================

interface RefreshCountdownProps {
  nextRefreshIn: number // seconds until next refresh
  isRefreshing: boolean
  className?: string
}

export function RefreshCountdown({ nextRefreshIn, isRefreshing, className }: RefreshCountdownProps) {
  if (isRefreshing) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs font-mono text-white/50", className)}>
        <div className="w-3 h-3 border border-white/30 border-t-bonk rounded-full animate-spin" />
        <span>Updating...</span>
      </div>
    )
  }

  return (
    <div className={cn("flex items-center gap-1.5 text-xs font-mono text-white/30", className)}>
      <Clock className="w-3 h-3" />
      <span>Next update in {nextRefreshIn}s</span>
    </div>
  )
}
