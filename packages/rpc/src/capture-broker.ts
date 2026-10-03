/**
 * Screenshots are taken by the app window, not by a browser of our own.
 *
 * The window already runs a real rendering engine, so the local server asks
 * it: a capture request goes out over the window's event stream, the window
 * renders the design off-screen and posts the image back. With no window
 * connected there is nothing to render with, and the request fails with a
 * message that says so.
 */

export interface CaptureRequest {
  id: string
  /** Complete standalone HTML for the design (the exact export serialization). */
  html: string
  /** Viewport width in CSS px. */
  width: number
  pixelRatio: number
  /** Web node id to capture; `null` for the whole document. */
  rootId: string | null
  format: 'png' | 'jpeg'
  quality: number
}

export type CaptureResult =
  | { ok: true; bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg'; width: number; height: number; timings?: Record<string, number> }
  | { ok: false; message: string }

type Pending = {
  resolve: (result: CaptureResult) => void
  timer: ReturnType<typeof setTimeout>
  capturer: Capturer
}

export type Capturer = { send: (request: CaptureRequest) => void }

const CAPTURE_TIMEOUT_MS = 20_000

export const NO_WINDOW_MESSAGE =
  'No Sheet window is open to render this. Open the Sheet app, then try again. Nothing was changed.'

const capturers = new Set<Capturer>()
const pending = new Map<string, Pending>()

/** A window announces it can render. Returns the function that withdraws it. */
export function registerCapturer(capturer: Capturer) {
  capturers.add(capturer)
  return () => {
    capturers.delete(capturer)
    for (const [id, entry] of pending) {
      if (entry.capturer !== capturer) continue
      pending.delete(id)
      clearTimeout(entry.timer)
      entry.resolve({ ok: false, message: 'The Sheet window closed before the screenshot finished. Open it and try again.' })
    }
  }
}

export function hasCapturer() {
  return capturers.size > 0
}

/** Ask the most recently connected window to render. */
export function requestCapture(request: Omit<CaptureRequest, 'id'>): Promise<CaptureResult> {
  const capturer = [...capturers].at(-1)
  if (!capturer) return Promise.resolve({ ok: false, message: NO_WINDOW_MESSAGE })
  const id = crypto.randomUUID()
  return new Promise<CaptureResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({
        ok: false,
        message: `The Sheet window did not answer within ${CAPTURE_TIMEOUT_MS / 1000}s. It may be busy or in the background. Try again.`,
      })
    }, CAPTURE_TIMEOUT_MS)
    pending.set(id, { resolve, timer, capturer })
    try {
      capturer.send({ ...request, id })
    } catch {
      pending.delete(id)
      clearTimeout(timer)
      resolve({ ok: false, message: NO_WINDOW_MESSAGE })
    }
  })
}

/** The window posts its answer. Returns false when the request is unknown or already settled. */
export function completeCapture(id: string, result: CaptureResult) {
  const entry = pending.get(id)
  if (!entry) return false
  pending.delete(id)
  clearTimeout(entry.timer)
  entry.resolve(result)
  return true
}
