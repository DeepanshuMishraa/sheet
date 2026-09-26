export type UiSansFontId =
  | 'system'
  | 'inter'
  | 'geist'
  | 'archivo'
  | 'space-grotesk'
  | 'dm-sans'
  | 'manrope'
  | 'outfit'
  | 'ibm-plex-sans'

export type UiMonoFontId =
  | 'system-mono'
  | 'spline-sans-mono'
  | 'geist-mono'
  | 'jetbrains-mono'
  | 'paper-mono'
  | 'space-mono'
  | 'ibm-plex-mono'
  | 'fira-code'
  | 'roboto-mono'

export type UiFontMeta = {
  id: UiSansFontId | UiMonoFontId
  label: string
  /** Value written to `--sheet-font-sans` / `--sheet-font-mono`. */
  stack: string
  /** Short blurb for the picker (designer, character). */
  hint: string
}

const SANS_FALLBACK = 'ui-sans-serif, system-ui, sans-serif'
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** Interface (sans) typefaces for the app chrome. */
export const UI_SANS_FONTS: UiFontMeta[] = [
  {
    id: 'system',
    label: 'System',
    stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', ${SANS_FALLBACK}`,
    hint: 'Native platform text',
  },
  {
    id: 'inter',
    label: 'Inter',
    stack: `'Inter', ${SANS_FALLBACK}`,
    hint: 'Neutral grotesque',
  },
  {
    id: 'geist',
    label: 'Geist',
    stack: `'Geist', 'Inter', ${SANS_FALLBACK}`,
    hint: 'Vercel grotesque',
  },
  {
    id: 'archivo',
    label: 'Archivo',
    stack: `'Archivo', 'Inter', ${SANS_FALLBACK}`,
    hint: 'Expanded grotesque',
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    stack: `'Space Grotesk', 'Inter', ${SANS_FALLBACK}`,
    hint: 'Quirky display sans',
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    stack: `'DM Sans', 'Inter', ${SANS_FALLBACK}`,
    hint: 'Geometric humanist',
  },
  {
    id: 'manrope',
    label: 'Manrope',
    stack: `'Manrope', 'Inter', ${SANS_FALLBACK}`,
    hint: 'Rounded geometric',
  },
  {
    id: 'outfit',
    label: 'Outfit',
    stack: `'Outfit', 'Inter', ${SANS_FALLBACK}`,
    hint: 'Tall display sans',
  },
  {
    id: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    stack: `'IBM Plex Sans', 'Inter', ${SANS_FALLBACK}`,
    hint: 'Engineered grotesque',
  },
]

/** Monospace typefaces for code, shortcuts, and numeric chrome. */
export const UI_MONO_FONTS: UiFontMeta[] = [
  {
    id: 'system-mono',
    label: 'System Mono',
    stack: `${MONO_FALLBACK}`,
    hint: 'Native platform mono',
  },
  {
    id: 'spline-sans-mono',
    label: 'Spline Sans Mono',
    stack: `'Spline Sans Mono', ${MONO_FALLBACK}`,
    hint: 'Warm technical mono',
  },
  {
    id: 'geist-mono',
    label: 'Geist Mono',
    stack: `'Geist Mono', ${MONO_FALLBACK}`,
    hint: 'Vercel terminal mono',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    stack: `'JetBrains Mono', ${MONO_FALLBACK}`,
    hint: 'Developer mono',
  },
  {
    id: 'paper-mono',
    label: 'Paper Mono',
    stack: `'Paper Mono', ${MONO_FALLBACK}`,
    hint: 'Paper design mono',
  },
  {
    id: 'space-mono',
    label: 'Space Mono',
    stack: `'Space Mono', ${MONO_FALLBACK}`,
    hint: 'Typewriter mono',
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    stack: `'IBM Plex Mono', ${MONO_FALLBACK}`,
    hint: 'Engineered mono',
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    stack: `'Fira Code', ${MONO_FALLBACK}`,
    hint: 'Ligatured code mono',
  },
  {
    id: 'roboto-mono',
    label: 'Roboto Mono',
    stack: `'Roboto Mono', ${MONO_FALLBACK}`,
    hint: 'Mechanical mono',
  },
]

export const DEFAULT_UI_SANS: UiSansFontId = 'inter'
export const DEFAULT_UI_MONO: UiMonoFontId = 'spline-sans-mono'

const SANS_KEY = 'sheet:ui-sans'
const MONO_KEY = 'sheet:ui-mono'

const SANS_VAR = '--sheet-font-sans'
const MONO_VAR = '--sheet-font-mono'

const SANS_BY_ID = new Map(UI_SANS_FONTS.map((font) => [font.id, font]))
const MONO_BY_ID = new Map(UI_MONO_FONTS.map((font) => [font.id, font]))

