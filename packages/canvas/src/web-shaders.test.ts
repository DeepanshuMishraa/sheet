import { describe, expect, test } from 'vitest'
import {
  SHADER_NAMES,
  SHADERS,
  isShaderNode,
  parseShaderParams,
  shaderInfo,
  shaderNode,
  shaderPatchOperation,
  type ParamSpec as ParamSpecLike,
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

  test('every shader in the catalogue is complete and keeps its defaults', () => {
    expect(SHADER_NAMES.length).toBeGreaterThanOrEqual(19)
    for (const name of SHADER_NAMES) {
      const definition = SHADERS[name]
      expect(definition.label.length, name).toBeGreaterThan(0)
      expect(['gradient', 'pattern', 'effect'], name).toContain(definition.group)
      const parsed = parseShaderParams(name, undefined)
      for (const [key, spec] of Object.entries<ParamSpecLike>(definition.params)) {
        if (spec.kind === 'number') {
          expect(spec.default, `${name}.${key}`).toBeGreaterThanOrEqual(spec.min)
          expect(spec.default, `${name}.${key}`).toBeLessThanOrEqual(spec.max)
        }
        if (spec.kind === 'enum') expect(spec.options, `${name}.${key}`).toContain(spec.default)
        if (spec.kind === 'colors' && spec.max !== undefined) {
          expect(spec.default.length, `${name}.${key}`).toBeLessThanOrEqual(spec.max)
        }
        expect(parsed[key], `${name}.${key}`).toBeDefined()
      }
    }
  })

  test('a color list is cut to what the shader can hold', () => {
    const many = Array.from({ length: 9 }, (_, index) => `#00000${index}`)
    expect(parseShaderParams('god-rays', { colors: many }).colors).toHaveLength(5)
    expect(parseShaderParams('metaballs', { colors: many }).colors).toHaveLength(8)
    expect(parseShaderParams('simplex-noise', { colors: many }).colors).toHaveLength(9)
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
