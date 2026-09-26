import { configureRuntime } from '@loora/platform'

/**
 * Imported before anything else, so the runtime is configured before
 * anything renders.
 *
 * The API origin stays empty: this window is served by the host process, and
 * the host is what forwards `/api/*` on to the local server. Only what leaves
 * the app has to name somewhere else — a hand-off URL opened in a browser.
 */
configureRuntime({
  platform: 'desktop',
  appOrigin: import.meta.env.VITE_LOORA_APP_ORIGIN ?? 'http://127.0.0.1:4100',
  // A window that followed an outside link would stop being Loora. The host
  // opens it in a browser instead, and the window stays where it was.
  openExternal: (url) => {
    void fetch('/desktop/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  },
})
