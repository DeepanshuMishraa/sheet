import { orderedWebRules, orderedWebStyleSheets } from '@sheet/canvas/web-css'
import {
  createWebStyleRule,
  createWebStyleSheet,
  nextRuleOrder,
  type WebDocument,
  type WebTransaction,
} from '@sheet/canvas/web-model'

export type TokenGroup = 'Color' | 'Font' | 'Radius' | 'Spacing' | 'Shadow' | 'Other'

export type WebToken =
  /** Declared as a `--custom-property` in a stylesheet. */
  | { source: 'declared'; name: string; value: string; group: TokenGroup; sheetId: string; ruleId: string }
  /** A literal value the design uses; `count` is how many declarations use it. */
  | { source: 'used'; name: string; value: string; group: TokenGroup; count: number }

export const TOKEN_GROUP_ORDER: TokenGroup[] = ['Color', 'Font', 'Radius', 'Spacing', 'Shadow', 'Other']

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\([^)]*\)/gi
const COLOR_VALUE = new RegExp(`^(?:${COLOR_LITERAL.source}|transparent|currentcolor)$`, 'i')

const COLOR_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'border',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'fill',
  'stroke',
  'text-decoration-color',
])
const SPACING_PROPERTIES = new Set(['gap', 'row-gap', 'column-gap', 'padding', 'margin'])

function groupForDeclared(name: string, value: string): TokenGroup {
  if (COLOR_VALUE.test(value)) return 'Color'
  const lower = name.toLowerCase()
  if (/(radius|rounded)/.test(lower)) return 'Radius'
  if (/(spacing|space|gap)/.test(lower)) return 'Spacing'
  if (/shadow/.test(lower)) return 'Shadow'
  if (/font/.test(lower)) return 'Font'
  return 'Other'
}

type Used = { group: TokenGroup; value: string }

/** The reusable values one CSS declaration contributes. Values that reference a variable are skipped. */
function usedValues(property: string, raw: string): Used[] {
  const value = raw.trim()
  if (value === '' || value.includes('var(')) return []
  if (COLOR_PROPERTIES.has(property)) {
    return (value.match(COLOR_LITERAL) ?? []).map((color) => ({ group: 'Color', value: color.toLowerCase() }))
  }
  if (property === 'box-shadow' || property === 'text-shadow') {
    return value === 'none' ? [] : [{ group: 'Shadow', value }]
  }
  if (property === 'font-family') return [{ group: 'Font', value }]
  if (property.endsWith('radius')) return /^\d/.test(value) ? [{ group: 'Radius', value }] : []
  if (SPACING_PROPERTIES.has(property) && /^\d[\w.%]*$/.test(value) && value !== '0') {
    return [{ group: 'Spacing', value }]
  }
  return []
}

/**
 * The design's tokens: every `--custom-property` its stylesheets declare, then
 * every distinct color, font, radius, spacing and shadow value the design
 * actually uses. Rules behind a media/container/supports condition are skipped
 * so a breakpoint override never shadows the base value.
 */
export function extractWebTokens(document: Pick<WebDocument, 'nodes' | 'stylesheets' | 'stylesheetOrder'>) {
  const declared = new Map<string, WebToken>()
  const used = new Map<string, { group: TokenGroup; value: string; count: number }>()

  const countUsed = (property: string, value: string) => {
    for (const hit of usedValues(property, value)) {
      const key = `${hit.group}:${hit.value}`
      const entry = used.get(key)
      if (entry) entry.count += 1
      else used.set(key, { ...hit, count: 1 })
    }
  }

  for (const sheet of orderedWebStyleSheets(document.stylesheets, document.stylesheetOrder)) {
    for (const rule of orderedWebRules(sheet)) {
      if (rule.conditions.length > 0) continue
      for (const [property, raw] of Object.entries(rule.declarations)) {
        const value = raw.trim()
        if (property.startsWith('--')) {
          const name = property.slice(2)
          if (name !== '' && !declared.has(name)) {
            declared.set(name, {
              source: 'declared',
              name,
              value,
              group: groupForDeclared(name, value),
              sheetId: sheet.id,
              ruleId: rule.id,
            })
          }
        } else {
          countUsed(property, value)
        }
      }
    }
  }
  for (const node of Object.values(document.nodes)) {
    if (node.kind !== 'element') continue
    for (const [property, value] of Object.entries(node.styles)) countUsed(property, value)
  }

  const declaredValues = new Set([...declared.values()].map((token) => `${token.group}:${token.value.toLowerCase()}`))
  const derived = [...used.entries()]
    .filter(([key]) => !declaredValues.has(key.toLowerCase()))
    .map(([, entry]) => ({ source: 'used' as const, name: entry.value, value: entry.value, group: entry.group, count: entry.count }))
    .sort((a, b) => b.count - a.count)

  return [...declared.values(), ...derived]
}

type TokenOperations = WebTransaction['operations']

