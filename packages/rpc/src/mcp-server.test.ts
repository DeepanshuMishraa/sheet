import { afterEach, describe, expect, test } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import mcpToolManifest from '../../../apps/mcp/src/tools.json'
import {
  appUrl,
  createSheetServer,
  createSheetToolExecutor,
} from './mcp-server'
import type { McpUsageController } from './mcp-server'

const originalAppUrl = process.env.SHEET_APP_URL

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.SHEET_APP_URL
  else process.env.SHEET_APP_URL = originalAppUrl
})

function usageController(): McpUsageController {
  const snapshot = {
    metric: 'mcp_tool_calls' as const,
    plan: 'free' as const,
    included: 200,
    used: 12,
    remaining: 188,
    periodStart: '2026-07-27T00:00:00.000Z',
    resetsAt: '2026-08-03T00:00:00.000Z',
  }
  return {
    current: async () => snapshot,
    reserve: async () => snapshot,
  }
}

describe('MCP agent workflow', () => {
  test('executes the same registered handlers through the internal API boundary', async () => {
    const execute = createSheetToolExecutor('user-test', usageController())
    const result = await execute('getUsage', {}) as {
      content: Array<{ type: string; text: string }>
    }
    expect(result.content[0]?.type).toBe('text')
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      metric: 'mcp_tool_calls',
      used: 12,
      remaining: 188,
    })
  })

  test('returns canonical Main and branch editor URLs', () => {
    process.env.SHEET_APP_URL = 'https://sheet.test/'

    expect(appUrl('design one')).toBe(
      'https://sheet.test/design/design%20one',
    )
    expect(
      appUrl('design one', 'branch one', { node: 'text-title' }),
    ).toBe(
      'https://sheet.test/design/design%20one/b/branch%20one?node=text-title',
    )
  })

  test('advertises web tools and a real screenshot tool', async () => {
    let reservations = 0
    const usage = usageController()
    const server = createSheetServer('user-test', {
      current: usage.current,
      reserve: async () => {
        reservations += 1
        return usage.reserve()
      },
    })
    const client = new Client({ name: 'sheet-test', version: '1.0.0' })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const tools = await client.listTools()
      const names = new Set(tools.tools.map((tool) => tool.name))
      expect(names.has('getWebDocument')).toBe(true)
      expect(names.has('getWebHTML')).toBe(true)
      expect(names.has('getWebCSS')).toBe(true)
      expect(names.has('applyWebTransaction')).toBe(true)
      expect(names.has('getWebScreenshot')).toBe(true)
      expect(names.has('getUsage')).toBe(true)
      expect(names.has('exportCode')).toBe(false)
      expect(names.has('getScreenshot')).toBe(false)
      expect(names.has('insertNodes')).toBe(false)
      const applyWebTransaction = tools.tools.find(
        (tool) => tool.name === 'applyWebTransaction',
      )
      expect(applyWebTransaction?.description).toContain('WebTransaction')
      expect(JSON.stringify(applyWebTransaction?.inputSchema)).toContain(
        'expectedRevision',
      )
      const getWebScreenshot = tools.tools.find(
        (tool) => tool.name === 'getWebScreenshot',
      )
      expect(getWebScreenshot?.description).toContain('PNG')
      expect(
        tools.tools.find((tool) => tool.name === 'getWebScreenshot')
          ?.annotations?.readOnlyHint,
      ).toBe(true)
      const usageResult = await client.callTool({
        name: 'getUsage',
        arguments: {},
      })
      expect(usageResult.isError).not.toBe(true)
      if (!Array.isArray(usageResult.content)) {
        throw new Error('Expected getUsage to return content')
      }
      const usageContent = usageResult.content[0]
      if (usageContent?.type !== 'text') {
        throw new Error('Expected getUsage to return text')
      }
      expect(JSON.parse(usageContent.text).remaining).toBe(188)
      expect(usageResult._meta?.['sheet/usage']).toEqual(
        await usage.current(),
      )
      expect(reservations).toBe(0)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('keeps the tool manifest compact via shared schema definitions', async () => {
    const usage = usageController()
    const server = createSheetServer('user-test', usage)
    const client = new Client({ name: 'sheet-test', version: '1.0.0' })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const { tools } = await client.listTools()
      expect(JSON.parse(JSON.stringify(tools))).toEqual(mcpToolManifest)
      expect(tools.length).toBeGreaterThanOrEqual(15)
      expect(JSON.stringify(tools).length).toBeLessThan(100_000)
      // Conversion still keeps the vocabulary the agents rely on. Operation
      // payloads stay z.unknown (validated by parseWebTransaction, not the
      // manifest), so the op list lives in the tool description.
      const applyWebTransaction = tools.find((tool) => tool.name === 'applyWebTransaction')
      expect(applyWebTransaction?.description).toContain('node.patch')
      expect(applyWebTransaction?.description).toContain('instance.setOverride')
      expect(applyWebTransaction?.description).toContain('component.define')
    } finally {
      await client.close()
      await server.close()
    }
  })
})
