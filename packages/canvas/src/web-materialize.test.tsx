import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebStyleRule,
  createWebStyleSheet,
} from './web-model'
import { WebDocumentView } from './web-react'

function fixture() {
  const document = createWebDocument('Materialize', 'materialize')
  document.nodes.card = createWebElement('div', {
    id: 'card',
    order: 1_024,
    attributes: { class: 'card' },
  })
  document.roots = ['card']
  document.stylesheets.theme = createWebStyleSheet('theme', { id: 'theme', order: 512 })
  document.stylesheets.theme.rules.root = createWebStyleRule(
    ':root',
    { '--brand': '#18181b' },
    { id: 'root', order: 1_024 },
  )
  document.stylesheets.theme.ruleOrder = ['root']
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
  document.stylesheets.main.ruleOrder = ['base', 'narrow']
  document.stylesheetOrder = ['theme', 'main']
  return assertWebDocument(document)
}

describe('WebDocumentView stylesheet materialization', () => {
  it('mounts authored stylesheets as <style> elements in cascade order ahead of the DOM', () => {
    const view = render(<WebDocumentView document={fixture()} />)
    const styles = [...view.container.querySelectorAll('style[data-sheet-stylesheet]')]
    expect(styles.map((style) => style.getAttribute('data-sheet-stylesheet'))).toEqual([
      'theme',
      'main',
    ])
    expect(styles[0]?.textContent).toBe('@scope ([data-sheet-document]){:scope{--brand:#18181b}}')
    expect(styles[1]?.textContent).toBe(
      '@scope ([data-sheet-document]){.card{display:grid;gap:20px}@media (max-width: 768px){.card{gap:8px}}}',
    )
    const host = view.container.firstElementChild
    const card = view.container.querySelector('[data-sheet-node="card"]')
    expect(host?.firstElementChild?.tagName).toBe('STYLE')
    expect(card?.compareDocumentPosition(styles[1] as Element)).toBe(
      // The card follows its stylesheets in document order.
      Node.DOCUMENT_POSITION_PRECEDING,
    )
  })

  it('mounts no style elements when the document has no stylesheets', () => {
    const document = createWebDocument('Bare', 'bare')
    document.nodes.card = createWebElement('div', { id: 'card', order: 1_024 })
    document.roots = ['card']
    const view = render(<WebDocumentView document={assertWebDocument(document)} />)
    expect(view.container.querySelector('style[data-sheet-stylesheet]')).toBeNull()
    expect(
      view.container.querySelector('[data-sheet-node="card"]')?.tagName,
    ).toBe('DIV')
  })

  it('keeps document rules such as :root and body inside the document host', () => {
    const document = fixture()
    document.stylesheets.theme.rules.root.declarations['--background'] = '#111111'
    document.stylesheets.theme.rules.body = createWebStyleRule('body', { background: 'red' }, { id: 'body', order: 2_048 })
    document.stylesheets.theme.ruleOrder.push('body')
    const view = render(<WebDocumentView document={assertWebDocument(document)} />)
    const css = view.container.querySelector('style[data-sheet-stylesheet="theme"]')?.textContent
    expect(css).toContain('@scope ([data-sheet-document])')
    expect(css).not.toContain(':root{')
    expect(css).not.toContain('body{')
  })

  it('isolates unstyled document content from the app theme', () => {
    const document = createWebDocument('Bare', 'bare')
    document.nodes.card = createWebElement('div', { id: 'card', order: 1_024 })
    document.roots = ['card']
    const view = render(
      <div style={{ color: 'hotpink', background: 'black', colorScheme: 'dark' }}>
        <WebDocumentView document={assertWebDocument(document)} />
      </div>,
    )
    const host = view.container.querySelector<HTMLElement>('[data-sheet-document]')
    expect(host?.querySelector('style')?.textContent).toContain('background:#fff;color:#000;color-scheme:light;font-family:Arial,sans-serif')
  })
})
