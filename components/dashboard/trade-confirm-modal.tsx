"use client"

import { motion, AnimatePresence } from "framer-motion"
import { ExternalLink, AlertTriangle, X, Copy, Check } from "lucide-react"
import Image from "next/image"
import { useState, useCallback } from "react"
import type { Token } from "@/lib/types"
import { cn } from "@/lib/utils"

interface TradeConfirmModalProps {
  token: Token | null
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}

export function TradeConfirmModal({ token, isOpen, onClose, onConfirm }: TradeConfirmModalProps) {
  const [copied, setCopied] = useState(false)

  const handleCopyAddress = useCallback(async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }, [token])

  const handleConfirm = useCallback(() => {
    onConfirm()
    onClose()
  }, [onConfirm, onClose])

  if (!token) return null

  const tradeUrl = `https://trojan.com/@Vladgz?token=${token.address}`

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
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[80]"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-[85]"
          >
            <div className="glass-card-solid border border-white/10 rounded-2xl overflow-hidden mx-4">
              {/* Header */}
              <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-bonk/10">
                    <ExternalLink className="w-5 h-5 text-bonk" />
                  </div>
                  <h3 className="font-mono font-bold text-lg text-white">Trade on Trojan</h3>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/[0.06] rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-white/50" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-5">
                {/* Warning Banner */}
                <div className="flex items-start gap-3 p-4 rounded-xl bg-bonk/5 border border-bonk/20">
                  <AlertTriangle className="w-5 h-5 text-bonk flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="text-bonk font-bold mb-1">You are leaving BONKUSD1</p>
                    <p className="text-white/60">
                      You will be redirected to Trojan, an external trading platform. 
                      Make sure you have a Solana wallet connected before trading.
                    </p>
                  </div>
                </div>

                {/* Token Info */}
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-white/30 mb-2 font-mono">
                    TOKEN TO TRADE
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-lg">
                      {token.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-bold text-white truncate">{token.name}</p>
                      <p className="text-white/40 text-sm font-mono">${token.symbol}</p>
                    </div>
                  </div>
                </div>

                {/* Contract Address */}
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-white/30 mb-2 font-mono">
                    VERIFY CONTRACT ADDRESS
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono text-white/70 bg-black/20 px-3 py-2 rounded-lg truncate">
                      {token.address}
                    </code>
                    <button
                      onClick={handleCopyAddress}
                      className="p-2 hover:bg-white/[0.06] rounded-lg transition-colors flex-shrink-0"
                      title="Copy address"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-success" />
                      ) : (
                        <Copy className="w-4 h-4 text-white/50" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Destination */}
                <div className="flex items-center gap-2 text-xs text-white/40 font-mono">
                  <span>Destination:</span>
                  <span className="text-white/60">trojan.com</span>
                  <ExternalLink className="w-3 h-3" />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-white/[0.06] flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-xl font-mono font-bold text-sm text-white/70 transition-all"
                >
                  Cancel
                </button>
                <a
                  href={tradeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleConfirm}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-bonk hover:bg-bonk/90 rounded-xl font-mono font-bold text-sm text-black transition-all glow-bonk"
                >
                  Continue to Trojan
                  <Image src="/trojan-horse.png" alt="Trojan" width={16} height={16} unoptimized />
                </a>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
