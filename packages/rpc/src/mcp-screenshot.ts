import { existsSync } from 'node:fs'
import {
  chromium,
  type Browser,
  type ElementHandle,
} from 'playwright-core'
import { compileWebStandaloneHtml } from '@sheet/canvas/web-export'
import {
  assertWebDocument,
  type WebDocument,
} from '@sheet/canvas/web-model'
import { BoundedConcurrencyGate } from './mcp-concurrency'
import { IdleResource } from './mcp-idle-resource'

const MAX_SCREENSHOT_DIMENSION = 4_096
const MAX_SCREENSHOT_AREA = 12_000_000
const MAX_PNG_BYTES = 8 * 1024 * 1024

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


function chromiumExecutable() {
  const configured =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ||
    process.env.CHROMIUM_PATH?.trim()
  const candidates = [
    configured,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    chromium.executablePath(),
  ].filter((value): value is string => Boolean(value))
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const screenshotBrowser = new IdleResource(
  async () => {
    const executablePath = chromiumExecutable()
    if (!executablePath) {
      throw new Error(
        'Screenshot rendering needs Chromium. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.',
      )
    }
    const launched = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    })
    launched.on('disconnected', () => {
      screenshotBrowser.invalidate(launched)
    })
    return launched
  },
  integerEnvironment(
    'MCP_SCREENSHOT_IDLE_TIMEOUT_MS',
    5_000,
    5_000,
    30 * 60_000,
  ),
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
}

/**
 * Web screenshot: the same standalone serialization the editor
 * materializes from, rendered by the same Chromium pool through the same
 * route-interception, settle, clamp, and PNG-limit stages. External images
 * are skipped deterministically (route abort), exactly like the legacy
 * path; only the compile stage is model-specific.
 */
async function renderWebScreenshotWithBrowser(
  activeBrowser: Browser,
  source: WebDocument,
  options: WebScreenshotOptions = {},
): Promise<WebScreenshot> {
  const width = Math.round(Math.max(200, Math.min(options.width ?? 1_440, 3_840)))
  const pixelRatio = Math.max(1, Math.min(options.pixelRatio ?? 1, 2))
  const webDocument = assertWebDocument(structuredClone(source))
  if (options.rootId !== undefined && !webDocument.nodes[options.rootId]) {
    throw new Error(`Web node "${options.rootId}" does not exist`)
  }
  const skippedImages: string[] = []
  for (const node of Object.values(webDocument.nodes)) {
    if (
      node.kind === 'element' &&
      node.tag === 'img' &&
      /^\s*https?:\/\//i.test(node.attributes.src ?? '')
    ) {
      skippedImages.push(node.attributes.src as string)
    }
  }
  const html = compileWebStandaloneHtml(webDocument, { title: webDocument.name })
  const context = await activeBrowser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: pixelRatio,
  })
  try {
    await context.route('**/*', (route) => route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(async () => {
      await document.fonts?.ready
      await Promise.all(
        [...document.images].map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true })
                image.addEventListener('error', () => resolve(), { once: true })
              }),
        ),
      )
    })

    const root = page.locator('[data-sheet-export-root="true"]').first()
    await root.waitFor({ state: 'visible' })
    const handle = (
      options.rootId === undefined
        ? await root.elementHandle()
        : (
            await root.evaluateHandle(
              (element, nodeId) =>
                [...element.querySelectorAll('[data-sheet-node]')].find(
                  (node) => node.getAttribute('data-sheet-node') === nodeId,
                ) ?? null,
              options.rootId,
            )
          ).asElement()
    ) as ElementHandle<HTMLElement> | null
    if (!handle) {
      throw new Error(`Web node "${options.rootId}" did not render`)
    }

    await handle.evaluate(
      (element, limits) => {
        const htmlElement = element as HTMLElement
        const bounds = htmlElement.getBoundingClientRect()
        const areaScale = Math.sqrt(
          limits.maxArea /
            Math.max(1, bounds.width * bounds.height),
        )
        const scale = Math.min(
          1,
          limits.maxDimension / Math.max(1, bounds.width),
          limits.maxDimension / Math.max(1, bounds.height),
          areaScale,
        )
        if (scale < 1) {
          htmlElement.style.transformOrigin = 'top left'
          htmlElement.style.transform = `scale(${scale})`
        }
      },
      {
        maxArea: MAX_SCREENSHOT_AREA / (pixelRatio * pixelRatio),
        maxDimension: MAX_SCREENSHOT_DIMENSION / pixelRatio,
      },
    )
    const bounds = await handle.boundingBox()
    if (!bounds) throw new Error('Web screenshot target has no visible bounds')
    const format = options.format ?? 'png'
    const png = await handle.screenshot({
      type: format,
      ...(format === 'jpeg'
        ? { quality: Math.round(Math.max(1, Math.min(options.quality ?? 90, 100))) }
        : {}),
      animations: 'disabled',
      caret: 'hide',
    })
    if (png.byteLength > MAX_PNG_BYTES) {
      throw new Error(
        'The image is too large for one response. Use a smaller width, pixelRatio, or rootId.',
      )
    }
    return {
      png,
      mimeType: format === 'jpeg' ? ('image/jpeg' as const) : ('image/png' as const),
      width: Math.max(1, Math.round(bounds.width * pixelRatio)),
      height: Math.max(1, Math.round(bounds.height * pixelRatio)),
      rootId: options.rootId ?? null,
      skippedImages,
    }
  } finally {
    await context.close()
  }
}

export function renderWebScreenshot(
  _userId: string,
  source: WebDocument,
  options: WebScreenshotOptions = {},
) {
  return screenshotGate.run(() =>
    screenshotBrowser.run((activeBrowser) =>
      renderWebScreenshotWithBrowser(activeBrowser, source, options),
    ),
  )
}
