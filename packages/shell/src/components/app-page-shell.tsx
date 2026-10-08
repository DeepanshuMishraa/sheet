import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from '@tanstack/react-router'
import {
  PanelLeftIcon,
} from '@sheet/ui/icons'
import { cn } from '@sheet/ui/utils'
import { DocumentTabBar } from '@sheet/editor/tab-bar'
import { ChromeSlotsContext } from '@sheet/editor/chrome-slots'
import { AppSidebar, type AppSection } from './app-navigation'
import { AppSettingsDialog } from './settings-dialog'

const SIDEBAR_KEY = 'sheet:sidebar'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  } catch {
    return false
  }
}

function activeSection(pathname: string): AppSection | null {
  if (pathname.startsWith('/design')) return null
  if (pathname.startsWith('/app/appearance')) return 'appearance'
  if (pathname.startsWith('/app/integrations')) return 'integrations'
  if (pathname.startsWith('/app/files')) return 'files'
  return 'recents'
}

/**
 * The frame every screen sits in: one bar for tabs and screen controls, a
 * sidebar, and a lifted panel inset from the window edge that holds the page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [leading, setLeading] = useState<HTMLElement | null>(null)
  const [trailing, setTrailing] = useState<HTMLElement | null>(null)
  const slots = useMemo(() => ({ leading, trailing }), [leading, trailing])

  const setSidebar = useCallback((next: boolean) => {
    setCollapsed(next)
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'open')
    } catch {
      // The sidebar still moves for this session.
    }
  }, [])

  const isEditor = pathname.startsWith('/design')
  const sidebarHidden = isEditor || collapsed

  return (
    <div className="flex h-full min-h-0 flex-col bg-frame text-foreground">
      {/* One bar for the window: controls, the sidebar switch, the open files as
          tabs, and whatever the current screen puts at the far end. */}
      <header
        data-tauri-drag-region
        className="flex h-11 shrink-0 select-none items-center gap-2 bg-frame ps-20 pe-3"
      >
        {isEditor ? (
          // The editor fills this with its own panel switch.
          <div ref={setLeading} className="flex shrink-0 items-center" />
        ) : (
          <button
            type="button"
            aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-pressed={!collapsed}
            title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            onClick={() => setSidebar(!collapsed)}
            data-cuelume-select=""
            data-cuelume-emphasis="subtle"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 ease-smooth hover:bg-accent hover:text-foreground active:scale-90"
          >
            <PanelLeftIcon className="size-4" />
          </button>
        )}
        <DocumentTabBar />
        <div data-tauri-drag-region className="h-full min-w-4 flex-1" />
        <div ref={setTrailing} className="flex shrink-0 items-center gap-1.5" />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Sidebar"
          aria-hidden={sidebarHidden}
          inert={sidebarHidden}
          className={cn(
            'relative shrink-0 overflow-hidden bg-frame text-foreground transition-[width,opacity] duration-300 ease-smooth motion-reduce:transition-none',
            sidebarHidden ? 'w-0 opacity-0' : 'w-60 opacity-100',
          )}
        >
          {/* Fixed width inside, so the contents slide away instead of reflowing. */}
          <div className="h-full w-60">
            <AppSidebar
              active={activeSection(pathname)}
              onSettings={() => setSettingsOpen(true)}
            />
          </div>
        </aside>

        <div className={cn('min-w-0 flex-1 pb-1.5 pe-1.5', sidebarHidden ? 'ps-1.5' : 'ps-0')}>
          <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-background shadow-panel">
            <div className={cn('min-h-0 flex-1', isEditor ? 'overflow-hidden' : 'overflow-y-auto')}>
              <ChromeSlotsContext.Provider value={slots}>{children}</ChromeSlotsContext.Provider>
            </div>
          </div>
        </div>
      </div>

      <AppSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

/** A page inside the shell: a quiet title, then the content in a reading column. */
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
    <main className="app-page-enter flex min-w-0 flex-1 flex-col">
      <section className={cn('mx-auto w-full px-6 pb-16 pt-6', wide ? 'max-w-6xl' : 'max-w-2xl')}>
        <h1 className="text-xl font-medium tracking-tight text-foreground">{title}</h1>
        <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>
        <div className="mt-8">{children}</div>
      </section>
    </main>
  )
}
