import { serializeWebStylesheets } from './web-css'
import {
  assertWebDocument,
  serializeWebDocument,
  type WebDocument,
} from './web-model'

export interface WebStandaloneHtmlOptions {
  title?: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Standalone HTML for screenshots and portable rendering. The body embeds
 * byte-identical output of the same serializers `WebDocumentView`
 * materializes from — `serializeWebDocument` for DOM,
 * `serializeWebStylesheets` for authored CSS in cascade order — inside one
 * `data-sheet-export-root` wrapper. There is no second rendering
 * implementation: what the editor mounts and what the screenshot renders
 * are the same strings. Viewport width governs layout; nothing here injects
 * sizing, and no revision, history, or document state is touched.
 */
export function compileWebStandaloneHtml(
  document: WebDocument,
  options: WebStandaloneHtmlOptions = {},
): string {
  const source = assertWebDocument(document)
  const css = serializeWebStylesheets(source.stylesheets, source.stylesheetOrder)
  const body = serializeWebDocument(source, { includeNodeIds: true })
  const title = escapeHtml(options.title ?? source.name)
  // Capture chrome, not document semantics: without it the browser's default
  // body margin offsets every screenshot by 8px.
  const chrome = 'body{margin:0}'
  return [
    '<!doctype html>',
    '<html>',
    `<head><meta charset="utf-8"><title>${title}</title><style>${chrome}${css}</style></head>`,
    `<body><div data-sheet-export-root="true">${body}</div></body>`,
    '</html>',
  ].join('')
}
