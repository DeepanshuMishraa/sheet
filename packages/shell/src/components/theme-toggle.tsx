import { useState } from 'react'
import { cn } from '@sheet/ui/utils'
import {
  getThemePreference,
  resolveTheme,
  setThemePreference,
  type ThemeId,
} from '../lib/theme'

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies ReadonlyArray<{ value: ThemeId; label: string }>

/**
 * Light or dark, as two words. A bracket-shaped rule slides under the one in
 * use, so the state reads from the shape on the line and not from a colour
 * alone. The pick applies at once and is remembered like any theme choice.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeId>(() => resolveTheme(getThemePreference()))
  const index = OPTIONS.findIndex((option) => option.value === mode)

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('relative grid h-7 w-32 grid-cols-2', className)}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          className={cn(
            'cx-label outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            mode === option.value ? 'text-foreground' : 'hover:text-foreground',
          )}
          onClick={() => {
            setMode(option.value)
            setThemePreference(option.value)
          }}
        >
          {option.label}
        </button>
      ))}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[5px] w-1/2 transition-transform duration-200 ease-smooth motion-reduce:transition-none"
        style={{ transform: `translateX(${index * 100}%)` }}
      >
        <svg viewBox="0 0 40 5" preserveAspectRatio="none" className="size-full overflow-visible">
          <path
            d="M0.5 0V4.5H39.5V0"
            fill="none"
            stroke="var(--cx-accent)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </span>
    </div>
  )
}
