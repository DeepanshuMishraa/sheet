import { useState, type ComponentType, type CSSProperties, type SVGProps } from 'react'
import { prefersReducedMotion } from './hooks'
import { ClaudeMark, CodexMark, CursorMark, OpenCodeMark } from './marks'

/* Every diagram draws with CSS variables, so it follows the light/dark theme. */

interface Agent {
  id: string
  name: string
  tool: string
  frame: number
  /** Where its cursor lands on the mini canvas. */
  x: number
  y: number
  Mark: ComponentType<SVGProps<SVGSVGElement>>
  /** The app-icon tile, as in the hero: gradient, ink and glow. */
  tile: { from: string; to: string; ink: string; glow: string }
}

const agents: readonly Agent[] = [
  {
    id: 'claude',
    name: 'Claude',
    tool: 'insertNodes',
    frame: 0,
    x: 700,
    y: 130,
    Mark: ClaudeMark,
    tile: { from: '#f0845f', to: '#c8502b', ink: '#ffffff', glow: 'rgba(217, 119, 87, 0.55)' },
  },
  {
    id: 'codex',
    name: 'Codex',
    tool: 'patchNodes',
    frame: 1,
    x: 835,
    y: 175,
    Mark: CodexMark,
    tile: { from: '#ffffff', to: '#d6d6d6', ink: '#111111', glow: 'rgba(160, 160, 160, 0.5)' },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    tool: 'moveNodes',
    frame: 2,
    x: 700,
    y: 285,
    Mark: CursorMark,
    tile: { from: '#3a3930', to: '#14130e', ink: '#f2f1ea', glow: 'rgba(120, 118, 100, 0.55)' },
  },
  {
    id: 'opencode',
    name: 'opencode',
    tool: 'animateNodes',
    frame: 0,
    x: 760,
    y: 120,
    Mark: OpenCodeMark,
    tile: { from: '#fdfcfc', to: '#e6e5e6', ink: '#17181c', glow: 'rgba(160, 160, 165, 0.5)' },
  },
]

interface Point {
  x: number
  y: number
}

/**
 * The same picture, laid out twice: agents left of the hub and the canvas
 * right of it on a wide screen; agents in a grid above the hub and the canvas
 * under it on a phone, so the diagram reads top to bottom instead of
 * scrolling sideways.
 */
interface Layout {
  id: 'wide' | 'tall'
  viewBox: string
  /** Top-left corner of each agent's card. */
  card: (index: number) => Point
  cardWidth: number
  wire: (index: number) => string
  hub: Point
  /** The wire from the hub into the canvas. */
  feed: string
  /** The canvas art is drawn at its wide position, then moved by this. */
  canvasShift: Point
  toolCall: Point & { anchor: 'middle' | 'start' }
  address: Point & { anchor: 'middle' | 'start' }
}

const CARD_HEIGHT = 52
const HUB_RADIUS = 44

const WIDE: Layout = {
  id: 'wide',
  viewBox: '0 0 920 390',
  card: (index) => ({ x: 1, y: 34 + index * 90 }),
  cardWidth: 178,
  wire: (index) => {
    const y = 60 + index * 90
    return `M180 ${y} C 320 ${y}, 320 195, ${460 - HUB_RADIUS} 195`
  },
  hub: { x: 460, y: 195 },
  feed: `M${460 + HUB_RADIUS} 195 H 640`,
  canvasShift: { x: 0, y: 0 },
  toolCall: { x: 460, y: 131, anchor: 'middle' },
  address: { x: 460, y: 273, anchor: 'middle' },
}

const TALL: Layout = {
  id: 'tall',
  viewBox: '0 0 400 700',
  // Two columns with a gap down the middle; every wire leaves a card's inner
  // edge and runs down that gap, so none crosses a card below it.
  card: (index) => ({ x: index % 2 === 0 ? 8 : 224, y: 6 + Math.floor(index / 2) * 72 }),
  cardWidth: 168,
  wire: (index) => {
    const card = TALL.card(index)
    const x = index % 2 === 0 ? card.x + TALL.cardWidth : card.x
    const y = card.y + CARD_HEIGHT / 2
    return `M${x} ${y} C 200 ${y}, 200 ${y}, 200 ${y + 24} V ${250 - HUB_RADIUS}`
  },
  hub: { x: 200, y: 250 },
  feed: `M200 ${250 + HUB_RADIUS} V 380`,
  canvasShift: { x: -575, y: 335 },
  toolCall: { x: 256, y: 244, anchor: 'start' },
  address: { x: 256, y: 264, anchor: 'start' },
}

