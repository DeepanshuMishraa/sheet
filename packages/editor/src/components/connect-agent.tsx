import { useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon, ExternalLinkIcon, MoreHorizontalIcon } from '@sheet/ui/icons'
import { cn } from '@sheet/ui/utils'
import {
  AntigravityLogo,
  ClaudeCodeLogo,
  CodexLogo,
  CursorLogo,
  GithubCopilotLogo,
  OpenCodeLogo,
  VSCodeLogo,
} from './agent-logos'

/** Where the local Sheet server answers MCP over HTTP. */
export const MCP_URL = 'http://127.0.0.1:4100/mcp'

type IconProps = { className?: string }

const OtherGlyph = ({ className }: IconProps) => <MoreHorizontalIcon className={className} />

interface Step {
  title: string
  body?: string
  /** Text to copy, shown in a code block. */
  code?: string
  file?: string
  /** One-click install link the agent's app handles. */
  action?: { label: string; href: string }
}

interface Agent {
  key: string
  name: string
  icon: (props: IconProps) => ReactNode
  steps: Step[]
  note?: string
}

const jsonRemote = (key: string, extra: Record<string, unknown>) =>
  JSON.stringify({ [key]: { sheet: extra } }, null, 2)

const CURSOR_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=sheet&config=${
  typeof btoa === 'function' ? btoa(JSON.stringify({ url: MCP_URL })) : ''
}`
const VSCODE_LINK = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'sheet', type: 'http', url: MCP_URL }))}`

const VSCODE_STEPS: Step[] = [
  { title: 'Install with one click', action: { label: 'Add to VS Code', href: VSCODE_LINK } },
  {
    title: 'Or add it to your workspace',
    file: '.vscode/mcp.json',
    code: jsonRemote('servers', { type: 'http', url: MCP_URL }),
  },
  { title: 'Start the server', body: 'Open Chat in Agent mode, click the tools icon, and start the "sheet" server.' },
]

export const AGENTS: Agent[] = [
  {
    key: 'cursor',
    name: 'Cursor',
    icon: CursorLogo,
    steps: [
      { title: 'Install with one click', action: { label: 'Add to Cursor', href: CURSOR_LINK } },
      {
        title: 'Or add it to your config',
        file: '~/.cursor/mcp.json',
        code: jsonRemote('mcpServers', { url: MCP_URL }),
      },
    ],
  },
  {
    key: 'claude-code',
    name: 'Claude Code',
    icon: ClaudeCodeLogo,
    steps: [
      { title: 'Run in your terminal', code: `claude mcp add --transport http sheet ${MCP_URL}` },
      { title: 'Check the connection', body: 'Run /mcp inside Claude Code. "sheet" should show as connected.' },
    ],
  },
  {
    key: 'github-copilot',
    name: 'Copilot',
    icon: GithubCopilotLogo,
    steps: VSCODE_STEPS,
    note: 'Copilot reads the same MCP config as VS Code.',
  },
  { key: 'vscode', name: 'VS Code', icon: VSCodeLogo, steps: VSCODE_STEPS },
  {
    key: 'opencode',
    name: 'OpenCode',
    icon: OpenCodeLogo,
    steps: [
      {
        title: 'Add it to your config',
        file: 'opencode.json',
        code: JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { sheet: { type: 'remote', url: MCP_URL, enabled: true } } }, null, 2),
      },
      { title: 'Verify', code: 'opencode mcp list' },
    ],
  },
  {
    key: 'codex',
    name: 'Codex',
    icon: CodexLogo,
    steps: [
      {
        title: 'Add it to your Codex config',
        file: '~/.codex/config.toml',
        code: `[mcp_servers.sheet]\nurl = "${MCP_URL}"`,
      },
      { title: 'Restart Codex', body: 'Reopen the app so it picks up the new server.' },
    ],
  },
  {
    key: 'antigravity',
    name: 'Antigravity',
    icon: AntigravityLogo,
    steps: [
      {
        title: 'Add it to your MCP config',
        body: 'Open the agent panel → MCP servers → Manage → View raw config.',
        file: 'mcp_config.json',
        code: jsonRemote('mcpServers', { serverUrl: MCP_URL }),
      },
    ],
  },
  {
    key: 'other',
    name: 'Other',
    icon: OtherGlyph,
    steps: [
      { title: 'Point your agent at the endpoint', body: 'Any client that speaks Streamable HTTP MCP works. No auth, loopback only.', code: MCP_URL },
      {
        title: 'Or use a JSON config',
        file: 'mcp.json',
        code: jsonRemote('mcpServers', { url: MCP_URL }),
      },
    ],
    note: 'Config formats differ between harnesses. Check your agent’s docs and adjust the shape.',
  },
]

