import {
  bind,
  play,
  setEnabled,
  setVolume,
  type Emphasis,
  type SoundName,
  type ThemeName,
} from 'cuelume'

export type SoundPreference = 'on' | 'off'

export const DEFAULT_SOUND: SoundPreference = 'on'

const KEY = 'sheet:sound'
const VOLUME_KEY = 'sheet:sound-volume'

/** Five steps of loudness. Full is the default: cuelume's cues are short and shaped, so even the top step is a click, not an alarm. */
export const VOLUME_LEVELS = [0.2, 0.4, 0.6, 0.8, 1] as const
export type VolumeLevel = (typeof VOLUME_LEVELS)[number]
export const DEFAULT_VOLUME: VolumeLevel = 1

export function getVolumePreference(): VolumeLevel {
  try {
    const stored = Number(globalThis.localStorage?.getItem(VOLUME_KEY))
    return VOLUME_LEVELS.find((level) => level === stored) ?? DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

export function setVolumePreference(level: VolumeLevel) {
  try {
    globalThis.localStorage?.setItem(VOLUME_KEY, String(level))
  } catch {
    // The level still applies for this session.
  }
  setVolume(level)
  // Let the person hear the level they just chose.
  play('tap', { emphasis: 'strong' })
}

function readStorage(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

function writeStorage(value: SoundPreference) {
  try {
    globalThis.localStorage?.setItem(KEY, value)
  } catch {
    // The preference still applies for this session.
  }
}

function parse(value: string | null): SoundPreference {
  return value === 'on' || value === 'off' ? value : DEFAULT_SOUND
}

export function getSoundPreference(): SoundPreference {
  return parse(readStorage())
}

export function setSoundPreference(next: SoundPreference) {
  writeStorage(next)
  setEnabled(next === 'on')
  // Confirm the switch with the sound it just turned on.
  if (next === 'on') play('toggle', { emphasis: 'strong' })
}

/** Anything the pointer can act on. */
const INTERACTIVE =
  "button, a[href], summary, select, input, textarea, [role='button'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='option'], [role='switch'], [role='checkbox'], [role='radio'], [role='treeitem']"

/** Elements that already carry a cuelume attribute: `bind()` plays those. */
const DECLARED =
  '[data-cuelume-tap], [data-cuelume-type], [data-cuelume-select], [data-cuelume-toggle], [data-cuelume-open], [data-cuelume-close], [data-cuelume-navigate]'

/** The design itself is silent: clicking and typing in a canvas is the work, not the chrome. */
const SILENT = '[data-sheet-node]'

const THEMES: readonly ThemeName[] = ['default', 'mech', 'bubble', 'press']

function themeFor(element: Element): ThemeName | undefined {
  const named = element.closest('[data-cuelume-theme]')?.getAttribute('data-cuelume-theme')
  return THEMES.find((theme) => theme === named)
}

function isDisabled(element: Element) {
  return (
    element.matches(':disabled') ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.getAttribute('data-disabled') !== null
  )
}

type Cue = { sound: SoundName; emphasis: Emphasis; direction?: 'forward' | 'back' }

/** What a pointer passing over this control sounds like. Each kind of control gets its own. */
function hoverCue(element: Element): Cue | null {
  if (element.matches('input[type="text"], input[type="search"], input:not([type]), textarea')) {
    return { sound: 'type', emphasis: 'subtle' }
  }
  if (element.matches("[role='tab'], a[href]")) return { sound: 'navigate', emphasis: 'subtle' }
  if (element.matches("[role='switch'], [role='checkbox'], [role='radio'], input")) {
    return { sound: 'toggle', emphasis: 'subtle', direction: 'back' }
  }
  if (element.matches("[role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='option'], [role='treeitem']")) {
    return { sound: 'select', emphasis: 'normal', direction: 'back' }
  }
  return { sound: 'select', emphasis: 'normal', direction: 'forward' }
}

/** What a press on a control that did not declare its own cue sounds like. */
function clickCue(element: Element): Cue {
  if (element.matches("[role='switch'], [role='checkbox'], input[type='checkbox']")) {
    return { sound: 'toggle', emphasis: 'strong' }
  }
  if (element.matches("[role='tab'], [role='radio'], [role='option'], select")) {
    return { sound: 'select', emphasis: 'strong' }
  }
  if (element.matches('a[href]')) return { sound: 'navigate', emphasis: 'strong' }
  if (element.matches('[aria-haspopup], [aria-expanded]')) return { sound: 'open', emphasis: 'strong' }
  return { sound: 'tap', emphasis: 'strong' }
}

function typingRole(event: KeyboardEvent) {
  if (event.key === 'Backspace' || event.key === 'Delete') return 'delete' as const
  if (event.key === 'Enter') return 'enter' as const
  if (event.key === ' ') return 'space' as const
  return event.key.length === 1 ? ('printable' as const) : null
}

/**
 * The cues cuelume's attributes cannot express: a sound as the pointer reaches
 * a control, and a sound for every control that never declared one. Delegated
 * on the document, so markup that mounts later is covered and no component has
 * to remember to opt in.
 */
function listenAmbient() {
  let hovered: Element | null = null
  let lastHoverAt = 0

  const onOver = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) return
    const control = event.target.closest(INTERACTIVE)
    if (!control || control === hovered) return
    hovered = control
    if (control.closest(SILENT) || isDisabled(control)) return
    const now = performance.now()
    // Sweeping across a toolbar should be a run of ticks, not a buzz.
    if (now - lastHoverAt < 45) return
    lastHoverAt = now
    const cue = hoverCue(control)
    if (cue) play(cue.sound, { ...cue, theme: themeFor(control) })
  }

  const onOut = (event: PointerEvent) => {
    if (hovered && !(event.relatedTarget instanceof Node && hovered.contains(event.relatedTarget))) {
      hovered = null
    }
  }

  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    const control = event.target.closest(INTERACTIVE)
    if (!control || control.closest(DECLARED) || control.closest(SILENT) || isDisabled(control)) return
    const cue = clickCue(control)
    // A switch reports its new state a tick after the click lands.
    if (cue.sound === 'toggle') {
      window.setTimeout(() => {
        const on = control.getAttribute('aria-checked') === 'true' || (control as HTMLInputElement).checked === true
        play('toggle', { ...cue, direction: on ? 'forward' : 'back', theme: themeFor(control) })
      }, 0)
      return
    }
    play(cue.sound, { ...cue, theme: themeFor(control) })
  }

  const onKey = (event: KeyboardEvent) => {
    if (!(event.target instanceof Element) || event.repeat) return
    if (!event.target.matches('input:not([type="checkbox"]):not([type="radio"]), textarea')) return
    if (event.target.closest(DECLARED) || event.target.closest(SILENT)) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const key = typingRole(event)
    if (key) play('type', { key, emphasis: 'normal', theme: themeFor(event.target) })
  }

  document.addEventListener('pointerover', onOver, true)
  document.addEventListener('pointerout', onOut, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
  return () => {
    document.removeEventListener('pointerover', onOver, true)
    document.removeEventListener('pointerout', onOut, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKey, true)
  }
}

/**
 * Wires every `data-cuelume-*` attribute in the document, adds the hover and
 * undeclared-click cues, and applies the stored preference. Returns the
 * cleanup for the listeners it added.
 */
export function initSound() {
  setVolume(getVolumePreference())
  setEnabled(getSoundPreference() === 'on')
  bind()
  const stopAmbient = listenAmbient()
  // Settings is its own window, so its choices reach this one through storage.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) setEnabled(getSoundPreference() === 'on')
    if (event.key === VOLUME_KEY) setVolume(getVolumePreference())
  }
  window.addEventListener('storage', onStorage)
  return () => {
    stopAmbient()
    window.removeEventListener('storage', onStorage)
  }
}

/** Outcome cues for work the app does rather than the user touches. */
export const Sound = {
  success: () => play('success', { emphasis: 'strong' }),
  error: () => play('error', { emphasis: 'strong' }),
  warning: () => play('warning', { emphasis: 'strong' }),
  loading: () => play('loading', { emphasis: 'normal' }),
  ready: () => play('ready', { emphasis: 'strong' }),
  attention: () => play('attention', { emphasis: 'strong' }),
  open: () => play('open', { emphasis: 'strong' }),
  close: () => play('close', { emphasis: 'strong' }),
  navigate: () => play('navigate', { emphasis: 'strong' }),
} as const
