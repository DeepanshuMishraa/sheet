import { toastManager } from '@sheet/ui/toast'

/**
 * App updates, asked of the desktop host over the same loopback bridge as every
 * other desktop call. The host holds the updater: it checks the release feed,
 * verifies the download against the key baked into the app, installs it, and
 * relaunches. Nothing here touches the network beyond `/desktop/*`.
 */

export type UpdateCheck =
  | { status: 'upToDate'; version: string }
  | { status: 'available'; version: string; currentVersion: string; notes: string | null }
  | { status: 'error'; message: string }

export type UpdateInstall = { status: 'installed' } | { status: 'error'; message: string }

const AUTO_KEY = 'sheet:auto-update'
const FIRST_CHECK_MS = 8_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1_000
const CHECK_TIMEOUT_MS = 20_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function errorMessage(body: unknown, fallback: string) {
  return isRecord(body) && typeof body.message === 'string' ? body.message : fallback
}

function parseCheck(body: unknown): UpdateCheck {
  if (isRecord(body) && body.status === 'upToDate' && typeof body.version === 'string') {
    return { status: 'upToDate', version: body.version }
  }
  if (
    isRecord(body) &&
    body.status === 'available' &&
    typeof body.version === 'string' &&
    typeof body.currentVersion === 'string'
  ) {
    return {
      status: 'available',
      version: body.version,
      currentVersion: body.currentVersion,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    }
  }
  return { status: 'error', message: errorMessage(body, 'Sheet could not read the update answer.') }
}

export async function getAppVersion(): Promise<string | null> {
  try {
    const body = await readJson(await fetch('/desktop/version'))
    return isRecord(body) && typeof body.version === 'string' ? body.version : null
  } catch {
    return null
  }
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const response = await fetch('/desktop/update/check', {
      method: 'POST',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    const body = await readJson(response)
    if (!response.ok) {
      return { status: 'error', message: errorMessage(body, 'Could not check for updates.') }
    }
    return parseCheck(body)
  } catch {
    return {
      status: 'error',
      message: 'Could not reach the update server. Check your connection and try again.',
    }
  }
}

export async function installUpdate(): Promise<UpdateInstall> {
  try {
    const response = await fetch('/desktop/update/install', { method: 'POST' })
    const body = await readJson(response)
    if (response.ok && isRecord(body) && body.status === 'installed') return { status: 'installed' }
    return { status: 'error', message: errorMessage(body, 'Could not install the update.') }
  } catch {
    return {
      status: 'error',
      message: 'Lost contact with Sheet while installing. Sheet is unchanged; try again.',
    }
  }
}

/** Downloads, installs and relaunches, telling the person what is happening at each step. */
export async function installWithToasts(version: string) {
  const id = toastManager.add({
    type: 'loading',
    title: `Downloading Sheet ${version}`,
    description: 'Sheet will restart when it is ready. Your designs are saved.',
    timeout: 0,
  })
  const result = await installUpdate()
  if (result.status === 'installed') {
    toastManager.update(id, {
      type: 'success',
      title: `Sheet ${version} installed`,
      description: 'Restarting now.',
      timeout: 0,
    })
    return
  }
  toastManager.update(id, {
    type: 'error',
    title: 'Update failed',
    description: result.message,
    timeout: 8_000,
  })
}

/** Offers an update that was found: one toast per version, with the install one click away. */
export function offerUpdate(update: Extract<UpdateCheck, { status: 'available' }>) {
  const id = toastManager.add({
    type: 'info',
    title: `Sheet ${update.version} is available`,
    description: `You have ${update.currentVersion}. Install it now and Sheet restarts.`,
    timeout: 0,
    actionProps: {
      children: 'Install and restart',
      onClick: () => {
        toastManager.close(id)
        void installWithToasts(update.version)
      },
    },
  })
}

export function getAutoUpdate(): boolean {
  try {
    return globalThis.localStorage?.getItem(AUTO_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setAutoUpdate(next: boolean) {
  try {
    globalThis.localStorage?.setItem(AUTO_KEY, next ? 'on' : 'off')
  } catch {
    // The choice still applies until the window closes.
  }
}

/**
 * Looks for an update shortly after launch and every few hours after, quietly:
 * a failed or empty check says nothing. Only the main window runs this, and it
 * offers each version once, so a person who dismissed it is not nagged.
 */
export function startAutoUpdate() {
  let offered: string | null = null
  const run = async () => {
    if (!getAutoUpdate()) return
    const result = await checkForUpdate()
    if (result.status !== 'available' || result.version === offered) return
    offered = result.version
    offerUpdate(result)
  }
  const first = window.setTimeout(() => void run(), FIRST_CHECK_MS)
  const every = window.setInterval(() => void run(), CHECK_EVERY_MS)
  return () => {
    window.clearTimeout(first)
    window.clearInterval(every)
  }
}
