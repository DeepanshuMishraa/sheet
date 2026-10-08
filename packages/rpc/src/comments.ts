import { ORPCError } from '@orpc/server'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@sheet/db'
import { design, designComment, type CommentAuthor } from '@sheet/db/schema'
import { localProcedure, requireDesignAccess } from './procedures'

/**
 * Element comments: notes pinned to one node of a design, written by the
 * person in the editor or by an agent over MCP. They sit beside the document
 * rather than in it, so they never pass through a `WebTransaction`, never reach
 * undo history, and never appear in an export.
 */

export const MAX_COMMENT_LENGTH = 2_000
export const MAX_COMMENTS_PER_DESIGN = 1_000

export const commentStatusSchema = z.enum(['open', 'resolved', 'all'])
export type CommentStatus = z.infer<typeof commentStatusSchema>

export interface DesignCommentRecord {
  id: string
  designId: string
  nodeId: string
  nodeLabel: string
  body: string
  author: CommentAuthor
  resolved: boolean
  resolvedAt: number | null
  createdAt: number
  updatedAt: number
}

type CommentRow = typeof designComment.$inferSelect

function toRecord(row: CommentRow): DesignCommentRecord {
  return {
    id: row.id,
    designId: row.designId,
    nodeId: row.nodeId,
    nodeLabel: row.nodeLabel,
    body: row.body,
    author: row.author,
    resolved: row.resolvedAt !== null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

async function requireDesign(userId: string, designId: string) {
  const [found] = await db
    .select({ id: design.id })
    .from(design)
    .where(and(eq(design.id, designId), eq(design.userId, userId)))
    .limit(1)
  if (!found) throw new ORPCError('NOT_FOUND', { message: `Design "${designId}" was not found.` })
}

export async function listDesignComments(
  userId: string,
  designId: string,
  options: { nodeId?: string; status?: CommentStatus } = {},
) {
  await requireDesign(userId, designId)
  const status = options.status ?? 'open'
  const rows = await db
    .select()
    .from(designComment)
    .where(
      and(
        eq(designComment.userId, userId),
        eq(designComment.designId, designId),
        options.nodeId ? eq(designComment.nodeId, options.nodeId) : undefined,
        status === 'open' ? isNull(designComment.resolvedAt) : undefined,
        status === 'resolved' ? isNotNull(designComment.resolvedAt) : undefined,
      ),
    )
    .orderBy(asc(designComment.createdAt))
  return rows.map(toRecord)
}

export async function addDesignComment(
  userId: string,
  designId: string,
  input: { nodeId: string; nodeLabel: string; body: string; author: CommentAuthor },
) {
  await requireDesign(userId, designId)
  const body = input.body.trim()
  if (!body) throw new ORPCError('BAD_REQUEST', { message: 'A comment needs some text.' })
  const existing = await db
    .select({ id: designComment.id })
    .from(designComment)
    .where(and(eq(designComment.userId, userId), eq(designComment.designId, designId)))
  if (existing.length >= MAX_COMMENTS_PER_DESIGN) {
    throw new ORPCError('BAD_REQUEST', {
      message: `This design already has ${MAX_COMMENTS_PER_DESIGN} comments. Delete resolved ones before adding more.`,
    })
  }
  const [created] = await db
    .insert(designComment)
    .values({
      id: `comment_${crypto.randomUUID().replaceAll('-', '')}`,
      designId,
      userId,
      nodeId: input.nodeId,
      nodeLabel: input.nodeLabel,
      body,
      author: input.author,
    })
    .returning()
  if (!created) throw new Error('The comment could not be saved.')
  return toRecord(created)
}

export async function setDesignCommentResolved(
  userId: string,
  designId: string,
  commentId: string,
  resolved: boolean,
) {
  const [updated] = await db
    .update(designComment)
    .set({ resolvedAt: resolved ? new Date() : null, updatedAt: new Date() })
    .where(
      and(
        eq(designComment.id, commentId),
        eq(designComment.designId, designId),
        eq(designComment.userId, userId),
      ),
    )
    .returning()
  if (!updated) {
    throw new ORPCError('NOT_FOUND', { message: `Comment "${commentId}" was not found on this design.` })
  }
  return toRecord(updated)
}

export async function editDesignComment(
  userId: string,
  designId: string,
  commentId: string,
  body: string,
) {
  const text = body.trim()
  if (!text) throw new ORPCError('BAD_REQUEST', { message: 'A comment needs some text.' })
  const [updated] = await db
    .update(designComment)
    .set({ body: text, updatedAt: new Date() })
    .where(
      and(
        eq(designComment.id, commentId),
        eq(designComment.designId, designId),
        eq(designComment.userId, userId),
      ),
    )
    .returning()
  if (!updated) {
    throw new ORPCError('NOT_FOUND', { message: `Comment "${commentId}" was not found on this design.` })
  }
  return toRecord(updated)
}

export async function deleteDesignComment(userId: string, designId: string, commentId: string) {
  const [removed] = await db
    .delete(designComment)
    .where(
      and(
        eq(designComment.id, commentId),
        eq(designComment.designId, designId),
        eq(designComment.userId, userId),
      ),
    )
    .returning({ id: designComment.id })
  if (!removed) {
    throw new ORPCError('NOT_FOUND', { message: `Comment "${commentId}" was not found on this design.` })
  }
  return { id: removed.id }
}

const idSchema = z.string().min(1).max(128)
const bodySchema = z.string().min(1).max(MAX_COMMENT_LENGTH)

export const listComments = localProcedure
  .input(
    z.object({
      designId: idSchema,
      nodeId: idSchema.optional(),
      status: commentStatusSchema.optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireDesignAccess(context.user, input.designId)
    return listDesignComments(context.user.id, input.designId, input)
  })

export const createComment = localProcedure
  .input(
    z.object({
      designId: idSchema,
      nodeId: idSchema,
      nodeLabel: z.string().min(1).max(200),
      body: bodySchema,
    }),
  )
  .handler(async ({ context, input }) => {
    await requireDesignAccess(context.user, input.designId, 'edit')
    return addDesignComment(context.user.id, input.designId, { ...input, author: 'user' })
  })

export const resolveComment = localProcedure
  .input(z.object({ designId: idSchema, commentId: idSchema, resolved: z.boolean() }))
  .handler(async ({ context, input }) => {
    await requireDesignAccess(context.user, input.designId, 'edit')
    return setDesignCommentResolved(context.user.id, input.designId, input.commentId, input.resolved)
  })

export const editComment = localProcedure
  .input(z.object({ designId: idSchema, commentId: idSchema, body: bodySchema }))
  .handler(async ({ context, input }) => {
    await requireDesignAccess(context.user, input.designId, 'edit')
    return editDesignComment(context.user.id, input.designId, input.commentId, input.body)
  })

export const removeComment = localProcedure
  .input(z.object({ designId: idSchema, commentId: idSchema }))
  .handler(async ({ context, input }) => {
    await requireDesignAccess(context.user, input.designId, 'edit')
    return deleteDesignComment(context.user.id, input.designId, input.commentId)
  })
