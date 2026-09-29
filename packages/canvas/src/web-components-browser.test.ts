import { describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import { findChromiumExecutable } from './web-test-browser'
import {
  applyWebTransaction,
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebStyleRule,
  createWebStyleSheet,
  createWebText,
  detachComponents,
  serializeWebDocument,
  type WebDocument,
} from './web-model'
import { serializeWebStylesheets } from './web-css'

/**
 * M4 proof that components are authoring machinery over ordinary DOM+CSS.
 * Chromium resolves everything: instance styling, :hover/:active state,
 * media queries, and custom-property overrides. Sheet owns the metadata and
 * the propagation replay; the browser owns the rendering.
 */

const executable = findChromiumExecutable()

function buttonFixture() {
  let document = assertWebDocument(createWebDocument('Button proof', 'button-proof'))
  const button = createWebElement('button', {
    id: 'btn-template',
    parentId: null,
    order: 1_024,
    attributes: { class: 'btn', type: 'button' },
  })
  const icon = createWebElement('span', {
    id: 'btn-icon-template',
    parentId: 'btn-template',
    order: 1_024,
    attributes: { class: 'icon' },
  })
  const label = createWebElement('span', {
    id: 'btn-label-template',
    parentId: 'btn-template',
    order: 2_048,
    attributes: { class: 'label' },
  })
  const labelText = createWebText('Label', {
    id: 'btn-label-text-template',
    parentId: 'btn-label-template',
    order: 1_024,
  })
  const sheet = createWebStyleSheet('component:Button', { id: 'btn-sheet', order: 1_024 })
  sheet.rules.base = createWebStyleRule(
    '.btn',
    {
      display: 'inline-flex',
      gap: '8px',
      padding: '10px 16px',
      background: 'var(--btn-bg)',
      color: 'rgb(255, 255, 255)',
      'border-radius': '8px',
      '--btn-bg': '#18181b',
    },
    { id: 'base', order: 1_024 },
  )
  sheet.rules.hover = createWebStyleRule(
    '.btn:hover',
    { background: 'rgb(63, 63, 70)' },
    { id: 'hover', order: 2_048 },
  )
  sheet.rules.active = createWebStyleRule(
    '.btn:active',
    { transform: 'translateY(1px)' },
    { id: 'active', order: 3_072 },
  )
  sheet.rules.narrow = createWebStyleRule(
    '.btn',
    { padding: '8px 12px' },
    { id: 'narrow', order: 4_096, conditions: [{ kind: 'media', query: '(max-width: 700px)' }] },
  )
  sheet.ruleOrder = ['base', 'hover', 'active', 'narrow']

  document = applyWebTransaction(document, {
    id: 'define-button',
    label: 'Define Button',
    operations: [{
      type: 'component.define',
      component: {
        id: 'button',
        name: 'Button',
        templateRootIds: ['btn-template'],
        stylesheetId: 'btn-sheet',
      },
      template: [button, icon, label, labelText],
      stylesheet: sheet,
    }],
  }).document
  document = applyWebTransaction(document, {
    id: 'create-a',
    label: 'Create A',
    operations: [{ type: 'instance.create', id: 'a', componentId: 'button', parentId: null, order: 1_024 }],
  }).document
  document = applyWebTransaction(document, {
    id: 'create-b',
    label: 'Create B',
    operations: [{ type: 'instance.create', id: 'b', componentId: 'button', parentId: null, order: 2_048 }],
  }).document

  const bindingsOf = (instanceId: string) => document.instances[instanceId]?.bindings ?? {}
  const labelTextOf = (instanceId: string) =>
    Object.entries(bindingsOf(instanceId)).find(([, template]) => template === 'btn-label-text-template')?.[0] as string
  document = applyWebTransaction(document, {
    id: 'override-a-label',
    label: 'Override A label',
    operations: [{
      type: 'instance.setOverride',
      instanceId: 'a',
      id: labelTextOf('a'),
      override: { kind: 'text', text: 'Custom' },
    }],
  }).document
  const rootB = document.instances.b?.rootId as string
  document = applyWebTransaction(document, {
    id: 'override-b-bg',
    label: 'Override B background',
    operations: [{
      type: 'instance.setOverride',
      instanceId: 'b',
      id: rootB,
      override: { kind: 'custom-properties', properties: { '--btn-bg': '#b91c1c' } },
    }],
  }).document
  return document
}

describe.skipIf(!executable)('component rendering in the browser', () => {
  it('renders instances through normal DOM/CSS, propagates CSS freely, and survives metadata deletion', async () => {
    const webDocument = buttonFixture()
    // The document holds ordinary nodes plus metadata maps — no scene graph.
    expect(Object.values(webDocument.nodes).every((node) =>
      node.kind === 'text' || node.kind === 'element',
    )).toBe(true)
    expect(Object.keys(webDocument.components)).toEqual(['button'])
    expect(Object.keys(webDocument.instances).sort()).toEqual(['a', 'b'])

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
      const snapshot = () =>
        page.evaluate(() => {
          const buttons = [...document.querySelectorAll('button.btn')]
          if (buttons.length !== 2) throw new Error('Expected two buttons')
          return buttons.map((button) => {
            const style = getComputedStyle(button)
            return {
              text: button.textContent,
              background: style.getPropertyValue('background-color'),
              padding: style.getPropertyValue('padding-top'),
              display: style.getPropertyValue('display'),
            }
          })
        })

      await show(webDocument)
      const wide = await snapshot()
      // Both instances compute from the owned sheet; overrides diverge them.
      expect(wide[0]?.display).toBe('inline-flex')
      expect(wide[1]?.display).toBe('inline-flex')
      expect(wide[0]?.text).toContain('Custom')
      expect(wide[1]?.text).toContain('Label')
      expect(wide[0]?.background).toBe('rgb(24, 24, 27)')
      expect(wide[1]?.background).toBe('rgb(185, 28, 28)')

      // Pseudo-states stay browser-native.
      await page.hover('button.btn >> nth=0')
      const hovered = await snapshot()
      expect(hovered[0]?.background).toBe('rgb(63, 63, 70)')
      await page.mouse.move(0, 0)

      // Media queries react with no Sheet evaluator.
      await page.setViewportSize({ width: 500, height: 768 })
      const narrow = await snapshot()
      expect(narrow[0]?.padding).toBe('8px')
      await page.setViewportSize({ width: 1_024, height: 768 })

      // A CSS change on the owned sheet reaches both instances with zero
      // propagation code: the cascade is the propagation.
      const rethemed = applyWebTransaction(webDocument, {
        id: 'retheme',
        label: 'Retheme Button',
        operations: [{
          type: 'rule.patch',
          stylesheetId: 'btn-sheet',
          id: 'base',
          patch: { declarations: { '--btn-bg': '#1d4ed8' } },
        }],
      }).document
      await show(rethemed)
      const themed = await snapshot()
      expect(themed[0]?.background).toBe('rgb(29, 78, 216)')
      // B keeps its inline custom-property override over the new default.
      expect(themed[1]?.background).toBe('rgb(185, 28, 28)')

      // The deletion invariant: metadata gone, rendering identical.
      const detached = detachComponents(rethemed)
      await show(detached)
      expect(await snapshot()).toEqual(themed)
      await context.close()
    } finally {
      await browser.close()
    }
  }, 60_000)
})
