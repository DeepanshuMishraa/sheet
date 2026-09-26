import { useState } from 'react'
import {
  CheckIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from '@sheet/ui/icons'
import { cn } from '@sheet/ui/utils'

function CursorIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1.5l9 5.2v10.6l-9 5.2-9-5.2V6.7l9-5.2zm0 2.3L4.8 8 12 12.2 19.2 8 12 3.8zm-7.2 6v7.4l7.2 4.2v-7.4L4.8 9.8zm14.4 0l-7.2 4.2v7.4l7.2-4.2V9.8z" />
    </svg>
  )
}

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14" />
    </svg>
  )
}

function ClaudeCodeIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 10l3 2-3 2M12 14h6" />
    </svg>
  )
}

function GitHubCopilotIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a9 9 0 0 0-9 9c0 3.2 1.7 6 4.2 7.5v-1.8A7 7 0 0 1 5 11a7 7 0 0 1 14 0c0 2.4-1.2 4.5-3.1 5.7v1.8c2.5-1.5 4.1-4.3 4.1-7.5a9 9 0 0 0-9-9zm-3 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
    </svg>
  )
}

function VSCodeIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.5 2.5a1.5 1.5 0 0 0-1.2.5L7.5 11.2 4 8.5a1 1 0 0 0-1.5.8v9.4a1 1 0 0 0 1.5.8l3.5-2.7 9.8 8.2a1.5 1.5 0 0 0 2.5-1.1V3.9a1.5 1.5 0 0 0-1.3-1.4zm-1 5.7v11.6l-7-5.8 7-5.8z" />
    </svg>
  )
}

function OpenCodeIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  )
}

function CodexIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  )
}

function CodexCLIIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="M6 9l3 3-3 3M11 15h4" />
    </svg>
  )
}

function AntigravityIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3L2 20h4.5l5.5-10.5L17.5 20H22L12 3z" />
    </svg>
  )
}

function OtherAgentsIcon({ className }: { className?: string }) {
  return <MoreHorizontalIcon className={className} />
}

type AgentKey =
  | 'cursor'
  | 'claude'
  | 'claude-code'
  | 'github-copilot'
  | 'vscode'
  | 'opencode'
  | 'codex'
  | 'codex-cli'
  | 'antigravity'
  | 'other'

interface AgentDef {
  key: AgentKey
  name: string
  icon: (props: { className?: string }) => React.ReactNode
}

const AGENTS: AgentDef[] = [
  { key: 'cursor', name: 'Cursor', icon: CursorIcon },
  { key: 'claude', name: 'Claude', icon: ClaudeIcon },
  { key: 'claude-code', name: 'Claude Code', icon: ClaudeCodeIcon },
  { key: 'github-copilot', name: 'GitHub Copilot', icon: GitHubCopilotIcon },
  { key: 'vscode', name: 'VS Code', icon: VSCodeIcon },
  { key: 'opencode', name: 'OpenCode', icon: OpenCodeIcon },
  { key: 'codex', name: 'Codex', icon: CodexIcon },
  { key: 'codex-cli', name: 'Codex CLI', icon: CodexCLIIcon },
  { key: 'antigravity', name: 'Antigravity', icon: AntigravityIcon },
  { key: 'other', name: 'Other agents', icon: OtherAgentsIcon },
]

const EXAMPLE_PROMPTS = [
  'Create a basic Hello World frame in Sheet',
  'Create 3 color tokens and make a swatch in Sheet',
  'Generate an image of a beautiful sunset in Sheet',
]

