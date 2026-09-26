import type {
  CanvasRealtimeEventInput,
  CanvasRealtimeTarget,
} from './events'

/**
 * In-process realtime bus for the local server.
 *
 * The desktop window and MCP clients talk to the same Bun process, so canvas
 * invalidations, branch changes, and agent activity fan out through memory —
 * no socket service, no Redis. A subscriber filters by design (and branch).
 */

export interface LocalBusMessage {
  userId: string
  target: CanvasRealtimeTarget
  event: CanvasRealtimeEventInput
  sentAt: number
}

type Listener = (message: LocalBusMessage) => void

const listeners = new Set<Listener>()

export function publishLocalEvent(
  userId: string,
  target: CanvasRealtimeTarget,
  event: CanvasRealtimeEventInput,
) {
  if (listeners.size === 0) return
  const message: LocalBusMessage = {
    userId,
    target,
    event,
    sentAt: Date.now(),
  }
  for (const listener of [...listeners]) {
    try {
      listener(message)
    } catch {
      // A slow subscriber never breaks a publisher.
    }
  }
}

export function subscribeLocalEvents(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Same-room check the SSE endpoint uses: Main sees Main, a branch sees both. */
export function messageTargetsRoom(
  message: LocalBusMessage,
  designId: string,
  draftId: string | null,
) {
  if (message.target.designId !== designId) return false
  if (draftId) return true
  return !message.target.draftId
}
