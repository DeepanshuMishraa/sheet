import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import { db } from '@sheet/db'
import { asset, design, designDraft, designVersion } from '@sheet/db/schema'
import { WEB_CANVAS_STORAGE_VERSION, createWebDocument, webId } from '@sheet/canvas/web-model'
import { publishBranchChanged, publishCanvasRealtimeEvent } from '@sheet/db/canvas-realtime'
import {
  applyWebDraftToStore,
  createWebDraftStore,
  getWebDraftComparison,
} from './branches'
import { readWebCanvasStore, renameWebCanvasStore } from './web-canvas-procedures'

export const MAX_NAME_LENGTH = 200

export async function listDesigns(userId: string) {
  const rows = await db
    .select({
      id: design.id,
      name: design.name,
      revision: design.revision,
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(and(eq(design.userId, userId), isNull(design.archivedAt)))
    .orderBy(asc(design.createdAt))
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
}

export async function createDesign(userId: string, name: string) {
  const id = webId('design')
  const document = createWebDocument(name, id)
  const [created] = await db
    .insert(design)
    .values({
      id,
      userId,
      name,
      shapes: [],
      pages: [],
      canvasVersion: WEB_CANVAS_STORAGE_VERSION,
      canvasDocument: document,
    })
    .returning({ id: design.id, name: design.name, revision: design.revision })
  if (!created) throw new Error('The design could not be created.')
  void publishCanvasRealtimeEvent(
    userId,
    { designId: created.id },
    { type: 'canvas.changed', revision: created.revision, nodeIds: [] },
  )
  return created
}

export const renameDesign = (userId: string, id: string, name: string) =>
  renameWebCanvasStore(userId, id, name)

export async function archiveDesign(userId: string, id: string) {
  const [archived] = await db
    .update(design)
    .set({ archivedAt: new Date() })
    .where(and(eq(design.id, id), eq(design.userId, userId), isNull(design.archivedAt)))
    .returning({ id: design.id, revision: design.revision })
  if (!archived) return false
  void publishCanvasRealtimeEvent(
    userId,
    { designId: archived.id },
    { type: 'canvas.changed', revision: archived.revision, nodeIds: [] },
  )
  return true
}

export async function listVersions(
  userId: string,
  designId: string,
  limit: number,
  draftId?: string | null,
) {
  const rows = await db
    .select({
      id: designVersion.id,
      message: designVersion.message,
      added: designVersion.added,
      removed: designVersion.removed,
      changed: designVersion.changed,
      canvasVersion: designVersion.canvasVersion,
      createdAt: designVersion.createdAt,
    })
    .from(designVersion)
    .where(and(
      eq(designVersion.designId, designId),
      eq(designVersion.userId, userId),
      draftId ? eq(designVersion.draftId, draftId) : isNull(designVersion.draftId),
    ))
    .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
    .limit(limit)
  return rows.map((row) => ({
    ...row,
    available: row.canvasVersion === WEB_CANVAS_STORAGE_VERSION,
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function listDrafts(userId: string, designId: string) {
  const rows = await db
    .select({
      id: designDraft.id,
      name: designDraft.name,
      description: designDraft.description,
      status: designDraft.status,
      canvasVersion: designDraft.canvasVersion,
      baseRevision: designDraft.baseRevision,
      revision: designDraft.revision,
      createdAt: designDraft.createdAt,
      updatedAt: designDraft.updatedAt,
    })
    .from(designDraft)
    .where(and(
      eq(designDraft.designId, designId),
      eq(designDraft.userId, userId),
    ))
    .orderBy(desc(designDraft.updatedAt))
  return rows.map((row) => ({
    ...row,
    available: row.canvasVersion === WEB_CANVAS_STORAGE_VERSION,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export const createDraft = (userId: string, designId: string, name: string) =>
  createWebDraftStore(userId, designId, name)

async function transitionDraft(
  userId: string,
  designId: string,
  draftId: string,
  from: Array<'active' | 'proposed' | 'closed'>,
  to: 'active' | 'proposed' | 'closed',
  description?: string,
) {
  const now = new Date()
  const [updated] = await db
    .update(designDraft)
    .set({
      status: to,
      ...(description !== undefined ? { description } : {}),
      proposedAt: to === 'proposed' ? now : to === 'active' ? null : undefined,
      closedAt: to === 'closed' ? now : to === 'active' ? null : undefined,
      updatedAt: now,
    })
    .where(and(
      eq(designDraft.id, draftId),
      eq(designDraft.designId, designId),
      eq(designDraft.userId, userId),
      eq(designDraft.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
      from.length === 1
        ? eq(designDraft.status, from[0]!)
        : or(...from.map((status) => eq(designDraft.status, status))),
    ))
    .returning({ id: designDraft.id, status: designDraft.status })
  if (!updated) throw new Error(`Branch "${draftId}" cannot transition to ${to}`)
  void publishBranchChanged(userId, designId, updated.id, to)
  return updated
}

export const proposeDraft = (
  userId: string,
  designId: string,
  draftId: string,
  description = '',
) => transitionDraft(userId, designId, draftId, ['active'], 'proposed', description)

export const reopenDraft = (userId: string, designId: string, draftId: string) =>
  transitionDraft(userId, designId, draftId, ['proposed', 'closed'], 'active')

export const closeDraft = (userId: string, designId: string, draftId: string) =>
  transitionDraft(userId, designId, draftId, ['active', 'proposed'], 'closed')

export async function compareDraft(userId: string, designId: string, draftId: string) {
  const comparison = await getWebDraftComparison(userId, designId, draftId)
  return {
    designId,
    draftId,
    status: comparison.draft.status,
    mainRevision: comparison.mainRevision,
    draftRevision: comparison.draft.revision,
    summary: comparison.summary,
    conflicts: comparison.conflicts,
  }
}

export const applyDraft = (
  userId: string,
  designId: string,
  draftId: string,
  expectedMainRevision: number,
  expectedDraftRevision: number,
  resolutions: Record<string, 'main' | 'draft'>,
) => applyWebDraftToStore(
  userId,
  designId,
  draftId,
  expectedMainRevision,
  expectedDraftRevision,
  resolutions,
)

export async function listAssets(userId: string) {
  const rows = await db
    .select({
      id: asset.id,
      name: asset.name,
      mediaType: asset.mediaType,
      size: asset.size,
      createdAt: asset.createdAt,
    })
    .from(asset)
    .where(eq(asset.userId, userId))
    .orderBy(desc(asset.createdAt))
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function requireWebDocument(userId: string, designId: string) {
  const found = await readWebCanvasStore(userId, designId)
  if (found.status !== 'ready') throw new Error('Migrate this legacy design before using MCP.')
  return found
}
