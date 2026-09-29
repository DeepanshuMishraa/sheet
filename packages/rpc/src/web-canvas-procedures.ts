import { ORPCError } from '@orpc/server'
import { and, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@sheet/db'
import { canvasTransaction, design, designDraft, designVersion } from '@sheet/db/schema'
import {
  CANVAS_SCHEMA_VERSION,
  parseCanvasDocument,
} from '@sheet/canvas/legacy-model'
import {
  migrateLegacyDocument,
  parseLegacyStorage,
} from '@sheet/canvas/legacy-migration'
import {
  WEB_CANVAS_STORAGE_VERSION,
  applyWebTransaction,
  createWebDocument,
  parseWebDocument,
  webId,
  parseWebTransaction,
} from '@sheet/canvas/web-model'
import { publishBranchChanged, publishCanvasRealtimeEvent } from '@sheet/db/canvas-realtime'
import { canvasTransactionPruneBefore } from '@sheet/db/canvas-transactions'
import { localProcedure, optionalDraftIdSchema, requireDesignAccess } from './procedures'

function parseStoredLegacyDocument(
  version: number,
  storedDocument: unknown,
  shapes: unknown,
  pages: unknown,
  name: string,
  id: string,
) {
  if (version === CANVAS_SCHEMA_VERSION && storedDocument) {
    return parseCanvasDocument(storedDocument)
  }
  if (version === 1) return parseLegacyStorage(shapes, pages, name, id)
  throw new ORPCError('CONFLICT', { message: `Unsupported legacy canvas version: ${version}` })
}

const webCanvasTarget = z.object({
  designId: z.string().min(1).max(128),
  draftId: optionalDraftIdSchema,
})

/**
 * Shared store read behind both the oRPC `webCanvas.get` procedure and the
 * MCP web tools: same revision source, same lazy v1/v2 migration, same
 * errors. MCP is a second transport, never a second authority.
 */
export async function readWebCanvasStore(
  ownerUserId: string,
  designId: string,
  draftId?: string | null,
) {
  if (draftId) {
    const draft = await db
      .select({
        version: designDraft.canvasVersion,
        name: designDraft.name,
        revision: designDraft.revision,
        document: designDraft.canvasDocument,
        shapes: designDraft.shapes,
        pages: designDraft.pages,
      })
      .from(designDraft)
      .where(
        and(
          eq(designDraft.id, draftId),
          eq(designDraft.designId, designId),
          eq(designDraft.userId, ownerUserId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0])
    if (!draft) throw new ORPCError('NOT_FOUND')
    if (draft.version === WEB_CANVAS_STORAGE_VERSION && draft.document) {
      return {
        status: 'ready' as const,
        revision: draft.revision,
        document: parseWebDocument(draft.document),
      }
    }
    if (draft.version === CANVAS_SCHEMA_VERSION && draft.document) {
      return {
        status: 'legacy' as const,
        revision: draft.revision,
        document: parseCanvasDocument(draft.document),
      }
    }
    if (draft.version === 1) {
      return {
        status: 'legacy' as const,
        revision: draft.revision,
        document: parseLegacyStorage(draft.shapes, draft.pages, draft.name, designId),
      }
    }
    throw new ORPCError('CONFLICT', { message: 'UNSUPPORTED_CANVAS' })
  }
  const target = await db
    .select({
      version: design.canvasVersion,
      name: design.name,
      revision: design.revision,
      document: design.canvasDocument,
      shapes: design.shapes,
      pages: design.pages,
    })
    .from(design)
    .where(
      and(
        eq(design.id, designId),
        eq(design.userId, ownerUserId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!target) throw new ORPCError('NOT_FOUND')
  if (target.version === WEB_CANVAS_STORAGE_VERSION && target.document) {
    return {
      status: 'ready' as const,
      revision: target.revision,
      document: parseWebDocument(target.document),
    }
  }
  if (target.version === CANVAS_SCHEMA_VERSION && target.document) {
    return {
      status: 'legacy' as const,
      revision: target.revision,
      document: parseCanvasDocument(target.document),
    }
  }
  if (target.version === 1) {
    return {
      status: 'legacy' as const,
      revision: target.revision,
      document: parseLegacyStorage(target.shapes, target.pages, target.name, designId),
    }
  }
  throw new ORPCError('CONFLICT', { message: 'UNSUPPORTED_CANVAS' })
}

export const getWebCanvas = localProcedure
  .input(webCanvasTarget)
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'view')
    return readWebCanvasStore(access.ownerUserId, input.designId, input.draftId ?? null)
  })

/**
 * Idempotent create: a new design row holding an empty WebDocument, so the
 * product never mints a new legacy document. Conflict → existing id wins.
 */
export const createWebCanvasDesign = localProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      name: z.string().trim().min(1).max(200),
    }),
  )
  .handler(async ({ context, input }) => {
    const document = createWebDocument(input.name, input.designId)
    const [created] = await db
      .insert(design)
      .values({
        id: input.designId,
        userId: context.user.id,
        name: input.name,
        shapes: [],
        pages: [],
        canvasVersion: WEB_CANVAS_STORAGE_VERSION,
        canvasDocument: document,
      })
      .onConflictDoNothing({ target: [design.id, design.userId] })
      .returning({
        id: design.id,
        revision: design.revision,
        document: design.canvasDocument,
      })
    if (created) {
      void publishCanvasRealtimeEvent(
        context.user.id,
        { designId: created.id },
        { type: 'canvas.changed', revision: created.revision, nodeIds: [] },
      )
      return {
        created: true as const,
        id: created.id,
        revision: created.revision,
        document: parseWebDocument(created.document),
      }
    }
    const [existing] = await db
      .select({
        id: design.id,
        version: design.canvasVersion,
        revision: design.revision,
        document: design.canvasDocument,
      })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!existing) throw new ORPCError('CONFLICT')
    if (existing.version !== WEB_CANVAS_STORAGE_VERSION || !existing.document) {
      throw new ORPCError('CONFLICT', { message: 'UNSUPPORTED_CANVAS' })
    }
    return {
      created: false as const,
      id: existing.id,
      revision: existing.revision,
      document: parseWebDocument(existing.document),
    }
  })

