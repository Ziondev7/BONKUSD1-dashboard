"use client"

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react"

interface ProModeContextType {
  isProMode: boolean
  toggleProMode: () => void
  setProMode: (value: boolean) => void
}

const ProModeContext = createContext<ProModeContextType | undefined>(undefined)

const STORAGE_KEY = "bonkusd1_pro_mode"

export function ProModeProvider({ children }: { children: ReactNode }) {
  const [isProMode, setIsProMode] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)

  // Hydrate from localStorage after mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "true") {
      setIsProMode(true)
    }
    setIsHydrated(true)
  }, [])

  // Persist to localStorage when changed
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(STORAGE_KEY, String(isProMode))
    }
  }, [isProMode, isHydrated])

  // Apply/remove body overflow class
  useEffect(() => {
    if (isHydrated) {
      if (isProMode) {
        document.body.classList.add("pro-mode-active")
        document.documentElement.style.overflow = "hidden"
      } else {
        document.body.classList.remove("pro-mode-active")
        document.documentElement.style.overflow = ""
      }
    }
  }, [isProMode, isHydrated])

  const toggleProMode = useCallback(() => {
    setIsProMode(prev => !prev)
  }, [])

  const setProMode = useCallback((value: boolean) => {
    setIsProMode(value)
  }, [])

  return (
    <ProModeContext.Provider value={{ isProMode, toggleProMode, setProMode }}>
      {children}
    </ProModeContext.Provider>
  )
}

export function useProMode() {
  const context = useContext(ProModeContext)
  if (context === undefined) {
    throw new Error("useProMode must be used within a ProModeProvider")
  }
  return context
}
