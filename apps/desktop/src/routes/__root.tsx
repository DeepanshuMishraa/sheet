import { Outlet, createRootRoute } from '@tanstack/react-router'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import { useEffect } from 'react'
import { syncThemePreference } from '@sheet/shell/lib/theme'
import { syncUiScale } from '@sheet/shell/lib/ui-scale'
import { syncUiFonts } from '@sheet/shell/lib/ui-font'
import { useCaptureResponder } from '@sheet/editor/lib/capture-client'

export const Route = createRootRoute({ component: RootLayout })

/**
 * The window's own chrome, which is none of it: the platform draws the title
 * bar, and everything below it is the shared interface.
 * Theme and interface scale are restored before first paint by the two scripts
 * the build injects, and kept in step here for as long as the window lives.
 * The static boot splash in `index.html` comes off once React has mounted —
 * the route content paints in the same commit, so there is no blank frame.
 */
function RootLayout() {
  useEffect(() => syncThemePreference(), [])
  useEffect(() => syncUiScale(), [])
  useEffect(() => syncUiFonts(), [])
  useCaptureResponder()
  useEffect(() => {
    document.getElementById('boot-splash')?.remove()
  }, [])

  return (
    <NuqsAdapter>
      <div className="flex h-dvh flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </NuqsAdapter>
  )
}
