import {
  createWebElement,
  orderedWebChildren,
  STAGE_MAIN_KEY,
  type WebDocument,
  type WebElementNode,
  type WebNode,
} from './web-model'

/**
 * A page is a top-level element tagged `data-sheet-page="<name>"` whose own
 * width, height and background are the page's canvas. Everything inside it
 * belongs to that page and to no other; the editor and the tools show one page
 * at a time.
 *
 * Roots that carry no tag are the design's original, unnamed page ("Page 1").
 * Every design has it, empty until something is made on it, and it is always
 * listed first, so adding a page never makes Page 1 disappear.
 */
export const PAGE_ATTRIBUTE = 'data-sheet-page'
export const NAME_ATTRIBUTE = 'data-name'
export const DEFAULT_PAGE_WIDTH = 1_440
export const DEFAULT_PAGE_HEIGHT = 900
export const IMPLICIT_PAGE_NAME = 'Page 1'

export interface WebPage {
  /** The page's root node id, or `null` for the implicit page. */
  id: string | null
  name: string
}

export function isPageNode(node: WebNode | null | undefined): node is WebElementNode {
  return node?.kind === 'element' && node.parentId === null && node.attributes[PAGE_ATTRIBUTE] !== undefined
}

/** Top-level nodes that belong to the implicit page, in document order. */
export function implicitPageRootIds(document: WebDocument) {
  return document.roots.filter((id) => !isPageNode(document.nodes[id]))
}

/** Page root ids in document order. */
export function pageRootIds(document: WebDocument) {
  return document.roots.filter((id) => isPageNode(document.nodes[id]))
}

export function listPages(document: WebDocument): WebPage[] {
  const pages: WebPage[] = pageRootIds(document).map((id) => {
    const node = document.nodes[id]
    return { id, name: node?.kind === 'element' ? node.attributes[PAGE_ATTRIBUTE]?.trim() || 'Untitled' : 'Untitled' }
  })
  pages.unshift({ id: null, name: document.metadata.pageOneName?.trim() || IMPLICIT_PAGE_NAME })
  return pages
}

/** The colour behind a page's frames, if one was chosen; the editor's own surface colour otherwise. */
export function stageColor(document: WebDocument, pageId: string | null) {
  return document.metadata.stageColors?.[pageId ?? STAGE_MAIN_KEY] ?? null
}

/**
 * The page a design opens on: Page 1 when it has anything on it, otherwise the
 * first named page, so a design an agent built on its own pages opens on them
 * rather than on an empty Page 1.
 */
export function openingPageId(document: WebDocument) {
  if (implicitPageRootIds(document).length > 0) return null
  return pageRootIds(document)[0] ?? null
}

/** A page id that still exists, falling back to the first listed page. */
export function resolvePageId(document: WebDocument, pageId: string | null) {
  const pages = listPages(document)
  return pages.some((page) => page.id === pageId) ? pageId : (pages[0]?.id ?? null)
}

/** Root ids to render for a page: its own root, or every implicit-page root. */
export function visibleRootIds(document: WebDocument, pageId: string | null) {
  return pageId === null ? implicitPageRootIds(document) : [pageId]
}

/** Where new content goes by default on a page. */
export function pageParentId(document: WebDocument, pageId: string | null) {
  return pageId === null ? (implicitPageRootIds(document)[0] ?? null) : pageId
}

/**
 * Where an interactive insert goes. The unnamed page is the open canvas: new
 * frames are top-level objects on it, never children of whichever root happens
 * to come first. A named page is a bounded artboard, so it takes its own root.
 * Agent tools keep using `pageParentId`, which targets the first root.
 */
export function canvasParentId(pageId: string | null) {
  return pageId
}

/** Top-level layers of a page, as shown in the layers panel. */
export function pageLayerIds(document: WebDocument, pageId: string | null) {
  if (pageId === null) return implicitPageRootIds(document)
  return orderedWebChildren(document, pageId).map((node) => node.id)
}

function pixels(value: string | undefined) {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)px$/)
  return match ? Number(match[1]) : null
}

/** The size a page canvas has, from its root's authored width and height. */
export function pageRootSize(document: WebDocument, pageId: string) {
  const node = document.nodes[pageId]
  const styles = node?.kind === 'element' ? node.styles : {}
  return {
    width: pixels(styles.width) ?? DEFAULT_PAGE_WIDTH,
    height: pixels(styles.height) ?? DEFAULT_PAGE_HEIGHT,
  }
}

export function nextPageName(document: WebDocument) {
  const taken = new Set(listPages(document).map((page) => page.name))
  const start = listPages(document).length + 1
  for (let number = start; ; number += 1) {
    const name = `Page ${number}`
    if (!taken.has(name)) return name
  }
}

