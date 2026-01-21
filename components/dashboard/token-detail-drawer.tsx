"use client"

import { useState, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Copy,
  Check,
  Loader2,
  X,
  Clock,
  Droplets,
  BarChart3,
  DollarSign,
  Zap,
  Twitter,
  Globe,
  Send,
  Activity,
  Users,
  ArrowRightLeft,
} from "lucide-react"
import Image from "next/image"
import type { Token } from "@/lib/types"
import { formatNumber, formatPrice, formatAge, generateDeterministicChartData, cn } from "@/lib/utils"

// Holders Card Component
function HoldersCard({ token }: { token: Token }) {
  const holders = token.holders || 0

  // Determine style based on holder count
  const getHolderConfig = () => {
    if (holders >= 100) {
      return {
        bg: "bg-success/5",
        border: "border-success/30",
        text: "text-success",
        label: "STRONG DISTRIBUTION",
        description: "Token has a healthy number of holders",
      }
    }
    if (holders >= 20) {
      return {
        bg: "bg-bonk/5",
        border: "border-bonk/30",
        text: "text-bonk",
        label: "GROWING",
        description: "Token is building its holder base",
      }
    }
    return {
      bg: "bg-white/5",
      border: "border-white/10",
      text: "text-white/50",
      label: "EARLY STAGE",
      description: "Token has limited holder distribution",
    }
  }

  const config = getHolderConfig()

  return (
    <div className={cn("glass-card-solid p-4 border", config.border, config.bg)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className={cn("w-5 h-5", config.text)} />
          <span className={cn("font-mono text-sm font-bold", config.text)}>{config.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/30 font-mono text-xs">Holders</span>
          <span className={cn("font-mono font-bold text-lg", config.text)}>
            {holders > 0 ? holders : "—"}
          </span>
        </div>
      </div>

      <p className="text-white/40 text-xs font-mono">{config.description}</p>
    </div>
  )
}

interface TokenDetailDrawerProps {
  token: Token | null
  isOpen: boolean
  onClose: () => void
}

function TokenLogo({ token, size = "lg" }: { token: Token; size?: "lg" | "xl" }) {
  const [hasError, setHasError] = useState(false)
  const sizeClasses = size === "xl" ? "w-20 h-20" : "w-14 h-14"
  const textSize = size === "xl" ? "text-4xl" : "text-2xl"

  if (!token.imageUrl || hasError) {
    return (
      <div className={`${sizeClasses} rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center ${textSize}`}>
        {token.emoji}
      </div>
    )
  }

  return (
    <div className={`${sizeClasses} rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden relative`}>
      <Image
        src={token.imageUrl || "/placeholder.svg"}
        alt={token.name}
        fill
        className="object-cover"
        onError={() => setHasError(true)}
        unoptimized
      />
    </div>
  )
}

// Large chart for the drawer
function LargeChart({ token }: { token: Token }) {
  const chartData = useMemo(
    () => generateDeterministicChartData(token.address, token.change24h, 48),
    [token.address, token.change24h]
  )
  
  const isPositive = token.change24h >= 0
  const min = Math.min(...chartData)
  const max = Math.max(...chartData)
  const range = max - min || 1
  
  const width = 400
  const height = 120
  const padding = 4
  
  const points = chartData.map((value, i) => {
    const x = padding + (i / (chartData.length - 1)) * (width - padding * 2)
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')
  
  const fillPath = `M ${padding},${height - padding} L ${points} L ${width - padding},${height - padding} Z`
  
  const gradientId = `large-gradient-${token.address.slice(0, 8)}`
  const color = isPositive ? "#00FF88" : "#FF3B3B"
  
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width - padding}
        cy={height - padding - ((chartData[chartData.length - 1] - min) / range) * (height - padding * 2)}
        r="5"
        fill={color}
      >
        <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

export function TokenDetailDrawer({ token, isOpen, onClose }: TokenDetailDrawerProps) {
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [chartLoaded, setChartLoaded] = useState(false)

  const handleCopyAddress = useCallback(async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token.address)
      setCopiedAddress(true)
      setTimeout(() => setCopiedAddress(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }, [token])

  const handleClose = useCallback(() => {
    setChartLoaded(false)
    onClose()
  }, [onClose])

  if (!token) return null

  const isPositive = token.change24h >= 0
  const dexScreenerEmbedUrl = `https://dexscreener.com/solana/${encodeURIComponent(token.address)}?embed=1&theme=dark&trades=0&info=0`

  const stats = [
    { label: "Price", value: formatPrice(token.price), icon: DollarSign, color: "" },
    {
      label: "24h Change",
      value: `${isPositive ? "+" : ""}${token.change24h.toFixed(2)}%`,
      icon: isPositive ? TrendingUp : TrendingDown,
      color: isPositive ? "text-success" : "text-danger",
    },
    { label: "Liquidity", value: formatNumber(token.liquidity), icon: Droplets, color: "" },
    { label: "Market Cap", value: formatNumber(token.mcap), icon: BarChart3, color: "" },
    { label: "Volume 24h", value: formatNumber(token.volume24h), icon: Activity, color: "" },
    { label: "Age", value: formatAge(token.created), icon: Clock, color: "" },
    { label: "Txns 24h", value: token.txns24h.toLocaleString(), icon: ArrowRightLeft, color: "" },
    { label: "Buys/Sells", value: `${token.buys24h}/${token.sells24h}`, icon: Users, color: "" },
  ]

  const hasSocials = token.twitter || token.website || token.telegram

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[60]"
            onClick={handleClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 h-full w-full bg-[#030303] border-l border-white/[0.06] z-[70] flex"
          >
            {/* Left Panel - Chart */}
            <div className="flex-1 h-full border-r border-white/[0.06] flex flex-col">
              {!chartLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#030303] z-10">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-6 h-6 text-bonk animate-spin" />
                    <span className="text-white/30 font-mono text-xs">Loading chart...</span>
                  </div>
                </div>
              )}
              <iframe
                src={dexScreenerEmbedUrl}
                className="w-full h-full"
                title={`${token.symbol} Chart`}
                onLoad={() => setChartLoaded(true)}
                style={{ border: "none" }}
              />
            </div>

            {/* Right Panel - Token Details */}
            <div className="w-[440px] flex-shrink-0 flex flex-col h-full overflow-hidden">
              {/* Header */}
              <div className="flex-shrink-0 bg-[#0a0a0c] border-b border-white/[0.06] p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <TokenLogo token={token} size="xl" />
                    <div>
                      <h2 className="text-white font-mono font-bold text-2xl tracking-tight flex items-center gap-2">
                        ${token.symbol}
                      </h2>
                      <p className="text-white/40 font-mono text-sm">{token.name}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-white/30 text-xs font-mono">
                          {token.address.slice(0, 8)}...{token.address.slice(-6)}
                        </span>
                        <button
                          onClick={handleCopyAddress}
                          className="text-white/30 hover:text-bonk transition-colors"
                        >
                          {copiedAddress ? (
                            <Check className="w-3.5 h-3.5 text-success" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      
                      {/* Social Links */}
                      {hasSocials && (
                        <div className="flex items-center gap-2 mt-3">
                          {token.twitter && (
                            <a
                              href={token.twitter}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 bg-white/[0.04] hover:bg-[#1DA1F2]/20 border border-white/[0.06] hover:border-[#1DA1F2]/50 rounded-lg transition-all group"
                              title="Twitter/X"
                            >
                              <Twitter className="w-4 h-4 text-white/40 group-hover:text-[#1DA1F2]" />
                            </a>
                          )}
                          {token.telegram && (
                            <a
                              href={token.telegram}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 bg-white/[0.04] hover:bg-[#0088cc]/20 border border-white/[0.06] hover:border-[#0088cc]/50 rounded-lg transition-all group"
                              title="Telegram"
                            >
                              <Send className="w-4 h-4 text-white/40 group-hover:text-[#0088cc]" />
                            </a>
                          )}
                          {token.website && (
                            <a
                              href={token.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 bg-white/[0.04] hover:bg-bonk/20 border border-white/[0.06] hover:border-bonk/50 rounded-lg transition-all group"
                              title="Website"
                            >
                              <Globe className="w-4 h-4 text-white/40 group-hover:text-bonk" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Close button */}
                  <motion.button
                    onClick={handleClose}
                    whileHover={{ scale: 1.1, rotate: 90 }}
                    whileTap={{ scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    className="p-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-xl transition-colors"
                  >
                    <X className="w-5 h-5 text-white/50" />
                  </motion.button>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
                {/* Holders Card */}
                <HoldersCard token={token} />

                {/* Mini Chart */}
                <div className="glass-card-solid p-4">
                  <p className="text-white/30 font-mono text-[10px] uppercase tracking-[0.15em] mb-3">
                    PRICE CHART (24H)
                  </p>
                  <LargeChart token={token} />
                </div>

                {/* Stats Grid */}
                <div>
                  <p className="text-white/30 font-mono text-[10px] uppercase tracking-[0.15em] mb-3">
                    TOKEN STATS
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {stats.map((stat, i) => (
                      <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="glass-card-solid p-3 hover:bg-white/[0.04] transition-colors"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <stat.icon className={`w-3 h-3 ${stat.color || "text-white/30"}`} />
                          <p className="text-white/30 font-mono text-[9px] uppercase tracking-wider">
                            {stat.label}
                          </p>
                        </div>
                        <p className={`font-mono font-bold text-sm ${stat.color || "text-white"}`}>
                          {stat.value}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 pt-2 pb-6">
                  <a
                    href={`https://trojan.com/@Vladgz?token=${token.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      className="w-full bg-bonk hover:bg-bonk/90 text-black font-mono font-bold py-4 px-5 rounded-xl text-sm flex items-center justify-center gap-3 glow-bonk transition-all"
                    >
                      TRADE ON TROJAN
                      <Image src="/trojan-horse.png" alt="Trojan" width={20} height={20} unoptimized />
                    </motion.button>
                  </a>

                  <a href={token.url} target="_blank" rel="noopener noreferrer" className="block">
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      className="w-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white font-mono font-bold py-3 px-5 rounded-xl text-sm flex items-center justify-center gap-2 transition-all"
                    >
                      VIEW ON DEXSCREENER
                      <ExternalLink className="w-4 h-4" />
                    </motion.button>
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
