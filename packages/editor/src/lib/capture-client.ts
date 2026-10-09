import { useEffect } from 'react'
import { apiUrl } from '@sheet/platform'
import { domToBlob } from 'modern-screenshot'
import {
  isShaderName,
  SHADER_NAME_ATTRIBUTE,
  SHADER_PARAMS_ATTRIBUTE,
  shaderSnapshot,
} from '@sheet/canvas/web-shaders'

/** Mirrors `CaptureRequest` in `@sheet/rpc/capture-broker`; the wire shape is plain JSON. */
interface CaptureRequest {
  id: string
  html: string
  width: number
  pixelRatio: number
  rootId: string | null
  format: 'png' | 'jpeg'
  quality: number
}

const MAX_DIMENSION = 4_096
const MAX_AREA = 12_000_000
const VIEWPORT_HEIGHT = 900
const RENDER_TIMEOUT_MS = 15_000

function isCaptureRequest(value: unknown): value is CaptureRequest {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CaptureRequest>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.html === 'string' &&
    typeof candidate.width === 'number' &&
    typeof candidate.pixelRatio === 'number' &&
    (candidate.format === 'png' || candidate.format === 'jpeg')
  )
}

/** Draws every shader in the page as a picture and sets it as that box's background. */
async function paintShaders(frameDocument: Document) {
  const boxes = [...frameDocument.querySelectorAll<HTMLElement>(`[${SHADER_NAME_ATTRIBUTE}]`)]
  for (const box of boxes) {
    const name = box.getAttribute(SHADER_NAME_ATTRIBUTE)
    const { width, height } = box.getBoundingClientRect()
    if (!isShaderName(name) || width < 1 || height < 1) continue
    let raw: unknown = null
    try {
      raw = JSON.parse(box.getAttribute(SHADER_PARAMS_ATTRIBUTE) ?? '{}')
    } catch {
      // Unreadable params draw with the shader's defaults, as the editor does.
    }
    const url = await shaderSnapshot(name, raw, width, height)
    if (!url) continue
    box.style.backgroundImage = `url("${url}")`
    box.style.backgroundSize = '100% 100%'
    box.style.backgroundRepeat = 'no-repeat'
  }
}

function loaded(frame: HTMLIFrameElement, html: string) {
  return new Promise<void>((resolve, reject) => {
    frame.addEventListener('load', () => resolve(), { once: true })
    frame.addEventListener('error', () => reject(new Error('The design failed to load for rendering.')), { once: true })
    frame.srcdoc = html
  })
}

async function settle(frameDocument: Document) {
  await frameDocument.fonts?.ready
  await Promise.all(
    [...frameDocument.images].map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            image.addEventListener('load', () => resolve(), { once: true })
            image.addEventListener('error', () => resolve(), { once: true })
          }),
    ),
  )
}

/**
 * Images on other origins usually lack CORS headers, so the renderer cannot read
 * them. The local server fetches those instead; same-origin and data: URLs are
 * read directly (returning false hands the URL back to the renderer).
 */
async function fetchImage(url: string): Promise<string | false> {
  if (!/^https?:/i.test(url)) return false
  try {
    if (new URL(url, location.href).origin === location.origin) return false
    const response = await fetch(apiUrl(`/api/capture-image?url=${encodeURIComponent(url)}`))
    if (!response.ok) return false
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return false
  }
}

/**
 * Render the design in a hidden frame sized to the requested viewport, so media
 * and container queries answer for that width, then rasterize the target.
 */
