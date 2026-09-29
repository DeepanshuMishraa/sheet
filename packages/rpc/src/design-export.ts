import { z } from 'zod'
import { compileWebCodeHtml } from '@sheet/canvas/web-export'
import type { WebDocument } from '@sheet/canvas/web-model'

export const EXPORT_FORMATS = ['html', 'png', 'jpg', 'json'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export const exportOptionsShape = {
  format: z
    .enum(EXPORT_FORMATS)
    .describe(
      'html: one complete self-contained page (DOM + all CSS). png/jpg: rendered image. json: the authored web document.',
    ),
  rootId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('png/jpg only: web node id to capture; omit for the whole document.'),
  width: z.number().finite().min(200).max(3_840).default(1_440).describe('png/jpg only: viewport width in px.'),
  pixelRatio: z.number().finite().min(1).max(2).default(1).describe('png/jpg only: device scale factor.'),
}

export type ExportOptions = {
  format: ExportFormat
  rootId?: string
  width?: number
  pixelRatio?: number
}

export type ExportedDesign = {
  filename: string
  mimeType: string
  /** `utf8` for text formats, `base64` for images. */
  encoding: 'utf8' | 'base64'
  data: string
  /** Set for images. */
  width?: number
  height?: number
}

function slug(name: string) {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return cleaned || 'design'
}

/**
 * One export path for the editor (oRPC) and MCP. Text formats come straight
 * from the same serializers the editor renders; images go through the shared
 * Chromium screenshot pool.
 */
export async function exportWebDocument(
  userId: string,
  document: WebDocument,
  options: ExportOptions,
): Promise<ExportedDesign> {
  const base = slug(document.name)
  if (options.format === 'html') {
    return {
      filename: `${base}.html`,
      mimeType: 'text/html',
      encoding: 'utf8',
      data: compileWebCodeHtml(document),
    }
  }
  if (options.format === 'json') {
    return {
      filename: `${base}.json`,
      mimeType: 'application/json',
      encoding: 'utf8',
      data: JSON.stringify(document, null, 2),
    }
  }
  const { renderWebScreenshot } = await import('./mcp-screenshot')
  const image = await renderWebScreenshot(userId, document, {
    rootId: options.rootId,
    width: options.width,
    pixelRatio: options.pixelRatio,
    format: options.format === 'jpg' ? 'jpeg' : 'png',
  })
  return {
    filename: `${base}.${options.format}`,
    mimeType: image.mimeType,
    encoding: 'base64',
    data: Buffer.from(image.png).toString('base64'),
    width: image.width,
    height: image.height,
  }
}
