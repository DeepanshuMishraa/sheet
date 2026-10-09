import { describe, expect, test } from 'vitest'
import { applyWebTransaction, createWebDocument, createWebElement, createWebText } from './web-model'
import {
  canvasParentId,
  isBoundedPage,
  layerChildren,
  layerName,
  listPages,
  nextPageName,
  nextRootOrder,
  openingPageId,
  pageLayerIds,
  pageNode,
  pageParentId,
  planLayerMove,
  pageRootSize,
  resolvePageId,
  visibleRootIds,
} from './web-pages'

function withPages() {
  const legacy = createWebElement('main', { id: 'legacy', parentId: null, order: 1_024 })
  const base = { ...createWebDocument('t'), roots: [legacy.id], nodes: { [legacy.id]: legacy } }
  const second = pageNode('Landing', { order: nextRootOrder(base), width: 800, height: 600 })
  const document = applyWebTransaction(base, {
    id: 'tx-1',
    label: 'Add page',
    operations: [{ type: 'node.insert', node: second }],
  }).document
  return { document, second }
}

describe('web pages', () => {
  test('an empty design lists the implicit page only', () => {
    expect(listPages(createWebDocument('t'))).toEqual([{ id: null, name: 'Page 1' }])
  })

  test('Page 1 stays listed first when another page is added', () => {
    const base = createWebDocument('t')
    const page = pageNode('Home', { order: nextRootOrder(base) })
    const document = applyWebTransaction(base, {
      id: 'tx-1', label: 'Add page', operations: [{ type: 'node.insert', node: page }],
    }).document
    expect(listPages(document)).toEqual([
      { id: null, name: 'Page 1' },
      { id: page.id, name: 'Home' },
    ])
  })

  test('a design opens on Page 1, or on its first named page when Page 1 is empty and others are not', () => {
    const base = createWebDocument('t')
    expect(openingPageId(base)).toBe(null)
    const page = pageNode('Home', { order: nextRootOrder(base) })
    const named = applyWebTransaction(base, {
      id: 'tx-1', label: 'Add page', operations: [{ type: 'node.insert', node: page }],
    }).document
    expect(openingPageId(named)).toBe(page.id)
    expect(openingPageId(withPages().document)).toBe(null)
  })

  test('an open page has no edge or paint, a default page is a bounded artboard', () => {
    const base = createWebDocument('t')
    const open = pageNode('Open', { order: nextRootOrder(base), open: true })
    const bounded = pageNode('Board', { order: nextRootOrder(base) })
    const document = applyWebTransaction(base, {
      id: 'tx-1', label: 'Add pages', operations: [
        { type: 'node.insert', node: open },
        { type: 'node.insert', node: bounded },
      ],
    }).document
    expect(isBoundedPage(document, open.id)).toBe(false)
    expect(isBoundedPage(document, bounded.id)).toBe(true)
    expect(isBoundedPage(document, null)).toBe(false)
  })

  test('pages are isolated: each shows only its own roots and layers', () => {
    const { document, second } = withPages()
    expect(listPages(document).map((page) => page.name)).toEqual(['Page 1', 'Landing'])
    expect(visibleRootIds(document, null)).toEqual(['legacy'])
    expect(visibleRootIds(document, second.id)).toEqual([second.id])
    expect(pageLayerIds(document, second.id)).toEqual([])
    expect(pageParentId(document, null)).toBe('legacy')
    expect(pageParentId(document, second.id)).toBe(second.id)
    // Page 1 takes new frames at the top level; agents still target the first root.
    expect(canvasParentId(null)).toBe(null)
    expect(canvasParentId(second.id)).toBe(second.id)
    expect(pageRootSize(document, second.id)).toEqual({ width: 800, height: 600 })
  })

  test('content inserted under a page root belongs to that page only', () => {
    const { document, second } = withPages()
    const child = createWebElement('div', { id: 'card', parentId: second.id, order: 1_024 })
    const next = applyWebTransaction(document, {
      id: 'tx-2', label: 'Insert', operations: [{ type: 'node.insert', node: child }],
    }).document
    expect(pageLayerIds(next, second.id)).toEqual(['card'])
    expect(pageLayerIds(next, null)).toEqual(['legacy'])
  })

  test('a removed page falls back to a listed one and names do not collide', () => {
    const { document } = withPages()
    expect(resolvePageId(document, 'gone')).toBe(null)
    expect(nextPageName(document)).toBe('Page 3')
  })

  test('layers are named by what they are, not by their tag', () => {
    const frame = createWebElement('div', { id: 'f', parentId: null, order: 1, styles: { display: 'flex' } })
    const title = createWebElement('h1', { id: 'h', parentId: 'f', order: 1 })
    const text = createWebText('Hello world', { id: 't', parentId: 'h', order: 1 })
    const base = { ...createWebDocument('t'), roots: ['f'], nodes: { f: frame, h: title, t: text } }
    expect(layerName(frame, base)).toBe('Frame')
    expect(layerName(title, base)).toBe('Hello world')
    expect(layerChildren(base, title)).toEqual([])
    expect(layerChildren(base, frame).map((node) => node.id)).toEqual(['h'])
    const named = createWebElement('div', { id: 'n', parentId: null, order: 1, attributes: { 'data-name': 'Hero' } })
    expect(layerName(named, base)).toBe('Hero')
    expect(layerName(createWebElement('img', { id: 'i', parentId: null, order: 1 }), base)).toBe('Image')
  })
})

describe('planLayerMove', () => {
  function tree() {
    const base = createWebDocument('t')
    const make = (id: string, parentId: string | null, order: number) =>
      createWebElement('div', { id, parentId, order })
    const nodes = [
      make('a', null, 1_024),
      make('b', null, 2_048),
      make('c', null, 3_072),
      make('a1', 'a', 1_024),
      make('a2', 'a', 2_048),
    ]
    const document = applyWebTransaction(base, {
      id: 'tx-tree',
      label: 'Tree',
      operations: nodes.map((node) => ({ type: 'node.insert' as const, node })),
    }).document
    return document
  }

  test('dropping inside puts the layer last in the target', () => {
    expect(planLayerMove(tree(), 'c', 'a', 'inside')).toEqual({ parentId: 'a', order: 3_072 })
    expect(planLayerMove(tree(), 'c', 'b', 'inside')).toEqual({ parentId: 'b', order: 1_024 })
  })

  test('dropping before or after lands between neighbours under the target\'s parent', () => {
    expect(planLayerMove(tree(), 'c', 'b', 'before')).toEqual({ parentId: null, order: 1_536 })
    expect(planLayerMove(tree(), 'a', 'c', 'after')).toEqual({ parentId: null, order: 4_096 })
    expect(planLayerMove(tree(), 'c', 'a', 'before')).toEqual({ parentId: null, order: 0 })
    expect(planLayerMove(tree(), 'c', 'a1', 'after')).toEqual({ parentId: 'a', order: 1_536 })
  })

  test('refuses a layer onto itself and into its own subtree', () => {
    expect(planLayerMove(tree(), 'a', 'a', 'inside')).toBeNull()
    expect(planLayerMove(tree(), 'a', 'a1', 'inside')).toBeNull()
    expect(planLayerMove(tree(), 'a', 'a2', 'before')).toBeNull()
    expect(planLayerMove(tree(), 'a', 'missing', 'inside')).toBeNull()
  })
})
