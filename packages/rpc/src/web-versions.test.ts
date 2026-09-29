import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, ensureLocalUser, LOCAL_USER_ID } from '@sheet/db'
import { design } from '@sheet/db/schema'

const publishCanvasRealtimeEvent = vi.hoisted(() => vi.fn())
vi.mock('@sheet/db/canvas-realtime', () => ({ publishCanvasRealtimeEvent }))
import {
  assertWebDocument,
  createWebDocument,
  createWebElement,
  WEB_CANVAS_STORAGE_VERSION,
  type WebDocument,
} from '@sheet/canvas/web-model'
import { appRouter } from './router'

const context = {
  context: { request: new Request('http://localhost/api/rpc') },
}

function cardFixture() {
  const document = createWebDocument('Versioned', 'versioned')
  document.nodes.card = createWebElement('div', {
    id: 'card',
    order: 1_024,
    attributes: { class: 'card' },
  })
  document.roots = ['card']
  return assertWebDocument(document)
}

async function seedDesign(document: WebDocument) {
  await ensureLocalUser()
  const id = `web-versions-${crypto.randomUUID()}`
  await db.insert(design).values({
    id,
    userId: LOCAL_USER_ID,
    name: document.name,
    shapes: [],
    pages: [],
    canvasVersion: WEB_CANVAS_STORAGE_VERSION,
    canvasDocument: document,
    revision: 0,
  })
  return id
}

describe('web version checkpoints', () => {
  beforeEach(() => {
    publishCanvasRealtimeEvent.mockClear()
  })
  it('commits, lists, compares, and restores whole web documents', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const designId = await seedDesign(cardFixture())
    const commitWeb = appRouter.history.commitWeb.callable(context)
    const first = await commitWeb({
      id: `v1-${tag}`,
      designId,
      message: 'Card shell',
      document: cardFixture(),
      skipIfUnchanged: true,
    })
    expect(first).toMatchObject({ id: `v1-${tag}`, added: 1 })

    const apply = appRouter.webCanvas.applyTransaction.callable(context)
    const edited = await apply({
      designId,
      expectedRevision: 0,
      transaction: {
        id: 'add-gap',
        label: 'Add gap',
        operations: [{
          type: 'node.patch',
          id: 'card',
          patch: { kind: 'element', styles: { display: 'flex', gap: '16px' } },
        }],
      },
    })
    expect(edited.applied).toBe(true)

    const second = await commitWeb({
      id: `v2-${tag}`,
      designId,
      message: 'Flex card',
      document: edited.applied ? edited.document : cardFixture(),
      skipIfUnchanged: true,
    })
    expect(second).toMatchObject({ id: `v2-${tag}`, changed: 1 })

    // Unchanged content commits nothing.
    const skipped = await commitWeb({
      id: `v3-${tag}`,
      designId,
      message: 'No-op',
      document: edited.applied ? edited.document : cardFixture(),
      skipIfUnchanged: true,
    })
    expect(skipped).toBeNull()

    const list = appRouter.history.list.callable(context)
    const page = await list({ designId, limit: 20 })
    expect(page.items.map((item) => item.id)).toEqual([`v2-${tag}`, `v1-${tag}`])

    const compareWeb = appRouter.history.compareWeb.callable(context)
    const compared = await compareWeb({ designId, id: `v2-${tag}` })
    expect(compared.current.id).toBe(`v2-${tag}`)
    expect(compared.previous?.id).toBe(`v1-${tag}`)
    expect(compared.current.document.nodes.card).toMatchObject({
      styles: expect.objectContaining({ display: 'flex' }),
    })
  })

  it('restores atomically, publishes realtime, and blocks stale editors', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const designId = await seedDesign(cardFixture())
    const commitWeb = appRouter.history.commitWeb.callable(context)
    await commitWeb({ id: `v1-${tag}`, designId, message: 'Base', document: cardFixture(), skipIfUnchanged: true })
    const apply = appRouter.webCanvas.applyTransaction.callable(context)
    // Editor A and editor B both read revision 1 after two edits.
    await apply({
      designId,
      expectedRevision: 0,
      transaction: { id: 'a1', label: 'A1', operations: [{ type: 'node.move', id: 'card', parentId: null, order: 2_048 }] },
    })
    const second = await apply({
      designId,
      expectedRevision: 1,
      transaction: { id: 'a2', label: 'A2', operations: [{ type: 'node.move', id: 'card', parentId: null, order: 3_072 }] },
    })
    expect(second.revision).toBe(2)

    // A restores the base checkpoint at revision 2.
    const restoreWeb = appRouter.history.restoreWeb.callable(context)
    const restored = await restoreWeb({ designId, id: `v1-${tag}`, expectedRevision: 2 })
    expect(restored.revision).toBe(3)
    expect(restored.document.nodes.card).toMatchObject({ order: 1_024 })
    // The restore published so B observes revision 3 instead of editing on.
    expect(publishCanvasRealtimeEvent).toHaveBeenCalledWith(
      expect.anything(),
      { designId, draftId: null },
      { type: 'canvas.changed', revision: 3, nodeIds: [] },
    )

    // B, still holding revision 2, cannot save over the restore.
    const stale = await apply({
      designId,
      expectedRevision: 2,
      transaction: { id: 'b1', label: 'B1', operations: [{ type: 'node.move', id: 'card', parentId: null, order: 9_999 }] },
    })
    expect(stale).toMatchObject({ applied: false, reason: 'stale', revision: 3 })
  })

  it('rejects stale and missing restores', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const designId = await seedDesign(cardFixture())
    const commitWeb = appRouter.history.commitWeb.callable(context)
    await commitWeb({ id: `v1-${tag}`, designId, message: 'Base', document: cardFixture(), skipIfUnchanged: true })
    const restoreWeb = appRouter.history.restoreWeb.callable(context)
    await expect(restoreWeb({ designId, id: `v1-${tag}`, expectedRevision: 7 }))
      .rejects.toThrow('changed before the version could be restored')
    await expect(restoreWeb({ designId, id: 'missing', expectedRevision: 0 }))
      .rejects.toThrow('Not Found')


  })
})
