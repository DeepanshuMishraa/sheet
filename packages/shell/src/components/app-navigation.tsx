import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ChevronDownIcon,
  ClockIcon,
  LayoutGridIcon,
  LinkIcon,
  PlusIcon,
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

export type AppSection = 'recents' | 'appearance' | 'integrations' | 'files'

const NAV_ITEMS = [
  { to: '/app', section: 'recents', label: 'Recents', Icon: ClockIcon },
  { to: '/app/files', section: 'files', label: 'Files', Icon: LayoutGridIcon },
  { to: '/app/appearance', section: 'appearance', label: 'Appearance', Icon: SunIcon },
  { to: '/app/integrations', section: 'integrations', label: 'Integrations', Icon: LinkIcon },
] as const satisfies ReadonlyArray<{
  to: string
  section: AppSection
  label: string
  Icon: typeof ClockIcon
}>

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

/** One row of the sidebar. Selected rows lift; the rest only tint on hover. */
const rowClassName = (selected: boolean) =>
  cn(
    'group/row relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-xs outline-none transition-[background-color,color,box-shadow,transform] duration-150 ease-smooth active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
    selected
      ? 'bg-surface text-foreground shadow-lift'
      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
  )

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-2.5 pb-1.5 pt-4 text-2xs uppercase tracking-[0.14em] text-muted-foreground/70">
      {children}
    </p>
  )
}

export function AppSidebar({
  active,
  onSettings,
}: {
  active: AppSection | null
  onSettings: () => void
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
        <SectionLabel>Home</SectionLabel>
        <nav className="flex flex-col gap-0.5" aria-label="Main navigation">
          {NAV_ITEMS.map(({ to, section, label, Icon }) => (
            <Link
              key={to}
              to={to}
              preload="intent"
              data-cuelume-navigate=""
              data-cuelume-emphasis="subtle"
              aria-current={active === section ? 'page' : undefined}
              className={rowClassName(active === section)}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{label}</span>
            </Link>
          ))}
          <Link
            to="/app/new"
            preload="intent"
            data-cuelume-tap=""
            data-cuelume-emphasis="subtle"
            className={rowClassName(false)}
          >
            <PlusIcon className="size-4 shrink-0" />
            <span className="truncate">New file</span>
          </Link>
        </nav>

      </div>

      <div className="shrink-0 border-t border-line p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Menu for ${firstName}`}
              className={cn(rowClassName(false), 'h-9 px-2')}
            >
              <Avatar className="size-5 shrink-0 rounded-md text-2xs font-semibold">
                {profile?.imageUrl ? (
                  <AvatarImage src={profile.imageUrl} alt="" />
                ) : null}
                <AvatarFallback className="bg-foreground text-background">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {firstName}
              </span>
              <ChevronDownIcon className="size-3.5 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuItem onClick={onSettings}>
              <SettingsIcon data-slot="icon" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
