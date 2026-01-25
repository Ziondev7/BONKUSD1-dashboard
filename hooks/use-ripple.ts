import { useCallback, useRef } from 'react'

interface RippleOptions {
  color?: string
  duration?: number
}

export function useRipple(options: RippleOptions = {}) {
  const { color = 'rgba(250, 204, 21, 0.3)', duration = 600 } = options
  const containerRef = useRef<HTMLElement | null>(null)

  const createRipple = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const container = event.currentTarget
      containerRef.current = container

      // Get click position relative to the element
      const rect = container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      // Calculate ripple size based on element dimensions
      const size = Math.max(rect.width, rect.height) * 2

      // Create ripple element
      const ripple = document.createElement('span')
      ripple.style.cssText = `
        position: absolute;
        left: ${x - size / 2}px;
        top: ${y - size / 2}px;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${color};
        transform: scale(0);
        animation: ripple-animation ${duration}ms linear;
        pointer-events: none;
        z-index: 1;
      `

      // Ensure container has proper styles
      const currentPosition = window.getComputedStyle(container).position
      if (currentPosition === 'static') {
        container.style.position = 'relative'
      }
      container.style.overflow = 'hidden'

      container.appendChild(ripple)

      // Clean up after animation
      setTimeout(() => {
        ripple.remove()
      }, duration)
    },
    [color, duration]
  )

  return { createRipple }
}

// Utility function for applying ripple without hook
export function applyRipple(
  element: HTMLElement,
  event: { clientX: number; clientY: number },
  options: RippleOptions = {}
) {
  const { color = 'rgba(250, 204, 21, 0.3)', duration = 600 } = options

  const rect = element.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const size = Math.max(rect.width, rect.height) * 2

  const ripple = document.createElement('span')
  ripple.className = 'ripple-effect'
  ripple.style.cssText = `
    left: ${x - size / 2}px;
    top: ${y - size / 2}px;
    width: ${size}px;
    height: ${size}px;
    background: ${color};
  `

  const currentPosition = window.getComputedStyle(element).position
  if (currentPosition === 'static') {
    element.style.position = 'relative'
  }
  element.style.overflow = 'hidden'

  element.appendChild(ripple)

  setTimeout(() => {
    ripple.remove()
  }, duration)
}
