import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import { db, ensureLocalUser, LOCAL_USER_ID } from '@sheet/db'
import { design } from '@sheet/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebStyleRule,
  createWebStyleSheet,
  createWebText,
  parseWebDocument,
  WEB_CANVAS_STORAGE_VERSION,
  type WebDocument,
} from '@sheet/canvas/web-model'
import { findChromiumExecutable } from '@sheet/canvas/web-test-browser'
import { buildHandoffPayload, getHandoffDesign, referencedAssetIds } from './handoff'
import { createHandoffToken } from './handoff-token'

/**
 * M8b-3 proof: handoffs carry a portable WebDocument artifact — document
 * plus directly renderable html/css — scoped by the existing token crypto.
 * Legacy payloads are untouched.
 */

const executable = findChromiumExecutable()
const origin = 'https://sheet.test'

function cardFixture() {
  const document = createWebDocument('Handoff card', 'handoff-card')
  document.nodes.card = createWebElement('div', {
    id: 'card',
    order: 1_024,
    attributes: { class: 'card' },
    styles: { padding: '20px', background: 'rgb(24, 24, 27)' },
  })
  document.nodes.title = createWebText('Card', { id: 'title', parentId: 'card', order: 1_024 })
  document.roots = ['card']
  document.stylesheets.main = createWebStyleSheet('main', { id: 'main', order: 1_024 })
  document.stylesheets.main.rules.base = createWebStyleRule(
    '.card',
    { display: 'grid', gap: '16px' },
    { id: 'base', order: 1_024 },
  )
  document.stylesheets.main.ruleOrder = ['base']
  document.stylesheetOrder = ['main']
  return assertWebDocument(document)
}

async function seedWebDesign(document: WebDocument) {
  await ensureLocalUser()
  const id = `web-handoff-${crypto.randomUUID()}`
  await db.insert(design).values({
    id,
    userId: LOCAL_USER_ID,
    name: document.name,
    shapes: [],
    pages: [],
    canvasVersion: WEB_CANVAS_STORAGE_VERSION,
    canvasDocument: document,
    revision: 3,
  })
  return id
}

