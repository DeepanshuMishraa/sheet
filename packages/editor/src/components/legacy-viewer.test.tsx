import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
} from '@sheet/canvas/legacy-model'
import { LegacyDocumentViewer } from './legacy-viewer'

function legacyFixture() {
  const document = createCanvasDocument('Legacy file', 'legacy-file')
  const page = createPageNode('Home', { id: 'page-home' })
  const card = createFrameNode('Card', {
    id: 'card',
    parentId: 'page-home',
    order: 1_024,
    semanticTag: 'section',
  })
  document.nodes[page.id] = page
  document.nodes[card.id] = card
  return document
}

describe('LegacyDocumentViewer', () => {
  const originalRect = Element.prototype.getBoundingClientRect

  beforeEach(() => {
    // JSDOM reports zero sizes; the fit-view preview needs a box to render.
    Element.prototype.getBoundingClientRect = () =>
      ({ width: 800, height: 600, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0, toJSON: () => {} }) as DOMRect
  })

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect
  })
  it('renders a legacy document read-only with migration and archive actions', () => {
    const onMigrate = vi.fn()
    const onArchive = vi.fn()
    const view = render(
      <div className="h-[600px] w-[800px]">
        <LegacyDocumentViewer
          document={legacyFixture()}
          name="Legacy file"
          onMigrate={onMigrate}
          onArchive={onArchive}
        />
      </div>,
    )
    expect(view.getByText('Legacy file')).toBeTruthy()
    expect(view.getByText('read-only legacy')).toBeTruthy()
    // Compatibility rendering is a one-way web materialization, never an editor.
    expect(view.container.querySelector('[data-sheet-node="card"]')).not.toBeNull()
    expect(view.container.querySelector('[data-sheet-node-type]')).toBeNull()
    fireEvent.click(view.getByText('Migrate'))
    expect(onMigrate).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByText('Archive'))
    expect(onArchive).toHaveBeenCalledTimes(1)
  })
})
