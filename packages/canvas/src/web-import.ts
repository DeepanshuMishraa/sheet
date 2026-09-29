import { webId } from './web-model'
import {
  assertWebDocument,
  createWebDocument,
  nextStylesheetOrder,
  parseWebHtml,
  type WebDocument,
} from './web-model'
import {
  MAX_WEB_RULES_PER_SHEET,
  assertWebStyleSheet,
  validSelector,
  validStyleName,
  validStyleValue,
  type WebCondition,
  type WebStyleRule,
  type WebStyleSheet,
} from './web-css'

/**
 * Website snapshot import: HTML + CSS become a {@link WebDocument} with their
 * structure recognizable, never translated into proprietary primitives and
 * never baked from computed styles.
 *
 * Two browser APIs do the parsing, zero Sheet code evaluates CSS:
 * - `DOMParser` for element structure (attributes, classes, text, nesting).
 * - `CSSStyleSheet` (CSSOM) for authored rule structure: selectors,
 *   declarations in source order, and media/container/supports grouping.
 * Anything CSSOM reports that the v1 document model cannot represent —
 * `@keyframes`, `@font-face`, `@layer`, nesting, `!important` — is skipped
 * with an explicit warning. There is no `rawCss` escape hatch: what M3
 * cannot represent, it reports.
 */

export interface WebImportResult {
  document: WebDocument
  warnings: string[]
}

const STYLE_RULE = 1
const MEDIA_RULE = 4
const SUPPORTS_RULE = 12
const CONTAINER_RULE = 17

/**
 * Parser canonicalization, not Sheet semantics: CSS parsers may expand
 * shorthands (`padding`, `background`) into longhands while also reporting
 * the shorthand, and normalize values (`0` to `0px`). Import keeps whatever
 * the CSSOM reports verbatim — still authored specified values, never
 * computed — because collapsing expansions would require a hand-rolled CSS
 * property database, which is exactly the compiler M3 refuses to build.
 */
interface PendingRule {
  selector: string
  declarations: Record<string, string>
  conditions: WebCondition[]
}

function ruleLabel(rule: CSSRule) {
  const name = rule.constructor?.name ?? `type ${rule.type}`
  const text = rule.cssText.slice(0, 80).replace(/\s+/g, ' ')
  return `${name} ${text}`
}

function groupingCondition(rule: CSSRule): WebCondition | null {
  if (rule.type === MEDIA_RULE) {
    return { kind: 'media', query: (rule as CSSMediaRule).conditionText }
  }
  if (rule.type === SUPPORTS_RULE) {
    return { kind: 'supports', query: (rule as CSSSupportsRule).conditionText }
  }
  if (rule.type === CONTAINER_RULE) {
    return { kind: 'container', query: (rule as CSSContainerRule).conditionText }
  }
  return null
}

function readDeclarations(style: CSSStyleDeclaration, selector: string, warnings: string[]) {
  const names: string[] = []
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index)
    if (name) names.push(name)
  }
  const declarations: Record<string, string> = {}
  for (const name of names) {
    if (style.getPropertyPriority(name) === 'important') {
      warnings.push(`"${selector}": "!important" on "${name}" is not represented and was skipped`)
      continue
    }
    const value = style.getPropertyValue(name)
    if (!validStyleName(name) || !validStyleValue(value)) {
      warnings.push(`"${selector}": declaration "${name}" was skipped as unsafe or invalid`)
      continue
    }
    declarations[name] = value
  }
  return declarations
}

