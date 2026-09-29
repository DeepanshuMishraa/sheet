import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db, ensureLocalUser, LOCAL_USER_ID } from '@sheet/db'
import { design, designVersion } from '@sheet/db/schema'
import {
  CANVAS_SCHEMA_VERSION,
  createCanvasDocument,
  createFrameNode,
  createPageNode,
} from '@sheet/canvas/legacy-model'
import { WEB_CANVAS_STORAGE_VERSION } from '@sheet/canvas/web-model'
import { appRouter } from './router'

const context = {
  context: { request: new Request('http://localhost/api/rpc') },
}

describe('web canvas production persistence', () => {
  it('migrates, saves a web transaction, reloads, and preserves a legacy version', async () => {
    await ensureLocalUser()
    const id = `web-production-${crypto.randomUUID()}`
    const legacy = createCanvasDocument('Production slice', id)
    legacy.nodes.page = createPageNode('Page', { id: 'page' })
    legacy.nodes.card = createFrameNode('Card', {
      id: 'card',
      parentId: 'page',
      order: 1_024,
      semanticTag: 'section',
    })
    await db.insert(design).values({
      id,
      userId: LOCAL_USER_ID,
      name: legacy.name,
      shapes: [],
      pages: [],
      canvasVersion: CANVAS_SCHEMA_VERSION,
      canvasDocument: legacy,
      revision: 0,
    })

    const migrate = appRouter.webCanvas.migrate.callable(context)
    const migrated = await migrate({ designId: id, expectedRevision: 0 })
    expect(migrated.migrated).toBe(true)
    expect(migrated.revision).toBe(1)
    expect(migrated.document.nodes.card).toMatchObject({
      kind: 'element',
      tag: 'section',
    })

    const apply = appRouter.webCanvas.applyTransaction.callable(context)
    const saved = await apply({
      designId: id,
      expectedRevision: 1,
      transaction: {
        id: 'set-card-layout',
        label: 'Set card layout',
        operations: [{
          type: 'node.patch',
          id: 'card',
          patch: {
            kind: 'element',
            styles: { display: 'flex', gap: '24px' },
          },
        }],
      },
    })
    expect(saved.applied).toBe(true)
    expect(saved.revision).toBe(2)

    const get = appRouter.webCanvas.get.callable(context)
    const reloaded = await get({ designId: id })
    expect(reloaded.status).toBe('ready')
    if (reloaded.status !== 'ready') throw new Error('Web document did not reload')
    expect(reloaded.document.nodes.card).toMatchObject({
      kind: 'element',
      styles: expect.objectContaining({ display: 'flex', gap: '24px' }),
    })

    const stored = await db
      .select({ version: design.canvasVersion, revision: design.revision })
      .from(design)
      .where(and(eq(design.id, id), eq(design.userId, LOCAL_USER_ID)))
      .limit(1)
      .then((rows) => rows[0])
    expect(stored).toEqual({ version: WEB_CANVAS_STORAGE_VERSION, revision: 2 })

    const backup = await db
      .select({
        version: designVersion.canvasVersion,
        message: designVersion.message,
        document: designVersion.canvasDocument,
      })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, id),
          eq(designVersion.userId, LOCAL_USER_ID),
        ),
      )
      .limit(1)
      .then((rows) => rows[0])
    expect(backup?.version).toBe(CANVAS_SCHEMA_VERSION)
    expect(backup?.message).toBe('Before web document migration')
    expect(backup?.document).toEqual(legacy)
  })
})
