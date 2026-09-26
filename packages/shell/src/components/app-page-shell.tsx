import { useState, type ReactNode } from 'react'
import { useLocation } from '@tanstack/react-router'
import { DocumentTabBar } from '@sheet/editor/tab-bar'
import {
  AppAccountMenu,
  AppNavigation,
  type AppSection,
} from './app-navigation'
import { AppSettingsDialog } from './settings-dialog'

function activeSection(pathname: string): AppSection {
  if (pathname.startsWith('/app/appearance')) return 'appearance'
  if (pathname.startsWith('/app/integrations')) return 'integrations'
  if (pathname.startsWith('/app/files')) return 'files'
  return 'recents'
}

/**
 * Persistent frame for every `/app` route with a custom desktop title bar and sidebar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const isLauncher = pathname.startsWith('/app/new')

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-foreground">
      <header
        data-tauri-drag-region
        className="flex h-10 w-full shrink-0 select-none items-center justify-between border-b border-line bg-surface pe-3 ps-20"
      >
        <DocumentTabBar />

        {/* Draggable header area */}
        <div data-tauri-drag-region className="h-full flex-1" />
      </header>

      {/* Main body: Sidebar + Content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!isLauncher && (
          <aside className="hidden w-60 shrink-0 flex-col border-e border-line bg-surface p-3 md:flex">
            <AppNavigation
              active={activeSection(pathname)}
              onSettings={() => setSettingsOpen(true)}
            />
          </aside>
        )}

        {!isLauncher && (
          <div className="fixed start-3 top-12 z-20 md:hidden">
            <AppAccountMenu compact onSettings={() => setSettingsOpen(true)} />
          </div>
        )}

        <div className="min-w-0 flex-1 overflow-y-auto bg-surface">
          {children}
        </div>
      </div>

      <AppSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

export function AppPageShell({
  title,
  description,
  children,
  wide = false,
}: {
  title: string
  description: string
  children: ReactNode
  /** Data-dense pages need more than the reading measure. */
  wide?: boolean
}) {
  return (
    <main className="app-page-enter flex min-w-0 flex-1 flex-col overflow-y-auto bg-surface">
      <header className="sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b border-line bg-surface pe-3 ps-12 md:px-4">
        <div className="min-w-0 py-2">
          <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </header>

      {/* Content sits flat on the canvas like the designs dashboard; the
          sections below bring their own surfaces where grouping helps. */}
      <section
        className={`mx-auto w-full p-4 md:p-6 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}
      >
        {children}
      </section>
    </main>
  )
}
