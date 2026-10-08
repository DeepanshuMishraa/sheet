import { bind, play, setEnabled, setVolume } from 'cuelume'

export type SoundPreference = 'on' | 'off'

export const DEFAULT_SOUND: SoundPreference = 'on'

const KEY = 'sheet:sound'
// Quiet by default: the cues are there to confirm, never to announce.
const VOLUME = 0.45

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
  if (next === 'on') play('toggle', { emphasis: 'subtle' })
}

/**
 * Wires every `data-cuelume-*` attribute in the document and applies the stored
 * preference. Listeners are delegated, so markup that mounts later is covered.
 */
export function initSound() {
  setVolume(VOLUME)
  setEnabled(getSoundPreference() === 'on')
  bind()
}

/** Outcome cues for work the app does rather than the user touches. */
export const Sound = {
  success: () => play('success', { emphasis: 'subtle' }),
  error: () => play('error', { emphasis: 'subtle' }),
  warning: () => play('warning', { emphasis: 'subtle' }),
  loading: () => play('loading', { emphasis: 'subtle' }),
  ready: () => play('ready', { emphasis: 'subtle' }),
  attention: () => play('attention'),
  open: () => play('open', { emphasis: 'subtle' }),
  close: () => play('close', { emphasis: 'subtle' }),
  navigate: () => play('navigate', { emphasis: 'subtle' }),
} as const
