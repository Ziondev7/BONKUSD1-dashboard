"use client"

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { toPng } from "html-to-image"
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
  Twitter,
  Globe,
  Send,
  Activity,
  Users,
  ArrowRightLeft,
  Shuffle,
  Share2,
} from "lucide-react"
import Image from "next/image"
import type { Token } from "@/lib/types"
import { formatNumber, formatPrice, formatAge, generateDeterministicChartData, cn } from "@/lib/utils"

// Type definitions for share card styles
interface LogoConfig {
  size: number
  position: string
  animation: string
  opacity: number
  delay?: string
  transformOrigin?: string
  centered?: boolean
}

interface ShareCardStyle {
  id: string
  name: string
  logos: LogoConfig[]
  cardStyle?: string
  neonText?: boolean
}

// Animation style configurations for the share card (50 styles)
const SHARE_CARD_STYLES: ShareCardStyle[] = [
  // 1-10: Classic animations
  { id: "floating-dreams", name: "Floating Dreams", logos: [
    { size: 80, position: "right-5 top-5", animation: "share-anim-float", opacity: 0.15 },
    { size: 60, position: "left-8 bottom-10", animation: "share-anim-float-alt", opacity: 0.12 },
    { size: 50, position: "right-[40%] top-[40%]", animation: "share-anim-float", delay: "1s", opacity: 0.1 },
  ]},
  { id: "heartbeat", name: "Heartbeat Pulse", logos: [
    { size: 150, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-heartbeat", opacity: 0.15 },
  ]},
  { id: "neon-glow", name: "Neon Glow", logos: [
    { size: 130, position: "right-8 top-1/2 -translate-y-1/2", animation: "share-anim-neon", opacity: 0.3 },
  ], cardStyle: "bg-gradient-to-br from-[#0a0510] to-[#0F0B18]", neonText: true },
  { id: "bouncing-party", name: "Bouncing Party", logos: [
    { size: 40, position: "left-[10%] bottom-8", animation: "share-anim-bounce", opacity: 0.12 },
    { size: 50, position: "left-[25%] bottom-8", animation: "share-anim-bounce", delay: "0.1s", opacity: 0.15 },
    { size: 45, position: "left-[40%] bottom-8", animation: "share-anim-bounce", delay: "0.2s", opacity: 0.13 },
    { size: 55, position: "left-[55%] bottom-8", animation: "share-anim-bounce", delay: "0.3s", opacity: 0.17 },
    { size: 42, position: "left-[70%] bottom-8", animation: "share-anim-bounce", delay: "0.4s", opacity: 0.14 },
  ]},
  { id: "disco-mode", name: "Disco Mode", logos: [
    { size: 120, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-disco", opacity: 0.2 },
    { size: 60, position: "right-5 top-5", animation: "share-anim-disco", delay: "0.5s", opacity: 0.15 },
    { size: 50, position: "left-5 bottom-10", animation: "share-anim-disco", delay: "1s", opacity: 0.12 },
  ]},
  { id: "ripple-effect", name: "Ripple Effect", logos: [
    { size: 80, position: "left-1/2 top-1/2", animation: "share-anim-ripple", opacity: 0.2, centered: true },
    { size: 80, position: "left-1/2 top-1/2", animation: "share-anim-ripple", delay: "0.5s", opacity: 0.2, centered: true },
    { size: 80, position: "left-1/2 top-1/2", animation: "share-anim-ripple", delay: "1s", opacity: 0.2, centered: true },
    { size: 60, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "", opacity: 0.2 },
  ]},
  { id: "swing-dance", name: "Swing Dance", logos: [
    { size: 100, position: "right-8 top-3", animation: "share-anim-swing", opacity: 0.15, transformOrigin: "top center" },
    { size: 70, position: "left-5 top-8", animation: "share-anim-swing", delay: "0.5s", opacity: 0.12, transformOrigin: "top center" },
  ]},
  { id: "meteor-shower", name: "Meteor Shower", logos: [
    { size: 40, position: "left-[20%] top-0", animation: "share-anim-meteor", opacity: 0.15 },
    { size: 35, position: "left-[50%] top-0", animation: "share-anim-meteor", delay: "1s", opacity: 0.12 },
    { size: 45, position: "left-[70%] top-0", animation: "share-anim-meteor", delay: "2s", opacity: 0.18 },
  ]},
  { id: "breathing-zen", name: "Breathing Zen", logos: [
    { size: 180, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-breathe", opacity: 0.1 },
  ]},
  { id: "shake-it", name: "Shake It", logos: [
    { size: 100, position: "right-8 bottom-10", animation: "share-anim-shake", opacity: 0.18 },
    { size: 60, position: "left-10 top-8", animation: "share-anim-shake", delay: "0.1s", opacity: 0.12 },
  ]},
  // 11-20: Fun animations
  { id: "slow-spin", name: "Slow Spin", logos: [
    { size: 140, position: "left-1/2 top-1/2", animation: "share-anim-spin-slow", opacity: 0.12, centered: true },
  ]},
  { id: "pulse-glow", name: "Pulse Glow", logos: [
    { size: 130, position: "right-5 bottom-8", animation: "share-anim-pulse-glow", opacity: 0.2 },
  ]},
  { id: "wobble", name: "Wobble", logos: [
    { size: 120, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-wobble", opacity: 0.15 },
  ]},
  { id: "zoom-pulse", name: "Zoom Pulse", logos: [
    { size: 100, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-zoom-pulse", opacity: 0.15 },
  ]},
  { id: "slide-horizontal", name: "Slide Horizontal", logos: [
    { size: 80, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-slide-lr", opacity: 0.15 },
    { size: 60, position: "right-10 top-10", animation: "share-anim-slide-lr", delay: "0.5s", opacity: 0.1 },
  ]},
  { id: "slide-vertical", name: "Slide Vertical", logos: [
    { size: 90, position: "right-10 top-1/2 -translate-y-1/2", animation: "share-anim-slide-ud", opacity: 0.15 },
    { size: 70, position: "left-10 top-1/2 -translate-y-1/2", animation: "share-anim-slide-ud", delay: "0.3s", opacity: 0.12 },
  ]},
  { id: "rotate-bounce", name: "Rotate Bounce", logos: [
    { size: 100, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-rotate-bounce", opacity: 0.15 },
  ]},
  { id: "flicker", name: "Flicker", logos: [
    { size: 150, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-flicker", opacity: 0.25 },
  ]},
  { id: "pop", name: "Pop", logos: [
    { size: 80, position: "right-10 bottom-10", animation: "share-anim-pop", opacity: 0.18 },
    { size: 60, position: "left-10 top-10", animation: "share-anim-pop", delay: "0.3s", opacity: 0.15 },
    { size: 50, position: "right-[30%] top-5", animation: "share-anim-pop", delay: "0.6s", opacity: 0.12 },
  ]},
  { id: "jello", name: "Jello", logos: [
    { size: 130, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-jello", opacity: 0.15 },
  ]},
  // 21-30: Energetic animations
  { id: "rubber", name: "Rubber Band", logos: [
    { size: 110, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-rubber", opacity: 0.15 },
  ]},
  { id: "tada", name: "Tada", logos: [
    { size: 100, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-tada", opacity: 0.18 },
  ]},
  { id: "swing-reverse", name: "Swing Reverse", logos: [
    { size: 90, position: "left-1/2 top-5", animation: "share-anim-swing-reverse", opacity: 0.15, transformOrigin: "top center" },
  ]},
  { id: "float-diagonal", name: "Float Diagonal", logos: [
    { size: 80, position: "left-[30%] top-[30%]", animation: "share-anim-float-diagonal", opacity: 0.15 },
    { size: 60, position: "right-[20%] bottom-[20%]", animation: "share-anim-float-diagonal", delay: "0.5s", opacity: 0.12 },
  ]},
  { id: "spiral", name: "Spiral", logos: [
    { size: 70, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-spiral", opacity: 0.15 },
  ]},
  { id: "wave", name: "Wave", logos: [
    { size: 50, position: "left-[15%] bottom-10", animation: "share-anim-wave", opacity: 0.12 },
    { size: 60, position: "left-[35%] bottom-10", animation: "share-anim-wave", delay: "0.2s", opacity: 0.14 },
    { size: 55, position: "left-[55%] bottom-10", animation: "share-anim-wave", delay: "0.4s", opacity: 0.13 },
    { size: 50, position: "left-[75%] bottom-10", animation: "share-anim-wave", delay: "0.6s", opacity: 0.12 },
  ]},
  { id: "twinkle", name: "Twinkle Stars", logos: [
    { size: 40, position: "right-10 top-10", animation: "share-anim-twinkle", opacity: 0.2 },
    { size: 35, position: "left-[20%] top-[30%]", animation: "share-anim-twinkle", delay: "0.3s", opacity: 0.18 },
    { size: 45, position: "right-[30%] bottom-[25%]", animation: "share-anim-twinkle", delay: "0.6s", opacity: 0.22 },
    { size: 30, position: "left-10 bottom-10", animation: "share-anim-twinkle", delay: "0.9s", opacity: 0.15 },
  ]},
  { id: "glitch", name: "Glitch", logos: [
    { size: 130, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-glitch", opacity: 0.2 },
  ], cardStyle: "bg-gradient-to-br from-[#0a0510] to-[#0F0B18]" },
  { id: "flip-x", name: "Flip X", logos: [
    { size: 100, position: "right-10 top-1/2 -translate-y-1/2", animation: "share-anim-flip-x", opacity: 0.15 },
  ]},
  { id: "flip-y", name: "Flip Y", logos: [
    { size: 100, position: "right-10 top-1/2 -translate-y-1/2", animation: "share-anim-flip-y", opacity: 0.15 },
  ]},
  // 31-40: Smooth animations
  { id: "blur-pulse", name: "Blur Pulse", logos: [
    { size: 150, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-blur", opacity: 0.2 },
  ]},
  { id: "grow-shrink", name: "Grow Shrink", logos: [
    { size: 100, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-grow-shrink", opacity: 0.15 },
  ]},
  { id: "roll", name: "Rolling", logos: [
    { size: 60, position: "left-0 top-1/2 -translate-y-1/2", animation: "share-anim-roll", opacity: 0.15 },
  ]},
  { id: "squeeze", name: "Squeeze", logos: [
    { size: 120, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-squeeze", opacity: 0.15 },
  ]},
  { id: "levitate", name: "Levitate", logos: [
    { size: 100, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-levitate", opacity: 0.18 },
  ]},
  { id: "pendulum", name: "Pendulum", logos: [
    { size: 80, position: "left-1/2 top-0", animation: "share-anim-pendulum", opacity: 0.15, transformOrigin: "top center" },
  ]},
  { id: "sway", name: "Sway", logos: [
    { size: 90, position: "right-10 top-1/2 -translate-y-1/2", animation: "share-anim-sway", opacity: 0.15 },
    { size: 70, position: "left-10 top-1/2 -translate-y-1/2", animation: "share-anim-sway", delay: "0.5s", opacity: 0.12 },
  ]},
  { id: "vibrate", name: "Vibrate", logos: [
    { size: 120, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-vibrate", opacity: 0.15 },
  ]},
  { id: "flash", name: "Flash", logos: [
    { size: 140, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-flash", opacity: 0.2 },
  ]},
  { id: "ping", name: "Ping", logos: [
    { size: 60, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-ping", opacity: 0.3 },
    { size: 60, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-ping", delay: "0.5s", opacity: 0.3 },
    { size: 80, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "", opacity: 0.15 },
  ]},
  // 41-50: Complex/combo animations
  { id: "drift", name: "Drift", logos: [
    { size: 100, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-drift", opacity: 0.15 },
  ]},
  { id: "zigzag", name: "Zigzag", logos: [
    { size: 70, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-zigzag", opacity: 0.15 },
  ]},
  { id: "heartbeat-fast", name: "Heartbeat Fast", logos: [
    { size: 120, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-heartbeat-fast", opacity: 0.18 },
  ]},
  { id: "elastic", name: "Elastic", logos: [
    { size: 100, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "share-anim-elastic", opacity: 0.15 },
  ]},
  { id: "orbit-system", name: "Orbit System", logos: [
    { size: 50, position: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", animation: "", opacity: 0.2 },
    { size: 35, position: "left-1/2 top-1/2", animation: "share-anim-orbit", opacity: 0.15, centered: true },
    { size: 30, position: "left-1/2 top-1/2", animation: "share-anim-orbit-reverse", opacity: 0.12, centered: true },
  ]},
  { id: "matrix-rain", name: "Matrix Rain", logos: [
    { size: 30, position: "left-[10%] top-0", animation: "share-anim-meteor", opacity: 0.12 },
    { size: 30, position: "left-[25%] top-0", animation: "share-anim-meteor", delay: "0.3s", opacity: 0.12 },
    { size: 30, position: "left-[40%] top-0", animation: "share-anim-meteor", delay: "0.6s", opacity: 0.12 },
    { size: 30, position: "left-[55%] top-0", animation: "share-anim-meteor", delay: "0.9s", opacity: 0.12 },
    { size: 30, position: "left-[70%] top-0", animation: "share-anim-meteor", delay: "1.2s", opacity: 0.12 },
    { size: 30, position: "left-[85%] top-0", animation: "share-anim-meteor", delay: "1.5s", opacity: 0.12 },
  ]},
  { id: "corner-bounce", name: "Corner Bounce", logos: [
    { size: 50, position: "left-5 top-5", animation: "share-anim-bounce", opacity: 0.12 },
    { size: 50, position: "right-5 top-5", animation: "share-anim-bounce", delay: "0.2s", opacity: 0.12 },
    { size: 50, position: "left-5 bottom-10", animation: "share-anim-bounce", delay: "0.4s", opacity: 0.12 },
    { size: 50, position: "right-5 bottom-10", animation: "share-anim-bounce", delay: "0.6s", opacity: 0.12 },
  ]},
  { id: "scattered-float", name: "Scattered Float", logos: [
    { size: 40, position: "left-[15%] top-[20%]", animation: "share-anim-float", opacity: 0.1 },
    { size: 50, position: "right-[20%] top-[30%]", animation: "share-anim-float-alt", delay: "0.5s", opacity: 0.12 },
    { size: 35, position: "left-[40%] bottom-[15%]", animation: "share-anim-float", delay: "1s", opacity: 0.08 },
    { size: 45, position: "right-[15%] bottom-[25%]", animation: "share-anim-float-alt", delay: "1.5s", opacity: 0.11 },
  ]},
  { id: "spotlight", name: "Spotlight", logos: [
    { size: 140, position: "right-0 top-1/2 -translate-y-1/2", animation: "share-anim-pulse-glow", opacity: 0.25 },
  ], cardStyle: "bg-[radial-gradient(ellipse_at_70%_50%,rgba(168,85,247,0.15)_0%,#0F0B18_50%)]" },
  { id: "chaos", name: "Chaos", logos: [
    { size: 60, position: "left-[20%] top-[20%]", animation: "share-anim-shake", opacity: 0.12 },
    { size: 50, position: "right-[25%] top-[35%]", animation: "share-anim-wobble", delay: "0.2s", opacity: 0.1 },
    { size: 70, position: "left-[45%] bottom-[20%]", animation: "share-anim-jello", delay: "0.4s", opacity: 0.14 },
    { size: 45, position: "right-[15%] bottom-[30%]", animation: "share-anim-rubber", delay: "0.6s", opacity: 0.11 },
  ]},
]

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

// Large chart for the drawer with grid lines and axis labels
function LargeChart({ token }: { token: Token }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const chartData = useMemo(
    () => generateDeterministicChartData(token.address, token.change24h, 72),
    [token.address, token.change24h]
  )

  const isPositive = token.change24h >= 0
  const min = Math.min(...chartData)
  const max = Math.max(...chartData)
  const range = max - min || 1

  const width = 400
  const height = 140
  const paddingLeft = 40
  const paddingRight = 8
  const paddingTop = 12
  const paddingBottom = 24
  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  const pointsArray = chartData.map((value, i) => ({
    x: paddingLeft + (i / (chartData.length - 1)) * chartWidth,
    y: paddingTop + chartHeight - ((value - min) / range) * chartHeight,
    value,
  }))

  const pathString = pointsArray.map(p => `${p.x},${p.y}`).join(' ')
  const fillPath = `M ${paddingLeft},${paddingTop + chartHeight} L ${pathString} L ${paddingLeft + chartWidth},${paddingTop + chartHeight} Z`

  const gradientId = `large-gradient-${token.address.slice(0, 8)}`
  const color = isPositive ? "#00FF88" : "#FF3B3B"

  // Grid lines (4 horizontal lines)
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: paddingTop + chartHeight * (1 - ratio),
    value: min + range * ratio,
  }))

  // Time labels
  const timeLabels = ['24h', '18h', '12h', '6h', 'Now']

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-36"
        preserveAspectRatio="none"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {gridLines.map((line, i) => (
          <g key={i}>
            <line
              x1={paddingLeft}
              y1={line.y}
              x2={width - paddingRight}
              y2={line.y}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="2,4"
            />
            {/* Y-axis labels */}
            <text
              x={paddingLeft - 4}
              y={line.y + 3}
              textAnchor="end"
              className="fill-white/30 text-[8px] font-mono"
            >
              {((line.value - 100) >= 0 ? '+' : '')}{(line.value - 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {timeLabels.map((label, i) => (
          <text
            key={i}
            x={paddingLeft + (i / (timeLabels.length - 1)) * chartWidth}
            y={height - 4}
            textAnchor="middle"
            className="fill-white/30 text-[8px] font-mono"
          >
            {label}
          </text>
        ))}

        {/* Area fill */}
        <path d={fillPath} fill={`url(#${gradientId})`}>
          <animate attributeName="opacity" values="0.8;1;0.8" dur="3s" repeatCount="indefinite" />
        </path>

        {/* Main line */}
        <polyline
          points={pathString}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Interactive hover areas */}
        {pointsArray.map((point, i) => (
          <rect
            key={i}
            x={point.x - chartWidth / chartData.length / 2}
            y={paddingTop}
            width={chartWidth / chartData.length}
            height={chartHeight}
            fill="transparent"
            onMouseEnter={() => setHoveredIndex(i)}
            className="cursor-crosshair"
          />
        ))}

        {/* Hover indicator */}
        {hoveredIndex !== null && (
          <>
            <line
              x1={pointsArray[hoveredIndex].x}
              y1={paddingTop}
              x2={pointsArray[hoveredIndex].x}
              y2={paddingTop + chartHeight}
              stroke={color}
              strokeWidth="1"
              strokeDasharray="3,3"
              opacity="0.5"
            />
            <circle
              cx={pointsArray[hoveredIndex].x}
              cy={pointsArray[hoveredIndex].y}
              r="5"
              fill={color}
              stroke="#030303"
              strokeWidth="2"
            />
          </>
        )}

        {/* End point indicator */}
        <circle
          cx={pointsArray[pointsArray.length - 1].x}
          cy={pointsArray[pointsArray.length - 1].y}
          r="5"
          fill={color}
        >
          <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>

      {/* Hover tooltip */}
      {hoveredIndex !== null && (
        <div
          className="absolute top-0 bg-[#0a0a0c] border border-white/10 px-3 py-1.5 rounded-lg text-xs font-mono text-white whitespace-nowrap z-50 pointer-events-none shadow-lg"
          style={{
            left: `${(pointsArray[hoveredIndex].x / width) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <span className={isPositive ? 'text-success' : 'text-danger'}>
            {((pointsArray[hoveredIndex].value - 100) >= 0 ? '+' : '')}
            {(pointsArray[hoveredIndex].value - 100).toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  )
}

// Helper function to convert image URL to data URL via server proxy
async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    // Use our server-side proxy to avoid CORS issues
    const response = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`)
    if (!response.ok) throw new Error('Proxy fetch failed')
    const data = await response.json()
    return data.dataUrl || null
  } catch (error) {
    console.error('Failed to load image via proxy:', error)
    return null
  }
}

// Share Card Component with random animation styles
function ShareCard({ token, onShuffle, styleIndex }: { token: Token; onShuffle: () => void; styleIndex: number }) {
  const style = SHARE_CARD_STYLES[styleIndex]
  const isPositive = token.change24h >= 0
  const [isGeneratingGif, setIsGeneratingGif] = useState(false)
  const [gifProgress, setGifProgress] = useState(0)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Pre-load token image as data URL to avoid CORS issues
  useEffect(() => {
    if (token.imageUrl) {
      setLogoDataUrl(null) // Reset on token change
      imageUrlToDataUrl(token.imageUrl).then(dataUrl => {
        setLogoDataUrl(dataUrl)
      })
    }
  }, [token.imageUrl])

  // Generate GIF from the animated card
  const handleGenerateGif = useCallback(async () => {
    if (!cardRef.current || isGeneratingGif) return

    setIsGeneratingGif(true)
    setGifProgress(0)

    try {
      const frames: string[] = []
      const frameCount = 36 // More frames for smoother animation
      const frameDuration = 100 // 100ms between frames = ~3.6 second animation cycle

      // Capture frames at high quality
      for (let i = 0; i < frameCount; i++) {
        setGifProgress(Math.round((i / frameCount) * 50)) // First 50% is capturing

        try {
          const dataUrl = await toPng(cardRef.current, {
            quality: 1.0,
            pixelRatio: 2.5, // Higher resolution capture
            backgroundColor: '#0F0B18',
            cacheBust: true,
          })
          frames.push(dataUrl)
        } catch (frameError) {
          console.warn('Frame capture error:', frameError)
          // Continue with next frame
        }

        // Wait for next frame
        await new Promise(resolve => setTimeout(resolve, frameDuration))
      }

      if (frames.length < 5) {
        throw new Error('Not enough frames captured')
      }

      setGifProgress(60) // Start GIF creation

      // Dynamically import gifshot (browser-only library)
      const gifshot = await import('gifshot')

      // Create high-quality GIF using gifshot
      gifshot.createGIF({
        images: frames,
        gifWidth: 800, // Larger dimensions for better quality
        gifHeight: 504, // Maintain 1.586 aspect ratio
        interval: 0.1, // 100ms per frame
        numFrames: frames.length,
        frameDuration: 1,
        sampleInterval: 1, // Sample every pixel for best color accuracy
        numWorkers: 4, // More workers for faster processing
        progressCallback: (progress: number) => {
          setGifProgress(60 + Math.round(progress * 40)) // Last 40% is encoding
        },
      }, (obj: { error: boolean; image: string; errorMsg?: string }) => {
        if (!obj.error) {
          // Create download link
          const link = document.createElement('a')
          link.href = obj.image
          link.download = `${token.symbol}-share-card.gif`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)

          // Also open Twitter share with the GIF
          const tweetText = `Check out $${token.symbol}! 🚀

💰 ${formatPrice(token.price)}
📈 ${isPositive ? "+" : ""}${token.change24h.toFixed(2)}%
💎 MCap: ${formatNumber(token.mcap)}

@bonkusd1 #crypto #solana`

          window.open(
            `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`,
            "_blank"
          )
        } else {
          console.error('GIF creation failed:', obj.errorMsg)
          alert('Failed to create GIF. Please try again.')
        }

        setIsGeneratingGif(false)
        setGifProgress(0)
      })
    } catch (error) {
      console.error('Error generating GIF:', error)
      setIsGeneratingGif(false)
      setGifProgress(0)
      alert('Failed to generate GIF. Please try again.')
    }
  }, [token, isPositive, isGeneratingGif])

  // Generate chart data for mini sparkline
  const chartData = useMemo(
    () => generateDeterministicChartData(token.address, token.change24h, 24),
    [token.address, token.change24h]
  )

  const min = Math.min(...chartData)
  const max = Math.max(...chartData)
  const range = max - min || 1

  const pathPoints = chartData
    .map((value, i) => {
      const x = (i / (chartData.length - 1)) * 320
      const y = 50 - ((value - min) / range) * 45
      return `${x},${y}`
    })
    .join(" ")

  const areaPath = `M 0,50 L ${pathPoints} L 320,50 Z`

  const handleShareToX = () => {
    const tweetText = `Check out $${token.symbol} on @bonkusd1!

💰 Price: ${formatPrice(token.price)}
📈 24h: ${isPositive ? "+" : ""}${token.change24h.toFixed(2)}%
💎 MCap: ${formatNumber(token.mcap)}
💧 Volume: ${formatNumber(token.volume24h)}

Trade now on bonkusd1.fun 🚀`

    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`
    window.open(tweetUrl, "_blank")
  }

  return (
    <div className="space-y-3">
      {/* Share Card */}
      <div
        ref={cardRef}
        className={cn(
          "relative overflow-hidden rounded-[4px_16px_4px_16px] border border-[rgba(168,85,247,0.5)]",
          "share-card-base share-card-shimmer",
          style.cardStyle || "bg-gradient-to-br from-[#1a1428] via-[#0F0B18] to-[#1a1020]"
        )}
        style={{ aspectRatio: "1.586" }}
      >
        {/* Animated Background Logos */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {style.logos.map((logo, i) => (
            <div
              key={i}
              className={cn("absolute", logo.position, logo.animation)}
              style={{
                width: logo.size,
                height: logo.size,
                opacity: logo.opacity,
                animationDelay: logo.delay || "0s",
                transformOrigin: logo.transformOrigin || "center",
              }}
            >
              {/* Use pre-loaded data URL for GIF compatibility */}
              {logoDataUrl ? (
                <img
                  src={logoDataUrl}
                  alt=""
                  className="w-full h-full object-contain"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center rounded-full bg-gradient-to-br from-[#A855F7]/20 to-[#EC4899]/20"
                  style={{ fontSize: logo.size * 0.6 }}
                >
                  {token.emoji || token.symbol.charAt(0)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Card Content */}
        <div className="relative z-10 h-full flex flex-col p-5">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-[2px_8px_2px_8px] bg-gradient-to-br from-[#A855F7]/30 to-[#EC4899]/30 border-2 border-[rgba(168,85,247,0.5)] overflow-hidden flex items-center justify-center">
                {/* Use pre-loaded data URL for GIF compatibility */}
                {logoDataUrl ? (
                  <img src={logoDataUrl} alt={token.symbol} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl">{token.emoji || token.symbol.charAt(0)}</span>
                )}
              </div>
              <div>
                <div className={cn("font-bold text-lg", style.neonText && "drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]")}>
                  {token.name}
                </div>
                <div className="text-white/50 font-mono text-xs">${token.symbol}</div>
              </div>
            </div>
            <div className="text-right">
              <div className={cn("font-mono font-bold text-xl", style.neonText && "drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]")}>
                {formatPrice(token.price)}
              </div>
              <div className={cn("font-semibold text-sm", isPositive ? "text-success" : "text-danger")}>
                {isPositive ? "+" : ""}{token.change24h.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div className="flex gap-5 mt-3">
            <div>
              <div className="text-[10px] text-white/50 uppercase tracking-wider">MCap</div>
              <div className="font-mono font-semibold text-sm">{formatNumber(token.mcap)}</div>
            </div>
            <div>
              <div className="text-[10px] text-white/50 uppercase tracking-wider">Volume</div>
              <div className="font-mono font-semibold text-sm">{formatNumber(token.volume24h)}</div>
            </div>
          </div>

          {/* Mini Chart */}
          <div className="flex-1 mt-2 mb-2">
            <svg viewBox="0 0 320 50" className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="shareChartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={isPositive ? "#22c55e" : "#ef4444"} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={isPositive ? "#22c55e" : "#ef4444"} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill="url(#shareChartGradient)" />
              <polyline
                points={pathPoints}
                fill="none"
                stroke={isPositive ? "#22c55e" : "#ef4444"}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: `drop-shadow(0 0 6px ${isPositive ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)"})` }}
              />
              <circle
                cx="320"
                cy={50 - ((chartData[chartData.length - 1] - min) / range) * 45}
                r="4"
                fill={isPositive ? "#22c55e" : "#ef4444"}
                style={{ filter: `drop-shadow(0 0 8px ${isPositive ? "rgba(34,197,94,0.8)" : "rgba(239,68,68,0.8)"})` }}
              />
            </svg>
          </div>

          {/* Footer */}
          <div className="flex justify-between items-end">
            <div className="text-[11px] text-white/40 font-mono">24h Chart</div>
            <div className="flex items-center gap-2 text-white/60 text-xs">
              <div className="w-5 h-5 rounded bg-gradient-to-br from-[#A855F7] to-[#EC4899] flex items-center justify-center text-[10px] font-bold">
                B
              </div>
              bonkusd1.fun
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleShareToX}
          className="flex-1 bg-[#1d9bf0] hover:bg-[#1a8cd8] text-white font-semibold py-3 px-4 rounded-[2px_8px_2px_8px] flex items-center justify-center gap-2 transition-all"
        >
          <Twitter className="w-4 h-4" />
          Share Text
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleGenerateGif}
          disabled={isGeneratingGif}
          className={cn(
            "flex-1 bg-gradient-to-r from-[#A855F7] to-[#EC4899] text-white font-semibold py-3 px-4 rounded-[2px_8px_2px_8px] flex items-center justify-center gap-2 transition-all",
            isGeneratingGif && "opacity-70 cursor-not-allowed"
          )}
        >
          {isGeneratingGif ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {gifProgress}%
            </>
          ) : (
            <>
              <Share2 className="w-4 h-4" />
              Share GIF
            </>
          )}
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05, rotate: 180 }}
          whileTap={{ scale: 0.95 }}
          onClick={onShuffle}
          disabled={isGeneratingGif}
          className="p-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] rounded-[2px_8px_2px_8px] transition-all disabled:opacity-50"
          title={`Shuffle Style (${styleIndex + 1}/${SHARE_CARD_STYLES.length})`}
        >
          <Shuffle className="w-5 h-5 text-white/60" />
        </motion.button>
      </div>

      {/* Style indicator */}
      <div className="text-center text-white/30 text-[10px] font-mono">
        Style: {style.name} ({styleIndex + 1}/{SHARE_CARD_STYLES.length})
      </div>
    </div>
  )
}

export function TokenDetailDrawer({ token, isOpen, onClose }: TokenDetailDrawerProps) {
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [chartLoaded, setChartLoaded] = useState(false)
  const [shareCardStyleIndex, setShareCardStyleIndex] = useState(0)

  // Generate random style on mount/token change
  useEffect(() => {
    if (isOpen && token) {
      setShareCardStyleIndex(Math.floor(Math.random() * SHARE_CARD_STYLES.length))
    }
  }, [isOpen, token])

  const handleShuffleStyle = useCallback(() => {
    setShareCardStyleIndex((prev) => (prev + 1) % SHARE_CARD_STYLES.length)
  }, [])

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
    { label: "Holders", value: token.holders ? token.holders.toLocaleString() : "—", icon: Users, color: "" },
    { label: "Age", value: formatAge(token.created), icon: Clock, color: "" },
    { label: "Txns 24h", value: token.txns24h.toLocaleString(), icon: ArrowRightLeft, color: "" },
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
                {/* Share Card */}
                <div>
                  <p className="text-white/30 font-mono text-[10px] uppercase tracking-[0.15em] mb-3">
                    SHAREABLE CARD
                  </p>
                  <ShareCard
                    token={token}
                    onShuffle={handleShuffleStyle}
                    styleIndex={shareCardStyleIndex}
                  />
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
