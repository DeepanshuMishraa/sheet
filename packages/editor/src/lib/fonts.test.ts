import { describe, expect, test } from 'vitest'
import {
  createWebDocument,
  createWebElement,
} from '@sheet/canvas/web-model'
import { documentFonts, firstFamily } from './fonts'

describe('documentFonts', () => {
  test('counts inline font families, most used first', () => {
    const a = createWebElement('p', { styles: { 'font-family': '"Inter", sans-serif' } })
    const b = createWebElement('p', { styles: { 'font-family': '"Inter", sans-serif' } })
    const c = createWebElement('p', { styles: { 'font-family': 'Georgia, serif', color: 'red' } })
    const document = {
      ...createWebDocument('t'),
      nodes: { [a.id]: a, [b.id]: b, [c.id]: c },
    }
    expect(documentFonts(document)).toEqual([
      { stack: '"Inter", sans-serif', family: 'Inter', uses: 2 },
      { stack: 'Georgia, serif', family: 'Georgia', uses: 1 },
    ])
  })

  test('ignores var() and inherit, and empty documents', () => {
    const a = createWebElement('p', { styles: { 'font-family': 'var(--font-sans)' } })
    expect(documentFonts({ ...createWebDocument('t'), nodes: { [a.id]: a } })).toEqual([])
    expect(firstFamily("'Space Grotesk', sans-serif")).toBe('Space Grotesk')
  })
})
