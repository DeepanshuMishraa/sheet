import { AgentIdentity } from '@sheet/rpc/mcp-agent-identity'

/**
 * Which agent sent a request.
 *
 * HTTP MCP is stateless here, but a client says who it is once, on
 * `initialize` (`clientInfo.name`). The reply carries an `Mcp-Session-Id`,
 * which the spec has the client echo on every later request, so each tool
 * call maps back to the agent and window that made it.
 *
 * A session id this process has never issued — the server restarted under a
 * running agent — still names a stable agent: the id is kept, and the kind is
 * read from the User-Agent instead.
 */

const MAX_SESSIONS = 256

const sessions = new Map<string, AgentIdentity>()

function clientName(params: unknown) {
  if (!params || typeof params !== 'object' || !('clientInfo' in params)) return null
  const info = params.clientInfo
  if (!info || typeof info !== 'object') return null
  const title = 'title' in info && typeof info.title === 'string' ? info.title : null
  const name = 'name' in info && typeof info.name === 'string' ? info.name : null
  return name ?? title
}

export const AgentSessions = {
  /** Called for `initialize`: a new session for the client that sent it. */
  open(params: unknown, userAgent: string | null) {
    const sessionId = `mcp_${globalThis.crypto.randomUUID()}`
    const name = clientName(params)
    const agent = name
      ? AgentIdentity.fromClient(name, sessionId)
      : AgentIdentity.fromUserAgent(userAgent, sessionId)
    sessions.set(sessionId, agent)
    if (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value
      if (oldest !== undefined) sessions.delete(oldest)
    }
    return { sessionId, agent }
  },

  /** The agent behind a request, from its session id and then its User-Agent. */
  resolve(sessionId: string | null, userAgent: string | null) {
    const id = sessionId?.trim() ?? ''
    if (id.length > 0) {
      return sessions.get(id) ?? AgentIdentity.fromUserAgent(userAgent, id)
    }
    const fallback = AgentIdentity.fromUserAgent(userAgent, 'anonymous')
    return { ...fallback, id: `anonymous:${fallback.kind}` }
  },

  /** Forgets a session; returns its agent so its presence can be ended too. */
  close(sessionId: string | null) {
    const id = sessionId?.trim() ?? ''
    const agent = sessions.get(id) ?? null
    sessions.delete(id)
    return agent
  },
} as const
