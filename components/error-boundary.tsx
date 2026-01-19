"use client"

import React from "react"

import { Component, type ReactNode } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { getUserFriendlyError } from "@/lib/utils"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 glass-card-solid rounded-xl">
          <AlertTriangle className="w-12 h-12 text-danger mb-4" />
          <h3 className="text-lg font-mono font-bold text-white mb-2">
            Something went wrong
          </h3>
          <p className="text-white/50 text-sm font-mono mb-4 text-center max-w-md">
            {getUserFriendlyError(this.state.error)}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: undefined })
              window.location.reload()
            }}
            className="flex items-center gap-2 px-4 py-2 bg-bonk hover:bg-bonk/90 text-black rounded-lg font-mono font-bold text-sm transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

// Hook for functional components to handle async errors
export function useErrorHandler() {
  const handleError = (error: Error) => {
    console.error("[useErrorHandler]", error)
    // Could integrate with error tracking service here
  }

  return { handleError }
}
