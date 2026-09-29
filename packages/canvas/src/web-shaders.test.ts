import { describe, expect, test } from 'vitest'
import {
  SHADERS,
  isShaderNode,
  parseShaderParams,
  shaderInfo,
  shaderNode,
  shaderPatchOperation,
} from './web-shaders'
import { applyWebTransaction, createWebDocument, createWebElement } from './web-model'

function withShader() {
  const root = createWebElement('main', { parentId: null })
  const base = { ...createWebDocument('t'), roots: [root.id], nodes: { [root.id]: root } }
  const node = shaderNode('mesh-gradient', { parentId: root.id, order: 1_024, width: 200, height: 100 })
  const result = applyWebTransaction(base, {
    id: 'tx-1',
    label: 'Insert shader',
    operations: [{ type: 'node.insert', node }],
  })
  return { document: result.document, node }
}

describe('web shaders', () => {
  test('clamps ranges, drops unknown keys and fills defaults', () => {
    const params = parseShaderParams('mesh-gradient', { distortion: 9, bogus: 1, colors: ['#fff', 3] })
    expect(params.distortion).toBe(1)
    expect(params).not.toHaveProperty('bogus')
    expect(params.colors).toEqual(['#fff'])
    expect(params.swirl).toBe(SHADERS['mesh-gradient'].params.swirl.default)
  })

  test('falls back to defaults for junk input', () => {
    expect(parseShaderParams('swirl', 'nope').bandCount).toBe(4)
    expect(parseShaderParams('grain-gradient', { shape: 'not-a-shape' }).shape).toBe('corners')
  })

  test('inserts a validated shader node that survives a transaction', () => {
    const { document, node } = withShader()
    const stored = document.nodes[node.id]
    expect(isShaderNode(stored)).toBe(true)
    expect(shaderInfo(stored)?.name).toBe('mesh-gradient')
    expect(stored?.kind === 'element' && stored.styles.width).toBe('200px')
  })

  test('patches merge over current params', () => {
    const { node } = withShader()
    const operation = shaderPatchOperation(node, { params: { speed: 2 }, width: 640 })
    expect(operation?.type).toBe('node.patch')
    if (operation?.type !== 'node.patch' || operation.patch.kind !== 'element') throw new Error('expected element patch')
    const merged = JSON.parse(operation.patch.attributes?.['data-shader-params'] ?? '{}')
    expect(merged.speed).toBe(2)
    expect(merged.colors).toEqual(SHADERS['mesh-gradient'].params.colors.default)
    expect(operation.patch.styles?.width).toBe('640px')
  })

  test('nothing to change yields no operation', () => {
    const { node } = withShader()
    expect(shaderPatchOperation(node, {})).toBeNull()
    expect(shaderPatchOperation(createWebElement('div', { parentId: null }), { width: 1 })).toBeNull()
  })
})
