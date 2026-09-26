import { useState } from 'react'
import { CheckIcon, ClipboardIcon } from '@loora/ui/icons'
import { Button } from '@loora/ui/button'
import { IntegrationCard } from './integration-card'

/**
 * Local MCP server info. The desktop app starts its own MCP endpoint on
 * loopback — point any MCP client at it, no accounts or tokens needed.
 */
const MCP_URL = 'http://127.0.0.1:4100/mcp'

const CLIENT_SNIPPETS = [
  {
    name: 'Claude Code (`mcp add`)',
    text: 'claude mcp add --transport http loora http://127.0.0.1:4100/mcp',
  },
  {
    name: 'Codex / Cursor / opencode (`mcp.json`)',
    text: '{\n  "mcpServers": {\n    "loora": { "url": "http://127.0.0.1:4100/mcp" }\n  }\n}',
  },
] as const

function Snippet({ name, text }: { name: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked — the text stays selectable below.
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">{name}</p>
        <Button size="xs" variant="ghost" onClick={() => void copy()}>
          {copied ? <CheckIcon /> : <ClipboardIcon />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-2xs leading-relaxed">
        {text}
      </pre>
    </div>
  )
}

export function IntegrationsSettings() {
  return (
    <div className="flex flex-col gap-5">
      <IntegrationCard
        title="Local MCP server"
        status={
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-2xs font-medium text-emerald-600">
            Running with this app
          </span>
        }
        description="Claude, Codex, Cursor, or opencode edit the same designs through typed tools — the same document open in the editor."
      >
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">Endpoint</p>
          <code className="rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs">
            {MCP_URL}
          </code>
        </div>
        {CLIENT_SNIPPETS.map((snippet) => (
          <Snippet key={snippet.name} name={snippet.name} text={snippet.text} />
        ))}
        <p className="text-2xs text-muted-foreground">
          Served by the app on startup (override with LOORA_MCP_PORT). No
          sign-in, no tokens — it only listens on loopback.
        </p>
      </IntegrationCard>
    </div>
  )
}
