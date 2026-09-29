import { ORPCError } from '@orpc/server'
import { and, desc, eq, isNotNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@sheet/db'
import { design, designDraft, designVersion } from '@sheet/db/schema'
import { diffWebDocuments } from '@sheet/canvas/web-diff'
import {
  WEB_CANVAS_STORAGE_VERSION,
  createWebDocument,
  parseWebDocument,
} from '@sheet/canvas/web-model'
import { publishCanvasRealtimeEvent } from '@sheet/db/canvas-realtime'
import { getOwnedDraft } from './branches'
import { toHistoryPage } from './history'
import { draftTargetWhere, localProcedure, optionalDraftIdSchema } from './procedures'

const versionTarget = z.object({
  designId: z.string().min(1).max(128),
  draftId: optionalDraftIdSchema,
})

async function requireWebTarget(userId: string, designId: string, draftId?: string | null) {
  if (draftId) {
    const draft = await getOwnedDraft(userId, designId, draftId)
    if (draft.status !== 'active') {
      throw new ORPCError('CONFLICT', { message: 'This branch is read-only.' })
    }
    if (draft.canvasVersion !== WEB_CANVAS_STORAGE_VERSION || !draft.canvasDocument) {
      throw new ORPCError('CONFLICT', { message: 'Legacy designs have no active history. Migrate Main first.' })
    }
    return { revision: draft.revision, document: parseWebDocument(draft.canvasDocument) }
  }
  const [target] = await db
    .select({
      version: design.canvasVersion,
      revision: design.revision,
      document: design.canvasDocument,
    })
    .from(design)
    .where(and(eq(design.id, designId), eq(design.userId, userId)))
    .limit(1)
  if (!target?.document) throw new ORPCError('NOT_FOUND')
  if (target.version !== WEB_CANVAS_STORAGE_VERSION) {
    throw new ORPCError('CONFLICT', { message: 'Legacy designs have no active history. Migrate Main first.' })
  }
  return { revision: target.revision, document: parseWebDocument(target.document) }
}

export const listVersions = localProcedure
  .input(versionTarget.extend({
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.object({
      at: z.number().int().min(0).max(8_640_000_000_000_000),
      id: z.string().min(1).max(128),
    }).optional(),
  }))
  .handler(async ({ context, input }) => {
    await requireWebTarget(context.user.id, input.designId, input.draftId)
    const cursorDate = input.cursor ? new Date(input.cursor.at) : null
    const versions = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        added: designVersion.added,
        removed: designVersion.removed,
        changed: designVersion.changed,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(and(
        eq(designVersion.designId, input.designId),
        eq(designVersion.userId, context.user.id),
        eq(designVersion.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
        isNotNull(designVersion.canvasDocument),
        draftTargetWhere(input.draftId),
        cursorDate
          ? or(
              lt(designVersion.createdAt, cursorDate),
              and(eq(designVersion.createdAt, cursorDate), lt(designVersion.id, input.cursor!.id)),
            )
          : undefined,
      ))
      .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
      .limit(input.limit + 1)
    return toHistoryPage(versions, input.limit)
  })

export const commitWebVersion = localProcedure
  .input(versionTarget.extend({
    id: z.string().min(1).max(128),
    message: z.string().trim().min(1).max(200),
    document: z.unknown(),
    skipIfUnchanged: z.boolean().default(true),
  }))
  .handler(async ({ context, input }) => {
    const document = parseWebDocument(input.document)
    await requireWebTarget(context.user.id, input.designId, input.draftId)
    const [latest] = await db
      .select({ document: designVersion.canvasDocument })
      .from(designVersion)
      .where(and(
        eq(designVersion.designId, input.designId),
        eq(designVersion.userId, context.user.id),
        eq(designVersion.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
        isNotNull(designVersion.canvasDocument),
        draftTargetWhere(input.draftId),
      ))
      .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
      .limit(1)
    const previous = latest?.document
      ? parseWebDocument(latest.document)
      : createWebDocument(document.name, document.id)
    if (input.skipIfUnchanged && JSON.stringify(previous) === JSON.stringify(document)) return null
    const [version] = await db
      .insert(designVersion)
      .values({
        id: input.id,
        designId: input.designId,
        draftId: input.draftId ?? null,
        userId: context.user.id,
        message: input.message,
        shapes: [],
        pages: [],
        canvasVersion: WEB_CANVAS_STORAGE_VERSION,
        canvasDocument: document,
        ...diffWebDocuments(previous, document),
      })
      .returning()
    return {
      id: version.id,
      message: version.message,
      added: version.added,
      removed: version.removed,
      changed: version.changed,
      at: version.createdAt.getTime(),
    }
  })

export const compareWebVersion = localProcedure
  .input(versionTarget.extend({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    await requireWebTarget(context.user.id, input.designId, input.draftId)
    const [current] = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        document: designVersion.canvasDocument,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(and(
        eq(designVersion.id, input.id),
        eq(designVersion.designId, input.designId),
        eq(designVersion.userId, context.user.id),
        eq(designVersion.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
        isNotNull(designVersion.canvasDocument),
        draftTargetWhere(input.draftId),
      ))
      .limit(1)
    if (!current?.document) throw new ORPCError('NOT_FOUND')
    const [previous] = await db
      .select({
        id: designVersion.id,
        message: designVersion.message,
        document: designVersion.canvasDocument,
        createdAt: designVersion.createdAt,
      })
      .from(designVersion)
      .where(and(
        eq(designVersion.designId, input.designId),
        eq(designVersion.userId, context.user.id),
        eq(designVersion.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
        isNotNull(designVersion.canvasDocument),
        draftTargetWhere(input.draftId),
        or(
          lt(designVersion.createdAt, current.createdAt),
          and(eq(designVersion.createdAt, current.createdAt), lt(designVersion.id, current.id)),
        ),
      ))
      .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
      .limit(1)
    const detail = (row: typeof current) => ({
      id: row.id,
      message: row.message,
      document: parseWebDocument(row.document),
      at: row.createdAt.getTime(),
    })
    return { current: detail(current), previous: previous?.document ? detail(previous) : null }
  })

export const restoreWebVersion = localProcedure
  .input(versionTarget.extend({
    id: z.string().min(1).max(128),
    expectedRevision: z.number().int().nonnegative(),
  }))
  .handler(async ({ context, input }) => {
    await requireWebTarget(context.user.id, input.designId, input.draftId)
    const [version] = await db
      .select({ document: designVersion.canvasDocument })
      .from(designVersion)
      .where(and(
        eq(designVersion.id, input.id),
        eq(designVersion.designId, input.designId),
        eq(designVersion.userId, context.user.id),
        eq(designVersion.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
        isNotNull(designVersion.canvasDocument),
        draftTargetWhere(input.draftId),
      ))
      .limit(1)
    if (!version?.document) throw new ORPCError('NOT_FOUND')
    const document = parseWebDocument(version.document)
    const updated = input.draftId
      ? await db
          .update(designDraft)
          .set({
            canvasDocument: document,
            revision: input.expectedRevision + 1,
            updatedAt: new Date(),
          })
          .where(and(
            eq(designDraft.id, input.draftId),
            eq(designDraft.designId, input.designId),
            eq(designDraft.userId, context.user.id),
            eq(designDraft.status, 'active'),
            eq(designDraft.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
            eq(designDraft.revision, input.expectedRevision),
          ))
          .returning({ revision: designDraft.revision })
      : await db
          .update(design)
          .set({
            canvasDocument: document,
            revision: input.expectedRevision + 1,
            updatedAt: new Date(),
          })
          .where(and(
            eq(design.id, input.designId),
            eq(design.userId, context.user.id),
            eq(design.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
            eq(design.revision, input.expectedRevision),
          ))
          .returning({ revision: design.revision })
    if (!updated[0]) {
      throw new ORPCError('CONFLICT', { message: 'The document changed before the version could be restored.' })
    }
    void publishCanvasRealtimeEvent(
      context.user.id,
      { designId: input.designId, draftId: input.draftId ?? null },
      { type: 'canvas.changed', revision: updated[0].revision, nodeIds: [] },
    )
    return { revision: updated[0].revision, document }
  })
