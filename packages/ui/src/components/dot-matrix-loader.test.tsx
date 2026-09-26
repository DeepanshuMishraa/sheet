import { afterEach, describe, expect, test } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DotMatrixLoader } from './dot-matrix-loader.tsx'

afterEach(() => {
  cleanup()
})

describe('DotMatrixLoader', () => {
  test('renders with default 3x3 grid (9 dots) and accessible role', () => {
    const { container } = render(<DotMatrixLoader data-testid="loader" />)
    const svg = screen.getByRole('status')
    expect(svg).toBeDefined()
    expect(svg.getAttribute('aria-label')).toBe('Loading')
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')

    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBe(9)
  })

  test('renders custom rows and columns', () => {
    const { container } = render(<DotMatrixLoader rows={4} columns={5} />)
    const svg = screen.getByRole('status')
    expect(svg.getAttribute('viewBox')).toBe('0 0 40 32')

    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBe(20)
  })

  test('supports square dotShape', () => {
    const { container } = render(<DotMatrixLoader dotShape="square" rows={2} columns={3} />)
    const rects = container.querySelectorAll('rect')
    expect(rects.length).toBe(6)
  })

  test('supports different animation variants', () => {
    const variants = ['wave', 'pulse', 'scan', 'blink'] as const
    for (const variant of variants) {
      const { container } = render(<DotMatrixLoader variant={variant} />)
      expect(container.querySelectorAll('.sheet-dot-matrix-dot').length).toBe(9)
      cleanup()
    }
  })

  test('passes custom className and style', () => {
    render(<DotMatrixLoader className="size-6 text-primary" style={{ margin: 10 }} />)
    const svg = screen.getByRole('status')
    expect(svg.classList.contains('size-6')).toBe(true)
    expect(svg.classList.contains('text-primary')).toBe(true)
  })
})
