import { describe, expect, it } from 'vitest'
import {
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebText,
} from '@sheet/canvas/web-model'
import {
  cloneSubtreeFresh,
  commitAbsoluteMove,
  commitResize,
  computeReorderOrder,
  dragMoveKind,
  parsePxAuthored,
  reorderAxis,
  resizeFromEdges,
} from './web-editor'

function siblings() {
  return [
    { id: 'a', order: 1_024, top: 0, left: 0, bottom: 40, right: 100 },
    { id: 'b', order: 2_048, top: 0, left: 116, bottom: 40, right: 216 },
    { id: 'c', order: 3_072, top: 0, left: 232, bottom: 40, right: 332 },
  ]
}

describe('web-native authoring math', () => {
  it('decides move semantics from computed position, never invents layout', () => {
    expect(dragMoveKind('static')).toBe('reorder')
    expect(dragMoveKind('relative')).toBe('reorder')
    expect(dragMoveKind('sticky')).toBe('reorder')
    expect(dragMoveKind('absolute')).toBe('absolute')
    expect(dragMoveKind('fixed')).toBe('absolute')
  })

  it('maps pointer movement to the parent main axis', () => {
    expect(reorderAxis('flex', 'row')).toBe('x')
    expect(reorderAxis('flex', 'row-reverse')).toBe('x')
    expect(reorderAxis('flex', 'column')).toBe('y')
    expect(reorderAxis('block', 'row')).toBe('y')
    expect(reorderAxis('grid', 'row')).toBe('y')
  })

  it('reorders within flex rows by pointer position', () => {
    // Dragging b past c commits an order between c and the end.
    expect(computeReorderOrder(siblings(), 'b', 2_048, 300, 20, 'x')).toBe(4_096)
    // Dragging b before a commits an order ahead of a.
    expect(computeReorderOrder(siblings(), 'b', 2_048, 10, 20, 'x')).toBe(0)
    // Staying inside b's own slot commits nothing.
    expect(computeReorderOrder(siblings(), 'b', 2_048, 150, 20, 'x')).toBeNull()
    // Midpoint orders split the gap without touching neighbors.
    expect(computeReorderOrder(siblings(), 'a', 1_024, 200, 20, 'x')).toBe(2_560)
  })

  it('reorders columns along the vertical axis', () => {
    const column = siblings().map((sibling, index) => ({
      ...sibling,
      top: index * 56,
      bottom: index * 56 + 40,
      left: 0,
      right: 100,
    }))
    expect(computeReorderOrder(column, 'a', 1_024, 20, 160, 'y')).toBe(4_096)
    expect(computeReorderOrder(column, 'a', 1_024, 20, 130, 'y')).toBe(2_560)
    expect(computeReorderOrder(column, 'c', 3_072, 20, 10, 'y')).toBe(0)
    expect(computeReorderOrder(column, 'b', 2_048, 20, 60, 'y')).toBeNull()
  })

  it('parses only pixel authored values for gesture deltas', () => {
    expect(parsePxAuthored('100px')).toBe(100)
    expect(parsePxAuthored('-5px')).toBe(-5)
    expect(parsePxAuthored('12.5px')).toBe(12.5)
    expect(parsePxAuthored('  8px  ')).toBe(8)
    expect(parsePxAuthored('50%')).toBeNull()
    expect(parsePxAuthored('auto')).toBeNull()
    expect(parsePxAuthored('calc(100% - 20px)')).toBeNull()
    expect(parsePxAuthored('min(50%, 200px)')).toBeNull()
    expect(parsePxAuthored('100')).toBeNull()
    expect(parsePxAuthored('')).toBeNull()
    expect(parsePxAuthored(undefined)).toBeNull()
  })

  it('commits absolute moves as authored start plus pointer delta', () => {
    // left: 100px, drag +17px → left: 117px.
    expect(commitAbsoluteMove({ left: 100, top: 50 }, 0, 0, 17, 0, 1)).toEqual({
      left: '117px',
      top: '50px',
    })
    // Same logical displacement at different zooms commits the same CSS.
    expect(commitAbsoluteMove({ left: 100, top: 50 }, 0, 0, 34, 20, 2)).toEqual(
      commitAbsoluteMove({ left: 100, top: 50 }, 10, 5, 27, 15, 1),
    )
    // Defensive float normalization, never a geometry source.
    expect(commitAbsoluteMove({ left: 0, top: 0 }, 0, 0, 10 / 3, 0, 1).left).toBe('3.33px')
  })

  it('commits resizes from authored size and declines non-pixel axes', () => {
    // width: 200px, drag +37 → 237px.
    expect(commitResize({ width: 200, height: 100 }, 0, 0, 37, 10, 1)).toEqual({
      width: '237px',
      height: '110px',
      declined: [],
    })
    expect(commitResize({ width: 5, height: 5 }, 0, 0, -100, -100, 1).width).toBe('1px')
    // %/auto/calc never silently become pixels.
    expect(commitResize({ width: null, height: null }, 0, 0, 37, 10, 1)).toEqual({
      declined: ['width', 'height'],
    })
    expect(commitResize({ width: 200, height: null }, 0, 0, 37, 10, 1)).toEqual({
      width: '237px',
      declined: ['height'],
    })
  })

  it('resizes from any side: far sides grow the box, near sides move the origin', () => {
    const box = { left: 100, top: 50, width: 200, height: 100 }
    // South-east grows, the origin stays.
    expect(resizeFromEdges(box, { s: true, e: true }, 30, 20)).toEqual({ left: 100, top: 50, width: 230, height: 120 })
    // West pulled left by 40 widens by 40 and moves left by 40; the east edge stays at 300.
    expect(resizeFromEdges(box, { w: true }, -40, 0)).toEqual({ left: 60, top: 50, width: 240, height: 100 })
    // North pulled down by 30 shrinks by 30; the south edge stays at 150.
    expect(resizeFromEdges(box, { n: true }, 0, 30)).toEqual({ left: 100, top: 80, width: 200, height: 70 })
    // Never below 1px, and the far edge still holds when it collapses.
    expect(resizeFromEdges(box, { w: true }, 500, 0)).toEqual({ left: 299, top: 50, width: 1, height: 100 })
  })

  it('clones subtrees with fresh IDs and a null-parent root', () => {
    const document = createWebDocument('Clone', 'clone')
    document.nodes.card = createWebElement('section', {
      id: 'card',
      order: 1_024,
      attributes: { class: 'card' },
      styles: { display: 'flex' },
    })
    document.nodes.title = createWebElement('h2', {
      id: 'title',
      parentId: 'card',
      order: 1_024,
    })
    document.nodes.text = createWebText('Hi', { id: 'text', parentId: 'title', order: 1_024 })
    document.roots = ['card']
    const source = assertWebDocument(document)

    const clones = cloneSubtreeFresh(source, 'card')
    expect(clones).toHaveLength(3)
    expect(clones.map((node) => node.id)).not.toContain('card')
    expect(clones[0]).toMatchObject({
      kind: 'element',
      tag: 'section',
      parentId: null,
      attributes: { class: 'card' },
      styles: { display: 'flex' },
    })
    const byId = new Map(clones.map((node) => [node.id, node]))
    for (const clone of clones.slice(1)) {
      expect(byId.has(clone.parentId as string)).toBe(true)
    }
    expect(() => cloneSubtreeFresh(source, 'missing')).toThrow('does not exist')
  })
})
