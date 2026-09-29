import { apiUrl } from '@sheet/platform'

export function subscribeCanvasChanges(
  designId: string | null,
  onChange: (revision: number) => void,
) {
  if (typeof EventSource === 'undefined') return () => {}
  const url = new URL(apiUrl('/api/canvas-events'))
  if (designId) url.searchParams.set('designId', designId)
  const source = new EventSource(url, { withCredentials: true })
  const handleChange = (message: Event) => {
    if (!(message instanceof MessageEvent)) return
    try {
      const event: unknown = JSON.parse(String(message.data))
      if (
        event &&
        typeof event === 'object' &&
        'type' in event &&
        event.type === 'canvas.changed' &&
        'revision' in event &&
        typeof event.revision === 'number' &&
        Number.isInteger(event.revision) &&
        event.revision >= 0
      ) {
        onChange(event.revision)
      }
    } catch {
      // Ignore malformed stream frames; EventSource reconnects itself.
    }
  }
  source.addEventListener('canvas', handleChange)
  return () => {
    source.removeEventListener('canvas', handleChange)
    source.close()
  }
}
