"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"

const DESIGNS = [
  {
    id: "default",
    name: "Default",
    description: "Original purple/pink gradient glass",
    colors: ["#A855F7", "#EC4899"],
    preview: "Rounded chamfered corners, glassmorphism",
  },
  {
    id: "brutalist",
    name: "Brutalist Tech",
    description: "Sharp edges, high contrast, geometric",
    colors: ["#B766FF", "#FF3D9A"],
    preview: "Zero radius, offset shadows, bold borders",
  },
  {
    id: "neon-matrix",
    name: "Neon Matrix",
    description: "Cyberpunk green + purple fusion",
    colors: ["#00FF41", "#BF40FF"],
    preview: "Matrix green, neon glows, sharp edges",
  },
  {
    id: "ice-crystal",
    name: "Ice Crystal",
    description: "Arctic cyan, frosted glass feel",
    colors: ["#00D4FF", "#8B5CF6"],
    preview: "Ice blue tones, cool crystalline aesthetic",
  },
  {
    id: "cyber-gold",
    name: "Cyber Gold",
    description: "Luxury gold + royal purple",
    colors: ["#FFB800", "#9D4EDD"],
    preview: "Warm gold accents, premium feel",
  },
  {
    id: "midnight-blood",
    name: "Midnight Blood",
    description: "Intense crimson + deep purple",
    colors: ["#DC143C", "#7B2CBF"],
    preview: "Blood red intensity, dark dramatic",
  },
]

export function DesignSwitcher() {
  const [currentDesign, setCurrentDesign] = useState("default")
  const [isOpen, setIsOpen] = useState(false)

  // Apply design to document root
  useEffect(() => {
    if (currentDesign === "default") {
      document.documentElement.removeAttribute("data-design")
    } else {
      document.documentElement.setAttribute("data-design", currentDesign)
    }
  }, [currentDesign])

  const currentDesignData = DESIGNS.find((d) => d.id === currentDesign) || DESIGNS[0]

  return (
    <>
      {/* Floating Switcher Button */}
      <motion.button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 z-50 flex items-center gap-2 px-4 py-3 bg-[rgba(20,15,35,0.95)] border border-[rgba(168,85,247,0.3)] backdrop-blur-xl shadow-lg hover:border-[rgba(168,85,247,0.6)] transition-all group"
        style={{ borderRadius: "0 8px 0 8px" }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1 }}
      >
        <div className="flex gap-1">
          {currentDesignData.colors.map((color, i) => (
            <div
              key={i}
              className="w-3 h-3"
              style={{ background: color, boxShadow: `0 0 8px ${color}` }}
            />
          ))}
        </div>
        <span className="text-xs font-mono text-white/70 group-hover:text-white transition-colors">
          Design: <span className="font-bold text-white">{currentDesignData.name}</span>
        </span>
        <svg className="w-4 h-4 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      </motion.button>

      {/* Design Picker Modal */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-x-4 bottom-4 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[700px] z-50 bg-[rgba(15,11,24,0.98)] border border-[rgba(168,85,247,0.3)] shadow-2xl overflow-hidden"
              style={{ borderRadius: "0 12px 0 12px" }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(168,85,247,0.2)] bg-gradient-to-r from-[rgba(168,85,247,0.1)] to-transparent">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-xl">🎨</span>
                    Dashboard Design Variations
                  </h2>
                  <p className="text-xs text-white/50 mt-1">
                    5 unique themes with sharp square corners
                  </p>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                  style={{ borderRadius: 0 }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Design Grid */}
              <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
                {DESIGNS.map((design) => {
                  const isActive = currentDesign === design.id
                  return (
                    <motion.button
                      key={design.id}
                      onClick={() => {
                        setCurrentDesign(design.id)
                      }}
                      className={`relative p-4 text-left transition-all border ${
                        isActive
                          ? "border-[rgba(168,85,247,0.6)] bg-[rgba(168,85,247,0.1)]"
                          : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)] hover:border-[rgba(168,85,247,0.3)]"
                      }`}
                      style={{ borderRadius: 0 }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {/* Active indicator */}
                      {isActive && (
                        <div className="absolute top-2 right-2 w-5 h-5 bg-gradient-to-r from-[#A855F7] to-[#EC4899] flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}

                      {/* Color preview */}
                      <div className="flex gap-1.5 mb-3">
                        {design.colors.map((color, i) => (
                          <div
                            key={i}
                            className="w-6 h-6"
                            style={{
                              background: color,
                              boxShadow: `0 0 12px ${color}40`,
                            }}
                          />
                        ))}
                      </div>

                      {/* Design info */}
                      <h3 className="text-sm font-bold text-white mb-1">{design.name}</h3>
                      <p className="text-[10px] text-white/50 leading-relaxed mb-2">
                        {design.description}
                      </p>
                      <p className="text-[9px] text-white/30 font-mono uppercase tracking-wider">
                        {design.preview}
                      </p>
                    </motion.button>
                  )
                })}
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t border-[rgba(168,85,247,0.2)] bg-[rgba(0,0,0,0.2)] flex items-center justify-between">
                <p className="text-[10px] text-white/40 font-mono">
                  Current: <span className="text-white">{currentDesignData.name}</span>
                </p>
                <button
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-[#A855F7] to-[#EC4899] hover:opacity-90 transition-opacity"
                  style={{ borderRadius: 0 }}
                >
                  Apply & Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