export async function renameWebCanvasStore(
  ownerUserId: string,
  designId: string,
  name: string,
) {
  const found = await readWebCanvasStore(ownerUserId, designId)
  if (found.status !== 'ready') {
    throw new ORPCError('CONFLICT', { message: 'Migrate this legacy design before renaming it.' })
  }
  const document = {
    ...found.document,
    name,
    metadata: { ...found.document.metadata, updatedAt: Date.now() },
  }
  const [updated] = await db
    .update(design)
    .set({
      name,
      canvasVersion: WEB_CANVAS_STORAGE_VERSION,
      canvasDocument: document,
      revision: found.revision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(design.id, designId),
        eq(design.userId, ownerUserId),
        eq(design.revision, found.revision),
        eq(design.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
      ),
    )
    .returning({ id: design.id, name: design.name, revision: design.revision })
  if (!updated) throw new ORPCError('CONFLICT', { message: 'The design changed before it could be renamed.' })
  void publishCanvasRealtimeEvent(
    ownerUserId,
    { designId },
    { type: 'canvas.changed', revision: updated.revision, nodeIds: [] },
  )
  return { ...updated, document }
}

export const renameWebCanvasDesign = localProcedure
  .input(z.object({
    designId: z.string().min(1).max(128),
    name: z.string().trim().min(1).max(200),
  }))
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'edit')
    return renameWebCanvasStore(access.ownerUserId, input.designId, input.name)
  })

