import { describe, expect, it } from 'vitest'
import { allows, canEdit, resolveDesignAccess } from './design-access'

describe('design access roles', () => {
  it('grants the local owner everything', () => {
    expect(allows('owner', 'owner')).toBe(true)
    expect(allows('owner', 'view')).toBe(true)
    expect(canEdit('owner')).toBe(true)
  })

  it('resolves nothing for an unknown design', async () => {
    await expect(
      resolveDesignAccess('missing', { id: 'local', email: 'local@sheet.design' }),
    ).resolves.toBeNull()
  })
})
