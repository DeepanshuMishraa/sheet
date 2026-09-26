import { LOCAL_USER_ID, ensureLocalUser } from '@loora/db'

export class AccessDeniedError extends Error {}

// Local-first: there is one user and nothing to gate. This keeps the shape
// MCP execution expects (`mcpPlan` for limit checks, usage options for the
// meters) while granting everything.
export async function requireAppAccess(userId: string) {
  await ensureLocalUser()
  if (userId !== LOCAL_USER_ID) throw new AccessDeniedError('Unknown user.')
  return {
    account: { id: LOCAL_USER_ID },
    mcpPlan: { plan: 'local', weeklyLimit: null } as const,
    mcpUsageOptions: {},
    agentUsageOptions: {},
  }
}
