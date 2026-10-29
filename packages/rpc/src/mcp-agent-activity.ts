import {
  AGENT_ACTIVITY_FINISHED_TTL_MS,
  AGENT_ACTIVITY_SETTLED_TTL_MS,
  AGENT_ACTIVITY_WORKING_TTL_MS,
  canvasRealtimeChannel,
  publishCanvasAgentActivity,
  type CanvasRealtimeActivity,
  type CanvasRealtimeTarget,
} from '@sheet/db/canvas-realtime'
import type { AgentIdentity } from './mcp-agent-identity'

/**
 * What each tool looks like to somebody watching the editor. Tools missing from
 * this map — usage checks, listings, anything without a design — publish
 * nothing, so the badge never lights up for work that is invisible anyway.
 */
const TOOL_LABELS: Record<string, string> = {
  getDesignContext: 'Reading the design',
  readTree: 'Reading the layers',
  readNode: 'Inspecting a layer',
  searchNodes: 'Searching the canvas',
  viewNode: 'Looking at a layer',
  viewPage: 'Looking at a page',
  viewCanvas: 'Looking at the canvas',
  getScreenshot: 'Taking a screenshot',
  exportCode: 'Exporting code',
  createPage: 'Adding a page',
  insertNodes: 'Adding elements',
  insertIcon: 'Adding an icon',
  listPages: 'Reading pages',
  listShaders: 'Browsing shaders',
  insertShader: 'Adding a shader',
  createFrame: 'Adding a frame',
  listFramePresets: 'Browsing frame sizes',
  styleShader: 'Styling a shader',
  patchNodes: 'Editing elements',
  moveNodes: 'Moving elements',
  deleteNodes: 'Deleting elements',
  createComponent: 'Creating a component',
  createInstance: 'Placing a component',
  setTokens: 'Updating tokens',
  setAnimations: 'Defining animations',
  animateNodes: 'Animating elements',
  renameDesign: 'Renaming the design',
  listVersions: 'Reading version history',
  listBranches: 'Reading branches',
  createBranch: 'Creating a branch',
  proposeBranch: 'Proposing a branch',
  reopenBranch: 'Reopening a branch',
  compareBranch: 'Comparing a branch',
  applyBranch: 'Applying a branch',
  closeBranch: 'Closing a branch',
  getWebDocument: 'Reading the design',
  getWebHTML: 'Reading the markup',
  getWebCSS: 'Reading the styles',
  getWebScreenshot: 'Taking a screenshot',
  applyWebTransaction: 'Editing the design',
  styleIcon: 'Styling an icon',
  exportDesign: 'Exporting the design',
  listComments: 'Reading comments',
  resolveComment: 'Resolving a comment',
  listAgents: 'Checking who else is here',
}

/**
 * How a call reads in a sentence about the node it targets: "Codex is editing
 * Heading". Only calls that are about particular nodes have one.
 */
const TOOL_VERBS: Record<string, string> = {
  readNode: 'inspecting',
  viewNode: 'looking at',
  insertNodes: 'adding to',
  insertIcon: 'adding an icon to',
  insertShader: 'adding a shader to',
  styleShader: 'styling',
  styleIcon: 'styling',
  patchNodes: 'editing',
  moveNodes: 'moving',
  deleteNodes: 'deleting',
  createComponent: 'componentizing',
  createInstance: 'placing a component in',
  animateNodes: 'animating',
  applyWebTransaction: 'editing',
}

/** Calls that change the nodes they name, so a second agent there is a clash. */
const WRITE_TOOLS = new Set([
  'patchNodes',
  'moveNodes',
  'deleteNodes',
  'styleIcon',
  'styleShader',
  'animateNodes',
  'applyWebTransaction',
  'createComponent',
])

/**
 * Calls that change the design. Only these ring their targets in the editor;
 * a read (a screenshot, the document) moves the cursor and highlights nothing.
 */
const MUTATING_TOOLS = new Set([
  ...WRITE_TOOLS,
  'createPage',
  'insertNodes',
  'insertIcon',
  'insertShader',
  'createFrame',
  'createInstance',
  'setTokens',
  'setAnimations',
  'renameDesign',
])

/** The overlay rings one node; the rest are only there to pick a visible one. */
const MAX_NODE_IDS = 24

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pushId(into: string[], value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    into.includes(value)
  ) {
    return
  }
  into.push(value)
}

function pushRef(into: string[], value: unknown) {
  if (record(value)) pushId(into, value.nodeId)
}

/** Nodes a web transaction touches: the `id` of node operations and the id of an inserted node. */
function pushTransactionIds(into: string[], transaction: unknown) {
  if (!record(transaction) || !Array.isArray(transaction.operations)) return
  for (const operation of transaction.operations) {
    if (!record(operation) || typeof operation.type !== 'string') continue
    if (operation.type.startsWith('node.')) pushId(into, operation.id)
    if (record(operation.node)) pushId(into, operation.node.id)
  }
}