export const migrateWebCanvas = localProcedure
  .input(
    webCanvasTarget.extend({
      expectedRevision: z.number().int().nonnegative(),
    }),
  )
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'edit')
    const result = await db.transaction(async (tx) => {
      if (input.draftId) {
        const main = await tx
          .select({ version: design.canvasVersion })
          .from(design)
          .where(and(eq(design.id, input.designId), eq(design.userId, access.ownerUserId)))
          .limit(1)
          .then((rows) => rows[0])
        if (main?.version !== WEB_CANVAS_STORAGE_VERSION) {
          throw new ORPCError('CONFLICT', { message: 'Migrate Main before migrating a branch.' })
        }
        const draft = await tx
          .select({
            name: designDraft.name,
            version: designDraft.canvasVersion,
            baseVersion: designDraft.baseCanvasVersion,
            revision: designDraft.revision,
            document: designDraft.canvasDocument,
            baseDocument: designDraft.baseCanvasDocument,
            shapes: designDraft.shapes,
            pages: designDraft.pages,
            baseShapes: designDraft.baseShapes,
            basePages: designDraft.basePages,
          })
          .from(designDraft)
          .where(and(
            eq(designDraft.id, input.draftId),
            eq(designDraft.designId, input.designId),
            eq(designDraft.userId, access.ownerUserId),
          ))
          .limit(1)
          .then((rows) => rows[0])
        if (!draft) throw new ORPCError('NOT_FOUND')
        if (draft.version === WEB_CANVAS_STORAGE_VERSION && draft.baseVersion === WEB_CANVAS_STORAGE_VERSION && draft.document) {
          return { migrated: false as const, revision: draft.revision, document: parseWebDocument(draft.document), draftId: input.draftId }
        }
        if (draft.revision !== input.expectedRevision) {
          throw new ORPCError('CONFLICT', { message: 'The branch changed before migration could start.' })
        }
        const legacy = parseStoredLegacyDocument(draft.version, draft.document, draft.shapes, draft.pages, draft.name, input.designId)
        const baseLegacy = parseStoredLegacyDocument(draft.baseVersion, draft.baseDocument, draft.baseShapes, draft.basePages, draft.name, input.designId)
        const document = migrateLegacyDocument(legacy)
        const baseDocument = migrateLegacyDocument(baseLegacy)
        const timestamp = new Date()
        await tx.insert(designVersion).values([
          {
            id: webId('version'), designId: input.designId, draftId: input.draftId,
            userId: access.ownerUserId, message: 'Branch before WebDocument migration',
            shapes: draft.shapes, pages: draft.pages, canvasVersion: draft.version,
            canvasDocument: draft.version === CANVAS_SCHEMA_VERSION ? legacy : null,
            added: 0, removed: 0, changed: Object.keys(legacy.nodes).length,
          },
          {
            id: webId('version'), designId: input.designId, draftId: input.draftId,
            userId: access.ownerUserId, message: 'Branch base before WebDocument migration',
            shapes: draft.baseShapes, pages: draft.basePages, canvasVersion: draft.baseVersion,
            canvasDocument: draft.baseVersion === CANVAS_SCHEMA_VERSION ? baseLegacy : null,
            added: 0, removed: 0, changed: Object.keys(baseLegacy.nodes).length,
          },
        ])
        const updated = await tx.update(designDraft).set({
          canvasVersion: WEB_CANVAS_STORAGE_VERSION,
          baseCanvasVersion: WEB_CANVAS_STORAGE_VERSION,
          canvasDocument: document,
          baseCanvasDocument: baseDocument,
          shapes: [], pages: [], baseShapes: [], basePages: [],
          revision: draft.revision + 1,
          updatedAt: timestamp,
        }).where(and(
          eq(designDraft.id, input.draftId),
          eq(designDraft.designId, input.designId),
          eq(designDraft.userId, access.ownerUserId),
          eq(designDraft.revision, draft.revision),
          eq(designDraft.canvasVersion, draft.version),
        )).returning({ revision: designDraft.revision })
        if (!updated[0]) throw new ORPCError('CONFLICT', { message: 'The branch changed during migration.' })
        return { migrated: true as const, revision: updated[0].revision, document, draftId: input.draftId }
      }

      const target = await tx.select({
        name: design.name,
        version: design.canvasVersion,
        revision: design.revision,
        document: design.canvasDocument,
        shapes: design.shapes,
        pages: design.pages,
      }).from(design).where(and(
        eq(design.id, input.designId),
        eq(design.userId, access.ownerUserId),
      )).limit(1).then((rows) => rows[0])
      if (!target) throw new ORPCError('NOT_FOUND')
      if (target.version === WEB_CANVAS_STORAGE_VERSION && target.document) {
        return { migrated: false as const, revision: target.revision, document: parseWebDocument(target.document), draftId: null }
      }
      if (target.revision !== input.expectedRevision) {
        throw new ORPCError('CONFLICT', { message: 'The design changed before web migration could start.' })
      }
      const legacy = parseStoredLegacyDocument(target.version, target.document, target.shapes, target.pages, target.name, input.designId)
      const document = migrateLegacyDocument(legacy)
      await tx.insert(designVersion).values({
        id: webId('version'), designId: input.designId, draftId: null,
        userId: access.ownerUserId, message: 'Before web document migration',
        shapes: target.shapes, pages: target.pages, canvasVersion: target.version,
        canvasDocument: target.version === CANVAS_SCHEMA_VERSION ? legacy : null,
        added: 0, removed: 0, changed: Object.keys(legacy.nodes).length,
      })
      const updated = await tx.update(design).set({
        canvasVersion: WEB_CANVAS_STORAGE_VERSION,
        canvasDocument: document,
        shapes: [], pages: [],
        revision: target.revision + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(design.id, input.designId),
        eq(design.userId, access.ownerUserId),
        eq(design.revision, target.revision),
        eq(design.canvasVersion, target.version),
      )).returning({ revision: design.revision })
      if (!updated[0]) throw new ORPCError('CONFLICT', { message: 'The design changed during web migration.' })
      return { migrated: true as const, revision: updated[0].revision, document, draftId: null }
    })
    if (result.migrated) {
      void publishCanvasRealtimeEvent(access.ownerUserId, {
        designId: input.designId,
        draftId: result.draftId,
      }, { type: 'canvas.changed', revision: result.revision, nodeIds: [] })
      if (result.draftId) void publishBranchChanged(access.ownerUserId, input.designId, result.draftId, 'active')
    }
    return result
  })