async function render(request: CaptureRequest) {
  const startedAt = performance.now()
  const timings: Record<string, number> = {}
  const lap = (name: string) => {
    timings[name] = Math.round(performance.now() - startedAt)
  }
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  Object.assign(frame.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${request.width}px`,
    height: `${VIEWPORT_HEIGHT}px`,
    border: '0',
    pointerEvents: 'none',
  })
  document.body.append(frame)
  try {
    await loaded(frame, request.html)
    lap('loadedMs')
    const frameDocument = frame.contentDocument
    if (!frameDocument) throw new Error('The design frame was not readable.')
    await settle(frameDocument)
    lap('settledMs')

    // Shaders are canvases the editor mounts, so a page of plain HTML has an empty box
    // where each one sits. Each is drawn here, in this window, at its own size and with
    // its own params, and the picture becomes the box's background.
    await paintShaders(frameDocument)
    lap('shadersMs')

    const root = frameDocument.querySelector<HTMLElement>('[data-sheet-export-root="true"]')
    const target =
      request.rootId === null
        ? root
        : [...(root?.querySelectorAll<HTMLElement>('[data-sheet-node]') ?? [])].find(
            (node) => node.getAttribute('data-sheet-node') === request.rootId,
          )
    if (!target) {
      throw new Error(request.rootId === null ? 'The design rendered nothing.' : `Web node "${request.rootId}" did not render`)
    }
    const bounds = target.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) throw new Error('Web screenshot target has no visible bounds')

    // Rendering a node on its own copies only its subtree, which loses anything inside it
    // that is positioned from the page instead of from the node (an image or icon placed
    // by `left` and `top` in a frame that is not itself positioned). Instead the whole
    // export is kept and shifted so the node sits at the origin of a box the node's size,
    // and that box is what is rasterized: everything keeps its place, and the rest is cropped.
    let captured: HTMLElement = target
    if (request.rootId !== null && root) {
      const crop = frameDocument.createElement('div')
      Object.assign(crop.style, {
        position: 'relative',
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        overflow: 'hidden',
      })
      root.style.transform = `translate(${-bounds.left}px, ${-bounds.top}px)`
      frameDocument.body.append(crop)
      crop.append(root)
      captured = crop
    }

    // Same clamps as before: neither side over 4096px, area under 12MP.
    const ratio = request.pixelRatio
    const fit = Math.min(
      1,
      MAX_DIMENSION / (bounds.width * ratio),
      MAX_DIMENSION / (bounds.height * ratio),
      Math.sqrt(MAX_AREA / (bounds.width * bounds.height * ratio * ratio)),
    )
    const scale = ratio * fit
    const mime = request.format === 'jpeg' ? 'image/jpeg' : 'image/png'
    const blob = await domToBlob(captured, {
      scale,
      type: mime,
      quality: request.quality / 100,
      backgroundColor: request.format === 'jpeg' ? '#ffffff' : null,
      timeout: RENDER_TIMEOUT_MS,
      fetchFn: fetchImage,
      // Only embed web fonts when the design actually declares some.
      font: request.html.includes('@font-face') ? undefined : false,
    })
    lap('rasterizedMs')
    return {
      timings,
      blob,
      mime,
      width: Math.max(1, Math.round(bounds.width * scale)),
      height: Math.max(1, Math.round(bounds.height * scale)),
    }
  } finally {
    frame.remove()
  }
}

async function answer(request: CaptureRequest) {
  try {
    const { blob, mime, width, height, timings } = await render(request)
    const query = new URLSearchParams({
      id: request.id,
      mime,
      width: String(width),
      height: String(height),
      timings: JSON.stringify({ ...timings, bytes: blob.size }),
    })
    await fetch(apiUrl(`/api/capture-result?${query}`), { method: 'POST', body: blob })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The window could not render this design.'
    const query = new URLSearchParams({ id: request.id, error: message })
    await fetch(apiUrl(`/api/capture-result?${query}`), { method: 'POST' }).catch(() => undefined)
  }
}

/**
 * Lets the local server use this window's rendering engine for screenshots
 * (MCP `getWebScreenshot`, PNG/JPG export). Mount once at the app root.
 */
export function useCaptureResponder() {
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource(apiUrl('/api/capture-events'))
    // One render at a time: each owns a full-size frame.
    let queue: Promise<void> = Promise.resolve()
    source.addEventListener('capture', (event) => {
      let parsed: unknown
      try {
        parsed = JSON.parse((event as MessageEvent<string>).data)
      } catch {
        return
      }
      if (!isCaptureRequest(parsed)) return
      const request = parsed
      queue = queue.then(() => answer(request))
    })
    return () => source.close()
  }, [])
}

/**
 * A PNG of one node, or of the whole document, rendered by this window from the
 * HTML it is given. The editor uses it to copy a selection as an image from the
 * live document, so edits that have not been saved yet are in the picture.
 */
export async function captureImage(options: {
  html: string
  rootId: string | null
  width?: number
  pixelRatio?: number
}): Promise<Blob> {
  const { blob } = await render({
    id: 'local',
    html: options.html,
    width: options.width ?? 1_440,
    pixelRatio: options.pixelRatio ?? 2,
    rootId: options.rootId,
    format: 'png',
    quality: 100,
  })
  return blob
}
