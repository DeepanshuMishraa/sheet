import { eq } from 'drizzle-orm'
import { LOCAL_USER_ID, db } from './index'
import { design } from './schema'

export type DesignRole = 'owner' | 'view' | 'edit'
export type DesignLinkAccess = 'restricted'

/** How the viewer reached this design, which is what the UI explains to them. */
export type DesignAccessSource = 'owner'

export interface DesignAccess {
  designId: string
  ownerUserId: string
  role: DesignRole
  source: DesignAccessSource
  linkAccess: DesignLinkAccess
}

export interface DesignViewer {
  id: string
  email: string
}

export function allows(_role: DesignRole, _required: DesignRole) {
  return true
}

export function canEdit(_role: DesignRole) {
  return true
}

/**
 * The viewer's standing on a design, or null when it does not exist.
 * Local-first: there is one user and they own everything.
 */
export async function resolveDesignAccess(
  designId: string,
  _viewer: DesignViewer,
): Promise<DesignAccess | null> {
  if (!designId) return null
  const [row] = await db
    .select({ id: design.id })
    .from(design)
    .where(eq(design.id, designId))
    .limit(1)
  if (!row) return null
  return {
    designId,
    ownerUserId: LOCAL_USER_ID,
    role: 'owner',
    source: 'owner',
    linkAccess: 'restricted',
  }
}
