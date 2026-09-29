import { ORPCError } from '@orpc/server'
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@sheet/db'
import { design } from '@sheet/db/schema'
import { publishCanvasRealtimeEvent } from '@sheet/db/canvas-realtime'
import {
  localProcedure,
} from './procedures'

/**
 * The `design` namespace: the legacy shape/page payload documents.
 */

export const listDesigns = localProcedure.handler(async ({ context }) => {
  return db
    .select({
      id: design.id,
      name: design.name,
      revision: design.revision,
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(and(eq(design.userId, context.user.id), isNull(design.archivedAt)))
    .orderBy(asc(design.createdAt))
    .then((rows) => rows.map(({ updatedAt, ...row }) => ({ ...row, updatedAt: updatedAt.getTime() })))
})

/** The archive, most recently archived first — the order people look in. */
export const listArchivedDesigns = localProcedure.handler(async ({ context }) => {
  return db
    .select({
      id: design.id,
      name: design.name,
      revision: design.revision,
      updatedAt: design.updatedAt,
      archivedAt: design.archivedAt,
    })
    .from(design)
    .where(and(eq(design.userId, context.user.id), isNotNull(design.archivedAt)))
    .orderBy(desc(design.archivedAt))
    .then((rows) =>
      rows.map(({ updatedAt, archivedAt, ...row }) => ({
        ...row,
        updatedAt: updatedAt.getTime(),
        archivedAt: (archivedAt ?? updatedAt).getTime(),
      })),
    )
})

export const archiveDesign = localProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [archived] = await db
      .update(design)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(design.id, input.id),
          eq(design.userId, context.user.id),
          isNull(design.archivedAt),
        ),
      )
      .returning({ id: design.id, revision: design.revision, archivedAt: design.archivedAt })

    if (!archived) throw new ORPCError('NOT_FOUND')
    void publishCanvasRealtimeEvent(
      context.user.id,
      { designId: archived.id },
      { type: 'canvas.changed', revision: archived.revision, nodeIds: [] },
    )
    return { archivedAt: (archived.archivedAt ?? new Date()).getTime() }
  })

export const restoreDesign = localProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [restored] = await db
      .update(design)
      .set({ archivedAt: null })
      .where(
        and(
          eq(design.id, input.id),
          eq(design.userId, context.user.id),
          isNotNull(design.archivedAt),
        ),
      )
      .returning({ id: design.id, revision: design.revision })

    if (!restored) throw new ORPCError('NOT_FOUND')
    void publishCanvasRealtimeEvent(
      context.user.id,
      { designId: restored.id },
      { type: 'canvas.changed', revision: restored.revision, nodeIds: [] },
    )
    return { restored: true }
  })

/**
 * Permanent, and only from the archive. Archiving is the delete people reach
 * for; this is the one that empties it, so it refuses a file that is still in
 * use rather than trusting the caller to have asked twice.
 */
export const deleteDesign = localProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [existing] = await db
      .select({ archivedAt: design.archivedAt })
      .from(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .limit(1)

    if (!existing) throw new ORPCError('NOT_FOUND')
    if (!existing.archivedAt) {
      throw new ORPCError('CONFLICT', {
        message: 'Archive this file before deleting it permanently.',
      })
    }

    const deleted = await db
      .delete(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .returning({ id: design.id })

    return { deleted: deleted.length > 0 }
  })
