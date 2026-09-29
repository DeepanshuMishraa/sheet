/**
 * Authored CSS for {@link WebDocument} — v1 subset.
 *
 * What this is: stylesheet/rule storage so authored CSS survives as authored
 * CSS. What this is not: a CSS engine. The browser remains the only thing
 * that matches selectors, computes specificity, evaluates `@media` /
 * `@container` / `@supports`, resolves pseudo-classes and pseudo-elements,
 * and produces computed styles. Sheet authors rules and asks the browser
 * what the result is (`getComputedStyle`, `getBoundingClientRect`).
 *
 * v1 subset limits (deliberate, not universal CSS):
 * - Conditions are a flat outer-to-inner at-rule stack (`media`, `container`,
 *   `supports`) stored per rule. Adjacent rules that came from one authored
 *   `@media` block normalize to per-rule conditions with order preserved;
 *   the serializer regroups consecutive identical conditions on output.
 * - Deeper CSS structure (nesting, `@layer`, `@keyframes`, `@font-face`,
 *   `@import`, `@scope`, style declaractions inside unknown at-rules) has no
 *   representation yet. M1 rejects such input with an explicit error rather
 *   than inventing a generic CSS AST or stuffing it into a selector rule.
 * - Selector matching, specificity, inheritance, and cascade resolution are
 *   never computed here.
 */

export const MAX_WEB_STYLESHEETS = 16
export const MAX_WEB_RULES_PER_SHEET = 2_000
export const MAX_WEB_DECLARATIONS_PER_RULE = 200
export const MAX_WEB_SELECTOR_LENGTH = 1_000
export const MAX_WEB_CONDITION_QUERY_LENGTH = 500
export const MAX_WEB_SERIALIZED_CSS = 1_000_000

export interface WebMediaCondition {
  kind: 'media'
  query: string
}

export interface WebContainerCondition {
  kind: 'container'
  query: string
}

export interface WebSupportsCondition {
  kind: 'supports'
  query: string
}

export type WebCondition = WebMediaCondition | WebContainerCondition | WebSupportsCondition

export interface WebStyleRule {
  id: string
  selector: string
  declarations: Record<string, string>
  conditions: WebCondition[]
  order: number
}

