import { eq, isNull } from 'drizzle-orm'
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import { LOCAL_USER_ID, ensureLocalUser } from '@sheet/db'
import { designVersion } from '@sheet/db/schema'
import {
  allows,
  resolveDesignAccess,
  type DesignRole,
} from '@sheet/db/design-access'

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
