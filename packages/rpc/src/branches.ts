import { ORPCError } from '@orpc/server'
import { and, desc, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@sheet/db'
import { design, designDraft, designVersion } from '@sheet/db/schema'
import { diffWebDocuments } from '@sheet/canvas/web-diff'
import {
  changedWebNodeIds,
  mergeWebDocuments,
  type WebMergeConflict,
} from '@sheet/canvas/web-merge'
import {
  WEB_CANVAS_STORAGE_VERSION,
  createWebDocument,
  parseWebDocument,
  webId,
} from '@sheet/canvas/web-model'
import { publishBranchChanged, publishCanvasRealtimeEvent } from '@sheet/db/canvas-realtime'
import { draftIdSchema, localProcedure } from './procedures'

export async function getOwnedDraft(userId: string, designId: string, draftId: string) {
  const [draft] = await db
    .select()
    .from(designDraft)
    .where(and(
      eq(designDraft.id, draftId),
      eq(designDraft.designId, designId),
      eq(designDraft.userId, userId),
    ))
    .limit(1)
  if (!draft) throw new ORPCError('NOT_FOUND')
  return draft
}

export type BranchMergeResolutions = Record<string, 'main' | 'draft'>

function mergeResolutions(resolutions: BranchMergeResolutions) {
  return Object.fromEntries(
    Object.entries(resolutions).map(([id, side]) => [id, side === 'draft' ? 'right' : 'left']),
  ) as Record<string, 'left' | 'right'>
}

export function branchMergeConflicts(conflicts: WebMergeConflict[]) {
  return conflicts.map(({ left, right, ...conflict }) => ({
    ...conflict,
    main: left,
    draft: right,
  }))
}

export async function getWebDraftComparison(userId: string, designId: string, draftId: string) {
  const [main, draft] = await Promise.all([
    db
      .select({
        canvasVersion: design.canvasVersion,
        canvasDocument: design.canvasDocument,
        revision: design.revision,
      })
      .from(design)
      .where(and(eq(design.id, designId), eq(design.userId, userId)))
      .limit(1)
      .then((rows) => rows[0]),
    getOwnedDraft(userId, designId, draftId),
  ])
  if (!main) throw new ORPCError('NOT_FOUND')
  if (
    main.canvasVersion !== WEB_CANVAS_STORAGE_VERSION ||
    draft.canvasVersion !== WEB_CANVAS_STORAGE_VERSION ||
    draft.baseCanvasVersion !== WEB_CANVAS_STORAGE_VERSION ||
    !main.canvasDocument ||
    !draft.canvasDocument ||
    !draft.baseCanvasDocument
  ) {
    throw new ORPCError('CONFLICT', { message: 'Legacy designs cannot branch. Migrate Main first.' })
  }
  const baseDocument = parseWebDocument(draft.baseCanvasDocument)
  const mainDocument = parseWebDocument(main.canvasDocument)
  const draftDocument = parseWebDocument(draft.canvasDocument)
  const merged = mergeWebDocuments(baseDocument, mainDocument, draftDocument)
  return {
    draft: {
      id: draft.id,
      name: draft.name,
      description: draft.description,
      status: draft.status,
      baseRevision: draft.baseRevision,
      revision: draft.revision,
      proposedAt: draft.proposedAt?.getTime() ?? null,
      appliedAt: draft.appliedAt?.getTime() ?? null,
      closedAt: draft.closedAt?.getTime() ?? null,
    },
    mainRevision: main.revision,
    mainDocument,
    draftDocument,
    baseDocument,
    summary: merged.summary,
    conflicts: branchMergeConflicts(merged.conflicts),
    unresolved: merged.unresolved,
  }
}

export const listDrafts = localProcedure
  .input(z.object({
    designId: z.string().min(1).max(128),
    includeArchived: z.boolean().default(true),
  }))
  .handler(async ({ context, input }) => {
    const rows = await db
      .select({
        id: designDraft.id,
        name: designDraft.name,
        description: designDraft.description,
        status: designDraft.status,
        canvasVersion: designDraft.canvasVersion,
        baseRevision: designDraft.baseRevision,
        revision: designDraft.revision,
        proposedAt: designDraft.proposedAt,
        appliedAt: designDraft.appliedAt,
        closedAt: designDraft.closedAt,
        createdAt: designDraft.createdAt,
        updatedAt: designDraft.updatedAt,
      })
      .from(designDraft)
      .where(and(
        eq(designDraft.designId, input.designId),
        eq(designDraft.userId, context.user.id),
        input.includeArchived
          ? undefined
          : or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
      ))
      .orderBy(desc(designDraft.updatedAt))
    return rows.map((row) => ({
      ...row,
      available: row.canvasVersion === WEB_CANVAS_STORAGE_VERSION,
      proposedAt: row.proposedAt?.getTime() ?? null,
      appliedAt: row.appliedAt?.getTime() ?? null,
      closedAt: row.closedAt?.getTime() ?? null,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    }))
  })

export async function createWebDraftStore(
  userId: string,
  designId: string,
  name: string,
  options: { id?: string; description?: string; empty?: boolean } = {},
) {
  const [main] = await db
    .select({
      canvasVersion: design.canvasVersion,
      canvasDocument: design.canvasDocument,
      revision: design.revision,
    })
    .from(design)
    .where(and(eq(design.id, designId), eq(design.userId, userId)))
    .limit(1)
  if (!main?.canvasDocument) throw new ORPCError('NOT_FOUND')
  if (main.canvasVersion !== WEB_CANVAS_STORAGE_VERSION) {
    throw new ORPCError('CONFLICT', { message: 'Legacy designs cannot branch. Migrate Main first.' })
  }
  const current = parseWebDocument(main.canvasDocument)
  const document = options.empty ? createWebDocument(current.name, current.id) : current
  const [created] = await db
    .insert(designDraft)
    .values({
      id: options.id ?? webId('draft'),
      designId,
      userId,
      name,
      description: options.description ?? '',
      baseShapes: [],
      shapes: [],
      basePages: [],
      pages: [],
      canvasVersion: WEB_CANVAS_STORAGE_VERSION,
      baseCanvasVersion: WEB_CANVAS_STORAGE_VERSION,
      baseCanvasDocument: document,
      canvasDocument: document,
      baseRevision: main.revision,
    })
    .returning()
  void publishBranchChanged(userId, designId, created.id, 'active')
  return created
}

export const createDraft = localProcedure
  .input(z.object({
    id: draftIdSchema,
    designId: z.string().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).default(''),
    empty: z.boolean().default(false),
  }))
  .handler(({ context, input }) => createWebDraftStore(
    context.user.id,
    input.designId,
    input.name,
    { id: input.id, description: input.description, empty: input.empty },
  ))

