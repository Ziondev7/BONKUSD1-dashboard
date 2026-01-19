"use client"

import { motion } from "framer-motion"
import { Github, ExternalLink, Heart } from "lucide-react"
import Image from "next/image"

export function DashboardFooter() {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.6 }}
      className="mt-16 pt-8 border-t border-white/[0.04]"
    >
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Brand */}
        <div className="flex items-center gap-4">
          <Image
            src="/logo.png"
            alt="BONKUSD1"
            width={32}
            height={32}
            className="opacity-50"
          />
          <div className="text-center md:text-left">
            <p className="font-mono text-sm text-white/40">
              BONK<span className="text-bonk">USD1</span>.FUN
            </p>
            <p className="text-[10px] text-white/20 font-mono">
              Track USD1 pairs on Bonk.fun
            </p>
          </div>
        </div>

        {/* Links */}
        <div className="flex items-center gap-6">
          <a
            href="https://x.com/BONKUSD1"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-white/30 hover:text-bonk transition-colors font-mono text-xs"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Twitter
          </a>
          <a
            href="https://dexscreener.com/solana?q=USD1"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-white/30 hover:text-success transition-colors font-mono text-xs"
          >
            <ExternalLink className="w-4 h-4" />
            DexScreener
          </a>
        </div>

        {/* Built with */}
        <p className="text-[10px] text-white/20 font-mono flex items-center gap-1">
          Built with <Heart className="w-3 h-3 text-danger fill-danger" /> for degens
        </p>
      </div>

      {/* Disclaimer */}
      <p className="mt-6 text-center text-[10px] text-white/15 font-mono max-w-2xl mx-auto">
        This dashboard is for informational purposes only. Not financial advice. 
        Always DYOR before trading. Cryptocurrency trading involves substantial risk.
      </p>
    </motion.footer>
  )
}
