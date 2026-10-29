import { cn } from '@sheet/ui/utils'
import { useState, type ComponentType, type CSSProperties } from 'react'
import type { AgentActivity, AgentKind } from '../lib/canvas-events'
import {
  AntigravityLogo,
  ClaudeCodeLogo,
  CodexLogo,
  CursorLogo,
  GithubCopilotLogo,
  OpenCodeLogo,
} from './agent-logos'

/**
 * How each agent looks in the editor: the app-icon tile from the marketing
 * site (gradient, ink, glow) and one colour for its cursor and the ring on the
 * node it works on.
 */
interface AgentLook {
  Logo: ComponentType<{ className?: string }> | null
  from: string
  to: string
  ink: string
  color: string
}

const AGENT_LOOKS: Record<AgentKind, AgentLook> = {
  claude: { Logo: ClaudeCodeLogo, from: '#f0845f', to: '#c8502b', ink: '#ffffff', color: '#d97757' },
  codex: { Logo: CodexLogo, from: '#ffffff', to: '#d6d6d6', ink: '#111111', color: '#10a37f' },
  cursor: { Logo: CursorLogo, from: '#3a3930', to: '#14130e', ink: '#f2f1ea', color: '#57564b' },
  copilot: { Logo: GithubCopilotLogo, from: '#a77bf3', to: '#6e40c9', ink: '#ffffff', color: '#8957e5' },
  opencode: { Logo: OpenCodeLogo, from: '#fdfcfc', to: '#e6e5e6', ink: '#17181c', color: '#3b3c42' },
  antigravity: { Logo: AntigravityLogo, from: '#ffffff', to: '#e8eefc', ink: '#1f2937', color: '#3186ff' },
  other: { Logo: null, from: '#8b93a1', to: '#4b5563', ink: '#ffffff', color: '#6c5ce7' },
}

export function agentColor(kind: AgentKind) {
  return AGENT_LOOKS[kind].color
}

/**
 * What each agent is called on screen. Two sessions of one app are "Claude"
 * and "Claude 2", numbered in the order they showed up.
 */
export function agentNames(activities: readonly AgentActivity[]) {
  const seen = new Map<string, number>()
  const names = new Map<string, string>()
  for (const { agent } of activities) {
    const count = (seen.get(agent.name) ?? 0) + 1
    seen.set(agent.name, count)
    names.set(agent.id, count === 1 ? agent.name : `${agent.name} ${count}`)
  }
  return names
}

function lookStyle(kind: AgentKind) {
  const look = AGENT_LOOKS[kind]
  return {
    '--agent-from': look.from,
    '--agent-to': look.to,
    '--agent-ink': look.ink,
    '--agent-color': look.color,
  } as CSSProperties
}

export function AgentTile({ kind, name, className }: { kind: AgentKind; name: string; className?: string }) {
  const { Logo } = AGENT_LOOKS[kind]
  return (
    <span className={cn('cx-agent-tile', className)} style={lookStyle(kind)}>
      {Logo ? (
        // The Claude artwork carries its own orange; on the orange tile it takes the ink instead.
        <Logo className={cn('relative size-[58%]', kind === 'claude' && '[&_path]:fill-current')} />
      ) : (
        <span className="relative text-[11px] font-semibold leading-none">{name.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  )
}

const MAX_AVATARS = 4

/** Every agent in the document, as a stack of app tiles in the top bar. */
export function AgentAvatars({
  activities,
  names,
  onFocus,
}: {
  activities: readonly AgentActivity[]
  names: ReadonlyMap<string, string>
  onFocus: (activity: AgentActivity) => void
}) {
  if (activities.length === 0) return null
  const shown = activities.slice(0, MAX_AVATARS)
  const hidden = activities.length - shown.length
  const working = activities.filter((activity) => activity.phase === 'working')
  return (
    <div className="flex shrink-0 items-center">
      <span role="status" aria-live="polite" className="sr-only">
        {working.length > 0
          ? working.map((activity) => `${names.get(activity.agent.id)}: ${activity.label}`).join('. ')
          : 'Agents finished'}
      </span>
      <div className="flex items-center -space-x-1.5">
        {shown.map((activity) => {
          const name = names.get(activity.agent.id) ?? activity.agent.name
          const status = activity.phase === 'working' ? activity.label : 'Finished'
          return (
            <button
              key={activity.agent.id}
              type="button"
              title={`${name} · ${status}`}
              aria-label={`${name}, ${status}. Show what it is working on`}
              data-phase={activity.phase}
              className="cx-agent-avatar relative rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={lookStyle(activity.agent.kind)}
              onClick={() => onFocus(activity)}
            >
              <AgentTile kind={activity.agent.kind} name={name} className="size-6 ring-2 ring-background" />
            </button>
          )
        })}
        {hidden > 0 ? (
          <span className="relative grid size-6 place-items-center rounded-[7px] bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
            +{hidden}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export interface AgentRect {
  left: number
  top: number
  width: number
  height: number
}

function sameRect(a: AgentRect | null, b: AgentRect | null) {
  return a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)
}

/**
 * Where an agent "is": a cursor that glides to the node it works on, with a
 * pill saying what it is doing there. Between calls that name no node it stays
 * where it last was; once the agent settles it fades out on the server's clock.
 */
export function AgentCursor({
  activity,
  name,
  rect,
  nodeName,
}: {
  activity: AgentActivity
  name: string
  rect: AgentRect | null
  nodeName: string | null
}) {
  const [spot, setSpot] = useState(rect)
  if (rect && !sameRect(rect, spot)) setSpot(rect)
  if (!spot) return null

  const look = AGENT_LOOKS[activity.agent.kind]
  // Inside the node, toward its lower right, so the arrow points at it and the label clears it.
  const x = spot.left + Math.min(spot.width * 0.66, Math.max(spot.width - 10, 0))
  const y = spot.top + Math.min(spot.height * 0.66, Math.max(spot.height - 10, 0))
  const working = activity.phase === 'working'
  const leaveMs = Math.max(0, activity.expiresAt - activity.updatedAt)

  return (
    <div
      aria-hidden="true"
      className="cx-agent-cursor pointer-events-none absolute left-0 top-0 z-30"
      data-phase={activity.phase}
      style={{
        ...lookStyle(activity.agent.kind),
        transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`,
        '--agent-leave': `${leaveMs}ms`,
      } as CSSProperties}
    >
      <svg viewBox="0 0 16 16" className="size-4 drop-shadow-sm" fill="none">
        <path
          d="M1.5 1.2 14.2 6.1c.5.2.5.9 0 1.1L9 9.1 7.1 14.3c-.2.5-.9.5-1.1 0L1.1 1.6c-.1-.3.1-.5.4-.4Z"
          fill={look.color}
          stroke="white"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <div className="cx-agent-cursor-label ms-3.5 -mt-0.5 flex max-w-64 items-center gap-1.5 whitespace-nowrap rounded-full py-1 pe-2.5 ps-1.5 text-xs text-white shadow-lg">
        <AgentTile kind={activity.agent.kind} name={name} className="size-4 rounded-full ring-1 ring-white/40" />
        <span className="truncate">
          <span className="font-medium">{name}</span>
          {working ? (
            activity.verb && nodeName ? (
              <>
                {' '}is {activity.verb} <span className="font-semibold">{nodeName}</span>
              </>
            ) : (
              <span className="opacity-85"> · {activity.label}</span>
            )
          ) : null}
        </span>
      </div>
    </div>
  )
}
