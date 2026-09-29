import { describe, expect, test } from 'vitest'
import { createWebDocument } from '@sheet/canvas/web-model'
import { exportWebDocument } from './design-export'

describe('exportWebDocument', () => {
  const document = createWebDocument('Denta AI — Landing', 'design-1')

  test('html is a complete page without editor identity attributes', async () => {
    const file = await exportWebDocument('local', document, { format: 'html' })
    expect(file).toMatchObject({ filename: 'denta-ai-landing.html', mimeType: 'text/html', encoding: 'utf8' })
    expect(file.data).toContain('<!doctype html>')
    expect(file.data).toContain('<style>')
    expect(file.data).not.toContain('data-sheet-')
  })

  test('json round-trips the authored document', async () => {
    const file = await exportWebDocument('local', document, { format: 'json' })
    expect(JSON.parse(file.data).name).toBe('Denta AI — Landing')
  })
})