/**
 * Shared store write behind both the oRPC `webCanvas.applyTransaction`
 * procedure and the MCP `applyWebTransaction` tool: same parsing, same
 * idempotency, same compare-and-swap, same history row, same realtime
 * event. MCP mutations are WebTransactions or they do not happen.
 */
export async function applyWebCanvasTransactionToStore(
  ownerUserId: string,
  authorUserId: string,
  designId: string,
  expectedRevision: number,
  transactionInput: unknown,
  draftId?: string | null,
) {
  const transaction = parseWebTransaction(transactionInput)
  const targetKey = draftId ? `draft:${draftId}` : 'main'
  const result = await db.transaction(async (tx) => {
    const duplicate = await tx
      .select({ revision: canvasTransaction.revision })
      .from(canvasTransaction)
      .where(
        and(
          eq(canvasTransaction.userId, ownerUserId),
          eq(canvasTransaction.designId, designId),
          eq(canvasTransaction.targetKey, targetKey),
          eq(canvasTransaction.transactionId, transaction.id),
        ),
      )
      .limit(1)
      .then((rows) => rows[0])
    if (duplicate) {
      const current = draftId
        ? await tx
          .select({
            revision: designDraft.revision,
            document: designDraft.canvasDocument,
          })
          .from(designDraft)
          .where(
            and(
              eq(designDraft.id, draftId),
              eq(designDraft.designId, designId),
              eq(designDraft.userId, ownerUserId),
            ),
          )
          .limit(1)
          .then((rows) => rows[0])
        : await tx
          .select({
            revision: design.revision,
            document: design.canvasDocument,
          })
          .from(design)
          .where(
            and(
              eq(design.id, designId),
              eq(design.userId, ownerUserId),
            ),
          )
          .limit(1)
          .then((rows) => rows[0])
      if (!current?.document) throw new ORPCError('NOT_FOUND')
      return {
        applied: false as const,
        reason: 'idempotent' as const,
        revision: current.revision,
        document: parseWebDocument(current.document),
        changedNodeIds: [] as string[],
      }
    }

    if (draftId) {
      const draft = await tx
        .select({
          version: designDraft.canvasVersion,
          status: designDraft.status,
          revision: designDraft.revision,
          document: designDraft.canvasDocument,
        })
        .from(designDraft)
        .where(
          and(
            eq(designDraft.id, draftId),
            eq(designDraft.designId, designId),
            eq(designDraft.userId, ownerUserId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0])
      if (!draft?.document) throw new ORPCError('NOT_FOUND')
      if (draft.status !== 'active') {
        throw new ORPCError('CONFLICT', { message: 'This branch is read-only.' })
      }
      if (draft.version !== WEB_CANVAS_STORAGE_VERSION) {
        throw new ORPCError('CONFLICT', { message: 'WEB_CANVAS_NOT_MIGRATED' })
      }
      const current = parseWebDocument(draft.document)
      if (draft.revision !== expectedRevision) {
        return {
          applied: false as const,
          reason: 'stale' as const,
          revision: draft.revision,
          document: current,
          changedNodeIds: [] as string[],
        }
      }
      const applied = applyWebTransaction(current, transaction)
      const nextRevision = draft.revision + 1
      const updated = await tx
        .update(designDraft)
        .set({
          canvasDocument: applied.document,
          canvasVersion: WEB_CANVAS_STORAGE_VERSION,
          revision: nextRevision,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(designDraft.id, draftId),
            eq(designDraft.designId, designId),
            eq(designDraft.userId, ownerUserId),
            eq(designDraft.revision, draft.revision),
            eq(designDraft.status, 'active'),
            eq(designDraft.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
          ),
        )
        .returning({ revision: designDraft.revision })
      if (!updated[0]) {
        throw new ORPCError('CONFLICT', {
          message: 'The design changed while the web transaction was saving.',
        })
      }
      await tx.insert(canvasTransaction).values({
        designId,
        userId: ownerUserId,
        authorUserId,
        targetKey,
        transactionId: transaction.id,
        baseRevision: draft.revision,
        revision: nextRevision,
        transaction,
      })
      const pruneBefore = canvasTransactionPruneBefore(draft.revision, nextRevision)
      if (pruneBefore !== null) {
        await tx.delete(canvasTransaction).where(and(
          eq(canvasTransaction.userId, ownerUserId),
          eq(canvasTransaction.designId, designId),
          eq(canvasTransaction.targetKey, targetKey),
          lt(canvasTransaction.revision, pruneBefore),
        ))
      }
      return {
        applied: true as const,
        revision: nextRevision,
        document: applied.document,
        changedNodeIds: [...applied.changedNodeIds],
      }
    }

    const target = await tx
      .select({
        version: design.canvasVersion,
        revision: design.revision,
        document: design.canvasDocument,
      })
      .from(design)
      .where(
        and(
          eq(design.id, designId),
          eq(design.userId, ownerUserId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0])
    if (!target?.document) throw new ORPCError('NOT_FOUND')
    if (target.version !== WEB_CANVAS_STORAGE_VERSION) {
      throw new ORPCError('CONFLICT', { message: 'WEB_CANVAS_NOT_MIGRATED' })
    }
    const current = parseWebDocument(target.document)
    if (target.revision !== expectedRevision) {
      return {
        applied: false as const,
        reason: 'stale' as const,
        revision: target.revision,
        document: current,
        changedNodeIds: [] as string[],
      }
    }
    const applied = applyWebTransaction(current, transaction)
    const nextRevision = target.revision + 1
    const updated = await tx
      .update(design)
      .set({
        canvasDocument: applied.document,
        canvasVersion: WEB_CANVAS_STORAGE_VERSION,
        revision: nextRevision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(design.id, designId),
          eq(design.userId, ownerUserId),
          eq(design.revision, target.revision),
          eq(design.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
        ),
      )
      .returning({ revision: design.revision })
    if (!updated[0]) {
      throw new ORPCError('CONFLICT', {
        message: 'The design changed while the web transaction was saving.',
      })
    }
    await tx.insert(canvasTransaction).values({
      designId,
      userId: ownerUserId,
      authorUserId,
      targetKey,
      transactionId: transaction.id,
      baseRevision: target.revision,
      revision: nextRevision,
      transaction,
    })
    const pruneBefore = canvasTransactionPruneBefore(target.revision, nextRevision)
    if (pruneBefore !== null) {
      await tx.delete(canvasTransaction).where(and(
        eq(canvasTransaction.userId, ownerUserId),
        eq(canvasTransaction.designId, designId),
        eq(canvasTransaction.targetKey, targetKey),
        lt(canvasTransaction.revision, pruneBefore),
      ))
    }
    return {
      applied: true as const,
      revision: nextRevision,
      document: applied.document,
      changedNodeIds: [...applied.changedNodeIds],
    }
  })

  if (result.applied) {
    void publishCanvasRealtimeEvent(
      ownerUserId,
      { designId, draftId: draftId ?? null },
      {
        type: 'canvas.changed',
        revision: result.revision,
        nodeIds: result.changedNodeIds,
      },
    )
  }
  return result
}

export const applyWebCanvasTransaction = localProcedure
  .input(
    webCanvasTarget.extend({
      expectedRevision: z.number().int().nonnegative(),
      transaction: z.unknown(),
    }),
  )
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'edit')
    return applyWebCanvasTransactionToStore(
      access.ownerUserId,
      context.user.id,
      input.designId,
      input.expectedRevision,
      input.transaction,
      input.draftId ?? null,
    )
  })
