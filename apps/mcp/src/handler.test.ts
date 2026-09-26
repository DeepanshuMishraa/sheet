import { afterEach, describe, expect, test, vi } from 'vitest'
import { configFrom } from './config'
import { createAppState, handleRequest } from './handler'

function configWith(values: Record<string, string>) {
  return configFrom((key) => values[key])
}

async function mcpCall(
  state: ReturnType<typeof createAppState>,
  body: unknown,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json, text/event-stream')
  }
  if (!headers.has('host')) headers.set('host', 'localhost:4100')
  return handleRequest(
    new Request('http://localhost:4100/mcp', {
      method: 'POST',
      ...init,
      headers,
      body: JSON.stringify(body),
    }),
    state,
  )
}

describe('MCP local HTTP contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('no token is required and tools execute directly', async () => {
    vi.stubEnv('SHEET_SQLITE_PATH', ':memory:')
    const state = createAppState(
      configWith({ MCP_PUBLIC_URL: 'http://localhost:4100' }),
    )
    const response = await mcpCall(state, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'getUsage', arguments: {} },
    })
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.result.content[0].text).toContain('"plan":"local"')
  })

  test('initialize negotiates the protocol without auth', async () => {
    const state = createAppState(
      configWith({ MCP_PUBLIC_URL: 'http://localhost:4100' }),
    )
    const response = await mcpCall(state, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.result.serverInfo.name).toBe('sheet')
  })

  test('unknown paths are 404', async () => {
    const state = createAppState(
      configWith({ MCP_PUBLIC_URL: 'http://localhost:4100' }),
    )
    const response = await handleRequest(
      new Request('http://localhost:4100/.well-known/oauth-protected-resource', {
        headers: { host: 'localhost:4100' },
      }),
      state,
    )
    expect(response.status).toBe(404)
  })
})
