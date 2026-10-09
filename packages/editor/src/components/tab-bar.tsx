import { Link, useLocation } from '@tanstack/react-router'
import { File01Icon, LayoutGridIcon, PlusIcon, XIcon } from '@sheet/ui/icons'
import { cn } from '@sheet/ui/utils'
import { useOpenTabs } from '../lib/open-tabs'

import { type ReactNode } from 'react'

/**
 * A tab is a square cell on the bar, divided from its neighbours by a
 * hairline. The open one takes the page's own background and covers the bar's
 * bottom rule, so it reads as the top of the page it opens; an accent bar
 * sweeps across its head from the left when it is chosen.
 */
const tabClassName = (active: boolean) =>
  cn(
    "relative flex h-full shrink-0 items-center gap-2 border-e border-line px-3.5 text-xs outline-none transition-colors duration-150 ease-smooth before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:origin-left before:bg-cx-accent before:transition-transform before:duration-200 before:ease-smooth before:content-[''] after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-background after:transition-opacity after:duration-150 after:content-[''] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:before:transition-none",
    active
      ? 'bg-background text-foreground before:scale-x-100 after:opacity-100'
      : 'text-muted-foreground before:scale-x-0 after:opacity-0 hover:bg-accent/60 hover:text-foreground',
  )

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
        data-cuelume-navigate=""
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
    <a href={href} data-cuelume-navigate="" className={className} aria-label={ariaLabel} title={title}>
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
  const activeId = activeDocument?.id ?? pathname.match(/^\/design\/([^/]+)/)?.[1]

  const isDashboard =
    pathname === '/app' ||
    pathname === '/app/' ||
    (pathname.startsWith('/app') && !pathname.startsWith('/app/new'))
  const isLauncher = pathname.startsWith('/app/new')

  return (
    <div data-tauri-drag-region className="flex h-full min-w-0 items-stretch border-s border-line">
      <TabLink
        to="/app"
        hasRouter={hasRouter}
        className={tabClassName(isDashboard)}
        aria-label="Back to dashboard"
      >
        <LayoutGridIcon className="size-3.5" />
        <span className="max-md:sr-only">Dashboard</span>
      </TabLink>

      <div className="flex min-w-0 items-stretch">
        {tabs.map((tab) => {
          const isActive = activeId === tab.id
          return (
            <div
              key={tab.id}
              className={cn(
                'group/tab relative flex h-full min-w-0 items-center',
                isActive && 'shrink-0',
              )}
            >
              <TabLink
                to="/design/$id"
                params={{ id: tab.id }}
                hasRouter={hasRouter}
                className={cn(tabClassName(isActive), 'min-w-0 pe-8')}
              >
                <File01Icon className="size-3.5 shrink-0" />
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
                className={cn(
                  'cx-press absolute end-1.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground outline-none transition-[opacity,color,background-color] duration-150 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
                )}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          )
        })}
      </div>

      <TabLink
        to="/app/new"
        hasRouter={hasRouter}
        className={cn(tabClassName(isLauncher), 'px-3')}
        aria-label="New tab"
        title="New tab"
      >
        <PlusIcon className="size-3.5" />
      </TabLink>
    </div>
  )
}
