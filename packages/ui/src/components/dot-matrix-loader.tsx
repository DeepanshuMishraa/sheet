import type React from 'react'
import { cn } from '../lib/utils.ts'

export interface DotMatrixLoaderProps extends React.ComponentProps<'svg'> {
  /**
   * Number of rows in the matrix.
   * @default 3
   */
  rows?: number
  /**
   * Number of columns in the matrix.
   * @default 3
   */
  columns?: number
  /**
   * Shape of each dot in the matrix.
   * @default 'circle'
   */
  dotShape?: 'circle' | 'square'
  /**
   * Animation style variant.
   * - 'wave': Diagonal sweep from top-left to bottom-right (default)
   * - 'pulse': Radial ripple expanding outward from center
   * - 'scan': Top-to-bottom scanline sweep
   * - 'blink': Synchronized breathing pulse
   * @default 'wave'
   */
  variant?: 'wave' | 'pulse' | 'scan' | 'blink'
  /**
   * Animation cycle duration in seconds.
   * @default 1.2
   */
  duration?: number
  /**
   * Resting opacity of inactive dots (0 to 1).
   * @default 0.18
   */
  inactiveOpacity?: number
  /**
   * Peak opacity of active dots (0 to 1).
   * @default 1
   */
  activeOpacity?: number
  /**
   * Dot radius in internal viewBox units.
   * @default 2.2
   */
  dotRadius?: number
}

const CELL_SIZE = 8

export function DotMatrixLoader({
  rows = 3,
  columns = 3,
  dotShape = 'circle',
  variant = 'wave',
  duration = 1.2,
  inactiveOpacity = 0.18,
  activeOpacity = 1,
  dotRadius = 2.2,
  className,
  style,
  ...props
}: DotMatrixLoaderProps): React.ReactElement {
  const safeRows = Math.max(1, rows)
  const safeColumns = Math.max(1, columns)
  const width = safeColumns * CELL_SIZE
  const height = safeRows * CELL_SIZE

  const dots: React.ReactElement[] = []

  for (let r = 0; r < safeRows; r++) {
    for (let c = 0; c < safeColumns; c++) {
      let delay = 0

      if (variant === 'wave') {
        const maxDist = (safeColumns - 1) + (safeRows - 1)
        const dist = c + r
        delay = maxDist > 0 ? (dist / maxDist) * (duration * 0.45) : 0
      } else if (variant === 'pulse') {
        const midX = (safeColumns - 1) / 2
        const midY = (safeRows - 1) / 2
        const maxDist = Math.hypot(midX, midY)
        const dist = Math.hypot(c - midX, r - midY)
        delay = maxDist > 0 ? (dist / maxDist) * (duration * 0.4) : 0
      } else if (variant === 'scan') {
        const maxDist = safeRows - 1
        delay = maxDist > 0 ? (r / maxDist) * (duration * 0.45) : 0
      } else if (variant === 'blink') {
        delay = 0
      }

      const cx = c * CELL_SIZE + CELL_SIZE / 2
      const cy = r * CELL_SIZE + CELL_SIZE / 2

      const dotStyle: React.CSSProperties = {
        opacity: inactiveOpacity,
        animation: `sheet-dot-matrix-glow ${duration}s cubic-bezier(0.4, 0, 0.2, 1) infinite`,
        animationDelay: `${delay.toFixed(3)}s`,
        fill: 'currentColor',
      }

      if (dotShape === 'square') {
        dots.push(
          <rect
            key={`${r}-${c}`}
            className="sheet-dot-matrix-dot"
            x={cx - dotRadius}
            y={cy - dotRadius}
            width={dotRadius * 2}
            height={dotRadius * 2}
            rx={dotRadius * 0.35}
            style={dotStyle}
          />,
        )
      } else {
        dots.push(
          <circle
            key={`${r}-${c}`}
            className="sheet-dot-matrix-dot"
            cx={cx}
            cy={cy}
            r={dotRadius}
            style={dotStyle}
          />,
        )
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      role="status"
      aria-label="Loading"
      className={cn('size-4 shrink-0 text-current', className)}
      style={{
        ...style,
        ['--dot-min-opacity' as string]: inactiveOpacity.toString(),
        ['--dot-max-opacity' as string]: activeOpacity.toString(),
      }}
      {...props}
    >
      <style>{`
        @keyframes sheet-dot-matrix-glow {
          0% {
            opacity: var(--dot-min-opacity, 0.18);
          }
          30% {
            opacity: var(--dot-max-opacity, 1);
          }
          60% {
            opacity: var(--dot-min-opacity, 0.18);
          }
          100% {
            opacity: var(--dot-min-opacity, 0.18);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sheet-dot-matrix-dot {
            animation: none !important;
            opacity: var(--dot-min-opacity, 0.35) !important;
          }
        }
      `}</style>
      {dots}
    </svg>
  )
}
