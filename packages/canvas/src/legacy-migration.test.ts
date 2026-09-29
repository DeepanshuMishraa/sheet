import { describe, expect, it } from 'vitest'
import { parseLegacyStorage } from './legacy-migration'

describe('parseLegacyStorage', () => {
  it('converts v1 pages/shapes into stable safe nodes and preserves source as text', () => {
    const shapes = [{ id: 'hero', name: 'Hero', x: 12, y: 8, w: 640, h: 320, code: '<script>alert(1)</script>' }]
    const pages = [{ id: 'home', name: 'Home', x: 0, y: 0, w: 800, items: [{ id: 'hero-item', elementId: 'hero', height: 320 }] }]
    const migrated = parseLegacyStorage(shapes, pages, 'Site', 'site')
    const repeat = parseLegacyStorage(shapes, pages, 'Site', 'site')
    const source = Object.values(migrated.nodes).find((node) => node.type === 'text')

    expect(Object.keys(migrated.nodes)).toEqual(Object.keys(repeat.nodes))
    expect(source).toMatchObject({ type: 'text', text: '<script>alert(1)</script>' })
    expect(migrated.metadata.migrationWarnings).toContain('hero: legacy source was preserved as text and not executed')
  })

  it('rejects malformed stored rows instead of treating them as empty', () => {
    expect(() => parseLegacyStorage('[{"id":"x"}]', [], 'Site', 'site')).toThrow('missing id, name, or code')
    expect(() => parseLegacyStorage('not-json', [], 'Site', 'site')).toThrow('must be a JSON array')
  })
})
