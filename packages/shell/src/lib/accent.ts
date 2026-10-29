const STORAGE_KEY = 'sheet:accent'

/**
 * The accent hues on offer. Mono, black and white only, is the default and
 * comes first (the pre-paint script below relies on that). `darkInk` is what
 * reads on the dark-mode fill: white everywhere but Mono, whose fill is paper.
 */
export const ACCENTS = [
  { id: 'mono', label: 'Mono', light: '#0d0d0d', dark: '#ececea', darkInk: '#0d0d0d' },
  { id: 'orange', label: 'Orange', light: '#f0541a', dark: '#ff6a2b', darkInk: '#ffffff' },
  { id: 'blue', label: 'Blue', light: '#2563eb', dark: '#4d8dff', darkInk: '#ffffff' },
  { id: 'violet', label: 'Violet', light: '#7c3aed', dark: '#9a77ff', darkInk: '#ffffff' },
  { id: 'green', label: 'Green', light: '#0f9d58', dark: '#1fb86b', darkInk: '#ffffff' },
  { id: 'pink', label: 'Pink', light: '#db2777', dark: '#f0549b', darkInk: '#ffffff' },
  { id: 'teal', label: 'Teal', light: '#0d8f86', dark: '#14a89d', darkInk: '#ffffff' },
] as const

export type AccentId = (typeof ACCENTS)[number]['id']

export const DEFAULT_ACCENT: AccentId = 'mono'

export function isAccentId(value: unknown): value is AccentId {
  return ACCENTS.some((accent) => accent.id === value)
}

export function getAccent(): AccentId {
  try {
    const storage = globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    const stored = storage?.getItem(STORAGE_KEY) ?? null
    return isAccentId(stored) ? stored : DEFAULT_ACCENT
  } catch {
    // Storage can be unavailable in private browsing or blocked contexts.
    return DEFAULT_ACCENT
  }
}

export function applyAccent(accent: AccentId = getAccent()) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // The default stays unset: the stylesheet's own value is Mono.
  if (accent === DEFAULT_ACCENT) root.removeAttribute('data-accent')
  else root.setAttribute('data-accent', accent)
}

export function setAccent(accent: AccentId) {
  try {
    const storage = globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    storage?.setItem(STORAGE_KEY, accent)
  } catch {
    // Applying the accent still works when persistence is unavailable.
  }
  applyAccent(accent)
}

/** Applies the stored accent and keeps the app's other windows in step with it. */
export function syncAccent() {
  applyAccent()
  if (typeof window === 'undefined') return () => {}
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) applyAccent()
  }
  window.addEventListener('storage', handleStorage)
  return () => window.removeEventListener('storage', handleStorage)
}

/** Runs before first paint so a stored accent cannot flash Mono first. */
export const ACCENT_INIT_SCRIPT = `(()=>{try{const a=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(${JSON.stringify(ACCENTS.map((accent) => accent.id))}.indexOf(a)>0)document.documentElement.setAttribute('data-accent',a)}catch(e){}})()`
