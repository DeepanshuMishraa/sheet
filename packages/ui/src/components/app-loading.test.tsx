import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { AppLoading } from './app-loading.tsx'

describe('AppLoading', () => {
  test('renders the loader grid with a loading role', () => {
    const { container } = render(<AppLoading />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(
      container.querySelectorAll('.cx-loader-cell').length,
    ).toBe(9)
  })

  test('shows the caption when a label is given', () => {
    render(<AppLoading label="Loading canvas" />)
    expect(screen.getByRole('status', { name: 'Loading canvas' })).toBeTruthy()
    expect(screen.getByText('Loading canvas')).toBeTruthy()
  })
})
