import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { IconPickerDialog } from './icon-picker-dialog'

describe('IconPickerDialog', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('finishes loading the svgl catalog after its tab is selected', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify([
      {
        id: 1,
        title: 'Example logo',
        category: 'software',
        route: 'https://example.com/logo.svg',
        url: 'https://example.com',
      },
    ]), { status: 200 }))))

    const view = render(
      <IconPickerDialog open onOpenChange={() => {}} onInsert={() => {}} />,
    )

    fireEvent.click(view.getByRole('tab', { name: 'svgl' }))

    expect(await view.findByTitle('Example logo')).toBeTruthy()
  })
})
