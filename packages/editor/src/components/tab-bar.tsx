import { Link, useLocation } from '@tanstack/react-router'
import { File01Icon, LayoutGridIcon, PlusIcon, XIcon } from '@sheet/ui/icons'
import { cn } from '@sheet/ui/utils'
import { useOpenTabs } from '../lib/open-tabs'

import { type ReactNode } from 'react'

/**
 * A tab is text on the bar. The open one is the only one at full ink, and an
 * accent hairline grows out of its centre onto the bar's own rule, so the
 * tab reads as part of the line rather than a button sitting on it.
 */
const tabClassName = (active: boolean) =>
  cn(
    "relative flex h-full shrink-0 items-center gap-1.5 px-3 text-xs outline-none transition-colors duration-150 ease-smooth after:absolute after:inset-x-3 after:-bottom-px after:h-px after:origin-center after:bg-cx-accent after:transition-transform after:duration-200 after:ease-smooth after:content-[''] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:after:transition-none",
    active
      ? 'text-foreground after:scale-x-100'
      : 'text-muted-foreground after:scale-x-0 hover:text-foreground',
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
        data-cuelume-emphasis="subtle"
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
    <a href={href} data-cuelume-navigate="" data-cuelume-emphasis="subtle" className={className} aria-label={ariaLabel} title={title}>
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
    <div data-tauri-drag-region className="flex h-full min-w-0 items-stretch">
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
                className={cn(tabClassName(isActive), 'min-w-0 pe-7')}
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
        className={cn(
          tabClassName(isLauncher),
          'px-2.5 after:inset-x-2',
        )}
        aria-label="New tab"
        title="New tab"
      >
        <PlusIcon className="size-3.5" />
      </TabLink>
    </div>
  )
}
