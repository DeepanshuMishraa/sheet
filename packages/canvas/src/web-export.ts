import { serializeWebStylesheets } from './web-css'
import {
  assertWebDocument,
  serializeWebDocument,
  STAGE_MAIN_KEY,
  type WebDocument,
} from './web-model'
import { isBoundedPage, stageColor } from './web-pages'

/**
 * The colour behind a page's frames, as CSS, so an export or a screenshot of the
 * page matches what the editor shows. Page 1's colour paints the whole export
 * (`wrapper` names the element that stands for it). A named open page has no
 * paint of its own, so its colour is applied to its root in a capture, where
 * roots can be told apart by id. A bounded page keeps its own background.
 * Colours are validated `#rrggbb` values and ids are escaped, so nothing here
 * can break out of the rule.
 */
function stageCss(document: WebDocument, wrapper: string, pageRoots: boolean) {
  const rules: string[] = []
  const main = stageColor(document, null)
  if (main) rules.push(`${wrapper}{background:${main}}`)
  if (pageRoots) {
    for (const [key, color] of Object.entries(document.metadata.stageColors ?? {})) {
      if (key === STAGE_MAIN_KEY || !document.nodes[key] || isBoundedPage(document, key)) continue
      const id = key.replace(/["\\]/g, '\\$&')
      rules.push(`[data-sheet-node="${id}"]{background:${color}!important}`)
    }
  }
  return rules.join('')
}

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
  const stage = stageCss(source, '[data-sheet-export-root]', true)
  return [
    '<!doctype html>',
    '<html>',
    `<head><meta charset="utf-8"><title>${title}</title><style>${chrome}${stage}${css}</style></head>`,
    `<body><div data-sheet-export-root="true">${body}</div></body>`,
    '</html>',
  ].join('')
}

/**
 * The complete, portable page: one self-contained HTML file with the authored
 * CSS inlined and the DOM serialized without editor identity attributes.
 * Same serializers as `compileWebStandaloneHtml`, minus the capture wrapper.
 */
export function compileWebCodeHtml(
  document: WebDocument,
  options: WebStandaloneHtmlOptions = {},
): string {
  const source = assertWebDocument(document)
  const css = serializeWebStylesheets(source.stylesheets, source.stylesheetOrder)
  const body = serializeWebDocument(source)
  const title = escapeHtml(options.title ?? source.name)
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<style>\n${stageCss(source, 'body', false)}${css}\n</style>`,
    '</head>',
    `<body>\n${body}\n</body>`,
    '</html>',
    '',
  ].join('\n')
}