const EXAMPLE_PROMPTS = [
  'Create a hero section with a headline and two buttons in Sheet',
  'Set up 3 color tokens and a swatch row in Sheet',
  'Add a heart icon in coral, 32px, to the header in Sheet',
]

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      window.setTimeout(() => setCopied((current) => (current === text ? null : current)), 1_800)
    } catch {
      setCopied(null)
    }
  }
  return { copied, copy }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopy()
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => void copy(text)}
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {copied === text ? <CheckIcon className="size-3.5 text-success-foreground" /> : <CopyIcon className="size-3.5" />}
    </button>
  )
}

function CodeBlock({ code, file }: { code: string; file?: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-well">
      <div className="flex items-center justify-between gap-2 border-b border-line/70 ps-3 pe-1 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate py-1.5 font-mono">{file ?? 'terminal'}</span>
        <CopyButton text={code} label="Copy" />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-foreground">{code}</pre>
    </div>
  )
}

export function ConnectAgent({ className }: { className?: string }) {
  const [selected, setSelected] = useState(AGENTS[0]?.key ?? 'cursor')
  const agent = AGENTS.find((entry) => entry.key === selected) ?? AGENTS[0]
  const { copied, copy } = useCopy()
  if (!agent) return null

  return (
    <div className={cn('flex min-w-0 flex-col gap-5', className)}>
      {/* Live endpoint */}
      <div
        className="flex min-w-0 items-center gap-3 rounded-xl border border-line px-3 py-2.5"
        style={{ backgroundImage: 'radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--cx-accent) 14%, transparent), transparent 60%)' }}
      >
        <span className="relative grid size-2 shrink-0 place-items-center" aria-hidden="true">
          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Local MCP endpoint</div>
          <div className="truncate font-mono text-xs text-foreground">{MCP_URL}</div>
        </div>
        <CopyButton text={MCP_URL} label="Copy endpoint" />
      </div>

      {/* Agent picker */}
      <div role="tablist" aria-label="Agent" className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-1.5">
        {AGENTS.map((entry) => {
          const Icon = entry.icon
          const active = entry.key === agent.key
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(entry.key)}
              className={cn(
                'flex min-w-0 flex-col items-center gap-1.5 rounded-lg border px-1.5 py-2.5 text-[11px] transition-all duration-150 active:scale-[0.97]',
                active
                  ? 'border-cx-accent/50 bg-cx-accent/10 font-medium text-foreground shadow-xs'
                  : 'border-line/70 text-muted-foreground hover:border-line hover:bg-secondary/60 hover:text-foreground',
              )}
            >
              <Icon className="size-5" />
              <span className="w-full truncate text-center">{entry.name}</span>
            </button>
          )
        })}
      </div>

      {/* Steps */}
      <ol className="flex flex-col">
        {agent.steps.map((step, index) => (
          <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
            {index < agent.steps.length - 1 ? (
              <span className="absolute start-[0.6875rem] top-6 bottom-0 w-px bg-line" aria-hidden="true" />
            ) : null}
            <span className="relative grid size-[1.375rem] shrink-0 place-items-center rounded-full border border-line bg-surface-2 font-mono text-[10px] text-muted-foreground">
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h4 className="text-sm font-medium leading-[1.375rem] text-foreground">{step.title}</h4>
              {step.body ? <p className="text-xs leading-relaxed text-muted-foreground">{step.body}</p> : null}
              {step.action ? (
                <a
                  href={step.action.href}
                  className="inline-flex h-8 w-fit items-center gap-2 rounded-lg border border-line bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 active:scale-[0.98]"
                >
                  {step.action.label}
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              ) : null}
              {step.code ? <CodeBlock code={step.code} file={step.file} /> : null}
            </div>
          </li>
        ))}
      </ol>
      {agent.note ? <p className="text-xs leading-relaxed text-muted-foreground">{agent.note}</p> : null}

      {/* First prompt */}
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <h4 className="text-xs font-medium text-foreground">Try a first prompt</h4>
        <div className="flex flex-col gap-1.5">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void copy(prompt)}
              className="group flex min-w-0 items-center gap-2.5 rounded-lg border border-line/70 px-3 py-2 text-start text-xs text-muted-foreground transition-colors hover:border-line hover:bg-secondary/60 hover:text-foreground"
            >
              <span className="min-w-0 flex-1 truncate">{prompt}</span>
              {copied === prompt ? (
                <span className="shrink-0 text-[11px] font-medium text-success-foreground">Copied</span>
              ) : (
                <CopyIcon className="size-3.5 shrink-0 opacity-50 group-hover:opacity-100" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
