import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  applyThemePreference,
  DEFAULT_THEME,
  getThemePreference,
  setThemePreference,
  syncThemePreference,
  THEME_INIT_SCRIPT,
} from './theme'

const STORAGE_KEY = 'sheet:theme'
const originalMatchMedia = window.matchMedia

function runInitScript() {
  Function('localStorage', 'document', THEME_INIT_SCRIPT)(
    window.localStorage,
    document,
  )
}

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  document.documentElement.classList.remove('dark')
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
})

describe('theme preferences', () => {
  test('uses dark mode when no preference has been stored', () => {
    expect(getThemePreference()).toBe('dark')

    applyThemePreference()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  test('stores and applies dark mode', () => {
    setThemePreference('dark')

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  test('stores and applies light mode', () => {
    document.documentElement.classList.add('dark')

    setThemePreference('light')

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('restores a dark preference before first paint', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark')

    runInitScript()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  test('restores light mode before first paint', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light')
    document.documentElement.classList.add('dark')

    runInitScript()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('treats a retired palette as the default, in the app and before paint', () => {
    window.localStorage.setItem(STORAGE_KEY, 'tokyo-night')

    expect(getThemePreference()).toBe(DEFAULT_THEME)

    runInitScript()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  test('tracks system appearance changes while system mode is selected', () => {
    let dark = true
    let listener: (() => void) | undefined
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        get matches() {
          return dark
        },
        addEventListener: (_event: string, next: () => void) => {
          listener = next
        },
        removeEventListener: () => {},
      }),
    })

    setThemePreference('system')
    const stop = syncThemePreference()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    dark = false
    listener?.()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    stop()
  })
})
