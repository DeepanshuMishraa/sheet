const STORAGE_KEY = 'sheet-site:theme'

export type Theme = 'light' | 'dark'

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/** Saves an explicit pick; until then the page follows the system. */
export function chooseTheme(theme: Theme) {
  applyTheme(theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Private mode: the pick lasts for this visit only.
  }
}

/** Follows OS theme changes while the visitor has not picked one. */
export function followSystem(onChange: (theme: Theme) => void) {
  const query = matchMedia('(prefers-color-scheme: dark)')
  const listener = () => {
    if (readStored()) return
    const theme = systemTheme()
    applyTheme(theme)
    onChange(theme)
  }
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
