import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@sheet/ui/utils'
import {
  DEFAULT_THEME,
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../lib/theme'
import {
  DEFAULT_UI_SCALE,
  getUiScale,
  setUiScale,
  UI_SCALES,
  type UiScale,
} from '../lib/ui-scale'
import {
  DEFAULT_SOUND,
  getSoundPreference,
  setSoundPreference,
  type SoundPreference,
} from '@sheet/ui/sound'

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string }>

const PLANE = {
  light: { bg: '#fafaf9', fg: '#0d0d0d', rule: '#e4e4e0' },
  dark: { bg: '#121212', fg: '#ececea', rule: '#2a2a2a' },
} as const

/** One window, drawn flat: a sidebar rule, three lines of text, the accent dot. */
function Plane({ tone }: { tone: keyof typeof PLANE }) {
  const { bg, fg, rule } = PLANE[tone]
  return (
    <g>
      <rect width="96" height="60" fill={bg} />
      <path d="M26 0v60" stroke={rule} strokeWidth="1" />
      <path d="M6 10h14M6 17h10M6 24h12" stroke={fg} strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M36 14h38M36 22h46M36 30h30" stroke={fg} strokeOpacity="0.7" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="84" cy="50" r="2.5" fill="#f0541a" />
    </g>
  )
}

/** A miniature of the app in that palette. System splits one window on the diagonal. */
function ThemeSpecimen({ mode }: { mode: ThemePreference }) {
  return (
    <svg viewBox="0 0 96 60" aria-hidden="true" className="block h-auto w-full">
      {mode === 'dark' ? <Plane tone="dark" /> : <Plane tone="light" />}
      {mode === 'system' ? (
        <>
          <defs>
            <clipPath id="cx-specimen-system">
              <path d="M96 0v60H0z" />
            </clipPath>
          </defs>
          <g clipPath="url(#cx-specimen-system)">
            <Plane tone="dark" />
          </g>
        </>
      ) : null}
    </svg>
  )
}

/** A check that writes itself in when its option is chosen. */
function DrawnCheck({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 text-cx-accent">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1" />
      {visible ? (
        <path
          className="cx-draw"
          pathLength="1"
          d="M5 8.4l2 2 4-4.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  )
}

const SCALE_LABELS: Record<UiScale, string> = {
  0.9: 'Compact',
  1: 'Default',
  1.1: 'Large',
  1.25: 'Larger',
  1.5: 'Largest',
}

function Section({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="cx-label cx-bracket">{label}</h2>
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  )
}

/**
 * Theme, interface scale, and sound. Shared by the Appearance page and the
 * Settings dialog so the two cannot drift apart.
 *
 * Every choice applies the moment it is made — the whole app is the preview,
 * which beats a swatch for a choice about size.
 */
export function AppearanceSettings({ className }: { className?: string }) {
  const [theme, setTheme] = useState<ThemePreference>(DEFAULT_THEME)
  const [scale, setScale] = useState<UiScale>(DEFAULT_UI_SCALE)
  const [sound, setSound] = useState<SoundPreference>(DEFAULT_SOUND)

  useEffect(() => {
    setTheme(getThemePreference())
    setScale(getUiScale())
    setSound(getSoundPreference())
  }, [])

  const scaleIndex = Math.max(0, UI_SCALES.indexOf(scale))

  return (
    <div className={cn('flex flex-col gap-10', className)}>
      <Section label="Theme" hint="System follows your device. Your designs are never affected.">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Color theme">
          {THEME_OPTIONS.map((option) => {
            const selected = theme === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={cn(
                  'cx-press group flex min-w-0 flex-col gap-2.5 rounded-lg p-2 text-start outline-none transition-[box-shadow,color] duration-150 ease-smooth focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'text-foreground shadow-lift-selected'
                    : 'text-muted-foreground shadow-hairline hover:text-foreground hover:shadow-lift-hover',
                )}
                onClick={() => {
                  setTheme(option.value)
                  setThemePreference(option.value)
                }}
              >
                <span className="block overflow-hidden rounded-md shadow-hairline">
                  <ThemeSpecimen mode={option.value} />
                </span>
                <span className="flex items-center justify-between gap-2 px-0.5 text-xs">
                  {option.label}
                  <DrawnCheck visible={selected} />
                </span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section
        label="Interface size"
        hint="Scales menus, panels, and text. Designs keep their own size; use canvas zoom for those."
      >
        <div
          className="relative grid grid-cols-5 rounded-lg shadow-hairline"
          role="radiogroup"
          aria-label="Interface size"
        >
          {/* One marker that slides between stops, rather than five that blink. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 start-0 w-1/5 p-0.5 transition-transform duration-200 ease-smooth motion-reduce:transition-none"
            style={{ transform: `translateX(${scaleIndex * 100}%)` }}
          >
            <span className="block size-full rounded-md shadow-lift-selected" />
          </span>
          {UI_SCALES.map((option) => {
            const selected = scale === option
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                className={cn(
                  'relative flex h-14 flex-col items-center justify-center gap-1.5 rounded-lg outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => {
                  setScale(option)
                  setUiScale(option)
                }}
              >
                {/* Sized in px so the sample keeps its meaning while the rest of
                    the app resizes around it. */}
                <span aria-hidden="true" className="leading-none" style={{ fontSize: `${Math.round(option * 11)}px` }}>
                  Aa
                </span>
                <span className="cx-label tabular-nums text-inherit">{Math.round(option * 100)}</span>
                <span className="sr-only">{SCALE_LABELS[option]}</span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section label="Sound" hint="Soft cues for taps, menus, and finished work. Never loud.">
        <button
          type="button"
          role="switch"
          aria-checked={sound === 'on'}
          aria-label="Sound"
          className="cx-press flex h-10 items-center justify-between rounded-lg px-3 text-xs shadow-hairline outline-none transition-shadow duration-150 hover:shadow-lift-hover focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            const next: SoundPreference = sound === 'on' ? 'off' : 'on'
            setSound(next)
            setSoundPreference(next)
          }}
        >
          <span>{sound === 'on' ? 'On' : 'Off'}</span>
          {/* A hairline track with a dot that travels it; the accent only shows
              while it is on. */}
          <span
            aria-hidden="true"
            className={cn(
              'relative h-4 w-8 rounded-full shadow-hairline transition-colors duration-200 ease-smooth',
              sound === 'on' && 'bg-cx-accent/15',
            )}
          >
            <span
              className={cn(
                'absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full transition-[transform,background-color] duration-200 ease-smooth',
                sound === 'on' ? 'translate-x-[1.1rem] bg-cx-accent' : 'translate-x-[0.2rem] bg-muted-foreground',
              )}
            />
          </span>
        </button>
      </Section>
    </div>
  )
}
