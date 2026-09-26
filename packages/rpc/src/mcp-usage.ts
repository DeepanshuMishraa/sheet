import type { McpIncludedUsage, McpUsageController } from './mcp-server'

/**
 * Local-first usage meters: everything is unlimited and nothing is reported
 * anywhere. The tool executor takes a usage controller and never asks which
 * meter is behind it, so the shape stays while the billing goes away.
 */
function unlimited(): McpIncludedUsage {
  return {
    metric: 'mcp_tool_calls',
    plan: 'local',
    included: null,
    used: 0,
    remaining: null,
    resetsAt: null,
  }
}

export function createMcpUsageController(): McpUsageController {
  return {
    current: async () => unlimited(),
    reserve: async () => unlimited(),
  }
}

export function createAgentUsageController(): McpUsageController {
  return {
    current: async () => unlimited(),
    reserve: async () => unlimited(),
  }
}
