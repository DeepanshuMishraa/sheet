import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@sheet/ui/utils'
import {
  ACCENTS,
  DEFAULT_ACCENT,
  getAccent,
  setAccent,
  type AccentId,
} from '../lib/accent'
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
  DEFAULT_VOLUME,
  getSoundPreference,
  getVolumePreference,
  setSoundPreference,
  setVolumePreference,
  VOLUME_LEVELS,
  type SoundPreference,
  type VolumeLevel,
} from '@sheet/ui/sound'

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string }>

const PLANE = {
  light: { bg: '#fafaf9', fg: '#0d0d0d', rule: '#e4e4e0' },
  dark: { bg: '#212121', fg: '#ececea', rule: '#363636' },
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
      <rect x="80" y="46" width="5" height="5" style={{ fill: 'var(--cx-accent)' }} />
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

/** Four corner marks that draw themselves around the chosen option. */
function Brackets({ size, inset = 0 }: { size: number; inset?: number }) {
  const a = inset + 0.5
  const b = size - inset - 0.5
  const arm = 7
  return (
    <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" fill="none">
      <path
        className="cx-draw"
        pathLength="1"
        d={`M${a} ${a + arm}V${a}H${a + arm}M${b - arm} ${a}H${b}V${a + arm}M${b} ${b - arm}V${b}H${b - arm}M${a + arm} ${b}H${a}V${b - arm}`}
        stroke="var(--cx-accent)"
        strokeWidth="1.25"
      />
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
 * Theme, accent and interface size. Every choice applies the moment it is
 * made, in this window and in the app's other windows: the whole app is the
 * preview, which beats a swatch for a choice about colour or size.
 */
export function AppearanceSettings({
  className,
  showScale = true,
}: {
  className?: string
  /** Interface size is left out of first-run onboarding; Settings keeps it. */
  showScale?: boolean
}) {
  const [theme, setTheme] = useState<ThemePreference>(DEFAULT_THEME)
  const [accent, setAccentState] = useState<AccentId>(DEFAULT_ACCENT)
  const [scale, setScale] = useState<UiScale>(DEFAULT_UI_SCALE)

  useEffect(() => {
    setTheme(getThemePreference())
    setAccentState(getAccent())
    setScale(getUiScale())
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
                  'cx-press group flex min-w-0 flex-col gap-2.5 p-2 text-start outline-none transition-[box-shadow,color] duration-150 ease-smooth focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'text-foreground shadow-lift-selected'
                    : 'text-muted-foreground shadow-hairline hover:text-foreground hover:shadow-lift-hover',
                )}
                onClick={() => {
                  setTheme(option.value)
                  setThemePreference(option.value)
                }}
              >
                <span className="block overflow-hidden shadow-hairline">
                  <ThemeSpecimen mode={option.value} />
                </span>
                <span className="px-0.5 text-xs">{option.label}</span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section label="Accent" hint="The one colour used for selection, focus and whatever is live.">
        <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((option) => {
            const selected = accent === option.id
            const vars = { '--sw-l': option.light, '--sw-d': option.dark } as CSSProperties
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                title={option.label}
                style={vars}
                className="cx-press group relative flex aspect-square min-w-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setAccentState(option.id)
                  setAccent(option.id)
                }}
              >
                <svg viewBox="0 0 44 44" aria-hidden="true" className="size-full">
                  <rect
                    x="9"
                    y="9"
                    width="26"
                    height="26"
                    className="fill-(--sw-l) transition-transform duration-200 ease-smooth [transform-box:fill-box] [transform-origin:center] group-hover:scale-110 dark:fill-(--sw-d)"
                    style={{ transform: selected ? 'scale(0.82)' : undefined }}
                  />
                </svg>
                {selected ? <Brackets size={44} /> : null}
              </button>
            )
          })}
        </div>
        <p className="cx-label tabular-nums">
          {ACCENTS.find((option) => option.id === accent)?.label}
        </p>
      </Section>

      {showScale ? <Section
        label="Interface size"
        hint="Scales menus, panels, and text. Designs keep their own size; use canvas zoom for those."
      >
        <div className="relative grid grid-cols-5 shadow-hairline" role="radiogroup" aria-label="Interface size">
          {/* One marker that slides between stops, rather than five that blink. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 start-0 w-1/5 p-0.5 transition-transform duration-200 ease-smooth motion-reduce:transition-none"
            style={{ transform: `translateX(${scaleIndex * 100}%)` }}
          >
            <span className="block size-full shadow-lift-selected" />
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
                  'relative flex h-14 flex-col items-center justify-center gap-1.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
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
      </Section> : null}
    </div>
  )
}

/** Sound on or off, and how loud, as five bars you can press. */
export function SoundSettings({ className }: { className?: string }) {
  const [sound, setSound] = useState<SoundPreference>(DEFAULT_SOUND)
  const [volume, setVolume] = useState<VolumeLevel>(DEFAULT_VOLUME)

  useEffect(() => {
    setSound(getSoundPreference())
    setVolume(getVolumePreference())
  }, [])

  return (
    <div className={cn('flex flex-col gap-10', className)}>
      <Section label="Sound" hint="Cues for taps, hovers, menus and finished work.">
        <button
          type="button"
          role="switch"
          aria-checked={sound === 'on'}
          aria-label="Sound"
          className="cx-press flex h-10 items-center justify-between px-3 text-xs shadow-hairline outline-none transition-shadow duration-150 hover:shadow-lift-hover focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            const next: SoundPreference = sound === 'on' ? 'off' : 'on'
            setSound(next)
            setSoundPreference(next)
          }}
        >
          <span>{sound === 'on' ? 'On' : 'Off'}</span>
          {/* A hairline track with a square that travels it; the accent only shows while it is on. */}
          <span
            aria-hidden="true"
            className={cn(
              'relative h-4 w-8 shadow-hairline transition-colors duration-200 ease-smooth',
              sound === 'on' && 'bg-cx-accent/15',
            )}
          >
            <span
              className={cn(
                'absolute top-1/2 size-2.5 -translate-y-1/2 transition-[inset-inline-start,background-color] duration-200 ease-smooth',
                sound === 'on' ? 'start-[1.1rem] bg-cx-accent' : 'start-[0.2rem] bg-muted-foreground',
              )}
            />
          </span>
        </button>
      </Section>

      <Section label="Volume" hint="Press a bar. The sound you hear is the level you chose.">
        <div
          className={cn('flex h-14 items-end gap-2 transition-opacity duration-200', sound === 'off' && 'opacity-40')}
          role="radiogroup"
          aria-label="Volume"
        >
          {VOLUME_LEVELS.map((level, index) => {
            const reached = level <= volume
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={volume === level}
                aria-label={`Volume ${Math.round(level * 100)} percent`}
                disabled={sound === 'off'}
                className="cx-press flex h-full flex-1 items-end outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                onClick={() => {
                  setVolume(level)
                  setVolumePreference(level)
                }}
              >
                <svg viewBox="0 0 20 56" preserveAspectRatio="none" aria-hidden="true" className="w-full" style={{ height: `${28 + index * 18}%` }}>
                  <rect
                    width="20"
                    height="56"
                    className="transition-[fill,fill-opacity] duration-200"
                    style={{ fill: reached ? 'var(--cx-accent)' : 'var(--muted-foreground)', fillOpacity: reached ? 1 : 0.25 }}
                  />
                </svg>
              </button>
            )
          })}
        </div>
        <p className="cx-label tabular-nums">{Math.round(volume * 100)}%</p>
      </Section>
    </div>
  )
}
