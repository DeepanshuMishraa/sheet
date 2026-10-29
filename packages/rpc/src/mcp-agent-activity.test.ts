import { describe, expect, test } from 'vitest'
import {
  agentActivityNodeIds,
  agentActivityTarget,
  agentClashes,
  agentPeers,
  finishAgentActivity,
  liveAgentActivities,
  otherAgents,
  trackAgentActivity,
} from './mcp-agent-activity'
import { AgentIdentity } from './mcp-agent-identity'

const claude = AgentIdentity.fromClient('claude-code', 'session-claude')
const codex = AgentIdentity.fromClient('codex-mcp-client', 'session-codex')
const quiet = async () => true

describe('Agent activity', () => {
  test('rings the nodes a call names, edited ones first', () => {
    expect(
      agentActivityNodeIds({
        designId: 'design-1',
        changes: [
          { ref: { nodeId: 'text-title', instancePath: [] }, patch: {} },
          { ref: { nodeId: 'text-body', instancePath: [] }, patch: {} },
        ],
      }),
    ).toEqual(['text-title', 'text-body'])
    expect(
      agentActivityNodeIds({
        designId: 'design-1',
        parent: { nodeId: 'page-home', instancePath: [] },
        nodes: [{ type: 'text', text: 'Hello' }],
      }),
    ).toEqual(['page-home'])
    expect(
      agentActivityNodeIds({ designId: 'design-1', nodeIds: ['a', 'a', 'b'] }),
    ).toEqual(['a', 'b'])
    expect(agentActivityNodeIds({ designId: 'design-1' })).toEqual([])
  })

  test('reads the target and skips calls without a design', () => {
    expect(
      agentActivityTarget({ designId: ' design-1 ', draftId: ' branch-1 ' }),
    ).toEqual({ designId: 'design-1', draftId: 'branch-1' })
    expect(agentActivityTarget({ designId: 'design-1' })).toEqual({
      designId: 'design-1',
      draftId: null,
    })
    expect(agentActivityTarget({ name: 'New design' })).toBeNull()
    expect(agentActivityTarget('design-1')).toBeNull()
  })

  test('tracks nothing for tools without a design or a label', () => {
    expect(trackAgentActivity('user-1', claude, 'createDesign', { name: 'X' })).toBeNull()
    expect(
      trackAgentActivity('user-1', claude, 'getUsage', { designId: 'design-1' }),
    ).toBeNull()
  })

  test('shares one run across overlapping calls on the same document', async () => {
    const published: { id: string; phase: string; label: string }[] = []
    const publish = async (
      _userId: string,
      _target: unknown,
      activity: { id: string; phase: string; label: string } | null,
    ) => {
      if (activity) published.push(activity)
      return true
    }
    const args = { designId: 'design-overlap' }
    const first = trackAgentActivity('user-1', claude, 'readTree', args, publish)
    const second = trackAgentActivity(
      'user-1',
      claude,
      'patchNodes',
      {
        ...args,
        changes: [
          { ref: { nodeId: 'text-title', instancePath: [] }, patch: {} },
        ],
      },
      publish,
    )
    first?.end()
    // Ending twice must not settle a run that another call still holds.
    first?.end()
    expect(published.map((entry) => entry.phase)).toEqual([
      'working',
      'working',
    ])
    second?.end()
    expect(published).toHaveLength(3)
    expect(published[2]).toMatchObject({
      phase: 'settled',
      label: 'Editing elements',
    })
    expect(new Set(published.map((entry) => entry.id)).size).toBe(1)
  })

  test('keeps a separate run per agent on one document', () => {
    const args = { designId: 'design-two-agents' }
    const a = trackAgentActivity('user-1', claude, 'readTree', args, quiet)
    const b = trackAgentActivity('user-1', codex, 'readTree', args, quiet)
    const running = liveAgentActivities('user-1', { designId: 'design-two-agents' })
    expect(running.map((activity) => activity.agent.name).sort()).toEqual(['Claude', 'Codex'])
    expect(new Set(running.map((activity) => activity.id)).size).toBe(2)
    a?.end()
    b?.end()
  })

  test('says what a call is doing to the node it names', () => {
    trackAgentActivity(
      'user-1',
      codex,
      'patchNodes',
      { designId: 'design-verb', changes: [{ ref: { nodeId: 'heading' }, patch: {} }] },
      quiet,
    )?.end()
    const [activity] = liveAgentActivities('user-1', { designId: 'design-verb' })
    expect(activity).toMatchObject({ verb: 'editing', nodeIds: ['heading'], phase: 'settled' })
  })

  test('a restyle names the rules it changes, so the cursor can find their elements', () => {
    trackAgentActivity(
      'user-1',
      codex,
      'applyWebTransaction',
      {
        designId: 'design-restyle',
        transaction: {
          operations: [
            { type: 'rule.patch', stylesheetId: 'theme', id: 'r-btn', patch: {} },
            { type: 'rule.insert', stylesheetId: 'theme', rule: { id: 'r-btn-lg-hover' } },
          ],
        },
      },
      quiet,
    )?.end()
    const [activity] = liveAgentActivities('user-1', { designId: 'design-restyle' })
    expect(activity).toMatchObject({
      verb: 'restyling',
      nodeIds: [],
      ruleIds: ['theme/r-btn', 'theme/r-btn-lg-hover'],
    })
  })

  test('bridges the pause between calls, then leaves when quiet', () => {
    trackAgentActivity('user-1', codex, 'readTree', { designId: 'design-idle' }, quiet)?.end()
    const room = { designId: 'design-idle' }
    expect(liveAgentActivities('user-1', room, Date.now() + 20_000)).toHaveLength(1)
    expect(liveAgentActivities('user-1', room, Date.now() + 31_000)).toHaveLength(0)
  })

  test('leaves at once when it says it is done, even with a call in flight', () => {
    const published: { phase: string; expiresAt: number; updatedAt: number }[] = []
    const record = async (
      _userId: string,
      _target: unknown,
      activity: { phase: string; expiresAt: number; updatedAt: number } | null,
    ) => {
      if (activity) published.push(activity)
      return true
    }
    const room = { designId: 'design-finish' }
    const inFlight = trackAgentActivity('user-1', claude, 'patchNodes', room, record)
    expect(finishAgentActivity(claude, { userId: 'user-1', target: room }, record)).toBe(1)
    inFlight?.end()
    expect(liveAgentActivities('user-1', room)).toEqual([])
    const last = published.at(-1)
    expect(last?.phase).toBe('settled')
    expect((last?.expiresAt ?? 0) - (last?.updatedAt ?? 0)).toBeLessThan(2_000)
    expect(published).toHaveLength(2)
  })

  test('a closed session leaves every document it was in', () => {
    trackAgentActivity('user-1', codex, 'readTree', { designId: 'design-a' }, quiet)?.end()
    trackAgentActivity('user-1', codex, 'readTree', { designId: 'design-b' }, quiet)?.end()
    expect(finishAgentActivity(codex, null, quiet)).toBeGreaterThanOrEqual(2)
    expect(liveAgentActivities('user-1', { designId: 'design-a' })).toEqual([])
    expect(liveAgentActivities('user-1', { designId: 'design-b' })).toEqual([])
  })

  test('only calls that change the design ring their targets', () => {
    trackAgentActivity('user-1', claude, 'getWebScreenshot', { designId: 'design-mode', rootId: 'hero' }, quiet)?.end()
    expect(liveAgentActivities('user-1', { designId: 'design-mode' })[0]).toMatchObject({ mode: 'read', nodeIds: ['hero'] })
    trackAgentActivity('user-1', claude, 'patchNodes', { designId: 'design-mode', nodeIds: ['hero'] }, quiet)?.end()
    expect(liveAgentActivities('user-1', { designId: 'design-mode' })[0]).toMatchObject({ mode: 'write' })
  })

  test('warns a writer about nodes another agent just touched, never about its own', () => {
    const args = {
      designId: 'design-clash',
      changes: [{ ref: { nodeId: 'hero' }, patch: {} }],
    }
    trackAgentActivity('user-1', codex, 'patchNodes', args, quiet)?.end()
    expect(agentClashes('user-1', claude, 'patchNodes', args)).toEqual([
      { agent: 'Codex', nodeIds: ['hero'] },
    ])
    expect(agentClashes('user-1', codex, 'patchNodes', args)).toEqual([])
    expect(agentClashes('user-1', claude, 'readNode', { ...args, nodeId: 'hero' })).toEqual([])
    expect(
      agentClashes('user-1', claude, 'patchNodes', args, Date.now() + 30_000),
    ).toEqual([])
    expect(otherAgents('user-1', { designId: 'design-clash' }, claude)).toMatchObject([
      { agent: { name: 'Codex', kind: 'codex' }, working: false, nodeIds: ['hero'] },
    ])
  })
})

