import { compileWebStandaloneHtml } from '@sheet/canvas/web-export'
import { assertWebDocument, type WebDocument } from '@sheet/canvas/web-model'
import { requestCapture } from './capture-broker'
import { BoundedConcurrencyGate } from './mcp-concurrency'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(process.env[name] ?? fallback)
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback
}

const screenshotGate = new BoundedConcurrencyGate(
  integerEnvironment('MCP_SCREENSHOT_CONCURRENCY', 1, 1, 8),
  integerEnvironment('MCP_SCREENSHOT_QUEUE_LIMIT', 2, 0, 100),
  integerEnvironment('MCP_SCREENSHOT_QUEUE_TIMEOUT_MS', 20_000, 1_000, 120_000),
)

export interface WebScreenshotOptions {
  rootId?: string
  width?: number
  pixelRatio?: number
  format?: 'png' | 'jpeg'
  /** JPEG only, 1-100. */
  quality?: number
}

export interface WebScreenshot {
  png: Uint8Array
  mimeType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  rootId: string | null
  skippedImages: string[]
  /** Milliseconds per stage, for finding what is slow. */
  timings: Record<string, number>
}

/**
 * Web screenshot: the same standalone serialization the editor materializes
 * from, rendered by the open Sheet window's own engine (see capture-broker).
 * No browser is launched here.
 */
async function renderWebScreenshotInWindow(
  source: WebDocument,
  options: WebScreenshotOptions,
): Promise<WebScreenshot> {
  const width = Math.round(Math.max(200, Math.min(options.width ?? 1_440, 3_840)))
  const pixelRatio = Math.max(1, Math.min(options.pixelRatio ?? 1, 2))
  const document = assertWebDocument(structuredClone(source))
  if (options.rootId !== undefined && !document.nodes[options.rootId]) {
    throw new Error(`Web node "${options.rootId}" does not exist`)
  }
  const format = options.format ?? 'png'
  const startedAt = performance.now()
  const result = await requestCapture({
    html: compileWebStandaloneHtml(document, { title: document.name }),
    width,
    pixelRatio,
    rootId: options.rootId ?? null,
    format,
    quality: Math.round(Math.max(1, Math.min(options.quality ?? 90, 100))),
  })
  if (!result.ok) throw new Error(result.message)
  if (result.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('The image is too large for one response. Use a smaller width, pixelRatio, or rootId.')
  }
  return {
    png: result.bytes,
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
    rootId: options.rootId ?? null,
    skippedImages: [],
    timings: { ...result.timings, roundTripMs: Math.round(performance.now() - startedAt) },
  }
}

export function renderWebScreenshot(
  _userId: string,
  source: WebDocument,
  options: WebScreenshotOptions = {},
) {
  return screenshotGate.run(() => renderWebScreenshotInWindow(source, options))
}
