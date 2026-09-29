import { createElement, useEffect, useMemo, useState } from 'react'
import { cn } from '@sheet/ui/utils'
import type { IconLibrary } from '@sheet/canvas/web-icons'

type IconModule = typeof import('@sheet/canvas/web-icons')

const LIMIT = 120
const camel = (name: string) => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())

function IconPreview({ icons, library, name }: { icons: IconModule; library: IconLibrary; name: string }) {
  const entry = icons.iconData(library, name)
  if (!entry) return null
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={library === 'lucide' ? 2 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {entry.data.map(([tag, props], index) =>
        createElement(tag, {
          key: index,
          ...Object.fromEntries(
            Object.entries(props)
              .filter(([key]) => key !== 'key' && key !== 'strokeWidth' && key !== 'stroke-width')
              .map(([key, value]) => [camel(key), value]),
          ),
        }),
      )}
    </svg>
  )
}

export function IconsPanel({ onInsert }: { onInsert: (icon: { library: IconLibrary; name: string }) => void }) {
  const [icons, setIcons] = useState<IconModule | null>(null)
  const [query, setQuery] = useState('')
  const [library, setLibrary] = useState<IconLibrary | 'all'>('all')

  // The full sets are large; load them only when this tab is opened.
  useEffect(() => {
    let active = true
    void import('@sheet/canvas/web-icons').then((module) => {
      if (active) setIcons(module)
    })
    return () => {
      active = false
    }
  }, [])

  const results = useMemo(
    () => icons?.searchIcons(query, library === 'all' ? undefined : library, LIMIT) ?? [],
    [icons, query, library],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <input
        type="search"
        aria-label="Search icons"
        placeholder="Search icons"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        className="h-8 w-full min-w-0 shrink-0 rounded-md border border-input bg-surface-2 px-2 text-xs text-foreground outline-none focus:border-ring"
      />
      <div role="group" aria-label="Icon library" className="grid shrink-0 grid-cols-3 rounded-lg border border-line bg-well p-0.5">
        {([{ id: 'all', label: 'All' }, ...(icons?.ICON_LIBRARIES ?? [])] as const).map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={library === option.id}
            className={cn(
              'min-w-0 truncate rounded-md px-1 py-1 text-xs transition-colors',
              library === option.id
                ? 'bg-surface font-medium text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setLibrary(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {!icons ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading icons…</p>
        ) : results.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No icons match “{query}”.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1">
            {results.map((icon) => (
              <button
                key={`${icon.library}:${icon.name}`}
                type="button"
                aria-label={`Insert ${icon.name} icon`}
                title={`${icon.name} · ${icon.library}`}
                className="grid aspect-square place-items-center rounded-md border border-line text-foreground hover:border-cx-accent hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => onInsert(icon)}
              >
                <IconPreview icons={icons} library={icon.library} name={icon.name} />
              </button>
            ))}
          </div>
        )}
        {icons && results.length === LIMIT ? (
          <p className="pt-3 text-center text-[11px] text-muted-foreground">
            Showing the first {LIMIT}. Search to narrow down.
          </p>
        ) : null}
      </div>
    </div>
  )
}
