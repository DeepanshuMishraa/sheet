import { describe, expect, test } from 'vitest'
import { iconSuggestions, resolveIcon, searchIcons } from './icon-library'

describe('icon library', () => {
  test.each([
    ['lucide', 'calendar'],
    ['hugeicons', 'calendar'],
  ] as const)('resolves %s icons into colored vector paths', (library, name) => {
    const icon = resolveIcon(library, name, '#ffffff')

    expect(icon?.viewBox).toBe('0 0 24 24')
    expect(icon?.paths.length).toBeGreaterThan(0)
    expect(
      icon?.paths.every(
        (path) => path.fill === '#ffffff' || path.stroke === '#ffffff',
      ),
    ).toBe(true)
  })

  test('searches catalogs and suggests close names instead of guessing', () => {
    expect(searchIcons('calendar-clock', 'lucide', 5)).toContainEqual({
      library: 'lucide',
      name: 'CalendarClock',
    })
    expect(resolveIcon('lucide', 'calendar-clock-nope', '#000000')).toBeNull()
    expect(iconSuggestions('lucide', 'calendar-clock')).toContain('CalendarClock')
  })
})