/** Pick an agent and watch its tool calls travel over MCP into the canvas. */
export function AgentsDiagram() {
  const [active, setActive] = useState(0)
  return (
    <>
      <AgentsArt layout={WIDE} active={active} onPick={setActive} />
      <AgentsArt layout={TALL} active={active} onPick={setActive} />
    </>
  )
}

function AgentTile({ agent, layout, at, size }: { agent: Agent; layout: Layout; at: Point; size: number }) {
  const { Mark } = agent
  const inset = size * 0.24
  return (
    <g className="agent-tile-art" style={{ '--tile-glow': agent.tile.glow } as CSSProperties}>
      <rect x={at.x} y={at.y} width={size} height={size} rx={size * 0.26} fill={`url(#${layout.id}-tile-${agent.id})`} className="tile-face" />
      <rect x={at.x} y={at.y} width={size} height={size} rx={size * 0.26} fill={`url(#${layout.id}-tile-gloss)`} className="tile-gloss" />
      <Mark
        x={at.x + inset}
        y={at.y + inset}
        width={size - inset * 2}
        height={size - inset * 2}
        className="tile-mark"
        style={{ color: agent.tile.ink }}
      />
    </g>
  )
}

function AgentsArt({ layout, active, onPick }: { layout: Layout; active: number; onPick: (index: number) => void }) {
  const agent = agents[active] ?? agents[0]
  const still = prefersReducedMotion()
  if (!agent) return null
  const { hub } = layout

  return (
    <svg
      className={`art art-agents art-agents-${layout.id}`}
      viewBox={layout.viewBox}
      role="group"
      aria-label="Four agents connect through one MCP endpoint to the same canvas"
    >
      <defs>
        {agents.map((entry) => (
          <linearGradient key={entry.id} id={`${layout.id}-tile-${entry.id}`} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor={entry.tile.from} />
            <stop offset="1" stopColor={entry.tile.to} />
          </linearGradient>
        ))}
        <linearGradient id={`${layout.id}-tile-gloss`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {agents.map((entry, index) => {
        const card = layout.card(index)
        const on = index === active
        const path = layout.wire(index)
        const middle = card.y + CARD_HEIGHT / 2
        return (
          <g key={entry.id}>
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
              onClick={() => onPick(index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onPick(index)
                }
              }}
            >
              <rect className="agent-card" x={card.x} y={card.y} width={layout.cardWidth} height={CARD_HEIGHT} rx="0" />
              <AgentTile agent={entry} layout={layout} at={{ x: card.x + 12, y: middle - 15 }} size={30} />
              <text x={card.x + 54} y={middle + 5} className="agent-name">
                {entry.name}
              </text>
            </g>
          </g>
        )
      })}

      <path className="wire" data-active="true" d={layout.feed} />
      {!still ? (
        <circle key={active} r="4" className="packet">
          <animateMotion dur="1.2s" repeatCount="indefinite" path={layout.feed} />
        </circle>
      ) : null}

      <circle className="hub-ring" cx={hub.x} cy={hub.y} r={HUB_RADIUS} />
      <circle className="hub" cx={hub.x} cy={hub.y} r={HUB_RADIUS} />
      <text x={hub.x} y={hub.y + 5} textAnchor="middle" className="hub-text">
        MCP
      </text>
      <text x={layout.address.x} y={layout.address.y} textAnchor={layout.address.anchor} className="label">
        127.0.0.1:4100/mcp
      </text>
      <text key={agent.tool} x={layout.toolCall.x} y={layout.toolCall.y} textAnchor={layout.toolCall.anchor} className="tool-call">
        {agent.tool}
      </text>

      <g className="canvas-art" transform={`translate(${layout.canvasShift.x} ${layout.canvasShift.y})`}>
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
          <rect x="12" y="10" width={agent.name.length * 7 + 32} height="20" rx="10" className="art-tag" />
          <AgentTile agent={agent} layout={layout} at={{ x: 15, y: 12 }} size={16} />
          <text x="36" y="24" className="art-tag-text">
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