export const NEW_TOKEN_DEFAULTS: Record<TokenGroup, { prefix: string; value: string }> = {
  Color: { prefix: 'color', value: '#000000' },
  Font: { prefix: 'font', value: 'Inter, sans-serif' },
  Radius: { prefix: 'radius', value: '8px' },
  Spacing: { prefix: 'spacing', value: '16px' },
  Shadow: { prefix: 'shadow', value: '0 1px 2px rgba(0, 0, 0, 0.2)' },
  Other: { prefix: 'token', value: '' },
}

/** A name not yet declared, e.g. `color-2` when `color` is taken. */
export function freshTokenName(tokens: WebToken[], prefix: string) {
  const taken = new Set(tokens.filter((token) => token.source === 'declared').map((token) => token.name))
  if (!taken.has(prefix)) return prefix
  let index = 2
  while (taken.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

export function validTokenName(name: string) {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(name)
}

/** Operations that declare `--name: value` on the document's unconditional `:root` rule, creating it if needed. */
export function declareTokenOperations(document: WebDocument, name: string, value: string): TokenOperations {
  for (const sheet of orderedWebStyleSheets(document.stylesheets, document.stylesheetOrder)) {
    const root = orderedWebRules(sheet).find((rule) => rule.selector === ':root' && rule.conditions.length === 0)
    if (root) {
      return [{ type: 'rule.patch', stylesheetId: sheet.id, id: root.id, patch: { declarations: { [`--${name}`]: value } } }]
    }
  }
  const rule = createWebStyleRule(':root', { [`--${name}`]: value })
  const first = orderedWebStyleSheets(document.stylesheets, document.stylesheetOrder)[0]
  if (first) return [{ type: 'rule.insert', stylesheetId: first.id, rule: { ...rule, order: nextRuleOrder(first) } }]
  return [
    {
      type: 'stylesheet.insert',
      stylesheet: createWebStyleSheet('theme', { rules: { [rule.id]: rule }, ruleOrder: [rule.id] }),
    },
  ]
}

/** Rename and/or revalue a declared token. A rename drops the old declaration in the same rule. */
export function editDeclaredTokenOperations(
  token: Extract<WebToken, { source: 'declared' }>,
  next: { name: string; value: string },
): TokenOperations {
  const declarations: Record<string, string | null> = { [`--${next.name}`]: next.value }
  if (next.name !== token.name) declarations[`--${token.name}`] = null
  return [{ type: 'rule.patch', stylesheetId: token.sheetId, id: token.ruleId, patch: { declarations } }]
}

export function deleteDeclaredTokenOperations(token: Extract<WebToken, { source: 'declared' }>): TokenOperations {
  return [
    { type: 'rule.patch', stylesheetId: token.sheetId, id: token.ruleId, patch: { declarations: { [`--${token.name}`]: null } } },
  ]
}

/** Rewrite every unconditional use of a literal value across node styles and rules. */
export function replaceUsedValueOperations(
  document: WebDocument,
  token: Extract<WebToken, { source: 'used' }>,
  next: string,
): TokenOperations {
  const rewrite = (property: string, value: string) => {
    if (!usedValues(property, value).some((hit) => hit.group === token.group && hit.value === token.value)) return null
    if (token.group !== 'Color') return next
    return value.replace(COLOR_LITERAL, (match) => (match.toLowerCase() === token.value ? next : match))
  }
  const operations: TokenOperations = []
  for (const node of Object.values(document.nodes)) {
    if (node.kind !== 'element') continue
    const styles: Record<string, string | null> = {}
    for (const [property, value] of Object.entries(node.styles)) {
      const rewritten = rewrite(property, value)
      if (rewritten !== null) styles[property] = rewritten
    }
    if (Object.keys(styles).length > 0) operations.push({ type: 'node.patch', id: node.id, patch: { kind: 'element', styles } })
  }
  for (const sheet of orderedWebStyleSheets(document.stylesheets, document.stylesheetOrder)) {
    for (const rule of orderedWebRules(sheet)) {
      if (rule.conditions.length > 0) continue
      const declarations: Record<string, string | null> = {}
      for (const [property, value] of Object.entries(rule.declarations)) {
        if (property.startsWith('--')) continue
        const rewritten = rewrite(property, value)
        if (rewritten !== null) declarations[property] = rewritten
      }
      if (Object.keys(declarations).length > 0) operations.push({ type: 'rule.patch', stylesheetId: sheet.id, id: rule.id, patch: { declarations } })
    }
  }
  return operations
}

/**
 * Turn a used literal into a named token: declare `--name` with the value, then
 * point every use at `var(--name)`.
 */
export function promoteUsedValueOperations(
  document: WebDocument,
  token: Extract<WebToken, { source: 'used' }>,
  next: { name: string; value: string },
): TokenOperations {
  return [
    ...declareTokenOperations(document, next.name, next.value),
    ...replaceUsedValueOperations(document, token, `var(--${next.name})`),
  ]
}
