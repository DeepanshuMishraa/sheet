import type { AgentKind, CanvasRealtimeAgent } from '@sheet/db/canvas-realtime'

export type AgentIdentity = CanvasRealtimeAgent

/**
 * How each app names itself. Clients send `clientInfo.name` on `initialize`
 * (Claude Code says `claude-code`, Codex `codex-mcp-client`, Cursor
 * `cursor-vscode`); the same words usually show up in their User-Agent, which
 * is the fallback when a client drops its session id. Order matters: Cursor is
 * a VS Code fork, so it is matched before Copilot's `vscode`.
 */
const KNOWN_AGENTS: ReadonlyArray<{ kind: AgentKind; name: string; match: RegExp }> = [
  { kind: 'claude', name: 'Claude', match: /claude/i },
  { kind: 'codex', name: 'Codex', match: /codex/i },
  { kind: 'cursor', name: 'Cursor', match: /cursor/i },
  { kind: 'opencode', name: 'OpenCode', match: /opencode/i },
  { kind: 'antigravity', name: 'Antigravity', match: /antigravity/i },
  { kind: 'copilot', name: 'Copilot', match: /copilot|visual studio code|vscode/i },
]

const MAX_ID_LENGTH = 200
const MAX_NAME_LENGTH = 40

/** `gemini-cli-mcp-client` → `Gemini Cli`: readable without a table entry. */
function displayName(clientName: string) {
  const words = clientName
    .replace(/[-_]?mcp[-_]?client$/i, '')
    .replace(/[-_]?mcp$/i, '')
    .split(/[\s\-_/]+/)
    .filter((word) => word.length > 0 && !/^\d/.test(word))
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
  const name = words.join(' ').slice(0, MAX_NAME_LENGTH).trim()
  return name.length > 0 ? name : 'Agent'
}

function sessionKey(sessionId: string) {
  return sessionId.slice(0, MAX_ID_LENGTH)
}

/**
 * How agents behave when they share a design. Sent as the MCP server
 * `instructions` on `initialize`, repeated in the skill, and enforced in spirit
 * by the notices every design-scoped tool result carries.
 */
export const AGENT_COLLABORATION_INSTRUCTIONS = [
  'Several agents (Claude, Codex, Cursor, …) can work in Sheet at the same time, on the same design or on different ones. Sheet knows which agent you are from your MCP session; you never announce yourself, and there is nothing to share or invite.',
  'When another agent is in the design you are working on, every tool result for that design ends with a note naming it, what it is doing and the node ids it is touching. The first note says it just joined.',
  'When you see one: do not edit, move, delete or restyle the nodes it is touching, and never undo or overwrite its changes. Keep to parts of the design it is not working on. If your task needs those same nodes, or the two tasks could conflict (one redesigning what the other builds, shared tokens or global styles), stop and ask the user how to split the work before continuing. A branch (createBranch) is a safe place for a change that rewrites shared parts.',
  'Re-read with getWebDocument before editing anything near another agent, and expect stale revisions more often: re-read, rebase your edit, retry once. listAgents gives the full picture at any time.',
  'While you work, the person watching sees your avatar and a cursor on the element you are changing. When you have finished the task in a design, call finishWork { designId } once so they disappear; do not call it between steps.',
].join('\n\n')

/** Calls that came with nothing to tell them apart, e.g. tests and scripts. */
const UNKNOWN: AgentIdentity = { id: 'agent', kind: 'other', name: 'Agent' }

export const AgentIdentity = {
  unknown: UNKNOWN,

  /** From what a client calls itself — `clientInfo.name`, or a User-Agent. */
  fromClient(clientName: string | null | undefined, sessionId: string): AgentIdentity {
    const id = sessionKey(sessionId)
    const name = clientName?.trim() ?? ''
    if (name.length === 0) return { ...UNKNOWN, id }
    const known = KNOWN_AGENTS.find((agent) => agent.match.test(name))
    if (known) return { id, kind: known.kind, name: known.name }
    return { id, kind: 'other', name: displayName(name.split(/[\s(]/)[0] ?? name) }
  },

  /**
   * A User-Agent only names an app Sheet knows. Anything else (`node`,
   * `undici`, `python-httpx`) is the HTTP library, not the agent.
   */
  fromUserAgent(userAgent: string | null | undefined, sessionId: string): AgentIdentity {
    const id = sessionKey(sessionId)
    const known = KNOWN_AGENTS.find((agent) => userAgent && agent.match.test(userAgent))
    return known ? { id, kind: known.kind, name: known.name } : { ...UNKNOWN, id }
  },
} as const
