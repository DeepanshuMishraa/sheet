import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { directExecute } from './executor'
import {
  advertisedTools,
  normalizeJsonArguments,
  validateToolArguments,
  type JsonValue,
} from './tools'

console.error('[sheet-mcp] stdio ready as the local user')

const server = new Server(
  { name: 'sheet', version: '0.3.0' },
  { capabilities: { tools: { listChanged: true } } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: advertisedTools,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name
  const raw = (request.params.arguments ?? {}) as JsonValue
  const args: JsonValue =
    raw && typeof raw === 'object' ? structuredClone(raw) : {}
  normalizeJsonArguments(args)
  const invalid = validateToolArguments(name, args)
  if (invalid) {
    return {
      content: [
        { type: 'text', text: `Invalid arguments for tool ${name}: ${invalid}` },
      ],
      isError: true,
    }
  }
  try {
    return (await directExecute('', name, args)) as {
      content: Array<{ type: string; text?: string }>
      isError?: boolean
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
