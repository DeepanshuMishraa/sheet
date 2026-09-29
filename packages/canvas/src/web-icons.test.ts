import { describe, expect, test } from 'vitest'
import {
  ICON_LIBRARIES,
  iconInfo,
  iconNodes,
  iconStyleOperation,
  isIconNode,
  searchIcons,
} from './web-icons'
import {
  applyWebTransaction,
  createWebDocument,
  createWebElement,
} from './web-model'

function withIcon(library: 'lucide' | 'hugeicons', name: string) {
  const root = createWebElement('main', { parentId: null })
  const base = { ...createWebDocument('t'), roots: [root.id], nodes: { [root.id]: root } }
  const nodes = iconNodes(library, name, { parentId: root.id, order: 1_024, color: '#ff0000' })
  if (!nodes) throw new Error('icon missing')
  const result = applyWebTransaction(base, {
    id: 'tx-1',
    label: 'Insert icon',
    operations: nodes.map((node) => ({ type: 'node.insert' as const, node })),
  })
  return { document: result.document, svg: nodes[0], count: nodes.length }
}

describe('web icons', () => {
  test('searches every supported library', () => {
    expect(ICON_LIBRARIES.map((entry) => entry.id)).toEqual(['hugeicons', 'lucide'])
    expect(searchIcons('heart', 'lucide').every((icon) => icon.library === 'lucide')).toBe(true)
    const libraries = new Set(searchIcons('heart').map((icon) => icon.library))
    expect(libraries).toEqual(new Set(['hugeicons', 'lucide']))
  })

  test('returns null for an unknown icon', () => {
    expect(iconNodes('lucide', 'definitely-not-an-icon', { parentId: null, order: 1 })).toBeNull()
  })

  test.each(['lucide', 'hugeicons'] as const)('%s icons insert through a real transaction', (library) => {
    const { document, svg, count } = withIcon(library, 'heart')
    expect(count).toBeGreaterThan(1)
    const inserted = document.nodes[svg?.id ?? '']
    expect(isIconNode(inserted)).toBe(true)
    expect(iconInfo(inserted)?.library).toBe(library)
    expect(inserted?.kind === 'element' && inserted.styles.color).toBe('#ff0000')
  })

  test('style operation recolors, resizes and re-strokes in one patch', () => {
    const { document, svg } = withIcon('lucide', 'heart')
    const operation = iconStyleOperation(svg?.id ?? '', { color: '#00ff00', size: 40, strokeWidth: 3 })
    expect(operation).not.toBeNull()
    if (!operation) return
    const next = applyWebTransaction(document, { id: 'tx-2', label: 'Style icon', operations: [operation] })
    const node = next.document.nodes[svg?.id ?? '']
    expect(node?.kind === 'element' && node.styles).toMatchObject({ color: '#00ff00', width: '40px', height: '40px' })
    expect(node?.kind === 'element' && node.attributes['stroke-width']).toBe('3')
    expect(iconStyleOperation('x', {})).toBeNull()
  })
})