/**
 * Anything the Interface dropdown can pick: every sans, plus every mono for
 * a full-mono chrome. The Monospace dropdown (code, shortcuts, numerics)
 * stays mono-only.
 */
export type UiInterfaceFontId = UiSansFontId | UiMonoFontId

const INTERFACE_BY_ID = new Map<UiInterfaceFontId, UiFontMeta>(
  [...UI_SANS_FONTS, ...UI_MONO_FONTS].map((font) => [font.id, font]),
)

export function uiInterfaceFontMeta(id: UiInterfaceFontId): UiFontMeta {
  return INTERFACE_BY_ID.get(id) ?? SANS_BY_ID.get(DEFAULT_UI_SANS)!
}

function isUiInterfaceFontId(value: string | null): value is UiInterfaceFontId {
  return value !== null && INTERFACE_BY_ID.has(value as UiInterfaceFontId)
}

function isUiMonoFontId(value: string | null): value is UiMonoFontId {
  return value !== null && MONO_BY_ID.has(value as UiMonoFontId)
}

function readStorage(key: string): string | null {
  try {
    const storage = globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    return storage?.getItem(key) ?? null
  } catch {
    // Storage can be unavailable in private browsing or blocked contexts.
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    const storage = globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    storage?.setItem(key, value)
  } catch {
    // Applying the font still works when persistence is unavailable.
  }
}

export function getUiSansFont(): UiInterfaceFontId {
  const stored = readStorage(SANS_KEY)
  return isUiInterfaceFontId(stored) ? stored : DEFAULT_UI_SANS
}

export function getUiMonoFont(): UiMonoFontId {
  const stored = readStorage(MONO_KEY)
  return isUiMonoFontId(stored) ? stored : DEFAULT_UI_MONO
}

export function uiSansStack(id: UiInterfaceFontId): string {
  return (
    INTERFACE_BY_ID.get(id)?.stack ?? SANS_BY_ID.get(DEFAULT_UI_SANS)!.stack
  )
}

export function uiMonoStack(id: UiMonoFontId): string {
  return MONO_BY_ID.get(id)?.stack ?? MONO_BY_ID.get(DEFAULT_UI_MONO)!.stack
}

export function applyUiFonts(
  sans: UiInterfaceFontId = getUiSansFont(),
  mono: UiMonoFontId = getUiMonoFont(),
) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // Defaults stay unset so the stylesheet's own stacks win and a stored
  // choice never leaves a stale inline property behind.
  if (sans === DEFAULT_UI_SANS) root.style.removeProperty(SANS_VAR)
  else root.style.setProperty(SANS_VAR, uiSansStack(sans))
  if (mono === DEFAULT_UI_MONO) root.style.removeProperty(MONO_VAR)
  else root.style.setProperty(MONO_VAR, uiMonoStack(mono))
}

export function setUiSansFont(id: UiInterfaceFontId) {
  writeStorage(SANS_KEY, id)
  applyUiFonts(id, getUiMonoFont())
}

export function setUiMonoFont(id: UiMonoFontId) {
  writeStorage(MONO_KEY, id)
  applyUiFonts(getUiSansFont(), id)
}

/** Applies the stored fonts and keeps other tabs of the app in step. */
export function syncUiFonts() {
  applyUiFonts()
  if (typeof window === 'undefined') return () => {}
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SANS_KEY || event.key === MONO_KEY) applyUiFonts()
  }
  window.addEventListener('storage', handleStorage)
  return () => window.removeEventListener('storage', handleStorage)
}

// Runs before first paint so a stored font cannot flash at the default face.
// Unknown ids fall back to the stylesheet defaults by leaving the vars unset.
export const UI_FONT_INIT_SCRIPT = `(()=>{try{var S=${JSON.stringify(SANS_KEY)};var M=${JSON.stringify(MONO_KEY)};var V=${JSON.stringify(SANS_VAR)};var W=${JSON.stringify(MONO_VAR)};var D=${JSON.stringify(DEFAULT_UI_SANS)};var E=${JSON.stringify(DEFAULT_UI_MONO)};var F=${JSON.stringify(Object.fromEntries([...UI_SANS_FONTS, ...UI_MONO_FONTS].map((font) => [font.id, font.stack])))};var G=${JSON.stringify(Object.fromEntries(UI_MONO_FONTS.map((font) => [font.id, font.stack])))};var r=document.documentElement;var s=null;var m=null;try{s=localStorage.getItem(S)}catch(e){}try{m=localStorage.getItem(M)}catch(e){}if(s&&s!==D&&F[s])r.style.setProperty(V,F[s]);if(m&&m!==E&&G[m])r.style.setProperty(W,G[m])}catch(e){}})()`