/**
 * Which nodes this call is about, read from the arguments rather than the
 * result: the editor can ring them the moment the call starts instead of after
 * it lands.
 */
export function agentActivityNodeIds(args: unknown) {
  const ids: string[] = []
  if (!record(args)) return ids
  if (Array.isArray(args.changes)) {
    for (const change of args.changes) {
      if (!record(change)) continue
      pushRef(ids, change.ref)
      pushId(ids, change.nodeId)
    }
  }
  if (Array.isArray(args.nodeIds)) {
    for (const id of args.nodeIds) pushId(ids, id)
  }
  pushRef(ids, args.ref)
  pushRef(ids, args.parent)
  pushRef(ids, args.root)
  pushId(ids, args.nodeId)
  pushId(ids, args.rootId)
  pushId(ids, args.parentId)
  pushTransactionIds(ids, args.transaction)
  pushId(ids, args.componentId)
  pushId(ids, args.pageId)
  return ids.slice(0, MAX_NODE_IDS)
}

/**
 * The stylesheet rules a web transaction changes, as `stylesheetId/ruleId`, so
 * the editor can place the cursor on the elements a restyle reaches.
 */
export function agentActivityRuleIds(args: unknown) {
  const refs: string[] = []
  if (!record(args) || !record(args.transaction)) return refs
  const operations = args.transaction.operations
  if (!Array.isArray(operations)) return refs
  for (const operation of operations) {
    if (!record(operation) || typeof operation.type !== 'string' || !operation.type.startsWith('rule.')) continue
    const ruleId = record(operation.rule) ? operation.rule.id : operation.id
    if (typeof operation.stylesheetId === 'string' && typeof ruleId === 'string') {
      pushId(refs, `${operation.stylesheetId}/${ruleId}`.slice(0, 404))
    }
  }
  return refs.slice(0, MAX_NODE_IDS)
}

export function agentActivityTarget(
  args: unknown,
): CanvasRealtimeTarget | null {
  if (!record(args)) return null
  const designId =
    typeof args.designId === 'string' ? args.designId.trim() : ''
  if (designId.length === 0 || designId.length > 128) return null
  const draftId =
    typeof args.draftId === 'string' && args.draftId.trim().length > 0
      ? args.draftId.trim()
      : null
  return { designId, draftId }
}

interface AgentRun {
  id: string
  depth: number
}

/**
 * One run per agent per document, not per tool call. An agent's parallel calls
 * share it and only the last one to finish settles it, so the editor shows one
 * continuous cursor per agent rather than one that flickers between every read
 * and write. Two agents on one document are two runs.
 */
const runs = new Map<string, AgentRun>()

interface LiveEntry {
  userId: string
  target: CanvasRealtimeTarget
  activity: CanvasRealtimeActivity
}

/**
 * The latest activity of every agent, by room, so a tab that opens mid-run and
 * an agent asking who else is here both see the same picture. An agent leaves
 * when it calls `finishWork`, when its session closes, or when it has been
 * quiet past its window.
 */
const live = new Map<string, Map<string, LiveEntry>>()

/** How long a touched node counts as somebody else's for a clash warning. */
export const AGENT_CLAIM_MS = 20_000

function remember(room: string, entry: LiveEntry) {
  const agents = live.get(room) ?? new Map<string, LiveEntry>()
  agents.set(entry.activity.agent.id, entry)
  live.set(room, agents)
}

function present(room: string, now: number) {
  const agents = live.get(room)
  if (!agents) return []
  for (const [id, entry] of agents) {
    if (entry.activity.expiresAt <= now) agents.delete(id)
  }
  if (agents.size === 0) live.delete(room)
  return [...agents.values()].map((entry) => entry.activity)
}

/**
 * The agent is done: its cursor and avatar fade out now instead of waiting out
 * the idle window. With a target, in that document; without one (its session
 * closed), everywhere it was. Returns how many documents it left.
 */
export function finishAgentActivity(
  agent: AgentIdentity,
  where: { userId: string; target: CanvasRealtimeTarget } | null,
  publish: PublishAgentActivity = publishCanvasAgentActivity,
) {
  const rooms = where ? [canvasRealtimeChannel(where.userId, where.target)] : [...live.keys()]
  let left = 0
  for (const room of rooms) {
    const agents = live.get(room)
    const entry = agents?.get(agent.id)
    if (!agents || !entry) continue
    agents.delete(agent.id)
    if (agents.size === 0) live.delete(room)
    for (const key of runs.keys()) {
      if (key === `${room}|${agent.id}`) runs.delete(key)
    }
    const at = Date.now()
    void publish(entry.userId, entry.target, {
      ...entry.activity,
      phase: 'settled',
      updatedAt: at,
      expiresAt: at + AGENT_ACTIVITY_FINISHED_TTL_MS,
    })
    left += 1
  }
  return left
}

/** Activities whose window is still open, for a tab that just subscribed. */
export function liveAgentActivities(
  userId: string,
  target: CanvasRealtimeTarget,
  now = Date.now(),
) {
  return present(canvasRealtimeChannel(userId, target), now).filter(
    (activity) => activity.expiresAt > now,
  )
}

