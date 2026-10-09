import * as HugeiconsData from '@hugeicons/core-free-icons'
import * as LucideData from 'lucide'
import {
  createWebElement,
  type WebNode,
} from './web-model'
import type { IconLibrary } from './web-icon-style'

export { iconInfo, iconStyleOperation, isIconNode } from './web-icon-style'
export type { IconLibrary, IconStyle } from './web-icon-style'


export const ICON_LIBRARIES = [
  { id: 'hugeicons', label: 'Hugeicons' },
  { id: 'lucide', label: 'Lucide' },
] as const satisfies readonly { id: IconLibrary; label: string }[]

type IconTuple = readonly [string, Readonly<Record<string, string | number>>]

interface IconEntry {
  name: string
  data: readonly IconTuple[]
}

export interface IconMatch {
  library: IconLibrary
  name: string
}

export interface IconOptions {
  parentId: string | null
  order: number
  /** Rendered width and height in px. */
  size?: number
  /** Any CSS color; icons draw with `currentColor`, so this sets the svg's `color`. */
  color?: string
  strokeWidth?: number
  /**
   * Place the icon at this point of its parent, free-positioned, so it can be
   * moved and resized. Without both, it sits in the parent's flow.
   */
  left?: number
  top?: number
}

const DEFAULT_STROKE: Record<IconLibrary, number> = { hugeicons: 1.5, lucide: 2 }
const libraries: Record<IconLibrary, Record<string, unknown>> = {
  hugeicons: HugeiconsData,
  lucide: LucideData,
}
const indexes = new Map<IconLibrary, Map<string, IconEntry>>()

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

function isIconData(value: unknown): value is readonly IconTuple[] {
  return Array.isArray(value) && value.length > 0 && value.every(
    (item) =>
      Array.isArray(item)
      && typeof item[0] === 'string'
      && typeof item[1] === 'object'
      && item[1] !== null,
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
    const key = normalize(name)
    if (!index.has(key)) index.set(key, { name, data })
  }
  indexes.set(library, index)
  return index
}

/** Names containing the query, shortest first; an empty query lists the library alphabetically. */
export function searchIcons(query: string, library?: IconLibrary, limit = 60): IconMatch[] {
  const needle = normalize(query)
  const matches: IconMatch[] = []
  for (const id of library ? [library] : ICON_LIBRARIES.map((entry) => entry.id)) {
    for (const [key, entry] of iconIndex(id)) {
      if (key.includes(needle)) matches.push({ library: id, name: entry.name })
    }
  }
  return matches
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export function iconCount(library: IconLibrary) {
  return iconIndex(library).size
}

/** Path data for previews; the same tuples the inserted svg is built from. */
export function iconData(library: IconLibrary, name: string) {
  return iconIndex(library).get(normalize(name)) ?? null
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** The svg plus one child per shape, ready for `node.insert` in that order. */
export function iconNodes(
  library: IconLibrary,
  requestedName: string,
  options: IconOptions,
): WebNode[] | null {
  const entry = iconData(library, requestedName)
  if (!entry) return null
  const size = options.size ?? 24
  const svg = createWebElement('svg', {
    namespace: 'svg',
    parentId: options.parentId,
    order: options.order,
    attributes: {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': String(options.strokeWidth ?? DEFAULT_STROKE[library]),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-label': entry.name,
      'data-icon-library': library,
      'data-icon-name': entry.name,
    },
    styles: {
      ...(options.left !== undefined && options.top !== undefined
        ? { position: 'absolute', left: `${options.left}px`, top: `${options.top}px` }
        : {}),
      width: `${size}px`,
      height: `${size}px`,
      ...(options.color ? { color: options.color } : {}),
    },
  })
  const children = entry.data.map(([tag, props], index) =>
    createWebElement(tag, {
      namespace: 'svg',
      parentId: svg.id,
      order: (index + 1) * 1_024,
      // Width lives on the svg so one edit restyles every shape.
      attributes: Object.fromEntries(
        Object.entries(props)
          .filter(([name]) => name !== 'key' && name !== 'strokeWidth')
          .map(([name, value]) => [kebab(name), String(value)]),
      ),
    }),
  )
  return [svg, ...children]
}
