import { cn } from '@sheet/ui/utils'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Five bands, newest first: an hour, a day, a week, a month, older. */
const BANDS = [HOUR, DAY, 7 * DAY, 30 * DAY] as const

/** How many of the five ticks stay lit for a file last edited at `updatedAt`. */
export function freshnessLevel(updatedAt: number, now = Date.now()) {
  const age = Math.max(0, now - updatedAt)
  const older = BANDS.findIndex((limit) => age < limit)
  return older === -1 ? 1 : 5 - older
}

/**
 * A five-tick gauge of how recently a file was touched. Lit ticks are the
 * accent, spent ones fade to the hairline colour, so a list of files reads as
 * "what I was just working on" at a glance without anyone parsing dates.
 * The text label next to it still carries the exact age.
 */
export function FreshnessMeter({
  updatedAt,
  className,
}: {
  updatedAt: number
  className?: string
}) {
  const level = freshnessLevel(updatedAt)
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 10"
      className={cn('h-2.5 w-5 shrink-0', className)}
    >
      {[0, 1, 2, 3, 4].map((index) => {
        const lit = index < level
        return (
          <rect
            key={index}
            x={index * 4.5}
            y={lit ? 0 : 3}
            width="1.5"
            height={lit ? 10 : 7}
            rx="0.75"
            fill={lit ? 'var(--cx-accent)' : 'var(--muted-foreground)'}
            opacity={lit ? 1 : 0.35}
          />
        )
      })}
    </svg>
  )
}
