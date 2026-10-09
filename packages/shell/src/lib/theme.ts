const STORAGE_KEY = 'sheet:theme'
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

/** The two palettes. There are no others. */
export type ThemeId = 'light' | 'dark'

/** What the user picked. `system` resolves to `light` or `dark` at apply time. */
export type ThemePreference = ThemeId | 'system'

/** Drives the window chrome colour; matches each palette's `--background`. */
const THEME_COLOR: Record<ThemeId, string> = {
  light: '#fafaf9',
  dark: '#212121',
}

/** The kit is dark-native, so that is what an account without a choice gets. */
export const DEFAULT_THEME: ThemePreference = 'dark'

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function getThemePreference(): ThemePreference {
  try {
    const storage =
      globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    const stored = storage?.getItem(STORAGE_KEY) ?? null
    // A palette retired in an earlier version lands here and gets the default.
    return isThemePreference(stored) ? stored : DEFAULT_THEME
  } catch {
    // Storage can be unavailable in private browsing or blocked contexts.
    return DEFAULT_THEME
  }
}

function systemPrefersDark() {
  return globalThis.window?.matchMedia?.(SYSTEM_DARK_QUERY).matches === true
}

/** The palette a preference resolves to right now. */
export function resolveTheme(preference: ThemePreference): ThemeId {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return preference
}

export function applyThemePreference(
  preference: ThemePreference = getThemePreference(),
) {
  if (typeof document === 'undefined') return
  const theme = resolveTheme(preference)
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme])
  if (root.getAttribute('class') === '') root.removeAttribute('class')
}

export function setThemePreference(preference: ThemePreference) {
  try {
    const storage =
      globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    storage?.setItem(STORAGE_KEY, preference)
  } catch {
    // Applying the theme still works when persistence is unavailable.
  }
  applyThemePreference(preference)
}

export function syncThemePreference() {
  applyThemePreference()
  if (typeof window === 'undefined') return () => {}

  const media = window.matchMedia?.(SYSTEM_DARK_QUERY)
  const handleSystemChange = () => {
    if (getThemePreference() === 'system') applyThemePreference('system')
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) applyThemePreference()
  }

  media?.addEventListener('change', handleSystemChange)
  window.addEventListener('storage', handleStorage)

  return () => {
    media?.removeEventListener('change', handleSystemChange)
    window.removeEventListener('storage', handleStorage)
  }
}

/**
 * Runs before first paint so a stored or system preference cannot flash.
 * Anything it does not recognise is the default.
 */
export const THEME_INIT_SCRIPT = `(()=>{let t='${DEFAULT_THEME}';try{const s=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(s==='light'||s==='dark'||s==='system')t=s}catch(e){}const w=document.defaultView;const m=w&&w.matchMedia;if(t==='system')t=(m&&m.call(w,'${SYSTEM_DARK_QUERY}').matches)?'dark':'light';const r=document.documentElement;r.classList.toggle('dark',t==='dark');const c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute('content',t==='dark'?'${THEME_COLOR.dark}':'${THEME_COLOR.light}');if(r.getAttribute('class')==='')r.removeAttribute('class')})()`
