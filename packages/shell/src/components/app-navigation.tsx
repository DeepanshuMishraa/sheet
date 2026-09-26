import { Link } from '@tanstack/react-router'
import {
  ClockIcon,
  LinkIcon,
  SettingsIcon,
  SunIcon,
} from '@loora/ui/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@loora/ui/dropdown-menu'
import { cn } from '@loora/ui/utils'

export type AppSection =
  | 'recents'
  | 'appearance'
  | 'integrations'

const navigation = [
  { section: 'recents', label: 'Recents', to: '/app', icon: ClockIcon },
  { section: 'appearance', label: 'Appearance', to: '/app/appearance', icon: SunIcon },
  { section: 'integrations', label: 'Integrations', to: '/app/integrations', icon: LinkIcon },
] as const

export function AppNavigation({
  active,
  onSettings,
}: {
  active: AppSection
  onSettings?: () => void
}) {
  return (
    <nav className="flex flex-col gap-px px-1.5">
      {navigation.map((item) => {
        const Icon = item.icon
        const selected = active === item.section
        return (
          <Link
            key={item.section}
            to={item.to}
            preload="intent"
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs transition-[color,background-color,box-shadow] duration-150',
              // The hover tint is translucent zinc, so a selected item painted
              // in the same tint would be indistinguishable from a hovered one.
              // Selected reads as its own surface: a step up plus a hairline.
              selected
                ? 'bg-surface-2 font-medium text-foreground shadow-panel'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {item.label}
          </Link>
        )
      })}
      {onSettings ? (
        <button
          type="button"
          onClick={onSettings}
          className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-start text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <SettingsIcon className="size-3.5" />
          Settings
        </button>
      ) : null}
    </nav>
  )
}

export function AppAccountMenu({
  onSettings,
  compact = false,
}: {
  onSettings?: () => void
  compact?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu"
          className={cn(
            'flex items-center gap-2 rounded-md text-start hover:bg-secondary',
            compact ? 'p-1' : 'w-full px-1.5 py-1',
          )}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-2xs font-semibold">
            L
          </span>
          {compact ? null : (
            <span className="min-w-0 flex-1 truncate text-xs font-medium">Loora</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {navigation.map((item) => {
          const Icon = item.icon
          return (
            <DropdownMenuItem key={item.section} asChild>
              <Link to={item.to} preload="intent">
                <Icon data-slot="icon" />
                {item.label}
              </Link>
            </DropdownMenuItem>
          )
        })}
        {onSettings ? (
          <DropdownMenuItem onClick={onSettings}>
            <SettingsIcon data-slot="icon" />
            Settings
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
