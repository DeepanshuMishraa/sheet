import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from '@tanstack/react-router'
import { cn } from '@sheet/ui/utils'
import { DocumentTabBar } from '@sheet/editor/tab-bar'
import { ChromeSlotsContext } from '@sheet/editor/chrome-slots'
import { AppSidebar, type AppSection } from './app-navigation'

const SIDEBAR_KEY = 'sheet:sidebar'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  } catch {
    return false
  }
}

/**
 * The sidebar switch, drawn so it shows the state it will leave you in: the
 * left pane is a filled strip that folds away when the sidebar is hidden.
 */
function SidebarGlyph({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" stroke="currentColor" strokeWidth="1.25" />
      <rect
        x="2.4"
        y="3.4"
        width="3.6"
        height="9.2"
       
        fill="var(--cx-accent)"
        className="origin-left transition-[transform,opacity] duration-200 ease-smooth motion-reduce:transition-none [transform-box:fill-box]"
        style={{ transform: `scaleX(${collapsed ? 0.15 : 1})`, opacity: collapsed ? 0 : 1 }}
      />
      <path d="M6.5 3v10" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

function activeSection(pathname: string): AppSection | null {
  if (pathname.startsWith('/design')) return null
  if (pathname.startsWith('/app/files')) return 'files'
  return 'recents'
}

/**
 * The frame every screen sits in: one bar for tabs and screen controls, a
 * sidebar, and a lifted panel inset from the window edge that holds the page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
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
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* One bar for the window, one hairline under it. The sidebar switch, the
          open files as tabs, and whatever the current screen puts at the far
          end all sit on it; the page below runs edge to edge with no inset card. */}
      <header
        data-tauri-drag-region
        data-cuelume-theme="mech"
        // No rule under the bar: it takes the colour of the panels below it
        // (white in the editor, the page colour elsewhere) so the two read as one.
        className={cn(
          'flex h-9 shrink-0 select-none items-stretch gap-1 ps-[78px] pe-3',
          isEditor ? 'bg-surface' : 'bg-background',
        )}
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
            className="cx-press my-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SidebarGlyph collapsed={collapsed} />
          </button>
        )}
        <DocumentTabBar />
        <div data-tauri-drag-region className="h-full min-w-4 flex-1" />
        <div ref={setTrailing} className="flex shrink-0 items-center gap-1.5" />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Sidebar"
          data-cuelume-theme="press"
          aria-hidden={sidebarHidden}
          inert={sidebarHidden}
          className={cn(
            'relative shrink-0 overflow-hidden border-line bg-frame text-foreground transition-[width,opacity,border-color] duration-300 ease-smooth motion-reduce:transition-none',
            sidebarHidden ? 'w-0 border-e-0 opacity-0' : 'w-60 border-e opacity-100',
          )}
        >
          {/* Fixed width inside, so the contents slide away instead of reflowing. */}
          <div className="h-full w-60">
            <AppSidebar active={activeSection(pathname)} />
          </div>
        </aside>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <div className={cn('min-h-0 flex-1', isEditor ? 'overflow-hidden' : 'overflow-y-auto')}>
            <ChromeSlotsContext.Provider value={slots}>{children}</ChromeSlotsContext.Provider>
          </div>
        </div>
      </div>

    </div>
  )
}

