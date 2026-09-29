import type { WebDocument } from '@sheet/canvas/web-model'

export interface DocumentFont {
  /** The full `font-family` value as authored, so applying it is lossless. */
  stack: string
  /** First family in the stack, unquoted; what the UI shows. */
  family: string
  uses: number
}

const FONT_DECLARATION = /^(font-family|--font[\w-]*)$/

export function firstFamily(stack: string) {
  const first = stack.split(',')[0]?.trim() ?? ''
  return first.replace(/^["']|["']$/g, '')
}

/** Every font stack the document uses, most-used first: inline styles, stylesheet rules and `--font-*` variables. */
export function documentFonts(document: WebDocument): DocumentFont[] {
  const counts = new Map<string, number>()
  const add = (value: string | undefined) => {
    const stack = value?.trim()
    if (!stack || stack.startsWith('var(') || stack === 'inherit') return
    counts.set(stack, (counts.get(stack) ?? 0) + 1)
  }
  for (const node of Object.values(document.nodes)) {
    if (node.kind !== 'element') continue
    for (const [name, value] of Object.entries(node.styles)) {
      if (FONT_DECLARATION.test(name)) add(value)
    }
  }
  for (const sheet of Object.values(document.stylesheets)) {
    for (const rule of Object.values(sheet.rules)) {
      for (const [name, value] of Object.entries(rule.declarations)) {
        if (FONT_DECLARATION.test(name)) add(value)
      }
    }
  }
  return [...counts]
    .map(([stack, uses]) => ({ stack, family: firstFamily(stack), uses }))
    .filter((font) => font.family)
    .sort((a, b) => b.uses - a.uses || a.family.localeCompare(b.family))
}

export const SYSTEM_FONT_STACKS = [
  { label: 'System UI', stack: 'system-ui, sans-serif' },
  { label: 'Sans serif', stack: 'ui-sans-serif, sans-serif' },
  { label: 'Serif', stack: 'ui-serif, Georgia, serif' },
  { label: 'Monospace', stack: 'ui-monospace, monospace' },
] as const
