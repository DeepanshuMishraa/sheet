import { LOCAL_USER_ID, ensureLocalUser } from '@sheet/db'
import type { AgentIdentity } from '@sheet/rpc/mcp-agent-identity'
import type { JsonValue } from './tools'

/**
 * Direct (in-process) MCP execution against the local SQLite database.
 *
 * Local-first: there are no accounts, no access checks, and no meters — every
 * call runs as the single local user through the canonical
 * `createSheetToolExecutor` from `@sheet/rpc/mcp-server`.
 *
 * All imports are lazy so unit tests never touch the database driver at
 * module load.
 */
export class DirectMcpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DirectMcpError'
  }
}

async function localUserId() {
  await ensureLocalUser()
  return LOCAL_USER_ID
}

export async function directReady(): Promise<JsonValue> {
  const { checkDatabaseConnection } = await import('@sheet/db')
  await checkDatabaseConnection()
  return { ready: true }
}

export async function directResolveUser(selector: string): Promise<JsonValue> {
  const userId = await localUserId()
  return { id: userId, email: 'local@sheet.design', selector: selector.trim() }
}

export async function directAccess(_userId: string): Promise<JsonValue> {
  await localUserId()
  return { allowed: true }
}

/** An agent's session closed: take its avatar and cursor off every design. */
export async function directFinish(agent: AgentIdentity) {
  const { finishAgentActivity } = await import('@sheet/rpc/mcp-agent-activity')
  finishAgentActivity(agent, null)
}

/** `agent` is who made the call, so the editor can draw its avatar and cursor. */
export async function directExecute(
  agent: AgentIdentity,
  tool: string,
  args: JsonValue,
): Promise<JsonValue> {
  const userId = await localUserId()
  const { createSheetToolExecutor } = await import('@sheet/rpc/mcp-server')
  const { createMcpUsageController } = await import('@sheet/rpc/mcp-usage')
  const execute = createSheetToolExecutor(userId, createMcpUsageController(), agent)
  try {
    return (await execute(tool, (args ?? {}) as Record<string, unknown>)) as unknown as JsonValue
  } catch (error) {
    throw new DirectMcpError(error instanceof Error ? error.message : 'Tool execution failed')
  }
}