export interface WebStyleSheet {
  id: string
  name: string
  order: number
  rules: Record<string, WebStyleRule>
  ruleOrder: string[]
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function validWebId(id: string) {
  return /^[A-Za-z0-9:_-]{1,200}$/.test(id)
}

export function validStyleName(name: string) {
  return /^--[a-z0-9_-]+$/i.test(name) || /^[a-z][a-z0-9-]*$/i.test(name)
}

export function validStyleValue(value: string) {
  return (
    value.length <= 10_000 &&
    // `</style>` would close an exported <style> block and let markup through.
    !/<\/?style|<script|<!--/i.test(value) &&
    !/expression\s*\(|-moz-binding|url\s*\(\s*(['"]?)\s*javascript:/i.test(value)
  )
}

function hasBalancedParens(value: string) {
  let depth = 0
  for (const character of value) {
    if (character === '(') depth += 1
    if (character === ')') {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

/**
 * Structural only: length, balanced parens, no rule-breaking characters, no
 * executable payloads, no targeting of Sheet's internal selection hooks.
 * Specificity and matching are the browser's job.
 */
export function validSelector(selector: string) {
  if (selector.length === 0 || selector.length > MAX_WEB_SELECTOR_LENGTH) return false
  if (selector.trim() !== selector || selector.trim().length === 0) return false
  if (/[{}`;]/.test(selector)) return false
  if (/<|javascript:|expression\s*\(|-moz-binding/i.test(selector)) return false
  if (/data-sheet-node/i.test(selector)) return false
  return hasBalancedParens(selector)
}

/**
 * Structural only: a media/container/supports prelude without the `@` keyword
 * or braces. Evaluation is the browser's job.
 */
export function validConditionQuery(query: string) {
  if (query.length === 0 || query.length > MAX_WEB_CONDITION_QUERY_LENGTH) return false
  if (query.trim() !== query || query.trim().length === 0) return false
  if (/[{};`]/.test(query)) return false
  if (/javascript:|expression\s*\(|-moz-binding/i.test(query)) return false
  if (/<(script|style|iframe|object|embed|link|meta)\b/i.test(query)) return false
  return hasBalancedParens(query)
}

function assertStringRecord(
  value: unknown,
  name: string,
  validateKey: (key: string) => boolean,
  validateValue: (key: string, value: string) => boolean = () => true,
) {
  if (!record(value)) throw new Error(`${name} must be an object`)
  for (const [key, entry] of Object.entries(value)) {
    if (!validateKey(key) || typeof entry !== 'string' || !validateValue(key, entry)) {
      throw new Error(`${name}.${key} is invalid`)
    }
  }
}

export function assertWebCondition(value: unknown): WebCondition {
  if (!record(value) || typeof value.query !== 'string') {
    throw new Error('Stylesheet condition is invalid')
  }
  if (
    value.kind !== 'media' &&
    value.kind !== 'container' &&
    value.kind !== 'supports'
  ) {
    throw new Error('Stylesheet condition kind is invalid')
  }
  if (!validConditionQuery(value.query)) {
    throw new Error('Stylesheet condition query is invalid')
  }
  return { kind: value.kind, query: value.query }
}

function assertConditions(value: unknown, name: string): WebCondition[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  if (value.length > 8) throw new Error(`${name} has too many conditions`)
  return value.map(assertWebCondition)
}

export function assertWebStyleRule(value: unknown, id: string): WebStyleRule {
  if (!record(value) || value.id !== id) throw new Error(`rules.${id} is invalid`)
  if (typeof value.selector !== 'string' || !validSelector(value.selector)) {
    throw new Error(`rules.${id}.selector is invalid`)
  }
  assertStringRecord(
    value.declarations,
    `rules.${id}.declarations`,
    validStyleName,
    (_, entry) => validStyleValue(entry),
  )
  const declarations = value.declarations as Record<string, string>
  if (Object.keys(declarations).length > MAX_WEB_DECLARATIONS_PER_RULE) {
    throw new Error(`rules.${id}.declarations has too many entries`)
  }
  const conditions = assertConditions(value.conditions ?? [], `rules.${id}.conditions`)
  if (typeof value.order !== 'number' || !Number.isFinite(value.order)) {
    throw new Error(`rules.${id} has an invalid order`)
  }
  return {
    id,
    selector: value.selector,
    declarations: { ...declarations },
    conditions,
    order: value.order,
  }
}

export function assertWebStyleSheet(value: unknown, id: string): WebStyleSheet {
  if (!record(value) || value.id !== id) throw new Error(`stylesheets.${id} is invalid`)
  if (
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > 200
  ) {
    throw new Error(`stylesheets.${id}.name is invalid`)
  }
  if (typeof value.order !== 'number' || !Number.isFinite(value.order)) {
    throw new Error(`stylesheets.${id} has an invalid order`)
  }
  if (!record(value.rules)) throw new Error(`stylesheets.${id}.rules is invalid`)
  if (!Array.isArray(value.ruleOrder)) {
    throw new Error(`stylesheets.${id}.ruleOrder is invalid`)
  }
  const entries = Object.entries(value.rules)
  if (entries.length > MAX_WEB_RULES_PER_SHEET) {
    throw new Error(`stylesheets.${id} has too many rules`)
  }
  const rules: Record<string, WebStyleRule> = {}
  for (const [ruleId, rule] of entries) {
    if (!validWebId(ruleId)) throw new Error(`stylesheets.${id} has an invalid rule id`)
    rules[ruleId] = assertWebStyleRule(rule, ruleId)
  }
  const expectedOrder = Object.values(rules)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((rule) => rule.id)
  const ruleOrder = value.ruleOrder as unknown[]
  if (
    ruleOrder.length !== expectedOrder.length ||
    ruleOrder.some((ruleId, index) => ruleId !== expectedOrder[index])
  ) {
    throw new Error(`stylesheets.${id}.ruleOrder does not match its rules`)
  }
  return {
    id,
    name: value.name,
    order: value.order,
    rules,
    ruleOrder: [...expectedOrder],
  }
}

export function assertWebStylesheets(value: unknown): {
  stylesheets: Record<string, WebStyleSheet>
  stylesheetOrder: string[]
} {
  if (!record(value)) throw new Error('Web stylesheets are invalid')
  const { stylesheets, stylesheetOrder } = value as {
    stylesheets: unknown
    stylesheetOrder: unknown
  }
  if (!record(stylesheets)) throw new Error('Web stylesheets are invalid')
  if (!Array.isArray(stylesheetOrder)) throw new Error('Web stylesheet order is invalid')
  const entries = Object.entries(stylesheets)
  if (entries.length > MAX_WEB_STYLESHEETS) throw new Error('Web document has too many stylesheets')
  const parsed: Record<string, WebStyleSheet> = {}
  for (const [id, sheet] of entries) {
    if (!validWebId(id)) throw new Error(`stylesheets.${id} has an invalid id`)
    parsed[id] = assertWebStyleSheet(sheet, id)
  }
  const expectedOrder = Object.values(parsed)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((sheet) => sheet.id)
  if (
    stylesheetOrder.length !== expectedOrder.length ||
    stylesheetOrder.some((id, index) => id !== expectedOrder[index])
  ) {
    throw new Error('Web stylesheet order does not match its stylesheets')
  }
  return { stylesheets: parsed, stylesheetOrder: [...expectedOrder] }
}

export function orderedWebStyleSheets(
  stylesheets: Record<string, WebStyleSheet>,
  stylesheetOrder: string[],
) {
  return stylesheetOrder
    .map((id) => stylesheets[id])
    .filter((sheet): sheet is WebStyleSheet => !!sheet)
}

export function orderedWebRules(sheet: WebStyleSheet) {
  return sheet.ruleOrder
    .map((id) => sheet.rules[id])
    .filter((rule): rule is WebStyleRule => !!rule)
}

function conditionPrelude(condition: WebCondition) {
  if (condition.kind === 'media') return `@media ${condition.query}`
  if (condition.kind === 'container') return `@container ${condition.query}`
  return `@supports ${condition.query}`
}

function serializeDeclarations(declarations: Record<string, string>) {
  return Object.entries(declarations)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
}

export function serializeWebRule(rule: WebStyleRule) {
  const body = `${rule.selector}{${serializeDeclarations(rule.declarations)}}`
  return rule.conditions.reduceRight(
    (inner, condition) => `${conditionPrelude(condition)}{${inner}}`,
    body,
  )
}

/**
 * Rules keep their authored structure: consecutive rules sharing identical
 * conditions regroup into one at-rule block; non-adjacent ones serialize as
 * separate blocks. Same cascade, preserved order.
 */
export function serializeWebStyleSheet(sheet: WebStyleSheet) {
  const rules = orderedWebRules(sheet)
  const blocks: string[] = []
  let index = 0
  while (index < rules.length) {
    const group: WebStyleRule[] = [rules[index] as WebStyleRule]
    while (
      index + group.length < rules.length &&
      JSON.stringify((rules[index + group.length] as WebStyleRule).conditions) ===
        JSON.stringify((rules[index] as WebStyleRule).conditions)
    ) {
      group.push(rules[index + group.length] as WebStyleRule)
    }
    const inner = group
      .map(
        (rule) => `${rule.selector}{${serializeDeclarations(rule.declarations)}}`,
      )
      .join('')
    const conditions = (rules[index] as WebStyleRule).conditions
    blocks.push(
      conditions.reduceRight(
        (wrapped, condition) => `${conditionPrelude(condition)}{${wrapped}}`,
        inner,
      ),
    )
    index += group.length
  }
  return blocks.join('')
}

export function serializeWebStylesheets(
  stylesheets: Record<string, WebStyleSheet>,
  stylesheetOrder: string[],
) {
  const css = orderedWebStyleSheets(stylesheets, stylesheetOrder)
    .map(serializeWebStyleSheet)
    .join('')
  if (css.length > MAX_WEB_SERIALIZED_CSS) throw new Error('Serialized CSS is too large')
  return css
}