describe('Agents finding each other', () => {
  test('tells an agent once that another joined, then keeps it aware without asking', () => {
    const args = { designId: 'design-peers' }
    expect(agentPeers('user-1', claude, args)).toBeNull()
    trackAgentActivity('user-1', claude, 'readTree', args, quiet)?.end()
    trackAgentActivity('user-1', codex, 'readTree', args, quiet)?.end()

    const first = agentPeers('user-1', claude, args)
    expect(first?.joined.map((peer) => peer.agent.name)).toEqual(['Codex'])
    expect(first?.present.map((peer) => peer.agent.name)).toEqual(['Codex'])

    const later = agentPeers('user-1', claude, args)
    expect(later?.joined).toEqual([])
    expect(later?.present.map((peer) => peer.agent.name)).toEqual(['Codex'])

    // Codex hears about Claude on its own next call.
    expect(agentPeers('user-1', codex, args)?.joined.map((peer) => peer.agent.name)).toEqual(['Claude'])
  })

  test('says nothing for calls outside a design or when alone', () => {
    expect(agentPeers('user-1', claude, { name: 'New design' })).toBeNull()
    trackAgentActivity('user-1', claude, 'readTree', { designId: 'design-alone' }, quiet)?.end()
    expect(agentPeers('user-1', claude, { designId: 'design-alone' })).toBeNull()
  })
})

describe('Agent identity', () => {
  test('names the apps it knows from clientInfo or a User-Agent', () => {
    expect(AgentIdentity.fromClient('claude-code', 's1')).toEqual({ id: 's1', kind: 'claude', name: 'Claude' })
    expect(AgentIdentity.fromClient('codex-mcp-client', 's2').kind).toBe('codex')
    expect(AgentIdentity.fromClient('cursor-vscode', 's3').kind).toBe('cursor')
    expect(AgentIdentity.fromClient('Visual Studio Code', 's4').kind).toBe('copilot')
    expect(AgentIdentity.fromClient('opencode', 's5').kind).toBe('opencode')
  })

  test('keeps an unknown client readable and an empty one anonymous', () => {
    expect(AgentIdentity.fromClient('gemini-cli-mcp-client', 's6')).toEqual({
      id: 's6',
      kind: 'other',
      name: 'Gemini Cli',
    })
    expect(AgentIdentity.fromClient('  ', 's7')).toEqual({ id: 's7', kind: 'other', name: 'Agent' })
    expect(AgentIdentity.fromClient(null, 's8').name).toBe('Agent')
  })
})
