import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ChevronDownIcon,
  ClockIcon,
  LayoutGridIcon,
  LinkIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from '@sheet/ui/icons'
import { Avatar, AvatarFallback, AvatarImage } from '@sheet/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sheet/ui/dropdown-menu'
import { cn } from '@sheet/ui/utils'
import { useDashboardSearchQuery } from '../lib/dashboard-search'

export type AppSection =
  | 'recents'
  | 'appearance'
  | 'integrations'
  | 'files'

type DesktopProfile = {
  firstName: string
  imageUrl: string | null
}

async function loadDesktopProfile(): Promise<DesktopProfile> {
  const response = await fetch('/desktop/profile')
  if (!response.ok) throw new Error('Could not read the local account profile')
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The local account profile response is invalid')
  }
  const firstName = Reflect.get(payload, 'firstName')
  const imageUrl = Reflect.get(payload, 'imageUrl')
  if (
    typeof firstName !== 'string' ||
    (typeof imageUrl !== 'string' && imageUrl !== null)
  ) {
    throw new Error('The local account profile response is invalid')
  }
  return { firstName, imageUrl }
}

export function AppNavigation({
  active,
  onSettings,
}: {
  active: AppSection
  onSettings?: () => void
}) {
  const [searchQuery, setSearchQuery] = useDashboardSearchQuery()
  const { data: profile } = useQuery({
    queryKey: ['desktop-profile'],
    queryFn: loadDesktopProfile,
    staleTime: Infinity,
    retry: false,
  })

  const firstName = profile?.firstName || 'Deepanshu'
  const initial = firstName.charAt(0).toUpperCase()

  return (
    <div className="flex h-full flex-col">
      {/* User profile dropdown at top of sidebar */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Menu for ${firstName}`}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors duration-fast ease-out hover:bg-surface active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Avatar className="size-6 shrink-0 rounded-full bg-surface-2 text-2xs font-semibold shadow-xs">
              {profile?.imageUrl ? (
                <AvatarImage src={profile.imageUrl} alt={firstName} />
              ) : null}
              <AvatarFallback className="bg-zinc-700 text-zinc-200">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {firstName}
            </span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {onSettings ? (
            <DropdownMenuItem onClick={onSettings}>
              <SettingsIcon data-slot="icon" />
              Settings
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Search Input (no cmd+f as instructed) */}
      <div className="relative mb-2 mt-3">
        <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          aria-label="Search files"
          placeholder="Search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="w-full rounded-lg border border-line bg-surface py-1.5 pe-3 ps-8 text-xs text-foreground shadow-xs transition-[background-color,border-color,box-shadow] duration-fast ease-spring placeholder:text-muted-foreground hover:border-ring/40 focus-visible:border-ring focus-visible:bg-surface focus-visible:shadow-panel focus-visible:outline-none"
        />
      </div>

      {/* Nav list */}
      <nav className="flex flex-col gap-0.5" aria-label="Main Navigation">
        {/* Recents */}
        <Link
          to="/app"
          preload="intent"
          aria-current={active === 'recents' ? 'page' : undefined}
          className={cn(
            'flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-xs transition-[color,background-color,box-shadow,border-color] duration-fast ease-out active:scale-[0.985] motion-reduce:transition-none',
            active === 'recents'
              ? 'border-line/80 bg-surface font-medium text-foreground shadow-xs'
              : 'border-transparent text-muted-foreground hover:bg-surface/60 hover:text-foreground',
          )}
        >
          <ClockIcon className="size-4 shrink-0" />
          <span>Recents</span>
        </Link>

        {/* Files */}
        <Link
          to="/app/files"
          preload="intent"
          aria-current={active === 'files' ? 'page' : undefined}
          className={cn(
            'flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-xs transition-[color,background-color,box-shadow,border-color] duration-fast ease-out active:scale-[0.985] motion-reduce:transition-none',
            active === 'files'
              ? 'border-line/80 bg-surface font-medium text-foreground shadow-xs'
              : 'border-transparent text-muted-foreground hover:bg-surface/60 hover:text-foreground',
          )}
        >
          <LayoutGridIcon className="size-4 shrink-0" />
          <span>Files</span>
        </Link>

        {/* Appearance */}
        <Link
          to="/app/appearance"
          preload="intent"
          aria-current={active === 'appearance' ? 'page' : undefined}
          className={cn(
            'flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-xs transition-[color,background-color,box-shadow,border-color] duration-fast ease-out active:scale-[0.985] motion-reduce:transition-none',
            active === 'appearance'
              ? 'border-line/80 bg-surface font-medium text-foreground shadow-xs'
              : 'border-transparent text-muted-foreground hover:bg-surface/60 hover:text-foreground',
          )}
        >
          <SunIcon className="size-4 shrink-0" />
          <span>Appearance</span>
        </Link>

        {/* Integrations */}
        <Link
          to="/app/integrations"
          preload="intent"
          aria-current={active === 'integrations' ? 'page' : undefined}
          className={cn(
            'flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-xs transition-[color,background-color,box-shadow,border-color] duration-fast ease-out active:scale-[0.985] motion-reduce:transition-none',
            active === 'integrations'
              ? 'border-line/80 bg-surface font-medium text-foreground shadow-xs'
              : 'border-transparent text-muted-foreground hover:bg-surface/60 hover:text-foreground',
          )}
        >
          <LinkIcon className="size-4 shrink-0" />
          <span>Integrations</span>
        </Link>
      </nav>
    </div>
  )
}

export function AppAccountMenu({
  onSettings,
  compact = false,
}: {
  onSettings?: () => void
  compact?: boolean
}) {
  const { data: profile } = useQuery({
    queryKey: ['desktop-profile'],
    queryFn: loadDesktopProfile,
    staleTime: Infinity,
    retry: false,
  })
  const firstName = profile?.firstName || 'Deepanshu'
  const initial = firstName.charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Menu for ${firstName}`}
          className={cn(
            'flex items-center gap-2 rounded-md text-start hover:bg-secondary',
            compact ? 'p-1' : 'w-full px-1.5 py-1',
          )}
        >
          <Avatar className="size-5 bg-accent text-2xs font-semibold">
            {profile?.imageUrl ? (
              <AvatarImage src={profile.imageUrl} alt="" />
            ) : null}
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
          {compact ? null : (
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {firstName}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem asChild>
          <Link to="/app" preload="intent">
            <ClockIcon data-slot="icon" />
            Recents
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/app/files" preload="intent">
            <LayoutGridIcon data-slot="icon" />
            Files
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/app/appearance" preload="intent">
            <SunIcon data-slot="icon" />
            Appearance
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/app/integrations" preload="intent">
            <LinkIcon data-slot="icon" />
            Integrations
          </Link>
        </DropdownMenuItem>
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