/** Every other agent still present in this document. */
export function otherAgents(
  userId: string,
  target: CanvasRealtimeTarget,
  self: AgentIdentity,
  now = Date.now(),
) {
  return present(canvasRealtimeChannel(userId, target), now)
    .filter((activity) => activity.agent.id !== self.id)
    .map((activity) => ({
      agent: { id: activity.agent.id, name: activity.agent.name, kind: activity.agent.kind },
      doing: activity.label,
      working: activity.phase === 'working',
      nodeIds: activity.nodeIds,
      secondsAgo: Math.max(0, Math.round((now - activity.updatedAt) / 1000)),
    }))
}

/**
 * Nodes this write names that another agent touched moments ago. A warning,
 * not a lock: the write still lands, and the agent decides whether to re-read.
 */
export function agentClashes(
  userId: string,
  self: AgentIdentity,
  toolName: string,
  args: unknown,
  now = Date.now(),
) {
  const target = agentActivityTarget(args)
  if (!target || !WRITE_TOOLS.has(toolName)) return []
  const mine = new Set(agentActivityNodeIds(args))
  if (mine.size === 0) return []
  return present(canvasRealtimeChannel(userId, target), now)
    .filter(
      (activity) =>
        activity.agent.id !== self.id &&
        now - activity.updatedAt <= AGENT_CLAIM_MS,
    )
    .map((activity) => ({
      agent: activity.agent.name,
      nodeIds: activity.nodeIds.filter((id) => mine.has(id)),
    }))
    .filter((clash) => clash.nodeIds.length > 0)
}

/**
 * Which other agents each agent has already been told about, per room, so the
 * first call after somebody arrives says "joined" and later calls only remind.
 */
const told = new Map<string, Set<string>>()

export interface AgentPeers {
  /** Agents this one has not been told about yet. */
  joined: ReturnType<typeof otherAgents>
  /** Every other agent present, newcomers included. */
  present: ReturnType<typeof otherAgents>
}

/**
 * The other agents in the document this call targets, with the ones this agent
 * is hearing about for the first time marked. Nothing to ask for: every
 * design-scoped call carries it, so an agent knows the moment it has company.
 */
export function agentPeers(
  userId: string,
  self: AgentIdentity,
  args: unknown,
  now = Date.now(),
): AgentPeers | null {
  const target = agentActivityTarget(args)
  if (!target) return null
  const present = otherAgents(userId, target, self, now)
  const key = `${canvasRealtimeChannel(userId, target)}|${self.id}`
  if (present.length === 0) {
    // Once alone again, a returning agent counts as joining anew.
    told.delete(key)
    return null
  }
  const known = told.get(key) ?? new Set<string>()
  const joined = present.filter((peer) => !known.has(peer.agent.id))
  told.set(key, new Set(present.map((peer) => peer.agent.id)))
  return { joined, present }
}

export interface AgentActivityHandle {
  end: () => void
}

type PublishAgentActivity = typeof publishCanvasAgentActivity

export function trackAgentActivity(
  userId: string,
  agent: AgentIdentity,
  toolName: string,
  args: unknown,
  publish: PublishAgentActivity = publishCanvasAgentActivity,
): AgentActivityHandle | null {
  const label = TOOL_LABELS[toolName]
  const target = agentActivityTarget(args)
  if (!label || !target) return null

  const room = canvasRealtimeChannel(userId, target)
  const key = `${room}|${agent.id}`
  const run = runs.get(key) ?? {
    id: `agent_${globalThis.crypto.randomUUID()}`,
    depth: 0,
  }
  run.depth += 1
  runs.set(key, run)

  const nodeIds = agentActivityNodeIds(args)
  const ruleIds = agentActivityRuleIds(args)
  const verb =
    nodeIds.length > 0
      ? (TOOL_VERBS[toolName] ?? null)
      : ruleIds.length > 0
        ? 'restyling'
        : null
  const announce = (phase: CanvasRealtimeActivity['phase']) => {
    const at = Date.now()
    const activity: CanvasRealtimeActivity = {
      id: run.id,
      agent,
      label,
      verb,
      nodeIds,
      ruleIds,
      mode: MUTATING_TOOLS.has(toolName) ? 'write' : 'read',
      phase,
      updatedAt: at,
      expiresAt:
        at +
        (phase === 'working'
          ? AGENT_ACTIVITY_WORKING_TTL_MS
          : AGENT_ACTIVITY_SETTLED_TTL_MS),
    }
    remember(room, { userId, target, activity })
    void publish(userId, target, activity)
  }
  announce('working')

  let ended = false
  return {
    end: () => {
      if (ended) return
      ended = true
      run.depth -= 1
      if (run.depth > 0) return
      // The agent called finishWork while this call was in flight: stay gone.
      if (runs.get(key) !== run) return
      runs.delete(key)
      announce('settled')
    },
  }
}