export const renameDraft = localProcedure
  .input(z.object({
    designId: z.string().min(1).max(128),
    id: draftIdSchema,
    name: z.string().trim().min(1).max(200),
  }))
  .handler(async ({ context, input }) => {
    const [updated] = await db
      .update(designDraft)
      .set({ name: input.name, updatedAt: new Date() })
      .where(and(
        eq(designDraft.id, input.id),
        eq(designDraft.designId, input.designId),
        eq(designDraft.userId, context.user.id),
        eq(designDraft.status, 'active'),
        eq(designDraft.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
      ))
      .returning({ id: designDraft.id, name: designDraft.name })
    if (!updated) throw new ORPCError('CONFLICT', { message: 'Only active web branches can be renamed.' })
    void publishBranchChanged(context.user.id, input.designId, updated.id, 'active')
    return updated
  })

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
      or(...from.map((status) => eq(designDraft.status, status))),
    ))
    .returning({ id: designDraft.id, status: designDraft.status })
  if (!updated) throw new ORPCError('CONFLICT', { message: `This branch cannot transition to ${to}.` })
  void publishBranchChanged(userId, designId, updated.id, to)
  return updated
}

export const proposeDraft = localProcedure
  .input(z.object({
    designId: z.string().min(1).max(128),
    id: draftIdSchema,
    description: z.string().trim().max(2_000).default(''),
  }))
  .handler(({ context, input }) => transitionDraft(
    context.user.id,
    input.designId,
    input.id,
    ['active'],
    'proposed',
    input.description,
  ))

export const reopenDraft = localProcedure
  .input(z.object({ designId: z.string().min(1).max(128), id: draftIdSchema }))
  .handler(({ context, input }) => transitionDraft(
    context.user.id,
    input.designId,
    input.id,
    ['proposed', 'closed'],
    'active',
  ))

export const closeDraft = localProcedure
  .input(z.object({ designId: z.string().min(1).max(128), id: draftIdSchema }))
  .handler(({ context, input }) => transitionDraft(
    context.user.id,
    input.designId,
    input.id,
    ['active', 'proposed'],
    'closed',
  ))

export const compareDraft = localProcedure
  .input(z.object({ designId: z.string().min(1).max(128), id: draftIdSchema }))
  .handler(({ context, input }) => getWebDraftComparison(context.user.id, input.designId, input.id))

