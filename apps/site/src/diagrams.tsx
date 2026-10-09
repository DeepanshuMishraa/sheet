import { useState } from 'react'
import { prefersReducedMotion } from './hooks'

/* Every diagram draws with CSS variables, so it follows the light/dark theme. */

const agents = [
  { name: 'Claude', tool: 'insertNodes', detail: 'Pricing / 3 plans', frame: 0, x: 700, y: 130 },
  { name: 'Codex', tool: 'patchNodes', detail: 'spacing, color tokens', frame: 1, x: 835, y: 175 },
  { name: 'Cursor', tool: 'moveNodes', detail: 'Hero → top of page', frame: 2, x: 700, y: 285 },
  { name: 'opencode', tool: 'animateNodes', detail: 'fade-in-up, stagger', frame: 0, x: 760, y: 120 },
] as const

const AGENT_ROWS = [60, 150, 240, 330] as const
const HUB = { x: 460, y: 195 } as const

/** Pick an agent and watch its tool calls travel over MCP into the canvas. */
export function AgentsDiagram() {
  const [active, setActive] = useState(0)
  const agent = agents[active] ?? agents[0]
  const still = prefersReducedMotion()

  return (
    <svg
      className="art art-agents"
      viewBox="0 0 920 390"
      role="group"
      aria-label="Four agents connect through one MCP endpoint to the same canvas"
    >
      {agents.map((entry, index) => {
        const y = AGENT_ROWS[index] ?? 0
        const on = index === active
        const path = `M180 ${y} C 320 ${y}, 320 ${HUB.y}, ${HUB.x - 44} ${HUB.y}`
        return (
          <g key={entry.name}>
            <path className="wire" data-active={on} d={path} />
            {on && !still
              ? [0, 0.9].map((begin) => (
                  <circle key={begin} r="4" className="packet">
                    <animateMotion dur="1.8s" begin={`${begin}s`} repeatCount="indefinite" path={path} />
                  </circle>
                ))
              : null}
            <g
              className="agent"
              data-active={on}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`Show ${entry.name}`}
              data-cuelume-select
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setActive(index)
                }
              }}
            >
              <rect x="1" y={y - 26} width="178" height="52" rx="0" />
              <circle cx="26" cy={y} r="5" className="agent-dot" />
              <text x="46" y={y + 5} className="agent-name">
                {entry.name}
              </text>
            </g>
          </g>
        )
      })}

      <path className="wire" data-active="true" d={`M${HUB.x + 44} ${HUB.y} H 640`} />
      {!still ? (
        <circle key={active} r="4" className="packet">
          <animateMotion dur="1.2s" repeatCount="indefinite" path={`M${HUB.x + 44} ${HUB.y} H 640`} />
        </circle>
      ) : null}

      <circle className="hub-ring" cx={HUB.x} cy={HUB.y} r="44" />
      <circle className="hub" cx={HUB.x} cy={HUB.y} r="44" />
      <text x={HUB.x} y={HUB.y + 5} textAnchor="middle" className="hub-text">
        MCP
      </text>
      <text x={HUB.x} y={HUB.y + 78} textAnchor="middle" className="label">
        127.0.0.1:4100/mcp
      </text>
      <text key={agent.tool} x={HUB.x} y={HUB.y - 64} textAnchor="middle" className="tool-call">
        {agent.tool}
      </text>

      <g className="canvas-art">
        <rect x="640" y="45" width="270" height="300" className="canvas-box" />
        <line x1="640" y1="73" x2="910" y2="73" className="stroke" />
        <circle cx="656" cy="59" r="3.5" className="agent-dot" />
        <circle cx="670" cy="59" r="3.5" className="agent-dot" />
        <circle cx="684" cy="59" r="3.5" className="agent-dot" />
        {[
          { x: 660, y: 95, w: 110, h: 110 },
          { x: 785, y: 95, w: 105, h: 70 },
          { x: 660, y: 225, w: 230, h: 95 },
        ].map((frame, index) => (
          <rect
            key={index}
            x={frame.x}
            y={frame.y}
            width={frame.w}
            height={frame.h}
            className="mini-frame"
            data-edited={index === agent.frame}
          />
        ))}
        <g className="art-cursor" style={{ transform: `translate(${agent.x}px, ${agent.y}px)` }}>
          <path d="M0 0l11 4.5-4.6 1.6L4.8 11z" className="art-cursor-shape" />
          <rect x="12" y="10" width={agent.name.length * 7 + 14} height="18" className="art-tag" />
          <text x="19" y="23" className="art-tag-text">
            {agent.name}
          </text>
        </g>
      </g>
    </svg>
  )
}

