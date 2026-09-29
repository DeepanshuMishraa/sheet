import {
  assertDocument,
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  defaultLayout,
  type CanvasDocument,
  type CanvasNode,
  type CanvasElement,
  type CanvasPage,
} from './legacy-model'
import {
  colorValue,
  fontFamilyValue,
  layoutDeclarations,
  layoutParent,
  paintValue,
} from './style-css'
import {
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebText,
  type WebDocument,
} from './web-model'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function legacyArray(value: unknown, field: string) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Report malformed persisted JSON below.
    }
  }
  if (value === null || value === undefined) return []
  throw new Error(`Legacy ${field} must be a JSON array`)
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Legacy ${field} must be a finite number`)
  }
  return value
}

function parseLegacyElement(value: unknown, index: number): CanvasElement {
  const field = `shapes[${index}]`
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' || !value.id ||
    typeof value.name !== 'string' ||
    typeof value.code !== 'string'
  ) throw new Error(`Legacy ${field} is missing id, name, or code`)
  if (value.code.length > 200_000) throw new Error(`Legacy ${field}.code exceeds 200000 characters`)
  const optionalNumber = (key: string) => value[key] === undefined
    ? {}
    : { [key]: finiteNumber(value[key], `${field}.${key}`) }
  const optionalString = (key: string) => value[key] === undefined
    ? {}
    : typeof value[key] === 'string'
      ? { [key]: value[key] }
      : (() => { throw new Error(`Legacy ${field}.${key} must be a string`) })()
  const optionalBoolean = (key: string) => value[key] === undefined
    ? {}
    : typeof value[key] === 'boolean'
      ? { [key]: value[key] }
      : (() => { throw new Error(`Legacy ${field}.${key} must be a boolean`) })()
  return {
    id: value.id,
    name: value.name,
    code: value.code,
    x: finiteNumber(value.x, `${field}.x`),
    y: finiteNumber(value.y, `${field}.y`),
    w: finiteNumber(value.w, `${field}.w`),
    h: finiteNumber(value.h, `${field}.h`),
    ...optionalNumber('r'),
    ...optionalString('groupId'),
    ...optionalBoolean('hidden'),
    ...optionalBoolean('locked'),
  }
}

function parseLegacyPage(value: unknown, index: number): CanvasPage {
  const field = `pages[${index}]`
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' || !value.id ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.items)
  ) throw new Error(`Legacy ${field} is missing id, name, or items`)
  const items = value.items.map((item, itemIndex) => {
    const itemField = `${field}.items[${itemIndex}]`
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' || !item.id ||
      typeof item.elementId !== 'string' || !item.elementId
    ) throw new Error(`Legacy ${itemField} is missing id or elementId`)
    return {
      id: item.id,
      elementId: item.elementId,
      height: finiteNumber(item.height, `${itemField}.height`),
    }
  })
  return {
    id: value.id,
    name: value.name,
    x: finiteNumber(value.x, `${field}.x`),
    y: finiteNumber(value.y, `${field}.y`),
    w: finiteNumber(value.w, `${field}.w`),
    items,
  }
}

/** Parse v1 shape/page columns without executing their saved source strings. */
export function parseLegacyStorage(
  shapesValue: unknown,
  pagesValue: unknown,
  name: string,
  id: string,
): CanvasDocument {
  const shapes = legacyArray(shapesValue, 'shapes').map(parseLegacyElement)
  const pages = legacyArray(pagesValue, 'pages').map(parseLegacyPage)
  const byId = new Map(shapes.map((shape) => [shape.id, shape]))
  if (byId.size !== shapes.length) throw new Error('Legacy shapes contain duplicate ids')

  const document = createCanvasDocument(name, id)
  const warnings = new Set<string>()
  const placed = new Set<string>()
  let pageOrder = 0

  const addSource = (
    shape: CanvasElement,
    parentId: string,
    order: number,
    position: { x: number; y: number; width: number; height: number },
    sourceKey: string,
    itemId?: string,
  ) => {
    const safeKey = sourceKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
    const frame = createFrameNode(shape.name, {
      id: `v1shape_${safeKey}`,
      parentId,
      order,
      hidden: shape.hidden ?? false,
      locked: shape.locked ?? false,
      rotation: shape.r ?? 0,
      layout: defaultLayout(position.width, position.height, {
        position: 'absolute',
        x: position.x,
        y: position.y,
      }),
      metadata: {
        legacyElementId: shape.id,
        ...(shape.groupId ? { legacyGroupId: shape.groupId } : {}),
        ...(itemId ? { legacyPageItemId: itemId } : {}),
      },
    })
    document.nodes[frame.id] = frame
    const source = createTextNode(shape.code, {
      id: `v1source_${safeKey}`,
      parentId: frame.id,
      order: 1_024,
    })
    document.nodes[source.id] = source
    placed.add(shape.id)
    warnings.add(`${shape.id}: legacy source was preserved as text and not executed`)
  }

  for (const [pageIndex, page] of pages.entries()) {
    const height = Math.max(1, page.items.reduce((total, item) => total + Math.max(1, item.height), 0))
    const node = createPageNode(page.name, {
      id: `v1page_${page.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)}_${pageIndex}`,
      order: (pageOrder += 1_024),
      layout: defaultLayout(page.w, height, { x: page.x, y: page.y }),
      viewport: { width: page.w, minHeight: height },
      metadata: { legacyPageId: page.id },
    })
    document.nodes[node.id] = node
    let itemY = 0
    page.items.forEach((item, itemIndex) => {
      const shape = byId.get(item.elementId)
      if (!shape) {
        warnings.add(`${page.id}/${item.id}: referenced missing legacy shape ${item.elementId}`)
        itemY += item.height
        return
      }
      addSource(shape, node.id, (itemIndex + 1) * 1_024, {
        x: 0,
        y: itemY,
        width: page.w,
        height: item.height,
      }, `p${pageIndex}_i${itemIndex}_${shape.id}`, item.id)
      itemY += item.height
    })
  }

  const unplaced = shapes.filter((shape) => !placed.has(shape.id))
  if (unplaced.length > 0) {
    const pageHeight = Math.max(900, ...unplaced.map((shape) => shape.y + shape.h))
    const page = createPageNode('Legacy canvas', {
      id: 'v1page_unplaced',
      order: (pageOrder += 1_024),
      layout: defaultLayout(1440, pageHeight),
      viewport: { width: 1440, minHeight: pageHeight },
      metadata: { legacyUnplacedElements: true },
    })
    document.nodes[page.id] = page
    unplaced.forEach((shape, index) => addSource(shape, page.id, (index + 1) * 1_024, {
      x: shape.x,
      y: shape.y,
      width: shape.w,
      height: shape.h,
    }, `u${index}_${shape.id}`))
  }

  document.metadata.migratedFrom = 1
  document.metadata.migrationWarnings = [...warnings]
  return assertDocument(document)
}

function legacyTag(node: CanvasNode) {
  if (node.type === 'page') return 'main'
  if (node.type === 'frame') return node.semanticTag
  if (node.type === 'text') return 'span'
  if (node.type === 'image') return 'img'
  if (node.type === 'vector') return 'svg'
  return 'div'
}

/** One-way compatibility migration. Legacy data never enters active editing. */
export function migrateLegacyDocument(document: CanvasDocument): WebDocument {
  const migrated = createWebDocument(document.name, document.id)
  const warnings: string[] = [...(document.metadata.migrationWarnings ?? [])]
  for (const node of Object.values(document.nodes)) {
    if (node.type === 'component' || node.type === 'instance') {
      warnings.push(`${node.id}: ${node.type} requires the web component model`)
      continue
    }
    const parent = node.parentId ? document.nodes[node.parentId] : undefined
    const styles = Object.fromEntries(
      layoutDeclarations(node.layout, {
        parent: parent ? layoutParent(parent.layout) : undefined,
        asRoot: node.parentId === null,
      }).map((declaration) => {
        const separator = declaration.indexOf(':')
        return [declaration.slice(0, separator), declaration.slice(separator + 1)]
      }),
    )
    styles.opacity = String(node.style.opacity)
    styles.overflow = node.style.overflow
    if (node.rotation) styles.transform = `rotate(${node.rotation}deg)`
    if (node.type === 'text' && node.style.fills[0]?.type === 'solid') {
      styles.color = colorValue(document, node.style.fills[0].color)
    } else if (node.style.fills.length > 0) {
      styles.background = node.style.fills
        .map((paint) => paintValue(document, paint))
        .join(',')
    }
    if (node.style.stroke) {
      styles.border = `${node.style.stroke.width}px ${node.style.stroke.style ?? 'solid'} ${colorValue(document, node.style.stroke.color)}`
    }
    const radii = Array.isArray(node.style.radius) ? node.style.radius : [node.style.radius]
    styles['border-radius'] = radii.map((radius) => `${radius}px`).join(' ')
    if (node.type === 'shape' && node.shape === 'ellipse') styles['border-radius'] = '50%'
    if (node.style.shadows.length > 0) {
      styles['box-shadow'] = node.style.shadows.map((shadow) =>
        `${shadow.inset ? 'inset ' : ''}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${colorValue(document, shadow.color)}`,
      ).join(',')
    }
    if (node.style.typography) {
      const typography = node.style.typography
      styles['font-family'] = fontFamilyValue(typography.family)
      styles['font-size'] = `${typography.size}px`
      styles['font-weight'] = String(typography.weight)
      styles['line-height'] = String(typography.lineHeight)
      styles['letter-spacing'] = `${typography.letterSpacing}px`
      styles['text-align'] = typography.align
      styles['white-space'] = typography.wrap === false ? 'nowrap' : 'pre-wrap'
      styles['text-decoration'] = typography.decoration ?? 'none'
      styles['text-transform'] = typography.transform ?? 'none'
    }
    if (node.type === 'image') styles['object-fit'] = node.fit
    const element = createWebElement(legacyTag(node), {
      id: node.id,
      parentId: node.parentId,
      order: node.order,
      namespace: node.type === 'vector' ? 'svg' : 'html',
      attributes:
        node.type === 'image'
          ? { src: node.src, alt: node.alt }
          : node.type === 'vector'
            ? { viewBox: node.viewBox }
            : {},
      styles,
    })
    migrated.nodes[element.id] = element
    if (node.type === 'text') {
      const text = createWebText(node.text, {
        id: `${node.id}:text`,
        parentId: node.id,
        order: 1_024,
      })
      migrated.nodes[text.id] = text
    }
  }
  migrated.roots = Object.values(migrated.nodes)
    .filter((node) => node.parentId === null || !migrated.nodes[node.parentId])
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((node) => node.id)
  for (const rootId of migrated.roots) {
    const root = migrated.nodes[rootId]
    if (root) root.parentId = null
  }
  migrated.metadata.migratedFrom = document.schemaVersion
  migrated.metadata.migrationWarnings = warnings
  return assertWebDocument(migrated)
}
