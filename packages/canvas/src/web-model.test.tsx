import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  createTextNode,
  type ImageNode,
  type ShapeNode,
} from './legacy-model'
import {
  applyWebTransaction,
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebText,
  parseWebHtml,
  serializeWebDocument,
  webNodeIdFromElement,
  writeWebHtml,
} from './web-model'
import { migrateLegacyDocument } from './legacy-migration'
import { WebDocumentView } from './web-react'

function fixture() {
  const document = createWebDocument('Settings', 'settings')
  document.nodes.page = createWebElement('main', {
    id: 'page',
    order: 1_024,
    attributes: { 'aria-label': 'Settings' },
    styles: { display: 'flex', gap: '16px' },
  })
  document.nodes.heading = createWebElement('h1', {
    id: 'heading',
    parentId: 'page',
    order: 1_024,
    styles: { color: 'rgb(20, 20, 24)' },
  })
  document.nodes.copy = createWebText('Settings', {
    id: 'copy',
    parentId: 'heading',
    order: 1_024,
  })
  document.roots = ['page']
  return assertWebDocument(document)
}

describe('web-native document tracer bullet', () => {
  it('uses HTML elements, text, attributes, and CSS as the canonical state', () => {
    const document = fixture()

    expect(document.nodes.page).toEqual({
      id: 'page',
      kind: 'element',
      parentId: null,
      order: 1_024,
      namespace: 'html',
      tag: 'main',
      attributes: { 'aria-label': 'Settings' },
      styles: { display: 'flex', gap: '16px' },
    })
    expect(serializeWebDocument(document)).toBe(
      '<main aria-label="Settings" style="display:flex;gap:16px"><h1 style="color:rgb(20, 20, 24)">Settings</h1></main>',
    )
  })

  it('resizes the page independently of its element tree, with undo and boundary validation', () => {
    const original = fixture()
    const result = applyWebTransaction(original, {
      id: 'resize-page', label: 'Resize page',
      operations: [{ type: 'page.resize', width: 1024, height: 768 }],
    })
    expect(result.document.metadata.page).toEqual({ width: 1024, height: 768 })
    expect(result.document.nodes).toEqual(original.nodes)
    expect(applyWebTransaction(result.document, result.inverse).document.metadata.page).toBeUndefined()
    expect(() => applyWebTransaction(original, {
      id: 'invalid-size', label: 'Invalid size',
      operations: [{ type: 'page.resize', width: -1, height: 768 }],
    })).toThrow('Web page size must be between')
  })

  it('applies style and tree edits as reversible transactions', () => {
    const document = fixture()
    const result = applyWebTransaction(document, {
      id: 'edit-heading',
      label: 'Edit heading',
      operations: [
        {
          type: 'node.patch',
          id: 'heading',
          patch: {
            kind: 'element',
            styles: { color: 'rebeccapurple', 'font-size': '32px' },
          },
        },
        { type: 'node.move', id: 'heading', parentId: null, order: 2_048 },
      ],
    })

    expect(result.document.nodes.heading).toMatchObject({
      parentId: null,
      styles: { color: 'rebeccapurple', 'font-size': '32px' },
    })
    expect(result.document.roots).toEqual(['page', 'heading'])

    const undone = applyWebTransaction(result.document, result.inverse).document
    expect(undone.nodes.heading).toEqual(document.nodes.heading)
    expect(undone.roots).toEqual(['page'])
  })

  it('imports HTML into the same representation and writes it through a transaction', () => {
    const imported = parseWebHtml(
      '<section style="display:grid;gap:24px"><h2>Profile</h2><script>alert(1)</script></section>',
      { id: 'imported' },
    )
    const section = imported.nodes[imported.roots[0]!]
    expect(section).toMatchObject({
      kind: 'element',
      tag: 'section',
      styles: { display: 'grid', gap: '24px' },
    })
    expect(Object.values(imported.nodes).some((node) =>
      node.kind === 'element' && node.tag === 'script',
    )).toBe(false)
    expect(serializeWebDocument(imported)).toBe(
      '<section style="display:grid;gap:24px"><h2>Profile</h2></section>',
    )

    const written = writeWebHtml(fixture(), 'page', '<button type="button">Save</button>')
    expect(serializeWebDocument(written.document)).toContain(
      '<button type="button">Save</button>',
    )
    expect(written.inverse.operations.length).toBe(2)
  })

  it('materializes native DOM and maps selection targets to stable node IDs', () => {
    let selected: string | null = null
    const view = render(
      <div
        onClick={(event) => {
          selected = webNodeIdFromElement(event.target as Element)
        }}
      >
        <WebDocumentView document={fixture()} />
      </div>,
    )

    const heading = view.container.querySelector<HTMLElement>('[data-sheet-node="heading"]')
    expect(heading?.tagName).toBe('H1')
    expect(heading?.style.color).toBe('rgb(20, 20, 24)')
    fireEvent.click(heading!)
    expect(selected).toBe('heading')
  })

  it('mechanically maps representative legacy layout nodes without keeping two sources', () => {
    const legacy = createCanvasDocument('Legacy', 'legacy')
    legacy.nodes.page = createPageNode('Page', { id: 'page' })
    legacy.nodes.stack = createFrameNode('Stack', {
      id: 'stack',
      parentId: 'page',
      order: 1_024,
      semanticTag: 'section',
      layout: {
        ...createFrameNode().layout,
        position: 'flow',
        mode: 'flex',
        direction: 'column',
        gap: 12,
      },
    })
    legacy.nodes.label = createTextNode('Hello', {
      id: 'label',
      parentId: 'stack',
      order: 1_024,
    })
    const { semanticTag: _shapeTag, ...shapeBase } = createFrameNode('Card', {
      id: 'shape',
      parentId: 'stack',
      order: 2_048,
      style: {
        ...createFrameNode().style,
        fills: [{ type: 'solid', color: '#ff0000' }],
      },
    })
    const shape: ShapeNode = {
      ...shapeBase,
      type: 'shape',
      shape: 'rectangle',
    }
    legacy.nodes.shape = shape
    const { semanticTag: _imageTag, ...imageBase } = createFrameNode('Photo', {
      id: 'image',
      parentId: 'stack',
      order: 3_072,
    })
    const image: ImageNode = {
      ...imageBase,
      type: 'image',
      src: 'https://example.com/photo.jpg',
      alt: 'Photo',
      fit: 'cover',
    }
    legacy.nodes.image = image

    const migrated = migrateLegacyDocument(legacy)
    expect(migrated.nodes.stack).toMatchObject({
      kind: 'element',
      tag: 'section',
      styles: {
        display: 'flex',
        'flex-direction': 'column',
        gap: '12px',
      },
    })
    expect(serializeWebDocument(migrated)).toContain('<span')
    expect(serializeWebDocument(migrated)).toContain('Hello</span>')
    expect(migrated.nodes.shape).toMatchObject({
      kind: 'element',
      tag: 'div',
      styles: { background: '#ff0000' },
    })
    expect(migrated.nodes.image).toMatchObject({
      kind: 'element',
      tag: 'img',
      attributes: { src: 'https://example.com/photo.jpg', alt: 'Photo' },
      styles: { 'object-fit': 'cover' },
    })
  })

  it('rejects executable elements, attributes, URLs, and CSS', () => {
    const document = fixture()
    const page = document.nodes.page
    if (page.kind !== 'element') throw new Error('Fixture root is missing')

    expect(() =>
      assertWebDocument({
        ...document,
        nodes: {
          ...document.nodes,
          page: { ...page, attributes: { onclick: 'alert(1)' } },
        },
      }),
    ).toThrow('attributes.onclick is invalid')

    expect(() =>
      applyWebTransaction(document, {
        id: 'unsafe-style',
        label: 'Unsafe style',
        operations: [{
          type: 'node.patch',
          id: 'page',
          patch: {
            kind: 'element',
            styles: { background: 'url(javascript:alert(1))' },
          },
        }],
      }),
    ).toThrow('styles.background is invalid')
  })
})
