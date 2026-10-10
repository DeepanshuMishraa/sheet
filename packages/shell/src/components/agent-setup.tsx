import { useState } from 'react'
import {
  AGENTS,
  MCP_URL,
  requestInstall,
  requestSkillInstall,
  type InstallState,
  type SkillState,
} from '@sheet/editor/connect-agent'
import { Button } from '@sheet/ui/button'
import { Spinner } from '@sheet/ui/spinner'
import { cn } from '@sheet/ui/utils'

/** Agents whose MCP config Sheet can write itself. "Other" is manual and lives in Settings. */
const SUPPORTED = AGENTS.filter((agent) => agent.manual === undefined)

type Phase =
  | { name: 'choosing' }
  | { name: 'installing' }
  | { name: 'done'; mcp: ReadonlyArray<{ agent: string; result: InstallState }>; skill: SkillState }

function resultLine(agent: string, result: InstallState) {
  if (result.phase === 'done') return `${agent}: ${result.already ? 'already connected' : 'connected'}`
  if (result.phase === 'failed') return `${agent}: ${result.message}`
  return `${agent}: not finished`
}

function skillLine(skill: SkillState) {
  if (skill.phase === 'done') {
    const written = skill.entries.filter((entry) => entry.status === 'installed' || entry.status === 'updated')
    return written.length > 0
      ? `Design skill added to ${written.length} agent ${written.length === 1 ? 'folder' : 'folders'}`
      : 'Design skill already up to date'
  }
  if (skill.phase === 'failed') return `Design skill: ${skill.message}`
  return null
}

/**
 * First-run agent setup: pick the agents you use, and one press writes Sheet's
 * MCP server into each one's config and installs the design skill. Nothing is
 * touched until the button is pressed, and the step can be passed without it.
 */
export function AgentSetup({ className }: { className?: string }) {
  const [chosen, setChosen] = useState<ReadonlyArray<string>>([])
  const [phase, setPhase] = useState<Phase>({ name: 'choosing' })

  const toggle = (key: string) =>
    setChosen((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]))

  const install = async () => {
    setPhase({ name: 'installing' })
    const mcp = await Promise.all(
      SUPPORTED.filter((agent) => chosen.includes(agent.key)).map(async (agent) => ({
        agent: agent.name,
        result: await requestInstall(agent.key),
      })),
    )
    const skill = await requestSkillInstall()
    setPhase({ name: 'done', mcp, skill })
  }

  const installing = phase.name === 'installing'

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Agents">
        {SUPPORTED.map((agent) => {
          const selected = chosen.includes(agent.key)
          const Icon = agent.icon
          return (
            <button
              key={agent.key}
              type="button"
              aria-pressed={selected}
              disabled={installing}
              className={cn(
                'cx-press flex min-w-0 flex-col items-center gap-2 px-1 py-3 text-xs outline-none transition-[box-shadow,color] duration-150 ease-smooth focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60',
                selected
                  ? 'text-foreground shadow-lift-selected'
                  : 'text-muted-foreground shadow-hairline hover:text-foreground hover:shadow-lift-hover',
              )}
              onClick={() => toggle(agent.key)}
            >
              <Icon className="size-5" />
              <span className="w-full truncate text-center">{agent.name}</span>
            </button>
          )
        })}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Adds <span className="font-mono">{MCP_URL}</span> to each agent you pick and installs the Sheet design skill.
      </p>

      {phase.name === 'done' ? (
        <ul role="status" className="flex flex-col gap-1 text-xs text-muted-foreground">
          {phase.mcp.map((entry) => (
            <li key={entry.agent}>{resultLine(entry.agent, entry.result)}</li>
          ))}
          {skillLine(phase.skill) ? <li>{skillLine(phase.skill)}</li> : null}
        </ul>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={installing || chosen.length === 0}
        onClick={() => void install()}
      >
        {installing ? <Spinner /> : null}
        {installing ? 'Setting up…' : phase.name === 'done' ? 'Set up again' : 'Set up'}
      </Button>
    </div>
  )
}