/** A laptop holding the database; the cloud is crossed out. */
export function LocalFirstArt() {
  return (
    <svg className="art art-local" viewBox="0 0 260 150" role="img" aria-label="A laptop running Sheet, with the cloud crossed out">
      <rect x="45" y="20" width="130" height="84" className="stroke" />
      <rect x="25" y="104" width="170" height="7" className="stroke" />
      <circle cx="110" cy="62" r="30" className="pulse" />
      <circle cx="110" cy="62" r="30" className="pulse pulse-late" />
      <rect x="82" y="42" width="56" height="40" className="stroke accent-stroke" />
      <rect x="90" y="50" width="26" height="5" className="fill-accent" />
      <rect x="90" y="61" width="40" height="3" className="fill-dim" />
      <rect x="90" y="68" width="32" height="3" className="fill-dim" />
      <path d="M205 56a11 11 0 0 1 2-21 15 15 0 0 1 28 3 9 9 0 0 1 0 18Z" className="stroke dim-stroke" />
      <path d="M200 66 242 24" className="stroke slash" />
      <path d="M180 70 C 190 70, 192 62, 200 58" className="stroke dim-stroke dashed" />
      <text x="110" y="136" textAnchor="middle" className="label">
        on your machine
      </text>
    </svg>
  )
}

const files = ['PNG', 'JPG', 'HTML'] as const

/** One document fans out into image and HTML files. */
export function ExportArt() {
  const still = prefersReducedMotion()
  return (
    <svg className="art art-export" viewBox="0 0 370 150" role="img" aria-label="One document exported as PNG, JPG or HTML">
      <g>
        <rect x="8" y="38" width="70" height="80" className="stroke accent-stroke" />
        <rect x="20" y="52" width="30" height="6" className="fill-accent" />
        <rect x="20" y="68" width="46" height="4" className="fill-dim" />
        <rect x="20" y="78" width="38" height="4" className="fill-dim" />
        <rect x="20" y="96" width="46" height="12" className="stroke" />
      </g>
      {files.map((label, index) => {
        const x = 140 + index * 58
        const path = `M78 78 C 110 78, 110 ${74 + (index - 1.5) * 4}, ${x} 78`
        return (
          <g key={label}>
            <path d={path} className="stroke dim-stroke" />
            {!still ? (
              <circle r="3" className="packet">
                <animateMotion dur="2.4s" begin={`${index * 0.5}s`} repeatCount="indefinite" path={path} />
              </circle>
            ) : null}
            <g className="file" style={{ transitionDelay: `${index * 40}ms` }}>
              <path d={`M${x} 46h30l14 14v50H${x}Z`} className="file-body" />
              <path d={`M${x + 30} 46v14h14`} className="stroke" />
              <text x={x + 22} y="92" textAnchor="middle" className="file-label">
                {label}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}

export type Platform = 'macOS' | 'Windows' | 'Linux'

export const platforms: readonly Platform[] = ['macOS', 'Windows', 'Linux']

export function SunMoon({ dark }: { dark: boolean }) {
  return (
    <svg className="theme-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" data-dark={dark}>
      <g className="sun">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
      </g>
      <path className="moon" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  )
}
