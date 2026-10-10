/**
 * Settings is a window of its own, owned by the desktop host. The interface
 * asks for it over the same loopback bridge as every other desktop call; the
 * host opens it, or raises the one that is already open.
 */
export function openSettingsWindow() {
  void fetch('/desktop/settings', { method: 'POST' }).catch(() => undefined)
}
