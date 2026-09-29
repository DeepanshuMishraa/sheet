import { describe, expect, test } from 'vitest'
import { applyWebTransaction, createWebDocument, createWebElement, createWebText } from './web-model'
import {
  layerChildren,
  layerName,
  listPages,
  nextPageName,
  nextRootOrder,
  pageLayerIds,
  pageNode,
  pageParentId,
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

  test('the implicit page hides once another page exists and it has no content', () => {
    const base = createWebDocument('t')
    const page = pageNode('Home', { order: nextRootOrder(base) })
    const document = applyWebTransaction(base, {
      id: 'tx-1', label: 'Add page', operations: [{ type: 'node.insert', node: page }],
    }).document
    expect(listPages(document)).toEqual([{ id: page.id, name: 'Home' }])
  })

  test('pages are isolated: each shows only its own roots and layers', () => {
    const { document, second } = withPages()
    expect(listPages(document).map((page) => page.name)).toEqual(['Page 1', 'Landing'])
    expect(visibleRootIds(document, null)).toEqual(['legacy'])
    expect(visibleRootIds(document, second.id)).toEqual([second.id])
    expect(pageLayerIds(document, second.id)).toEqual([])
    expect(pageParentId(document, null)).toBe('legacy')
    expect(pageParentId(document, second.id)).toBe(second.id)
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
