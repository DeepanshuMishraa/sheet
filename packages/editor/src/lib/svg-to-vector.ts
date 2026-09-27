import type { CanvasColor } from '@sheet/canvas/model'
import { shapePathData } from '@sheet/canvas/vector'

export { shapePathData } from '@sheet/canvas/vector'

export interface VectorDescriptor {
  viewBox: string
  paths: {
    d: string
    fill?: CanvasColor
    stroke?: CanvasColor
    strokeWidth?: number
  }[]
}

const ICON_DEFAULT_COLOR = '#111827'

function svgNumber(value: string | undefined, fallback = 0) {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'none' || trimmed === 'transparent') return undefined
  if (trimmed === 'currentColor') return ICON_DEFAULT_COLOR
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed
  if (/^[a-z]+$/i.test(trimmed)) return trimmed
  if (/^(?:rgb|rgba|hsl|hsla)\([0-9a-z.%+,\s/-]+\)$/i.test(trimmed)) return trimmed
  return undefined
}

const DRAWABLE_TAGS = new Set([
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
])

/**
 * Parse a raw SVG string into the vector path data the canvas stores. Uses
 * DOMParser (the editor already relies on it for HTML import), supports the
 * same shape primitives as the HTML/CSS import pipeline, and inherits
 * `fill`/`stroke`/`stroke-width` through the subtree. `currentColor`
 * substitutes a visible neutral so icons are not invisible on a white canvas.
 */
export function svgStringToVectorDescriptor(svg: string): VectorDescriptor | null {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  } catch {
    return null
  }
  const svgEl = doc.documentElement
  if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') return null

  const viewBox =
    svgEl.getAttribute('viewBox') ||
    (svgEl.getAttribute('width') && svgEl.getAttribute('height')
      ? `0 0 ${svgNumber(svgEl.getAttribute('width') ?? undefined)} ${svgNumber(svgEl.getAttribute('height') ?? undefined)}`
      : '0 0 24 24')

  const paths: VectorDescriptor['paths'] = []

  const visit = (
    element: Element,
    inherited: {
      fill?: string
      stroke?: string
      strokeWidth?: number
    },
  ) => {
    const tag = element.tagName.toLowerCase()
    const fill = safeColor(
      element.getAttribute('fill') ?? undefined,
    ) ?? inherited.fill
    const strokeColor =
      safeColor(element.getAttribute('stroke') ?? undefined) ?? inherited.stroke
    const ownStrokeWidth = Number.parseFloat(
      element.getAttribute('stroke-width') ?? '',
    )
    const strokeWidth = Number.isFinite(ownStrokeWidth)
      ? ownStrokeWidth
      : inherited.strokeWidth

    if (DRAWABLE_TAGS.has(tag)) {
      const attributes: Record<string, string> = {}
      for (const attr of Array.from(element.attributes)) {
        attributes[attr.name] = attr.value
      }
      const d = shapePathData(tag, attributes)
      if (d) {
        paths.push({
          d,
          ...(fill ? { fill } : {}),
          ...(strokeColor ? { stroke: strokeColor } : {}),
          ...(strokeWidth !== undefined ? { strokeWidth } : {}),
        })
      }
    }

    for (const child of Array.from(element.children)) {
      visit(child, {
        fill: fill ?? inherited.fill,
        stroke: strokeColor ?? inherited.stroke,
        strokeWidth,
      })
    }
  }

  visit(svgEl, {})

  if (paths.length === 0) return null
  return { viewBox, paths }
}

/**
 * Quick test of whether a pasted string looks like an SVG document. Used to
 * decide whether to try the SVG conversion path before falling back to plain
 * text paste.
 */
export function looksLikeSvg(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 5 || trimmed.length > 500_000) return false
  if (trimmed.startsWith('<svg')) return true
  const parser = new DOMParser()
  try {
    const doc = parser.parseFromString(trimmed, 'text/html')
    return !!doc.querySelector('svg')
  } catch {
    return false
  }
}

export { ICON_DEFAULT_COLOR }