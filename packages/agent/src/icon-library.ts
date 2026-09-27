import * as HugeIconsData from '@hugeicons/core-free-icons'
import * as LucideData from 'lucide'
import type { CanvasColor, VectorNode } from '@sheet/canvas/model'
import { shapePathData } from '@sheet/canvas/vector'

export type IconLibrary = 'hugeicons' | 'lucide'

interface TupleAttributes {
  readonly [key: string]: string | number
}

type IconData = readonly (readonly [string, TupleAttributes])[]

interface IconEntry {
  name: string
  data: IconData
}

export interface ResolvedIcon {
  name: string
  viewBox: string
  paths: VectorNode['paths']
}

const libraries = {
  hugeicons: HugeIconsData,
  lucide: LucideData,
} as const

const indexes = new Map<IconLibrary, Map<string, IconEntry>>()

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isIconData(value: unknown): value is IconData {
  return Array.isArray(value) && value.length > 0 && value.every(
    (item) =>
      Array.isArray(item) &&
      typeof item[0] === 'string' &&
      !!item[1] &&
      typeof item[1] === 'object',
  )
}

function iconIndex(library: IconLibrary) {
  const cached = indexes.get(library)
  if (cached) return cached

  const index = new Map<string, IconEntry>()
  for (const [exportName, data] of Object.entries(libraries[library])) {
    if (!isIconData(data)) continue
    const name = exportName.replace(/FreeIcons$/, '').replace(/Icon$/, '')
    if (!name) continue
    const entry = { name, data }
    const key = normalize(name)
    if (!index.has(key)) index.set(key, entry)
    if (key.endsWith('01') && !index.has(key.slice(0, -2))) {
      index.set(key.slice(0, -2), entry)
    }
  }
  indexes.set(library, index)
  return index
}

function paint(
  value: string | undefined,
  color: CanvasColor,
): CanvasColor | undefined {
  if (!value || value === 'none' || value === 'transparent') return undefined
  return value === 'currentColor' ? color : value
}

export function searchIcons(
  query: string,
  library?: IconLibrary,
  limit = 20,
) {
  const needle = normalize(query)
  const matches: Array<{ library: IconLibrary; name: string }> = []
  const selected = library ? [library] : (['hugeicons', 'lucide'] as const)
  for (const libraryId of selected) {
    const names = new Set<string>()
    for (const [key, entry] of iconIndex(libraryId)) {
      if (key.includes(needle)) names.add(entry.name)
    }
    matches.push(...[...names].map((name) => ({ library: libraryId, name })))
  }
  return matches
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export function iconSuggestions(library: IconLibrary, query: string) {
  return searchIcons(query, library, 8).map((icon) => icon.name)
}

export function resolveIcon(
  library: IconLibrary,
  requestedName: string,
  color: CanvasColor,
): ResolvedIcon | null {
  const entry = iconIndex(library).get(normalize(requestedName))
  if (!entry) return null

  const paths: VectorNode['paths'] = []
  for (const [tag, rawAttributes] of entry.data) {
    const attributes = Object.fromEntries(
      Object.entries(rawAttributes).map(([key, value]) => [key, String(value)]),
    )
    const d = shapePathData(tag, attributes)
    if (!d) continue

    const fill = paint(
      typeof rawAttributes.fill === 'string' ? rawAttributes.fill : undefined,
      color,
    )
    const rawStroke =
      typeof rawAttributes.stroke === 'string' ? rawAttributes.stroke : undefined
    const stroke = paint(rawStroke, color)
    const hasExplicitFill = fill !== undefined
    const strokeWidthValue = rawAttributes.strokeWidth
    const strokeWidth =
      typeof strokeWidthValue === 'number'
        ? strokeWidthValue
        : typeof strokeWidthValue === 'string'
          ? Number.parseFloat(strokeWidthValue)
          : undefined

    paths.push({
      d,
      ...(fill ? { fill } : {}),
      ...((stroke || !hasExplicitFill)
        ? {
            stroke: stroke ?? color,
            strokeWidth: Number.isFinite(strokeWidth)
              ? strokeWidth
              : library === 'hugeicons'
                ? 1.5
                : 2,
          }
        : {}),
    })
  }

  return paths.length > 0
    ? { name: entry.name, viewBox: '0 0 24 24', paths }
    : null
}
