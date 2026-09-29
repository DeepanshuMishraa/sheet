import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { assertWebDocument, createWebDocument, createWebElement } from '@sheet/canvas/web-model'
import { WebDocumentPreview, webPreviewBounds } from './web-preview'

function fixture(width: string, height: string) {
  const document = createWebDocument('Preview', 'preview')
  document.nodes.root = createWebElement('main', {
    id: 'root',
    order: 1_024,
    styles: { width, height },
  })
  document.roots = ['root']
  return assertWebDocument(document)
}

describe('webPreviewBounds', () => {
  it('labels an empty design instead of showing an unexplained blank thumbnail', () => {
    const view = render(<WebDocumentPreview document={createWebDocument('Empty')} />)
    expect(view.getByText('Empty design')).toBeTruthy()
  })

  it('centers the scaled document within the thumbnail instead of translating its full width', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320)
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
    try {
      const view = render(<WebDocumentPreview document={fixture('800px', '1600px')} />)
      const preview = view.container.querySelector<HTMLElement>('[data-sheet-document]')?.parentElement
      expect(preview?.style.left).toBe('110px')
      expect(preview?.style.transform).toBe('scale(0.125)')
    } finally {
      width.mockRestore()
      height.mockRestore()
    }
  })

  it('fits the authored page instead of assuming one fixed thumbnail scale', () => {
    expect(webPreviewBounds(fixture('800px', '1600px'))).toEqual({ width: 800, height: 1600 })
    expect(webPreviewBounds(fixture('100%', 'auto'))).toEqual({ width: 1440, height: 900 })
    const resized = fixture('800px', '1600px')
    resized.metadata.page = { width: 1024, height: 768 }
    expect(webPreviewBounds(resized)).toEqual({ width: 1024, height: 768 })
  })
})
