import { Link, useLocation } from '@tanstack/react-router'
import { File01Icon, LayoutGridIcon, PlusIcon, XIcon } from '@sheet/ui/icons'
import { cn } from '@sheet/ui/utils'
import { useOpenTabs } from '../lib/open-tabs'

import { type ReactNode } from 'react'

function TabLink({
  to,
  params,
  className,
  children,
  'aria-label': ariaLabel,
  title,
  hasRouter,
}: {
  to: string
  params?: Record<string, string>
  className?: string
  children: ReactNode
  'aria-label'?: string
  title?: string
  hasRouter: boolean
}) {
  if (hasRouter) {
    return (
      <Link
        to={to as any}
        params={params as any}
        className={className}
        aria-label={ariaLabel}
        title={title}
      >
        {children}
      </Link>
    )
  }
  let href = to
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      href = href.replace(`$${key}`, value)
    }
  }
  return (
    <a href={href} className={className} aria-label={ariaLabel} title={title}>
      {children}
    </a>
  )
}

export function DocumentTabBar({
  activeDocument,
}: {
  activeDocument?: { id: string; name: string }
}) {
  let pathname = ''
  let hasRouter = false
  try {
    pathname = typeof useLocation === 'function' ? (useLocation()?.pathname ?? '') : ''
    hasRouter = true
  } catch {
    pathname = typeof window !== 'undefined' ? window.location.pathname : ''
    hasRouter = false
  }
  const { tabs, closeTab } = useOpenTabs(activeDocument)

  const isDashboard =
    pathname === '/app' ||
    pathname === '/app/' ||
    (pathname.startsWith('/app') && !pathname.startsWith('/app/new'))
  const isLauncher = pathname.startsWith('/app/new')

  return (
    <div data-tauri-drag-region className="flex min-w-0 items-center gap-1.5">
      {/* Dashboard Tab */}
      <TabLink
        to="/app"
        hasRouter={hasRouter}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-normal transition-all duration-150 ease-out active:scale-[0.985]',
          isDashboard
            ? 'border border-line/80 bg-surface font-medium text-foreground shadow-xs'
            : 'border border-transparent text-muted-foreground hover:bg-surface/60 hover:text-foreground',
        )}
        aria-label="Back to dashboard"
      >
        <LayoutGridIcon className="size-3.5 text-muted-foreground" />
        <span className="max-md:sr-only">Dashboard</span>
      </TabLink>

      {/* Subtle vertical separator */}
      <div className="mx-1 h-3.5 w-px shrink-0 bg-line" />

      {/* Open Document Tabs */}
      <div className="flex min-w-0 items-center gap-1">
        {tabs.map((tab) => {
          const isActive = activeDocument?.id === tab.id
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-normal transition-all duration-150 ease-out',
                isActive && 'shrink-0',
                isActive
                  ? 'border border-line/80 bg-surface font-medium text-foreground shadow-xs'
                  : 'border border-transparent text-muted-foreground hover:bg-surface/60 hover:text-foreground',
              )}
            >
              <TabLink
                to="/design/$id"
                params={{ id: tab.id }}
                hasRouter={hasRouter}
                className="flex min-w-0 items-center gap-1.5 transition-opacity active:opacity-70"
              >
                <File01Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-44 truncate max-md:max-w-24">{tab.name}</span>
              </TabLink>
              <button
                type="button"
                aria-label={`Close ${tab.name}`}
                title="Close tab"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Plus button to open new file launcher */}
      <TabLink
        to="/app/new"
        hasRouter={hasRouter}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-all duration-150 ease-out hover:bg-surface hover:text-foreground active:scale-95',
          isLauncher && 'border border-line/80 bg-surface text-foreground shadow-xs',
        )}
        aria-label="New tab"
        title="New tab"
      >
        <PlusIcon className="size-3.5" />
      </TabLink>
    </div>
  )
}
