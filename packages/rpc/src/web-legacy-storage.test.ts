import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db, ensureLocalUser, LOCAL_USER_ID } from '@sheet/db'
import { design, designDraft, designVersion } from '@sheet/db/schema'
import { WEB_CANVAS_STORAGE_VERSION, createWebDocument } from '@sheet/canvas/web-model'
import { appRouter } from './router'

const context = { context: { request: new Request('http://localhost/api/rpc') } }
const shapes = [{ id: 'hero', name: 'Hero', x: 10, y: 20, w: 640, h: 320, code: '<main>Saved source</main>' }]
const pages = [{ id: 'home', name: 'Home', x: 0, y: 0, w: 800, items: [{ id: 'hero-item', elementId: 'hero', height: 320 }] }]

describe('v1 shape/page storage migration', () => {
  it('migrates a design while preserving the original row in immutable history', async () => {
    await ensureLocalUser()
    const id = `v1-design-${crypto.randomUUID()}`
    await db.insert(design).values({
      id,
      userId: LOCAL_USER_ID,
      name: 'V1 site',
      shapes,
      pages,
      canvasVersion: 1,
      revision: 0,
    })

    const migrate = appRouter.webCanvas.migrate.callable(context)
    const result = await migrate({ designId: id, expectedRevision: 0 })
    expect(result.migrated).toBe(true)
    expect(Object.values(result.document.nodes).some((node) => node.kind === 'text' && node.text === shapes[0]?.code)).toBe(true)

    const stored = await db.select().from(design).where(and(eq(design.id, id), eq(design.userId, LOCAL_USER_ID))).limit(1).then((rows) => rows[0])
    expect(stored?.canvasVersion).toBe(WEB_CANVAS_STORAGE_VERSION)
    expect(stored?.shapes).toEqual([])
    expect(stored?.pages).toEqual([])
    const version = await db.select().from(designVersion).where(and(eq(designVersion.designId, id), eq(designVersion.userId, LOCAL_USER_ID))).limit(1).then((rows) => rows[0])
    expect(version).toMatchObject({ canvasVersion: 1, shapes, pages, canvasDocument: null })
  })

  it('migrates legacy branch and base snapshots without discarding either', async () => {
    await ensureLocalUser()
    const id = `v1-branch-main-${crypto.randomUUID()}`
    const draftId = `v1-branch-${crypto.randomUUID()}`
    const main = createWebDocument('Main', id)
    await db.insert(design).values({
      id, userId: LOCAL_USER_ID, name: 'Main', shapes: [], pages: [],
      canvasVersion: WEB_CANVAS_STORAGE_VERSION, canvasDocument: main,
    })
    await db.insert(designDraft).values({
      id: draftId, designId: id, userId: LOCAL_USER_ID, name: 'Legacy branch',
      description: '', status: 'active', baseShapes: shapes, shapes, basePages: pages, pages,
      canvasVersion: 1, baseCanvasVersion: 1, baseRevision: 0, revision: 4,
    })

    const migrate = appRouter.webCanvas.migrate.callable(context)
    const result = await migrate({ designId: id, draftId, expectedRevision: 4 })
    expect(result.migrated).toBe(true)
    const branch = await db.select().from(designDraft).where(and(eq(designDraft.id, draftId), eq(designDraft.userId, LOCAL_USER_ID))).limit(1).then((rows) => rows[0])
    expect(branch).toMatchObject({
      canvasVersion: WEB_CANVAS_STORAGE_VERSION,
      baseCanvasVersion: WEB_CANVAS_STORAGE_VERSION,
      revision: 5,
      shapes: [], pages: [], baseShapes: [], basePages: [],
    })
    expect(Object.values(branch?.canvasDocument?.nodes ?? {}).some((node) => node.kind === 'text' && node.text === shapes[0]?.code)).toBe(true)

    const backups = await db.select({ version: designVersion.canvasVersion, shapes: designVersion.shapes, pages: designVersion.pages })
      .from(designVersion)
      .where(and(eq(designVersion.designId, id), eq(designVersion.draftId, draftId), eq(designVersion.userId, LOCAL_USER_ID)))
    expect(backups).toHaveLength(2)
    expect(backups.every((backup) => backup.version === 1 && backup.shapes.length === 1 && backup.pages.length === 1)).toBe(true)
  })
})
