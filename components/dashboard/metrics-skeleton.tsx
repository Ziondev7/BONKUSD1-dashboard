"use client"

import { motion } from "framer-motion"

export function MetricsSkeleton() {
  const cards = [0, 1, 2, 3]

  return (
    <div className="space-y-6 mb-14">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {cards.map((index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="glass-card-solid p-6"
          >
            {/* Header with icon placeholder */}
            <div className="flex items-center gap-2.5 mb-3">
              <div className="skeleton-premium w-8 h-8 rounded-lg" style={{ animationDelay: `${index * 100}ms` }} />
              <div className="skeleton-premium h-3 w-20 rounded" style={{ animationDelay: `${index * 100 + 50}ms` }} />
            </div>

            {/* Main value */}
            <div className="skeleton-premium h-8 w-28 rounded mb-2" style={{ animationDelay: `${index * 100 + 100}ms` }} />

            {/* Sub value */}
            <div className="skeleton-premium h-3 w-24 rounded" style={{ animationDelay: `${index * 100 + 150}ms` }} />
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// Individual metric card skeleton for inline use
export function MetricCardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className="glass-card-solid p-6">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="skeleton-premium w-8 h-8 rounded-lg" style={{ animationDelay: `${delay}ms` }} />
        <div className="skeleton-premium h-3 w-20 rounded" style={{ animationDelay: `${delay + 50}ms` }} />
      </div>
      <div className="skeleton-premium h-8 w-28 rounded mb-2" style={{ animationDelay: `${delay + 100}ms` }} />
      <div className="skeleton-premium h-3 w-24 rounded" style={{ animationDelay: `${delay + 150}ms` }} />
    </div>
  )
}

// Pulse variant for avatar/logo placeholders
export function AvatarSkeleton({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-14 h-14",
  }

  return (
    <div className={`${sizeClasses[size]} skeleton-pulse rounded-xl`} />
  )
}