const STDIO_CONFIG = `{
  "mcpServers": {
    "sheet": {
      "type": "stdio",
      "command": "/Users/dipxsy/.sheet/bin/sheet",
      "args": ["mcp"]
    }
  }
}`

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {}
  }
  return (
    <div className="relative rounded-xl border border-line bg-surface-2/40 p-4 font-mono text-xs leading-relaxed">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy configuration"
        title="Copy configuration"
        className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        {copied ? (
          <CheckIcon className="size-3.5 text-emerald-500" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </button>
      <pre className="overflow-x-auto pe-10 text-foreground">{code}</pre>
    </div>
  )
}

export function IntegrationsSettings() {
  const [selectedAgent, setSelectedAgent] = useState<AgentKey>('cursor')
  const [manualOpen, setManualOpen] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null)
  const [addedToCursor, setAddedToCursor] = useState(false)

  const activeAgent = AGENTS.find((a) => a.key === selectedAgent) ?? AGENTS[0]!

  const copyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedPrompt(prompt)
      window.setTimeout(() => setCopiedPrompt(null), 2000)
    } catch {}
  }

  const handleAddToCursor = () => {
    setAddedToCursor(true)
    window.location.href = 'cursor://settings/mcp'
    window.setTimeout(() => setAddedToCursor(false), 2500)
  }

  return (
    <main className="app-page-enter flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface text-foreground">
      <div className="mx-auto w-full max-w-4xl px-8 pt-8 pb-16">
        {/* Page Title */}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Connect your agent
        </h1>

        {/* Minimal Pill Tabs on Top */}
        <div className="mt-5 flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {AGENTS.map((agent) => {
            const Icon = agent.icon
            const isSelected = agent.key === selectedAgent
            return (
              <button
                key={agent.key}
                type="button"
                onClick={() => setSelectedAgent(agent.key)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all select-none',
                  isSelected
                    ? 'border border-line/80 bg-surface-2 text-foreground font-semibold shadow-xs'
                    : 'border border-transparent text-muted-foreground hover:bg-surface-2/60 hover:text-foreground',
                )}
              >
                <Icon
                  className={cn(
                    'size-3.5 shrink-0',
                    isSelected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                />
                <span>{agent.name}</span>
              </button>
            )
          })}
        </div>

        {/* Setup Steps */}
        <div className="mt-8 flex flex-col gap-8 max-w-2xl">
          {/* Step 1 */}
          <div className="flex items-center gap-3.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white shadow-xs">
              <CheckIcon className="size-3.5 stroke-[2.5]" />
            </div>
            <span className="text-sm font-medium text-foreground">
              Install Sheet Desktop
            </span>
          </div>

          {/* Step 2 */}
          <div className="flex items-start gap-3.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted-foreground border border-line">
              2
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-foreground mb-3">
                {selectedAgent === 'other'
                  ? 'Connect to other agents'
                  : `Connect to ${activeAgent.name}`}
              </h3>

              {selectedAgent === 'cursor' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/30 p-4">
                    <span className="text-sm text-foreground">
                      Add through the Cursor Marketplace
                    </span>
                    <button
                      type="button"
                      onClick={handleAddToCursor}
                      className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-3 transition-colors border border-line/60"
                    >
                      <CursorIcon className="size-3.5" />
                      <span>{addedToCursor ? 'Opening...' : 'Add to Cursor'}</span>
                    </button>
                  </div>

                  <div className="rounded-xl border border-line bg-surface-2/30 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setManualOpen(!manualOpen)}
                      className="flex w-full items-center justify-between p-4 text-sm text-foreground hover:bg-surface-2/40 transition-colors"
                    >
                      <span>Or, install manually</span>
                      <PlusIcon
                        className={cn(
                          'size-4 text-muted-foreground transition-transform duration-200',
                          manualOpen && 'rotate-45',
                        )}
                      />
                    </button>
                    {manualOpen && (
                      <div className="border-t border-line p-4 pt-3 flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">
                          Add Sheet to your Cursor MCP config (`cursor://settings/mcp` or `~/.cursor/mcp.json`):
                        </p>
                        <CodeBlock code={STDIO_CONFIG} />
                      </div>
                    )}
                  </div>
                </div>
              ) : selectedAgent === 'vscode' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/30 p-4">
                    <span className="text-sm text-foreground">
                      Install through VS Code Marketplace
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = 'vscode:extension/sheet'
                      }}
                      className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-3 transition-colors border border-line/60"
                    >
                      <VSCodeIcon className="size-3.5" />
                      <span>Install in VS Code</span>
                    </button>
                  </div>
                  <div className="rounded-xl border border-line bg-surface-2/30 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setManualOpen(!manualOpen)}
                      className="flex w-full items-center justify-between p-4 text-sm text-foreground hover:bg-surface-2/40 transition-colors"
                    >
                      <span>Or, install manually</span>
                      <PlusIcon
                        className={cn(
                          'size-4 text-muted-foreground transition-transform duration-200',
                          manualOpen && 'rotate-45',
                        )}
                      />
                    </button>
                    {manualOpen && (
                      <div className="border-t border-line p-4 pt-3 flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">
                          Add to your VS Code MCP config:
                        </p>
                        <CodeBlock code={STDIO_CONFIG} />
                      </div>
                    )}
                  </div>
                </div>
              ) : selectedAgent === 'claude-code' ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    Run this command in your terminal to connect Claude Code:
                  </p>
                  <CodeBlock code="claude mcp add --transport http sheet http://127.0.0.1:4100/mcp" />
                </div>
              ) : selectedAgent === 'codex-cli' ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    Run this command in your terminal to connect Codex CLI:
                  </p>
                  <CodeBlock code="codex mcp add sheet -- /Users/dipxsy/.sheet/bin/sheet mcp" />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    Add Sheet to the MCP config of your agent harness:
                  </p>
                  <CodeBlock code={STDIO_CONFIG} />
                  <p className="text-xs text-muted-foreground mt-1">
                    Note: Your agent harness may use a different format for the config file. Make sure to check its documentation and tweak as needed.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex items-start gap-3.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted-foreground border border-line">
              3
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-foreground mb-1">
                Run your first prompt
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Run one of these example prompts in{' '}
                {selectedAgent === 'other'
                  ? 'your agent harness'
                  : activeAgent.name}{' '}
                to test the connection:
              </p>
              <div className="flex flex-col gap-2">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void copyPrompt(prompt)}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/30 px-4 py-3 text-xs text-foreground hover:bg-surface-2 transition-colors text-start group shadow-xs"
                  >
                    <CopyIcon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                    <span className="flex-1 truncate">{prompt}</span>
                    {copiedPrompt === prompt && (
                      <span className="shrink-0 text-2xs font-semibold text-emerald-500">
                        Copied!
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