function walkRules(
  rules: CSSRuleList,
  conditions: WebCondition[],
  pending: PendingRule[],
  warnings: string[],
) {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules.item(index)
    if (!rule) continue
    if (rule.type === STYLE_RULE) {
      const selector = (rule as CSSStyleRule).selectorText ?? ''
      if (!validSelector(selector)) {
        warnings.push(`Selector "${selector.slice(0, 120)}" is invalid and its rule was skipped`)
        continue
      }
      pending.push({
        selector,
        declarations: readDeclarations((rule as CSSStyleRule).style, selector, warnings),
        conditions: [...conditions],
      })
      continue
    }
    const condition = groupingCondition(rule)
    if (condition) {
      if (conditions.length >= 8) {
        warnings.push(`Deeply nested condition "${condition.query}" exceeds the v1 model and was skipped`)
        continue
      }
      walkRules(
        (rule as CSSGroupingRule).cssRules,
        [...conditions, condition],
        pending,
        warnings,
      )
      continue
    }
    warnings.push(`${ruleLabel(rule)} is not represented in the v1 model and was skipped`)
  }
}

function parseSheet(css: string): CSSStyleSheet {
  if (typeof CSSStyleSheet === 'undefined') {
    throw new Error('CSS import requires a browser CSSStyleSheet')
  }
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  return sheet
}

/**
 * Parses authored CSS text into one stylesheet using the browser's CSSOM.
 * Selectors, declaration order, rule order, and media/container/supports
 * conditions survive; everything else is reported in `warnings`.
 */
export function importWebStylesheet(
  css: string,
  options: { id?: string; name?: string; order?: number } = {},
): { stylesheet: WebStyleSheet; warnings: string[] } {
  const warnings: string[] = []
  const pending: PendingRule[] = []
  walkRules(parseSheet(css).cssRules, [], pending, warnings)
  if (pending.length > MAX_WEB_RULES_PER_SHEET) {
    warnings.push(
      `Stylesheet has ${pending.length} rules; only the first ${MAX_WEB_RULES_PER_SHEET} were kept`,
    )
  }
  const rules: Record<string, WebStyleRule> = {}
  const ruleOrder: string[] = []
  let order = 0
  for (const item of pending.slice(0, MAX_WEB_RULES_PER_SHEET)) {
    const id = webId('rule')
    rules[id] = { ...item, id, order: (order += 1_024) }
    ruleOrder.push(id)
  }
  const stylesheet: WebStyleSheet = {
    id: options.id ?? webId('stylesheet'),
    name: options.name ?? 'imported',
    order: options.order ?? 1_024,
    rules,
    ruleOrder,
  }
  assertWebStyleSheet(stylesheet, stylesheet.id)
  return { stylesheet, warnings }
}

function embeddedStyleSources(html: string): string[] {
  if (typeof DOMParser === 'undefined') {
    throw new Error('HTML import requires a browser DOMParser')
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  return [...parsed.querySelectorAll('style')]
    .map((element) => element.textContent ?? '')
    .filter((css) => css.trim().length > 0)
}

/**
 * Imports an HTML snapshot plus its authored CSS into one `WebDocument`.
 * Element structure comes from `parseWebHtml` unchanged; `<style>` contents
 * (in document order) and the `css` argument (last) merge into a single
 * `imported` stylesheet preserving rule order. Computed styles are never
 * read: what the browser resolves stays the browser's job on render.
 */
export function importWebSnapshot(
  html: string,
  css = '',
  options: { id?: string; name?: string; stylesheetName?: string } = {},
): WebImportResult {
  const warnings: string[] = []
  const document = createWebDocument(options.name ?? 'Imported snapshot', options.id)
  const parsed = parseWebHtml(html)
  document.nodes = parsed.nodes
  document.roots = parsed.roots

  const sources = [
    ...embeddedStyleSources(html).map((source, index) => ({
      label: `<style> #${index + 1}`,
      css: source,
    })),
    ...(css.trim().length > 0 ? [{ label: 'provided CSS', css }] : []),
  ]
  if (sources.length > 0) {
    const combined = sources.map((source) => source.css).join('\n')
    const imported = importWebStylesheet(combined, {
      name: options.stylesheetName ?? 'imported',
      order: nextStylesheetOrder(document),
    })
    for (const warning of imported.warnings) warnings.push(warning)
    document.stylesheets[imported.stylesheet.id] = imported.stylesheet
    document.stylesheetOrder = [...document.stylesheetOrder, imported.stylesheet.id]
  }
  return { document: assertWebDocument(document), warnings }
}
