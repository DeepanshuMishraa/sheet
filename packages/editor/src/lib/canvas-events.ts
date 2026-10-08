import { apiUrl } from '@sheet/platform'

/** An agent working in the document, as the server announces it. */
export interface AgentActivity {
  id: string
  label: string
  nodeIds: string[]
  phase: 'working' | 'settled'
  expiresAt: number
}

function parseActivity(value: unknown): AgentActivity | null {
  if (!value || typeof value !== 'object') return null
  const id = Reflect.get(value, 'id')
  const label = Reflect.get(value, 'label')
  const nodeIds = Reflect.get(value, 'nodeIds')
  const phase = Reflect.get(value, 'phase')
  const expiresAt = Reflect.get(value, 'expiresAt')
  if (
    typeof id !== 'string' ||
    typeof label !== 'string' ||
    !Array.isArray(nodeIds) ||
    (phase !== 'working' && phase !== 'settled') ||
    typeof expiresAt !== 'number'
  ) {
    return null
  }
  return {
    id,
    label,
    nodeIds: nodeIds.filter((item): item is string => typeof item === 'string'),
    phase,
    expiresAt,
  }
}

export function subscribeCanvasChanges(
  designId: string | null,
  onChange: (revision: number) => void,
  options: {
    draftId?: string | null
    onReady?: () => void
    /** Called with the running or just-finished agent activity, or `null` when it clears. */
    onAgentActivity?: (activity: AgentActivity | null) => void
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
        options.onAgentActivity?.(parseActivity(event.activity))
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
