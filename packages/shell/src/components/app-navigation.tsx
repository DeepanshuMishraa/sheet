import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ClockIcon,
  LayoutGridIcon,
  PlusIcon,
} from '@sheet/ui/icons'
import { Avatar, AvatarFallback, AvatarImage } from '@sheet/ui/avatar'
import { BrandMark } from '@sheet/ui/brand-mark'
import { cn } from '@sheet/ui/utils'

export type AppSection = 'recents' | 'files'

const NAV_ITEMS = [
  { to: '/app', section: 'recents', label: 'Recents', Icon: ClockIcon },
  { to: '/app/files', section: 'files', label: 'Files', Icon: LayoutGridIcon },
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

/**
 * One row of the sidebar. No fill, no lift: the current page is the only row
 * at full ink, marked by an accent hairline on its left edge.
 */
const rowClassName = (selected: boolean) =>
  cn(
    'cx-row group/row flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-start text-xs outline-none transition-[background-color,color,transform] duration-150 ease-smooth active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
    selected
      ? 'bg-accent text-foreground'
      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
  )

function SectionLabel({ children }: { children: string }) {
  return <p className="cx-label cx-bracket px-2.5 pb-2 pt-5">{children}</p>
}

export function AppSidebar({ active }: { active: AppSection | null }) {
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
        <div className="group/brand flex h-9 items-center gap-2.5 px-2.5 pt-2 text-foreground">
          <BrandMark />
          <span className="cx-label text-foreground">Sheet</span>
        </div>
        <SectionLabel>Workspace</SectionLabel>
        <nav className="flex flex-col gap-0.5" aria-label="Main navigation">
          {NAV_ITEMS.map(({ to, section, label, Icon }) => (
            <Link
              key={to}
              to={to}
              preload="intent"
              data-cuelume-navigate=""
              aria-current={active === section ? 'page' : undefined}
              className={rowClassName(active === section)}
            >
              <Icon
                className={cn(
                  'size-4 shrink-0 transition-colors duration-150',
                  active === section && 'text-cx-accent',
                )}
              />
              <span className="truncate">{label}</span>
            </Link>
          ))}
          <Link
            to="/app/new"
            preload="intent"
            data-cuelume-tap=""
            className={rowClassName(false)}
          >
            <PlusIcon className="size-4 shrink-0" />
            <span className="truncate">New file</span>
          </Link>
        </nav>

      </div>

      {/* Who is signed in. Settings is not reached from here: it opens from the
          application menu, as its own window. */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-t border-line px-5">
        <Avatar className="size-5 shrink-0 rounded-full text-2xs font-semibold">
          {profile?.imageUrl ? <AvatarImage src={profile.imageUrl} alt="" /> : null}
          <AvatarFallback className="bg-cx-accent text-white">{initial}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{firstName}</span>
      </div>
    </div>
  )
}
