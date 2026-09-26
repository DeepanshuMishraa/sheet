import {
  and,
  eq,
  isNull,
} from 'drizzle-orm'
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import { LOCAL_USER_ID, db, ensureLocalUser } from '@sheet/db'
import {
  design,
  designVersion,
} from '@sheet/db/schema'
import {
  allows,
  resolveDesignAccess,
  type DesignRole,
} from '@sheet/db/design-access'
import { type CanvasElement, type CanvasPage } from '@sheet/db/canvas'

/**
 * Shared plumbing for every namespace: the request context, the local user
 * every procedure runs as, and the design lookups more than one namespace
 * needs.
 *
 * Local-first: there are no sessions, no legal consent, no preview access,
 * and no plans. Every call runs as the single local user.
 */

export interface LocalUser {
  id: string
  email: string
}

export interface ORPCContext {
  request: Request
}

export const shapeSchema = z.object({
  id: z.string(),
  name: z.string().max(200),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  // Rotation in degrees; permissive range so an out-of-range value never
  // rejects a whole design save (renderers normalize with mod 360).
  r: z.number().finite().optional(),
  code: z.string().max(200_000),
  groupId: z.string().max(128).optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
})

export const pageItemSchema = z.object({
  id: z.string().min(1).max(128),
  elementId: z.string().min(1).max(128),
  height: z.number().finite().min(1).max(100_000),
})

export const pageSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(1).max(100_000),
  items: z.array(pageItemSchema).max(10_000),
})

export const draftIdSchema = z.string().min(1).max(128)
export const optionalDraftIdSchema = draftIdSchema.nullish()
export const draftTargetWhere = (draftId: string | null | undefined) =>
  draftId ? eq(designVersion.draftId, draftId) : isNull(designVersion.draftId)

export function localUser(): LocalUser {
  return { id: LOCAL_USER_ID, email: 'local@sheet.design' }
}

const requireLocalUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  await ensureLocalUser()
  return next({ context: { user: localUser(), request: context.request } })
})

export const localProcedure = os.$context<ORPCContext>().use(requireLocalUser)

export function collectionDiff<T extends { id: string }>(previous: T[], next: T[]) {
  const previousById = new Map(previous.map((item) => [item.id, item]))
  const nextIds = new Set(next.map((item) => item.id))
  let added = 0
  let changed = 0
  for (const item of next) {
    const old = previousById.get(item.id)
    if (!old) added += 1
    else if (JSON.stringify(old) !== JSON.stringify(item)) changed += 1
  }
  return {
    added,
    removed: previous.filter((item) => !nextIds.has(item.id)).length,
    changed,
  }
}

export function documentDiff(
  previousShapes: CanvasElement[],
  nextShapes: CanvasElement[],
  previousPages: CanvasPage[],
  nextPages: CanvasPage[],
) {
  const shapes = collectionDiff(previousShapes, nextShapes)
  const pages = collectionDiff(previousPages, nextPages)
  return {
    added: shapes.added + pages.added,
    removed: shapes.removed + pages.removed,
    changed: shapes.changed + pages.changed,
  }
}

// Chats and versions can arrive before the debounced design save; make sure
// the parent row exists so their FKs hold. The real save upserts over this.
/**
 * A design id on its own does not say whose design it is — designs are keyed
 * by (id, ownerUserId) — so every design-scoped call resolves the viewer's
 * standing before it touches a row. Local-first there is only the owner.
 */
export async function requireDesignAccess(
  viewer: { id: string; email: string },
  designId: string,
  required: DesignRole = 'view',
) {
  const access = await resolveDesignAccess(designId, {
    id: viewer.id,
    email: viewer.email,
  })
  if (!access) throw new ORPCError('NOT_FOUND')
  if (!allows(access.role, required)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'You have view-only access to this design.',
    })
  }
  return access
}

export async function ensureDesign(
  designId: string,
  user: { id: string },
) {
  const [existing] = await db
    .select({ id: design.id })
    .from(design)
    .where(and(eq(design.id, designId), eq(design.userId, user.id)))
    .limit(1)
  if (existing) return
  await db
    .insert(design)
    .values({ id: designId, userId: user.id, name: 'Untitled', shapes: [], pages: [] })
    .onConflictDoNothing({ target: [design.id, design.userId] })
}
