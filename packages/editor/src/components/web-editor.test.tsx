import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebStyleRule,
  createWebStyleSheet,
  createWebText,
} from '@sheet/canvas/web-model'
import { matchingAuthoredRules, WebCanvasEditor } from './web-editor'

function fixture() {
  const document = createWebDocument('Web editor', 'web-editor')
  document.nodes.main = createWebElement('main', {
    id: 'main',
    order: 1_024,
    styles: { width: '800px', height: '600px', display: 'flex', gap: '24px' },
  })
  document.nodes.heading = createWebElement('h1', {
    id: 'heading',
    parentId: 'main',
    order: 1_024,
    styles: { color: 'rgb(20, 20, 24)' },
  })
  document.nodes.text = createWebText('Build faster', {
    id: 'text',
    parentId: 'heading',
    order: 1_024,
  })
  document.roots = ['main']
  return assertWebDocument(document)
}

describe('WebCanvasEditor', () => {
  it('keeps the full authoring chrome available for an empty WebDocument', () => {
    const view = render(
      <div className="h-[800px] w-[1200px]">
        <WebCanvasEditor
          designId="empty-editor"
          initialDocument={createWebDocument('Empty editor', 'empty-editor')}
          initialRevision={0}
          name="Empty editor"
        />
      </div>,
    )

    expect(view.getByRole('toolbar', { name: 'Tools' })).toBeTruthy()
    expect(view.getByText('Layers')).toBeTruthy()
    expect(view.getByText('Design')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Frame' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Text' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Image' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Create root element' })).toBeTruthy()
  })

  it('renders a WebDocument in the editor chrome and selects native DOM nodes', async () => {
    const view = render(
      <div className="h-[800px] w-[1200px]">
        <WebCanvasEditor
          designId="web-editor"
          initialDocument={fixture()}
          initialRevision={1}
          name="Web editor"
        />
      </div>,
    )

    expect(view.getByRole('complementary', { name: 'Layers' })).toBeTruthy()
    expect(view.getByRole('complementary', { name: 'Design' })).toBeTruthy()
    const heading = view.container.querySelector<HTMLElement>(
      '[data-sheet-node="heading"]',
    )
    expect(heading?.tagName).toBe('H1')
    expect(heading?.textContent).toBe('Build faster')

    fireEvent.click(heading!)
    await waitFor(() => {
      const tag = view.getByLabelText('tag')
      expect(tag).toBeInstanceOf(HTMLInputElement)
      if (tag instanceof HTMLInputElement) expect(tag.value).toBe('h1')
    })
    const color = view.getByLabelText('color')
    expect(color).toBeInstanceOf(HTMLInputElement)
    if (color instanceof HTMLInputElement) {
      expect(color.value).toBe('rgb(20, 20, 24)')
    }
  })

  it('separates authored stylesheet rules from computed browser output', async () => {
    const document = createWebDocument('Styled editor', 'styled-editor')
    document.nodes.card = createWebElement('div', {
      id: 'card',
      order: 1_024,
      attributes: { class: 'card' },
      styles: { width: '800px', height: '600px' },
    })
    document.roots = ['card']
    document.stylesheets.main = createWebStyleSheet('main', { id: 'main', order: 1_024 })
    document.stylesheets.main.rules.base = createWebStyleRule(
      '.card',
      { display: 'grid', gap: '20px' },
      { id: 'base', order: 1_024 },
    )
    document.stylesheets.main.rules.narrow = createWebStyleRule(
      '.card',
      { gap: '8px' },
      { id: 'narrow', order: 2_048, conditions: [{ kind: 'media', query: '(max-width: 768px)' }] },
    )
    document.stylesheets.main.rules.before = createWebStyleRule(
      '.card::before',
      { content: '"★"' },
      { id: 'before', order: 3_072 },
    )
    document.stylesheets.main.ruleOrder = ['base', 'narrow', 'before']
    document.stylesheetOrder = ['main']
    const initial = assertWebDocument(document)

    const view = render(
      <div className="h-[800px] w-[1200px]">
        <WebCanvasEditor
          designId="styled-editor"
          initialDocument={initial}
          initialRevision={1}
          name="Styled editor"
        />
      </div>,
    )

    // The card root is selected by default; the browser groups its rules once
    // the design DOM materializes and a measure pass re-renders.
    await waitFor(() => {
      expect(view.getAllByDisplayValue('.card')).toHaveLength(2)
    })
    expect(view.getByDisplayValue('.card::before')).toBeInstanceOf(HTMLInputElement)
    expect(view.getByText('@media (max-width: 768px)')).toBeTruthy()
    expect(view.getByText('pseudo-element · stays CSS')).toBeTruthy()
    expect(view.getByText('Computed · browser output · read-only')).toBeTruthy()

    const card = view.container.querySelector<HTMLElement>('[data-sheet-node="card"]')
    expect(card).not.toBeNull()
    const grouped = matchingAuthoredRules(card, initial)
    expect(grouped.map(({ rule }) => rule.id)).toEqual(['base', 'narrow', 'before'])
    expect(grouped.at(-1)?.viaPseudoElement).toBe(true)
  })
})
