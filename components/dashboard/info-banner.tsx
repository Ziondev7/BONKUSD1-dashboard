"use client"

import { motion, AnimatePresence } from "framer-motion"
import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from "lucide-react"
import type { BannerState } from "@/lib/types"

interface InfoBannerProps {
  banner: BannerState
  onDismiss?: () => void
}

export function InfoBanner({ banner, onDismiss }: InfoBannerProps) {
  const config = {
    success: {
      icon: CheckCircle,
      bg: "bg-success/10",
      border: "border-success/30",
      text: "text-success",
    },
    error: {
      icon: AlertCircle,
      bg: "bg-danger/10",
      border: "border-danger/30",
      text: "text-danger",
    },
    warning: {
      icon: AlertTriangle,
      bg: "bg-bonk/10",
      border: "border-bonk/30",
      text: "text-bonk",
    },
    info: {
      icon: Info,
      bg: "bg-white/5",
      border: "border-white/10",
      text: "text-white",
    },
  }[banner.type]

  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`${config.bg} ${config.border} border rounded-xl p-4 mb-6 flex items-start gap-3`}
    >
      <Icon className={`w-5 h-5 ${config.text} flex-shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <p className={`font-mono font-bold text-sm ${config.text}`}>{banner.title}</p>
        <p className="text-white/50 text-xs font-mono mt-1">{banner.message}</p>
      </div>
      {(banner.dismissible ?? true) && onDismiss && (
        <button
          onClick={onDismiss}
          className="p-1 hover:bg-white/10 rounded transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4 text-white/40" />
        </button>
      )}
    </motion.div>
  )
}
