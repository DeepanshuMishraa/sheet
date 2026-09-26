import { afterEach, describe, expect, test } from 'vitest'
import {
  applyUiFonts,
  DEFAULT_UI_MONO,
  DEFAULT_UI_SANS,
  getUiMonoFont,
  getUiSansFont,
  setUiMonoFont,
  setUiSansFont,
  UI_FONT_INIT_SCRIPT,
  UI_MONO_FONTS,
  UI_SANS_FONTS,
} from './ui-font'

const SANS_KEY = 'sheet:ui-sans'
const MONO_KEY = 'sheet:ui-mono'

function runInitScript() {
  Function('localStorage', 'document', UI_FONT_INIT_SCRIPT)(
    window.localStorage,
    document,
  )
}

afterEach(() => {
  window.localStorage.removeItem(SANS_KEY)
  window.localStorage.removeItem(MONO_KEY)
  document.documentElement.style.removeProperty('--sheet-font-sans')
  document.documentElement.style.removeProperty('--sheet-font-mono')
})

describe('ui font catalogues', () => {
  test('every offered font carries a non-empty stack', () => {
    for (const font of [...UI_SANS_FONTS, ...UI_MONO_FONTS]) {
      expect(font.stack.trim()).not.toBe('')
    }
  })

  test('the requested families are all offered', () => {
    const sans = UI_SANS_FONTS.map((font) => font.id)
    const mono = UI_MONO_FONTS.map((font) => font.id)
    expect(sans).toEqual(
      expect.arrayContaining(['inter', 'geist', 'archivo', 'space-grotesk']),
    )
    expect(mono).toEqual(
      expect.arrayContaining([
        'jetbrains-mono',
        'paper-mono',
        'space-mono',
        'spline-sans-mono',
        'geist-mono',
      ]),
    )
  })
})

describe('getUiSansFont / getUiMonoFont', () => {
  test('default when nothing is stored', () => {
    expect(getUiSansFont()).toBe(DEFAULT_UI_SANS)
    expect(getUiMonoFont()).toBe(DEFAULT_UI_MONO)
  })

  test('reads a stored pick and falls back for junk', () => {
    window.localStorage.setItem(SANS_KEY, 'geist')
    window.localStorage.setItem(MONO_KEY, 'jetbrains-mono')
    expect(getUiSansFont()).toBe('geist')
    expect(getUiMonoFont()).toBe('jetbrains-mono')

    window.localStorage.setItem(SANS_KEY, 'comic-sans')
    window.localStorage.setItem(MONO_KEY, 'comic-mono')
    expect(getUiSansFont()).toBe(DEFAULT_UI_SANS)
    expect(getUiMonoFont()).toBe(DEFAULT_UI_MONO)
  })

  test('the interface face accepts a mono pick for a full-mono chrome', () => {
    window.localStorage.setItem(SANS_KEY, 'paper-mono')
    expect(getUiSansFont()).toBe('paper-mono')
  })
})

describe('applyUiFonts', () => {
  test('sets the root font properties for a non-default pick', () => {
    applyUiFonts('geist', 'jetbrains-mono')
    expect(document.documentElement.style.getPropertyValue('--sheet-font-sans')).toContain(
      'Geist',
    )
    expect(document.documentElement.style.getPropertyValue('--sheet-font-mono')).toContain(
      'JetBrains Mono',
    )
  })

  test('leaves the root alone at the defaults so the stylesheet wins', () => {
    applyUiFonts('geist', 'jetbrains-mono')
    applyUiFonts(DEFAULT_UI_SANS, DEFAULT_UI_MONO)
    expect(document.documentElement.style.getPropertyValue('--sheet-font-sans')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--sheet-font-mono')).toBe('')
  })

  test('applies a mono pick as the interface face', () => {
    applyUiFonts('paper-mono', DEFAULT_UI_MONO)
    expect(document.documentElement.style.getPropertyValue('--sheet-font-sans')).toContain(
      'Paper Mono',
    )
  })
})

describe('setUiSansFont / setUiMonoFont', () => {
  test('persists and applies in one step', () => {
    setUiSansFont('manrope')
    expect(window.localStorage.getItem(SANS_KEY)).toBe('manrope')
    expect(document.documentElement.style.getPropertyValue('--sheet-font-sans')).toContain(
      'Manrope',
    )
    expect(getUiSansFont()).toBe('manrope')

    setUiMonoFont('fira-code')
    expect(window.localStorage.getItem(MONO_KEY)).toBe('fira-code')
    expect(document.documentElement.style.getPropertyValue('--sheet-font-mono')).toContain(
      'Fira Code',
    )
    expect(getUiMonoFont()).toBe('fira-code')
  })
})

describe('UI_FONT_INIT_SCRIPT', () => {
  test('applies stored picks before paint', () => {
    window.localStorage.setItem(SANS_KEY, 'geist')
    window.localStorage.setItem(MONO_KEY, 'jetbrains-mono')
    runInitScript()
    expect(document.documentElement.style.getPropertyValue('--sheet-font-sans')).toContain(
      'Geist',
    )
    expect(document.documentElement.style.getPropertyValue('--sheet-font-mono')).toContain(
      'JetBrains Mono',
    )
  })

  test('does nothing for the defaults or for junk', () => {
    runInitScript()
    expect(document.documentElement.style.getPropertyValue('--sheet-font-sans')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--sheet-font-mono')).toBe('')

    window.localStorage.setItem(SANS_KEY, 'comic-sans')
    window.localStorage.setItem(MONO_KEY, 'comic-mono')
    runInitScript()
    expect(document.documentElement.style.getPropertyValue('--sheet-font-sans')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--sheet-font-mono')).toBe('')
  })
})