describe('web handoffs', () => {
  const originalSecret = process.env.SHEET_HANDOFF_SECRET

  beforeEach(() => {
    process.env.SHEET_HANDOFF_SECRET = 'test-only-handoff-secret-at-least-32-bytes'
  })

  afterEach(() => {
    if (originalSecret == null) delete process.env.SHEET_HANDOFF_SECRET
    else process.env.SHEET_HANDOFF_SECRET = originalSecret
  })
  it('emits a version-4 portable artifact with document, html, css, and revision', async () => {
    const designId = await seedWebDesign(cardFixture())
    const { token } = await createHandoffToken(designId, LOCAL_USER_ID)
    const payload = await buildHandoffPayload(token, origin)
    expect(payload).toMatchObject({
      schema: 'sheet.design-handoff',
      version: 4,
      assets: [],
    })
    if (!payload || payload.version !== 4) throw new Error('Expected a v4 payload')
    expect(payload.design.id).toBe(designId)
    expect(payload.design.revision).toBe(3)
    expect(payload.design.document).toMatchObject({ model: 'web', id: 'handoff-card' })
    expect(payload.design.html).toContain('<div class="card"')
    expect(payload.design.css).toContain('.card{display:grid;gap:16px}')
    expect(payload.design.html).not.toContain('data-sheet-node')
    expect(Object.keys(payload.guidance)).toEqual(
      expect.arrayContaining(['sourceOfTruth', 'hierarchy', 'cascade', 'components', 'computed']),
    )
    // The carried document parses standalone: no Sheet renderer required.
    expect(parseWebDocument(payload.design.document)).toMatchObject({ id: 'handoff-card' })
  })

  it('finds asset references in attributes, styles, and stylesheet rules', () => {
    const document = cardFixture()
    document.nodes.photo = createWebElement('img', {
      id: 'photo',
      parentId: 'card',
      order: 2_048,
      attributes: { src: '/api/asset/abc123', alt: 'Photo' },
    })
    const sheet = document.stylesheets.main
    if (!sheet) throw new Error('Missing sheet')
    sheet.rules.bg = createWebStyleRule(
      '.card',
      { background: 'url(/api/asset/def456)' },
      { id: 'bg', order: 2_048 },
    )
    sheet.ruleOrder = ['base', 'bg']
    expect(referencedAssetIds(assertWebDocument(document))).toEqual(new Set(['abc123', 'def456']))
  })

  it('rejects forged, missing, and branch-scoped web handoffs', async () => {
    const designId = await seedWebDesign(cardFixture())
    expect(await buildHandoffPayload('forged.token.here', origin)).toBeNull()
    expect(await getHandoffDesign('forged.token.here')).toBeNull()

    const { token: missing } = await createHandoffToken('no-such-design', LOCAL_USER_ID)
    expect(await buildHandoffPayload(missing, origin)).toBeNull()

    const { token: branch } = await createHandoffToken(designId, LOCAL_USER_ID, undefined, 'draft-1')
    expect(await buildHandoffPayload(branch, origin)).toBeNull()
    expect(await getHandoffDesign(branch)).toBeNull()
  })

  it('refuses new handoffs for legacy designs', async () => {
    await ensureLocalUser()
    const designId = `legacy-handoff-${crypto.randomUUID()}`
    const { createCanvasDocument } = await import('@sheet/canvas/legacy-model')
    await db.insert(design).values({
      id: designId,
      userId: LOCAL_USER_ID,
      name: 'Legacy',
      shapes: [],
      pages: [],
      canvasVersion: 2,
      canvasDocument: createCanvasDocument('Legacy', 'legacy'),
      revision: 0,
    })
    const { token } = await createHandoffToken(designId, LOCAL_USER_ID)
    expect(await buildHandoffPayload(token, origin)).toBeNull()
  })

  it.skipIf(!executable)('renders payload html/css in a plain browser with no Sheet code', async () => {
    const designId = await seedWebDesign(cardFixture())
    const { token } = await createHandoffToken(designId, LOCAL_USER_ID)
    const payload = await buildHandoffPayload(token, origin)
    if (!payload || payload.version !== 4) throw new Error('Expected a v4 payload')

    const browser = await chromium.launch({
      executablePath: executable as string,
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    })
    try {
      const context = await browser.newContext({ viewport: { width: 1_024, height: 768 } })
      const page = await context.newPage()
      await page.setContent(
        `<!doctype html><html><head><style>${payload.design.css}</style></head><body>${payload.design.html}</body></html>`,
        { waitUntil: 'load' },
      )
      const computed = await page.evaluate(() => {
        const card = document.querySelector('.card')
        if (!card) throw new Error('Missing card')
        const style = getComputedStyle(card)
        return {
          display: style.getPropertyValue('display'),
          background: style.getPropertyValue('background-color'),
          padding: style.getPropertyValue('padding-top'),
        }
      })
      expect(computed).toEqual({
        display: 'grid',
        background: 'rgb(24, 24, 27)',
        padding: '20px',
      })
      await context.close()
    } finally {
      await browser.close()
    }
  }, 60_000)

  it('reads the stored design revision for the payload', async () => {
    const designId = await seedWebDesign(cardFixture())
    const { token } = await createHandoffToken(designId, LOCAL_USER_ID)
    const found = await getHandoffDesign(token)
    expect(found?.revision).toBe(3)
    const stored = await db
      .select({ revision: design.revision })
      .from(design)
      .where(and(eq(design.id, designId), eq(design.userId, LOCAL_USER_ID)))
      .limit(1)
      .then((rows) => rows[0])
    expect(stored?.revision).toBe(3)
  })
})