export async function applyWebDraftToStore(
  ownerUserId: string,
  designId: string,
  draftId: string,
  expectedMainRevision: number,
  expectedDraftRevision: number,
  resolutions: BranchMergeResolutions,
) {
  const comparison = await getWebDraftComparison(ownerUserId, designId, draftId)
  if (
    comparison.mainRevision !== expectedMainRevision ||
    comparison.draft.revision !== expectedDraftRevision
  ) {
    throw new ORPCError('CONFLICT', { message: 'Main or the branch changed during review.' })
  }
  if (comparison.draft.status !== 'active' && comparison.draft.status !== 'proposed') {
    throw new ORPCError('CONFLICT', { message: 'This branch is already archived.' })
  }
  const merge = mergeWebDocuments(
    comparison.baseDocument,
    comparison.mainDocument,
    comparison.draftDocument,
    mergeResolutions(resolutions),
  )
  if (merge.unresolved.length > 0) {
    return {
      applied: false as const,
      unresolved: merge.unresolved,
      conflicts: branchMergeConflicts(merge.conflicts),
    }
  }

  const beforeId = webId('version')
  const appliedId = webId('version')
  const now = new Date()
  await db.transaction(async (tx) => {
    const [updatedMain] = await tx
      .update(design)
      .set({
        canvasVersion: WEB_CANVAS_STORAGE_VERSION,
        canvasDocument: merge.merged,
        revision: expectedMainRevision + 1,
        updatedAt: now,
      })
      .where(and(
        eq(design.id, designId),
        eq(design.userId, ownerUserId),
        eq(design.revision, expectedMainRevision),
        eq(design.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
      ))
      .returning({ id: design.id })
    if (!updatedMain) throw new ORPCError('CONFLICT', { message: 'Main changed while applying the branch.' })

    await tx.insert(designVersion).values([
      {
        id: beforeId,
        designId,
        userId: ownerUserId,
        message: `Before applying: ${comparison.draft.name}`,
        shapes: [],
        pages: [],
        canvasVersion: WEB_CANVAS_STORAGE_VERSION,
        canvasDocument: comparison.mainDocument,
        ...diffWebDocuments(
          createWebDocument(comparison.mainDocument.name, comparison.mainDocument.id),
          comparison.mainDocument,
        ),
      },
      {
        id: appliedId,
        designId,
        userId: ownerUserId,
        message: `Applied branch: ${comparison.draft.name}`,
        shapes: [],
        pages: [],
        canvasVersion: WEB_CANVAS_STORAGE_VERSION,
        canvasDocument: merge.merged,
        ...diffWebDocuments(comparison.mainDocument, merge.merged),
      },
    ])

    const [updatedDraft] = await tx
      .update(designDraft)
      .set({ status: 'applied', appliedAt: now, appliedVersionId: appliedId, updatedAt: now })
      .where(and(
        eq(designDraft.id, draftId),
        eq(designDraft.designId, designId),
        eq(designDraft.userId, ownerUserId),
        eq(designDraft.revision, expectedDraftRevision),
        eq(designDraft.canvasVersion, WEB_CANVAS_STORAGE_VERSION),
        or(eq(designDraft.status, 'active'), eq(designDraft.status, 'proposed')),
      ))
      .returning({ id: designDraft.id })
    if (!updatedDraft) throw new ORPCError('CONFLICT', { message: 'The branch changed while it was applying.' })
  })

  const revision = expectedMainRevision + 1
  void publishBranchChanged(ownerUserId, designId, draftId, 'applied')
  void publishCanvasRealtimeEvent(ownerUserId, { designId }, {
    type: 'canvas.changed',
    revision,
    nodeIds: changedWebNodeIds(comparison.mainDocument, merge.merged),
  })
  return {
    applied: true as const,
    revision,
    versionId: appliedId,
    document: merge.merged,
    unresolved: [] as string[],
  }
}

export const applyDraft = localProcedure
  .input(z.object({
    designId: z.string().min(1).max(128),
    id: draftIdSchema,
    expectedMainRevision: z.number().int().nonnegative(),
    expectedDraftRevision: z.number().int().nonnegative(),
    resolutions: z.record(z.string(), z.enum(['main', 'draft'])).default({}),
  }))
  .handler(({ context, input }) => applyWebDraftToStore(
    context.user.id,
    input.designId,
    input.id,
    input.expectedMainRevision,
    input.expectedDraftRevision,
    input.resolutions,
  ))
