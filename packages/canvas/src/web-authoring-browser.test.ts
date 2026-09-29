import { describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import {
  applyWebTransaction,
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebStyleRule,
  createWebStyleSheet,
  createWebText,
  serializeWebDocument,
  type WebDocument,
} from './web-model'
import { serializeWebStylesheets } from './web-css'
import { findChromiumExecutable } from './web-test-browser'

/**
 * M5 proof: every editor layout operation persists as HTML attributes,
 * inline authored CSS, or stylesheet rules — never a Sheet layout
 * abstraction. Chromium lays out each persisted step; the document is
 * scanned for smuggled positioning/layout state at the end.
 */

const executable = findChromiumExecutable()

function layoutFixture() {
  const document = createWebDocument('Authoring proof', 'authoring-proof')
  document.nodes.card = createWebElement('div', {
    id: 'card',
    order: 1_024,
    attributes: { class: 'card' },
    styles: { width: '600px' },
  })
  for (const [index, name] of (['one', 'two', 'three'] as const).entries()) {
    document.nodes[name] = createWebElement('div', {
      id: name,
      parentId: 'card',
      order: (index + 1) * 1_024,
      attributes: { class: `child ${name}` },
    })
    document.nodes[`${name}-text`] = createWebText(
      name.replace(/^./, (first) => first.toUpperCase()),
      { id: `${name}-text`, parentId: name, order: 1_024 },
    )
  }
  document.roots = ['card']
  document.stylesheets.main = createWebStyleSheet('main', { id: 'main', order: 1_024 })
  const main = document.stylesheets.main
  main.rules.card = createWebStyleRule(
    '.card',
    { display: 'flex', gap: '16px', 'align-items': 'center', padding: '20px' },
    { id: 'card', order: 1_024 },
  )
  main.rules.compact = createWebStyleRule(
    '.card.compact',
    { gap: '4px', padding: '8px' },
    { id: 'compact', order: 2_048 },
  )
  main.ruleOrder = ['card', 'compact']
  document.stylesheetOrder = ['main']
  return assertWebDocument(document)
}

describe.skipIf(!executable)('authoring persists as web primitives', () => {
  it('keeps authored root and body rules off editor chrome in both themes', async () => {
    const browser = await chromium.launch({ executablePath: executable as string, headless: true })
    try {
      const page = await browser.newPage()
      const document = createWebDocument('Isolation', 'isolation')
      document.nodes.root = createWebElement('main', { id: 'root', order: 1_024, attributes: { class: 'page' } })
      document.roots = ['root']
      document.stylesheets.main = createWebStyleSheet('main', { id: 'main', order: 1_024 })
      document.stylesheets.main.rules.root = createWebStyleRule(':root', { '--foreground': '#ffffff' }, { id: 'root', order: 1_024 })
      document.stylesheets.main.rules.body = createWebStyleRule('body', { background: '#ffffff', color: '#111111' }, { id: 'body', order: 2_048 })
      document.stylesheets.main.rules.page = createWebStyleRule('.page', { color: 'var(--foreground)' }, { id: 'page', order: 3_072 })
      document.stylesheets.main.ruleOrder = ['root', 'body', 'page']
      document.stylesheetOrder = ['main']
      const { materializeWebStylesheets } = await import('./web-model')
      const css = materializeWebStylesheets(document, globalThis.document)[0]?.textContent
      await page.setContent(`<style>body { background: #222222; color: #eeeeee }</style><div id="chrome">Chrome</div><div data-sheet-document><style>${css}</style><main class="page">Page</main></div>`)
      const colors = await page.evaluate(() => {
        const chrome = window.document.querySelector('#chrome')
        const sheet = window.document.querySelector('[data-sheet-document]')
        const page = window.document.querySelector('.page')
        if (!chrome || !sheet || !page) throw new Error('Missing fixture')
        return [getComputedStyle(window.document.body).backgroundColor, getComputedStyle(chrome).color, getComputedStyle(page).color]
      })
      expect(colors).toEqual(['rgb(34, 34, 34)', 'rgb(238, 238, 238)', 'rgb(255, 255, 255)'])
    } finally {
      await browser.close()
    }
  })
  it('reorders, gaps, aligns, resizes, and reclasses through CSS alone', async () => {
    let webDocument = layoutFixture()
    const transact = (
      label: string,
      operations: Parameters<typeof applyWebTransaction>[1]['operations'],
    ) => {
      webDocument = applyWebTransaction(webDocument, { id: label, label, operations }).document
    }

    const browser = await chromium.launch({
      executablePath: executable as string,
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    })
    try {
      const context = await browser.newContext({ viewport: { width: 1_024, height: 768 } })
      const page = await context.newPage()
      const show = (doc: WebDocument) =>
        page.setContent(
          `<!doctype html><html><head><style>${serializeWebStylesheets(doc.stylesheets, doc.stylesheetOrder)}</style></head><body>${serializeWebDocument(doc)}</body></html>`,
          { waitUntil: 'load' },
        )
      const leftOrder = () =>
        page.evaluate(() => {
          const card = document.querySelector('.card')
          if (!card) throw new Error('Missing card')
          return [...card.children]
            .map((child) => ({
              text: child.textContent,
              left: child.getBoundingClientRect().left,
              top: child.getBoundingClientRect().top,
            }))
            .sort((left, right) => left.left - right.left)
            .map((child) => child.text)
        })
      const cardComputed = (...properties: string[]) =>
        page.evaluate((names) => {
          const card = document.querySelector('.card')
          if (!card) throw new Error('Missing card')
          const style = getComputedStyle(card)
          return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]))
        }, properties)

      await show(webDocument)
      expect(await leftOrder()).toEqual(['One', 'Two', 'Three'])
      expect(await cardComputed('display', 'gap')).toMatchObject({
        display: 'flex',
        gap: '16px',
      })

      // Reorder child: a pure order change the browser lays out.
      transact('reorder', [{ type: 'node.move', id: 'three', parentId: 'card', order: 512 }])
      await show(webDocument)
      expect(await leftOrder()).toEqual(['Three', 'One', 'Two'])

      // Gap, alignment, direction: authored inline CSS.
      transact('gap', [{
        type: 'node.patch',
        id: 'card',
        patch: { kind: 'element', styles: { gap: '32px' } },
      }])
      transact('direction', [{
        type: 'node.patch',
        id: 'card',
        patch: { kind: 'element', styles: { 'flex-direction': 'column', 'align-items': 'stretch' } },
      }])
      await show(webDocument)
      expect(await cardComputed('gap', 'flex-direction', 'align-items')).toMatchObject({
        gap: '32px',
        'flex-direction': 'column',
        'align-items': 'stretch',
      })
      const stacked = await page.evaluate(() => {
        const card = document.querySelector('.card')
        if (!card) throw new Error('Missing card')
        return [...card.children].map((child) => child.getBoundingClientRect().top)
      })
      expect(stacked[0]).toBeLessThan(stacked[1] as number)
      expect(stacked[1]).toBeLessThan(stacked[2] as number)

      // Resize and padding: width/height/padding CSS, nothing else.
      transact('resize', [{
        type: 'node.patch',
        id: 'card',
        patch: { kind: 'element', styles: { width: '400px', padding: '8px' } },
      }])
      await show(webDocument)
      expect(await cardComputed('width', 'padding-top')).toMatchObject({
        width: '400px',
        'padding-top': '8px',
      })

      // Reclass: an attribute mutation matched by a stylesheet rule. The
      // inline gap (32px) still beats the sheet (4px) until it is cleared,
      // which the next step asserts through the normal cascade.
      transact('reclass', [{
        type: 'node.patch',
        id: 'card',
        patch: {
          kind: 'element',
          attributes: { class: 'card compact' },
          styles: { gap: null },
        },
      }])
      await show(webDocument)
      expect(await cardComputed('gap', 'padding-top')).toMatchObject({
        gap: '4px',
        'padding-top': '8px',
      })

      // The persisted document holds attributes, inline CSS, rules, and
      // metadata — no positioned layout smuggling, no layout abstraction.
      const persisted = JSON.stringify(webDocument)
      expect(persisted).not.toContain('absolute')
      expect(persisted).not.toContain('"x"')
      expect(webDocument.nodes.card).toMatchObject({
        kind: 'element',
        attributes: { class: 'card compact' },
        styles: {
          width: '400px',
          'flex-direction': 'column',
          'align-items': 'stretch',
          padding: '8px',
        },
      })
      await context.close()
    } finally {
      await browser.close()
    }
  }, 60_000)
})
