import { Link, useLocation } from '@tanstack/react-router'
import { File01Icon, LayoutGridIcon, PlusIcon, XIcon } from '@sheet/ui/icons'
import { cn } from '@sheet/ui/utils'
import { useOpenTabs } from '../lib/open-tabs'

export function DocumentTabBar({
  activeDocument,
}: {
  activeDocument?: { id: string; name: string }
}) {
  let pathname = ''
  try {
    pathname = typeof useLocation === 'function' ? (useLocation()?.pathname ?? '') : ''
  } catch {
    pathname = typeof window !== 'undefined' ? window.location.pathname : ''
  }
  const { tabs, closeTab } = useOpenTabs(activeDocument)

  const isDashboard = pathname === '/app' || pathname === '/app/'
  const isLauncher = pathname.startsWith('/app/new')

  return (
    <div data-tauri-drag-region className="flex items-center gap-1.5 overflow-hidden">
      {/* Dashboard Tab */}
      <Link
        to="/app"
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-normal transition-colors',
          isDashboard
            ? 'border border-line/60 bg-surface-2 text-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-surface-2/60 hover:text-foreground',
        )}
        aria-label="Back to dashboard"
      >
        <LayoutGridIcon className="size-3.5 text-muted-foreground" />
        <span>Dashboard</span>
      </Link>

      {/* Subtle vertical separator */}
      <div className="mx-1 h-3.5 w-px bg-line/80" />

      {/* Open Document Tabs */}
      <div className="flex items-center gap-1">
        {tabs.map((tab) => {
          const isActive = activeDocument?.id === tab.id
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-normal transition-colors',
                isActive
                  ? 'border border-line/60 bg-surface-2 text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-surface-2/60 hover:text-foreground',
              )}
            >
              <Link
                to="/design/$id"
                params={{ id: tab.id }}
                className="flex items-center gap-2 min-w-0"
              >
                <File01Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-44 truncate">{tab.name}</span>
              </Link>
              <button
                type="button"
                aria-label={`Close ${tab.name}`}
                title="Close tab"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Plus button to open new file launcher */}
      <Link
        to="/app/new"
        className={cn(
          'flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground',
          isLauncher && 'border border-line/60 bg-surface-2 text-foreground',
        )}
        aria-label="New tab"
        title="New tab"
      >
        <PlusIcon className="size-3.5" />
      </Link>
    </div>
  )
}
