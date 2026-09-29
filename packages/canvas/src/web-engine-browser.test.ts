import { describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import { findChromiumExecutable } from './web-test-browser'
import {
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebStyleRule,
  createWebStyleSheet,
  createWebText,
  serializeWebDocument,
} from './web-model'
import { importWebSnapshot } from './web-import'
import { serializeWebStylesheets } from './web-css'

/**
 * M2 proof that the browser is Sheet's CSS engine. Everything asserted here
 * — class matching, media/container evaluation, :hover/:focus state,
 * ::before rendering, cascade order, inline-vs-sheet precedence — is resolved
 * by Chromium from serialized authored CSS. No Sheet code answers any of it.
 */

const executable = findChromiumExecutable()

function fixture() {
  const document = createWebDocument('Engine proof', 'engine-proof')
  document.nodes.card = createWebElement('div', {
    id: 'card',
    order: 1_024,
    attributes: { class: 'card' },
  })
  document.nodes.title = createWebElement('h1', {
    id: 'title',
    parentId: 'card',
    order: 1_024,
  })
  document.nodes.titleText = createWebText('Engine', { id: 'titleText', parentId: 'title', order: 1_024 })
  document.nodes.action = createWebElement('button', {
    id: 'action',
    parentId: 'card',
    order: 2_048,
    attributes: { class: 'btn', type: 'button' },
  })
  document.nodes.actionText = createWebText('Go', { id: 'actionText', parentId: 'action', order: 1_024 })
  document.nodes.pinned = createWebElement('div', {
    id: 'pinned',
    parentId: 'card',
    order: 3_072,
    attributes: { class: 'card' },
    styles: { padding: '99px' },
  })
  document.nodes.holder = createWebElement('div', {
    id: 'holder',
    parentId: 'card',
    order: 4_096,
    attributes: { class: 'holder' },
    styles: { width: '600px', 'container-type': 'inline-size' },
  })
  document.nodes.inner = createWebElement('div', {
    id: 'inner',
    parentId: 'holder',
    order: 1_024,
    attributes: { class: 'inner' },
  })
  document.nodes.tie = createWebElement('div', {
    id: 'tie',
    parentId: 'card',
    order: 5_120,
    attributes: { class: 'tie' },
  })
  document.roots = ['card']
  document.stylesheets.main = createWebStyleSheet('main', { id: 'main', order: 1_024 })
  const main = document.stylesheets.main
  main.rules.card = createWebStyleRule(
    '.card',
    { display: 'grid', gap: '20px', padding: '20px' },
    { id: 'card', order: 1_024 },
  )
  main.rules.cardNarrow = createWebStyleRule(
    '.card',
    { gap: '8px', padding: '12px' },
    { id: 'cardNarrow', order: 2_048, conditions: [{ kind: 'media', query: '(max-width: 768px)' }] },
  )
  main.rules.cardBefore = createWebStyleRule(
    '.card::before',
    { content: '"★"', color: 'rgb(255, 0, 0)' },
    { id: 'cardBefore', order: 3_072 },
  )
  main.rules.btn = createWebStyleRule(
    '.btn',
    { background: 'rgb(24, 24, 27)', color: 'rgb(255, 255, 255)' },
    { id: 'btn', order: 4_096 },
  )
  main.rules.btnHover = createWebStyleRule(
    '.btn:hover',
    { background: 'rgb(63, 63, 70)' },
    { id: 'btnHover', order: 5_120 },
  )
  main.rules.inner = createWebStyleRule(
    '.inner',
    { padding: '20px' },
    { id: 'inner', order: 6_144 },
  )
  main.rules.innerNarrow = createWebStyleRule(
    '.inner',
    { padding: '8px' },
    { id: 'innerNarrow', order: 7_168, conditions: [{ kind: 'container', query: '(max-width: 500px)' }] },
  )
  main.rules.tieFirst = createWebStyleRule(
    '.tie',
    { color: 'rgb(255, 0, 0)' },
    { id: 'tieFirst', order: 8_192 },
  )
  main.rules.tieSecond = createWebStyleRule(
    '.tie',
    { color: 'rgb(0, 0, 255)' },
    { id: 'tieSecond', order: 9_216 },
  )
  main.ruleOrder = [
    'card',
    'cardNarrow',
    'cardBefore',
    'btn',
    'btnHover',
    'inner',
    'innerNarrow',
    'tieFirst',
    'tieSecond',
  ]
  document.stylesheetOrder = ['main']
  return assertWebDocument(document)
}

describe.skipIf(!executable)('browser resolves authored CSS', () => {
  it('applies classes, media, container, hover, pseudo-elements, and cascade order', async () => {
    const webDocument = fixture()
    const before = JSON.stringify(webDocument)
    const html = serializeWebDocument(webDocument)
    const css = serializeWebStylesheets(webDocument.stylesheets, webDocument.stylesheetOrder)

    // The class carries styling with no inline duplication on the element.
    expect(html).toContain('<div class="card">')
    expect(html).not.toContain('display:grid')
    // Pseudo-elements remain stylesheet rules, never fake DOM nodes.
    expect(Object.values(webDocument.nodes).every((node) =>
      node.kind === 'text' || !node.tag.includes(':'),
    )).toBe(true)

    const browser = await chromium.launch({
      executablePath: executable as string,
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    })
    try {
      const context = await browser.newContext({ viewport: { width: 1_024, height: 768 } })
      const page = await context.newPage()
      await page.setContent(
        `<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`,
        { waitUntil: 'load' },
      )
      const card = page.locator('.card').first()
      const computed = (selector: string, property: string, pseudo?: string) =>
        page.evaluate(
          ([target, name, elementPseudo]) => {
            const element = document.querySelector(target)
            if (!element) throw new Error(`Missing ${target}`)
            return getComputedStyle(element as Element, elementPseudo ?? undefined).getPropertyValue(name)
          },
          [selector, property, pseudo] as const,
        )

      // 1. Class-based styling from the sheet, wide viewport.
      expect(await computed('.card', 'display')).toBe('grid')
      expect(await computed('.card', 'padding-top')).toBe('20px')
      expect(await computed('.card', 'gap')).toBe('20px')

      // 2. Media query reacts to viewport width with no Sheet evaluator.
      await page.setViewportSize({ width: 500, height: 768 })
      expect(await computed('.card', 'padding-top')).toBe('12px')
      expect(await computed('.card', 'gap')).toBe('8px')
      await page.setViewportSize({ width: 1_024, height: 768 })
      expect(await computed('.card', 'padding-top')).toBe('20px')

      // 3. Container query reacts to container size with no Sheet evaluator.
      expect(await computed('.inner', 'padding-top')).toBe('20px')
      await page.evaluate(() => {
        const holder = document.querySelector('.holder')
        if (holder instanceof HTMLElement) holder.style.width = '400px'
      })
      expect(await computed('.inner', 'padding-top')).toBe('8px')

      // 4. Pseudo-classes stay browser-native state.
      expect(await computed('.btn', 'background-color')).toBe('rgb(24, 24, 27)')
      await page.hover('.btn')
      expect(await computed('.btn', 'background-color')).toBe('rgb(63, 63, 70)')

      // 5. Pseudo-elements render from CSS alone.
      expect(await computed('.card', 'content', '::before')).toContain('★')
      expect(await computed('.card', 'color', '::before')).toBe('rgb(255, 0, 0)')

      // 6. Inline style and sheet rules coexist: inline wins by normal cascade.
      expect(await card.evaluate((element) =>
        getComputedStyle(element).getPropertyValue('padding-top'),
      )).toBe('20px')
      const pinnedPadding = await page.evaluate(() => {
        const element = [...document.querySelectorAll('.card')].at(-1)
        if (!element) throw new Error('Missing pinned card')
        return getComputedStyle(element).getPropertyValue('padding-top')
      })
      expect(pinnedPadding).toBe('99px')

      // 7. Rule order decides ties: the later .tie rule wins.
      expect(await computed('.tie', 'color')).toBe('rgb(0, 0, 255)')

      await context.close()
    } finally {
      await browser.close()
    }

    // 8. Computed browser state never enters the authored document.
    expect(JSON.stringify(webDocument)).toBe(before)
  }, 60_000)

  it('round-trips HTML+CSS through import with equivalent browser behavior', async () => {
    const sourceHtml = [
      '<div class="card"><h2 class="title">Hello</h2>',
      '<div class="footer">Bye</div></div>',
    ].join('')
    const sourceCss = [
      '.card { display: grid; gap: 20px; padding: 20px; }',
      '@media (max-width: 700px) { .card { gap: 8px; padding: 12px; } }',
      '.title { font-size: 32px; }',
      '.footer { color: rgb(100, 100, 100); }',
    ].join('\n')
    const imported = importWebSnapshot(sourceHtml, sourceCss)
    expect(imported.warnings).toEqual([])
    const roundTripped = {
      html: serializeWebDocument(imported.document),
      css: serializeWebStylesheets(
        imported.document.stylesheets,
        imported.document.stylesheetOrder,
      ),
    }

    const browser = await chromium.launch({
      executablePath: executable as string,
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    })
    try {
      const context = await browser.newContext({ viewport: { width: 1_024, height: 768 } })
      const original = await context.newPage()
      const roundTrip = await context.newPage()
      await original.setContent(
        `<!doctype html><html><head><style>${sourceCss}</style></head><body>${sourceHtml}</body></html>`,
        { waitUntil: 'load' },
      )
      await roundTrip.setContent(
        `<!doctype html><html><head><style>${roundTripped.css}</style></head><body>${roundTripped.html}</body></html>`,
        { waitUntil: 'load' },
      )
      const snapshot = (page: typeof original) =>
        page.evaluate(() => {
          const read = (selector: string, properties: string[]) => {
            const element = document.querySelector(selector)
            if (!element) throw new Error(`Missing ${selector}`)
            const style = getComputedStyle(element)
            return Object.fromEntries(
              properties.map((name) => [name, style.getPropertyValue(name)]),
            )
          }
          return {
            card: read('.card', ['display', 'gap', 'padding-top']),
            title: read('.title', ['font-size']),
            footer: read('.footer', ['color']),
          }
        })
      // Wide viewport: base rules apply identically on both sides.
      expect(await snapshot(roundTrip)).toEqual(await snapshot(original))
      // Narrow viewport: the imported @media block reacts identically.
      await original.setViewportSize({ width: 500, height: 768 })
      await roundTrip.setViewportSize({ width: 500, height: 768 })
      expect(await snapshot(roundTrip)).toEqual(await snapshot(original))
      expect((await snapshot(roundTrip)).card['padding-top']).toBe('12px')
      await context.close()
    } finally {
      await browser.close()
    }
  }, 60_000)
})