export interface PageOptions {
  name?: string
  width?: number
  height?: number
  background?: string
  /**
   * An open page has no edge and no paint: it is empty until frames are set on
   * it, and they may sit anywhere. This is what the editor's Add page makes,
   * and what Page 1 already is. Without it the page is a bounded, painted
   * artboard, which is what agents get from `createPage`.
   */
  open?: boolean
  order: number
}

/** The root element for a new page. Insert it with `node.insert`; it becomes an isolated page. */
export function pageNode(name: string, options: PageOptions) {
  return createWebElement('div', {
    parentId: null,
    order: options.order,
    attributes: { [PAGE_ATTRIBUTE]: name },
    styles: {
      position: 'relative',
      width: `${options.width ?? DEFAULT_PAGE_WIDTH}px`,
      height: `${options.height ?? DEFAULT_PAGE_HEIGHT}px`,
      overflow: options.open ? 'visible' : 'hidden',
      background: options.open ? 'transparent' : (options.background ?? '#ffffff'),
    },
  })
}

/** True when a page has an edge: its root clips and paints, like an artboard. */
export function isBoundedPage(document: WebDocument, pageId: string | null) {
  if (pageId === null) return false
  const node = document.nodes[pageId]
  return node?.kind === 'element' && node.styles.overflow === 'hidden'
}

/** Order after every current root, spaced like sibling inserts elsewhere. */
export function nextRootOrder(document: WebDocument) {
  return document.roots.reduce((max, id) => Math.max(max, document.nodes[id]?.order ?? 0), 0) + 1_024
}

const FRAME_TAGS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'form', 'ul', 'ol', 'li', 'figure'])
const TEXT_TAGS = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'strong', 'em', 'small', 'blockquote'])

export type LayerKind = 'frame' | 'frame-row' | 'frame-column' | 'text' | 'image' | 'svg' | 'shape' | 'link' | 'button' | 'input' | 'element'

/** What a layer is, for its icon and default name. Layout-aware: a flex frame shows its direction. */
export function layerKind(node: WebNode): LayerKind {
  if (node.kind === 'text') return 'text'
  const tag = node.tag.toLowerCase()
  if (node.namespace === 'svg') return tag === 'svg' ? 'svg' : 'shape'
  if (tag === 'img') return 'image'
  if (tag === 'a') return 'link'
  if (tag === 'button') return 'button'
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input'
  if (TEXT_TAGS.has(tag)) return 'text'
  if (FRAME_TAGS.has(tag)) {
    if (/^(inline-)?flex$/.test(node.styles.display ?? '')) {
      return (node.styles['flex-direction'] ?? 'row').startsWith('column') ? 'frame-column' : 'frame-row'
    }
    return 'frame'
  }
  return 'element'
}

const KIND_NAMES: Record<LayerKind, string> = {
  frame: 'Frame',
  'frame-row': 'Frame',
  'frame-column': 'Frame',
  text: 'Text',
  image: 'Image',
  svg: 'SVG',
  shape: 'Path',
  link: 'Link',
  button: 'Button',
  input: 'Input',
  element: 'Element',
}

function ownText(document: WebDocument, node: WebElementNode) {
  const children = orderedWebChildren(document, node.id)
  if (children.length === 0 || children.some((child) => child.kind !== 'text')) return null
  const value = children.map((child) => (child.kind === 'text' ? child.text : '')).join(' ').trim().replace(/\s+/g, ' ')
  return value || null
}

/** Children shown under a layer. A text element with only text inside is one layer, like "Aa Title". */
export function layerChildren(document: WebDocument, node: WebNode) {
  if (node.kind !== 'element') return []
  if (layerKind(node) === 'text' && ownText(document, node) !== null) return []
  if (node.attributes['data-icon-name'] !== undefined) return []
  return orderedWebChildren(document, node.id)
}

/**
 * The name a layer shows: an authored `data-name`, a page name, an icon or
 * shader label, a text element's own text, otherwise its kind ("Frame",
 * "Image", …), never the raw tag.
 */
export function layerName(node: WebNode, document?: WebDocument) {
  if (node.kind === 'text') {
    const value = node.text.trim().replace(/\s+/g, ' ')
    return value ? value.slice(0, 40) : 'Text'
  }
  const authored = node.attributes[NAME_ATTRIBUTE]?.trim()
  if (authored) return authored
  const page = node.attributes[PAGE_ATTRIBUTE]?.trim()
  if (page) return page
  const iconName = node.attributes['data-icon-name']
  if (iconName) return iconName
  if (node.attributes['data-shader']) return node.attributes['aria-label'] ?? 'Shader'
  if (layerKind(node) === 'text' && document) {
    const text = ownText(document, node)
    if (text) return text.slice(0, 40)
  }
  return KIND_NAMES[layerKind(node)]
}
