import { apiUrl } from '@sheet/platform'

export const AGENT_KINDS = ['claude', 'codex', 'cursor', 'copilot', 'opencode', 'antigravity', 'other'] as const

export type AgentKind = (typeof AGENT_KINDS)[number]

/** One agent session; two windows of the same app are two agents. */
export interface AgentIdentity {
  id: string
  kind: AgentKind
  name: string
}

/** An agent working in the document, as the server announces it. */
export interface AgentActivity {
  id: string
  agent: AgentIdentity
  label: string
  /** "editing", for a sentence about the node: "Codex is editing Heading". */
  verb: string | null
  nodeIds: string[]
  /** Rules the call restyles, as `stylesheetId/ruleId`; their elements carry the cursor. */
  ruleIds: string[]
  /** Only a `write` in flight rings its targets; a read just moves the cursor. */
  mode: 'read' | 'write'
  phase: 'working' | 'settled'
  updatedAt: number
  expiresAt: number
}

function isAgentKind(value: unknown): value is AgentKind {
  return AGENT_KINDS.some((kind) => kind === value)
}

function parseAgent(value: unknown): AgentIdentity | null {
  if (!value || typeof value !== 'object') return null
  const id = Reflect.get(value, 'id')
  const kind = Reflect.get(value, 'kind')
  const name = Reflect.get(value, 'name')
  if (typeof id !== 'string' || !isAgentKind(kind) || typeof name !== 'string' || name.length === 0) return null
  return { id, kind, name }
}

function parseActivity(value: unknown): AgentActivity | null {
  if (!value || typeof value !== 'object') return null
  const id = Reflect.get(value, 'id')
  const agent = parseAgent(Reflect.get(value, 'agent'))
  const label = Reflect.get(value, 'label')
  const verb = Reflect.get(value, 'verb')
  const nodeIds = Reflect.get(value, 'nodeIds')
  const ruleIds = Reflect.get(value, 'ruleIds')
  const mode = Reflect.get(value, 'mode')
  const phase = Reflect.get(value, 'phase')
  const updatedAt = Reflect.get(value, 'updatedAt')
  const expiresAt = Reflect.get(value, 'expiresAt')
  if (
    typeof id !== 'string' ||
    !agent ||
    typeof label !== 'string' ||
    (verb !== null && typeof verb !== 'string') ||
    !Array.isArray(nodeIds) ||
    !Array.isArray(ruleIds) ||
    (mode !== 'read' && mode !== 'write') ||
    (phase !== 'working' && phase !== 'settled') ||
    typeof updatedAt !== 'number' ||
    typeof expiresAt !== 'number'
  ) {
    return null
  }
  return {
    id,
    agent,
    label,
    verb,
    nodeIds: nodeIds.filter((item): item is string => typeof item === 'string'),
    ruleIds: ruleIds.filter((item): item is string => typeof item === 'string'),
    mode,
    phase,
    updatedAt,
    expiresAt,
  }
}

export function subscribeCanvasChanges(
  designId: string | null,
  onChange: (revision: number) => void,
  options: {
    draftId?: string | null
    onReady?: () => void
    /** Called with one agent's running or just-finished activity. */
    onAgentActivity?: (activity: AgentActivity) => void
  } = {},
) {
  if (typeof EventSource === 'undefined') return () => {}
  const url = new URL(apiUrl('/api/canvas-events'))
  if (designId) url.searchParams.set('designId', designId)
  if (options.draftId) url.searchParams.set('draftId', options.draftId)
  const source = new EventSource(url, { withCredentials: true })
  const handleChange = (message: Event) => {
    if (!(message instanceof MessageEvent)) return
    try {
      const event: unknown = JSON.parse(String(message.data))
      if (!event || typeof event !== 'object' || !('type' in event)) return
      if (
        event.type === 'canvas.changed' &&
        'revision' in event &&
        typeof event.revision === 'number' &&
        Number.isInteger(event.revision) &&
        event.revision >= 0
      ) {
        onChange(event.revision)
      } else if (event.type === 'agent.activity' && 'activity' in event) {
        const activity = parseActivity(event.activity)
        if (activity) options.onAgentActivity?.(activity)
      }
    } catch {
      // Ignore malformed stream frames; EventSource reconnects itself.
    }
  }
  const handleReady = () => options.onReady?.()
  source.addEventListener('canvas', handleChange)
  source.addEventListener('ready', handleReady)
  return () => {
    source.removeEventListener('canvas', handleChange)
    source.removeEventListener('ready', handleReady)
    source.close()
  }
}
