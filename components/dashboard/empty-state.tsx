"use client"

import { motion } from "framer-motion"
import { Search, Star, AlertTriangle, WifiOff, RefreshCw } from "lucide-react"
import Image from "next/image"

type EmptyStateVariant = "no-results" | "no-favorites" | "error" | "offline"

interface EmptyStateProps {
  variant: EmptyStateVariant
  onAction?: () => void
  searchQuery?: string
}

const variants = {
  "no-results": {
    icon: Search,
    title: "No tokens found",
    description: "Try adjusting your search or filter criteria",
    actionLabel: "Clear Filters",
    color: "text-bonk",
    bgColor: "bg-bonk/10",
  },
  "no-favorites": {
    icon: Star,
    title: "Your watchlist is empty",
    description: "Star your favorite tokens to track them here",
    actionLabel: "Browse Tokens",
    color: "text-bonk",
    bgColor: "bg-bonk/10",
  },
  "error": {
    icon: AlertTriangle,
    title: "Failed to load data",
    description: "There was a problem fetching token data. Please try again.",
    actionLabel: "Retry",
    color: "text-danger",
    bgColor: "bg-danger/10",
  },
  "offline": {
    icon: WifiOff,
    title: "Connection lost",
    description: "Check your internet connection and try again",
    actionLabel: "Retry Connection",
    color: "text-white/60",
    bgColor: "bg-white/5",
  },
}

export function EmptyState({ variant, onAction, searchQuery }: EmptyStateProps) {
  const config = variants[variant]
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
    >
      {/* Floating Bonk Logo Animation */}
      <motion.div
        animate={{
          y: [0, -10, 0],
          rotate: [-2, 2, -2],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="relative mb-6"
      >
        <div className={`w-20 h-20 rounded-2xl ${config.bgColor} flex items-center justify-center`}>
          <Icon className={`w-10 h-10 ${config.color}`} />
        </div>

        {/* Decorative particles */}
        <motion.div
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-bonk/30"
        />
        <motion.div
          animate={{ opacity: [0.5, 0.2, 0.5] }}
          transition={{ duration: 3, repeat: Infinity, delay: 0.5 }}
          className="absolute -bottom-1 -left-3 w-3 h-3 rounded-full bg-success/30"
        />
      </motion.div>

      {/* Title */}
      <h3 className="text-xl font-mono font-bold text-white mb-2">
        {config.title}
      </h3>

      {/* Description */}
      <p className="text-white/40 text-sm font-mono max-w-sm mb-6">
        {searchQuery && variant === "no-results"
          ? `No results for "${searchQuery}". ${config.description}`
          : config.description
        }
      </p>

      {/* Action Button */}
      {onAction && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onAction}
          className={`
            inline-flex items-center gap-2 px-6 py-3 rounded-xl font-mono text-sm font-bold
            transition-all border
            ${variant === "error" || variant === "offline"
              ? "bg-white/[0.04] border-white/[0.06] text-white hover:bg-white/[0.08]"
              : "bg-bonk text-black border-bonk hover:bg-bonk/90 glow-bonk"
            }
          `}
        >
          {(variant === "error" || variant === "offline") && (
            <RefreshCw className="w-4 h-4" />
          )}
          {config.actionLabel}
        </motion.button>
      )}

      {/* Branding */}
      <div className="mt-8 flex items-center gap-2 text-white/20">
        <Image
          src="/bonk-logo.png"
          alt="BONK"
          width={16}
          height={16}
          className="opacity-30"
          unoptimized
        />
        <span className="font-mono text-xs">BONKUSD1 DASHBOARD</span>
      </div>
    </motion.div>
  )
}
