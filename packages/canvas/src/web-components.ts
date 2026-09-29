import type { WebNodeId } from './web-model'
import type { WebNode } from './web-model'

/**
 * Component metadata for {@link WebDocument}.
 *
 * Components are an authoring abstraction *around* the web document, never a
 * rendering primitive:
 *
 * - A component is a reusable DOM subtree (ordinary `WebNode`s) plus an
 *   owned authored stylesheet plus metadata. There are no variants, no
 *   layout fields, no style bags on the definition.
 * - An instance is ordinary materialized WebNodes in the live tree plus a
 *   binding record (`live node -> template node`) and an override journal.
 *   Instances are not a node kind; the renderer never sees them.
 * - Overrides are explicit transactions only, in exactly three web-native
 *   shapes: text content, attributes, and CSS custom properties. Direct
 *   `node.patch` on a bound live node is rejected, even for otherwise valid
 *   edits, so the vocabulary stays explicit: `node.patch` edits the node it
 *   names, `instance.setOverride` intentionally diverges an instance.
 * - Template edits propagate by replaying document operations onto bound
 *   live subtrees in the same transaction. That replay is document
 *   maintenance, not rendering: the browser still owns matching, cascade,
 *   layout, and computed values, and component CSS reaches instances
 *   through the normal cascade with zero propagation code.
 * - Overrides are keyed by live node ID, but their meaning is
 *   `template node -> live node -> divergence`. Bindings and journal entries
 *   for removed nodes are dropped with the nodes; IDs are never reused, so
 *   an override can never silently attach to a recreated node.
 */

export const MAX_WEB_COMPONENTS = 256
export const MAX_WEB_INSTANCES = 2_000
export const MAX_COMPONENT_NESTING_DEPTH = 32

export const BOUND_NODE_ERROR =
  'Cannot patch a bound instance node directly. Use instance.setOverride to create an instance override.'

export interface WebComponent {
  id: string
  name: string
  /** M4 supports exactly one template root; enforced by validation. */
  templateRootIds: WebNodeId[]
  stylesheetId: string | null
  description?: string
}

export interface WebTextOverride {
  kind: 'text'
  text: string
}

export interface WebAttributesOverride {
  kind: 'attributes'
  attributes: Record<string, string | null>
}

export interface WebCustomPropertiesOverride {
  kind: 'custom-properties'
  properties: Record<string, string | null>
}

export type WebOverride =
  | WebTextOverride
  | WebAttributesOverride
  | WebCustomPropertiesOverride

export interface WebInstance {
  id: string
  componentId: string
  rootId: WebNodeId
  /** Live node ID -> template node ID. */
  bindings: Record<WebNodeId, WebNodeId>
  /** Live node ID -> divergence from its template node. */
  overrides: Record<WebNodeId, WebOverride>
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validName(name: string) {
  return name.length > 0 && name.length <= 200
}

/**
 * All node IDs reachable from a component's template roots, following
 * parent links that stay inside the `nodes` map.
 */
export function templateMemberIds(
  nodes: Record<WebNodeId, WebNode>,
  templateRootIds: WebNodeId[],
): Set<WebNodeId> {
  const members = new Set<WebNodeId>()
  const visit = (id: WebNodeId) => {
    if (members.has(id)) return
    const node = nodes[id]
    if (!node) return
    members.add(id)
    for (const child of Object.values(nodes)) {
      if (child.parentId === id) visit(child.id)
    }
  }
  for (const rootId of templateRootIds) visit(rootId)
  return members
}

/**
 * Which component's template owns this node, by walking to its null-parent
 * ancestor and matching template roots. Returns null for live-tree nodes.
 */
export function templateOwner(
  nodes: Record<WebNodeId, WebNode>,
  components: Record<string, WebComponent>,
  nodeId: WebNodeId,
): string | null {
  let current: WebNode | undefined = nodes[nodeId]
  const visited = new Set<WebNodeId>()
  while (current && current.parentId !== null) {
    if (visited.has(current.id)) return null
    visited.add(current.id)
    current = nodes[current.parentId]
  }
  if (!current) return null
  for (const component of Object.values(components)) {
    if (component.templateRootIds.includes(current.id)) return component.id
  }
  return null
}

export function assertOverride(value: unknown, name: string): WebOverride {
  if (!record(value) || typeof value.kind !== 'string') {
    throw new Error(`${name} is invalid`)
  }
  if (value.kind === 'text') {
    if (typeof value.text !== 'string') throw new Error(`${name} is invalid`)
    return { kind: 'text', text: value.text }
  }
  if (value.kind === 'attributes' || value.kind === 'custom-properties') {
    const field = value.kind === 'attributes' ? value.attributes : value.properties
    if (!record(field)) throw new Error(`${name} is invalid`)
    const entries: Record<string, string | null> = {}
    for (const [key, entry] of Object.entries(field)) {
      if (typeof key !== 'string' || key.length === 0 || key.length > 500) {
        throw new Error(`${name} has an invalid key`)
      }
      if (entry !== null && typeof entry !== 'string') {
        throw new Error(`${name}.${key} is invalid`)
      }
      if (value.kind === 'custom-properties' && !key.startsWith('--')) {
        throw new Error(
          `${name}.${key} is invalid: custom-property overrides must start with "--"`,
        )
      }
      entries[key] = entry
    }
    return value.kind === 'attributes'
      ? { kind: 'attributes', attributes: entries }
      : { kind: 'custom-properties', properties: entries }
  }
  throw new Error(`${name} has an unknown override kind`)
}

export function assertWebComponent(
  value: unknown,
  id: string,
  nodes: Record<WebNodeId, WebNode>,
  stylesheets: Record<string, { id: string }>,
): WebComponent {
  if (!record(value) || value.id !== id) throw new Error(`components.${id} is invalid`)
  if (typeof value.name !== 'string' || !validName(value.name)) {
    throw new Error(`components.${id}.name is invalid`)
  }
  if (!Array.isArray(value.templateRootIds) || value.templateRootIds.length !== 1) {
    throw new Error(
      `components.${id} must have exactly one template root in the M4 model`,
    )
  }
  const rootId = value.templateRootIds[0] as unknown
  if (typeof rootId !== 'string') throw new Error(`components.${id}.templateRoots are invalid`)
  const root = nodes[rootId]
  if (!root || root.kind !== 'element' || root.parentId !== null) {
    throw new Error(`components.${id}.templateRoot must be a null-parent element`)
  }
  if (value.stylesheetId !== null) {
    if (typeof value.stylesheetId !== 'string' || !stylesheets[value.stylesheetId]) {
      throw new Error(`components.${id}.stylesheetId does not exist`)
    }
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    throw new Error(`components.${id}.description is invalid`)
  }
  if (value.description !== undefined && value.description.length > 2_000) {
    throw new Error(`components.${id}.description is too long`)
  }
  return {
    id,
    name: value.name,
    templateRootIds: [rootId],
    stylesheetId: value.stylesheetId,
    ...(value.description === undefined ? {} : { description: value.description }),
  }
}

export function assertWebInstance(
  value: unknown,
  id: string,
  nodes: Record<WebNodeId, WebNode>,
  components: Record<string, WebComponent>,
): WebInstance {
  if (!record(value) || value.id !== id) throw new Error(`instances.${id} is invalid`)
  if (typeof value.componentId !== 'string' || !components[value.componentId]) {
    throw new Error(`instances.${id}.componentId does not exist`)
  }
  if (typeof value.rootId !== 'string' || !nodes[value.rootId]) {
    throw new Error(`instances.${id}.rootId does not exist`)
  }
  if (!record(value.bindings) || !record(value.overrides)) {
    throw new Error(`instances.${id} has invalid bindings or overrides`)
  }
  const component = components[value.componentId] as WebComponent
  const members = templateMemberIds(nodes, component.templateRootIds)
  const bindings: Record<WebNodeId, WebNodeId> = {}
  for (const [liveId, templateId] of Object.entries(value.bindings)) {
    if (typeof templateId !== 'string' || !members.has(templateId)) {
      throw new Error(`instances.${id}.bindings.${liveId} targets no template node`)
    }
    if (!nodes[liveId]) throw new Error(`instances.${id}.bindings.${liveId} has no live node`)
    bindings[liveId] = templateId
  }
  const templateRoot = component.templateRootIds[0] as WebNodeId
  if (bindings[value.rootId] !== templateRoot) {
    throw new Error(`instances.${id}.rootId must bind the component template root`)
  }
  // Nested instance roots live inside a template tree, never as loose roots:
  // a null-parent node is either a document root or a template root, so a
  // nested instance root must have a non-null parent inside its template.
  const root = nodes[value.rootId] as WebNode
  const owner = templateOwner(nodes, components, value.rootId)
  if (owner !== null && root.parentId === null && !components[owner]?.templateRootIds.includes(value.rootId)) {
    throw new Error(`instances.${id}.rootId must sit inside its template tree`)
  }
  // A nested record roots at a placeholder inside its owner's template: a
  // childless element with empty authoring whose tag matches the nested
  // component's root, carrying no overrides of its own. The placeholder
  // holds position; content comes from the nested template at instantiation.
  const nestedOwner = templateOwner(nodes, components, value.rootId)
  if (nestedOwner !== null) {
    if (root.kind !== 'element') {
      throw new Error(`instances.${id}.rootId must be an element to nest a component`)
    }
    if (Object.keys(root.attributes).length > 0 || Object.keys(root.styles).length > 0) {
      throw new Error(`instances.${id}.rootId must be a bare placeholder to nest a component`)
    }
    if (Object.values(nodes).some((node) => node.parentId === value.rootId)) {
      throw new Error(`instances.${id}.rootId must be childless to nest a component`)
    }
    const nestedRoot = nodes[components[value.componentId]?.templateRootIds[0] as WebNodeId]
    if (!nestedRoot || nestedRoot.kind !== 'element' || nestedRoot.tag !== root.tag) {
      throw new Error(`instances.${id}.rootId tag must match its component template root`)
    }
    if (Object.keys(value.overrides as Record<string, unknown>).length > 0) {
      throw new Error(`instances.${id} nests a component and carries no overrides`)
    }
  }
  const overrides: Record<WebNodeId, WebOverride> = {}
  for (const [liveId, override] of Object.entries(value.overrides)) {
    if (!bindings[liveId]) {
      throw new Error(`instances.${id}.overrides.${liveId} binds no template node`)
    }
    const parsed = assertOverride(override, `instances.${id}.overrides.${liveId}`)
    const live = nodes[liveId] as WebNode
    if (parsed.kind === 'text' && live.kind !== 'text') {
      throw new Error(`instances.${id}.overrides.${liveId} targets a non-text node`)
    }
    if (parsed.kind !== 'text' && live.kind !== 'element') {
      throw new Error(`instances.${id}.overrides.${liveId} targets a non-element node`)
    }
    overrides[liveId] = parsed
  }
  return {
    id,
    componentId: value.componentId,
    rootId: value.rootId,
    bindings,
    overrides,
  }
}

/**
 * Template-containment edges: an instance whose root sits inside component
 * X's template while pointing at component C means X depends on C. The graph
 * must stay acyclic or propagation could recurse forever.
 */
export function componentDependencyEdges(
  nodes: Record<WebNodeId, WebNode>,
  components: Record<string, WebComponent>,
  instances: Record<string, WebInstance>,
): Map<string, string[]> {
  const edges = new Map<string, string[]>()
  for (const id of Object.keys(components)) edges.set(id, [])
  for (const instance of Object.values(instances)) {
    const owner = templateOwner(nodes, components, instance.rootId)
    if (owner !== null && owner !== instance.componentId) {
      edges.get(owner)?.push(instance.componentId)
    }
    if (owner === instance.componentId) {
      edges.get(owner)?.push(instance.componentId)
    }
  }
  return edges
}

function hasCycle(edges: Map<string, string[]>): boolean {
  const state = new Map<string, 'active' | 'done'>()
  const visit = (id: string): boolean => {
    const current = state.get(id)
    if (current === 'done') return false
    if (current === 'active') return true
    state.set(id, 'active')
    for (const next of edges.get(id) ?? []) {
      if (!edges.has(next)) continue
      if (visit(next)) return true
    }
    state.set(id, 'done')
    return false
  }
  for (const id of edges.keys()) {
    if (visit(id)) return true
  }
  return false
}

export function assertAcyclicComponents(
  nodes: Record<WebNodeId, WebNode>,
  components: Record<string, WebComponent>,
  instances: Record<string, WebInstance>,
): void {
  if (hasCycle(componentDependencyEdges(nodes, components, instances))) {
    throw new Error('Component instances contain a recursive cycle')
  }
}

/**
 * Prospective check for `instance.create`: would nesting `to` inside `from`'s
 * template close a dependency cycle? Pure query, no mutation.
 */
export function createsDependencyCycle(
  nodes: Record<WebNodeId, WebNode>,
  components: Record<string, WebComponent>,
  instances: Record<string, WebInstance>,
  from: string,
  to: string,
): boolean {
  const edges = componentDependencyEdges(nodes, components, instances)
  if (!edges.has(from) || !edges.has(to)) return false
  edges.get(from)?.push(to)
  return hasCycle(edges)
}

export function assertWebComponents(value: unknown): {
  components: Record<string, WebComponent>
  instances: Record<string, WebInstance>
} {
  if (!record(value)) throw new Error('Web components are invalid')
  const { nodes, stylesheets, components, instances } = value as {
    nodes: unknown
    stylesheets: unknown
    components: unknown
    instances: unknown
  }
  if (!record(nodes) || !record(stylesheets)) {
    throw new Error('Web components need nodes and stylesheets to validate against')
  }
  if (!record(components) || !record(instances)) {
    throw new Error('Web components are invalid')
  }
  const componentEntries = Object.entries(components)
  const instanceEntries = Object.entries(instances)
  if (componentEntries.length > MAX_WEB_COMPONENTS) {
    throw new Error('Web document has too many components')
  }
  if (instanceEntries.length > MAX_WEB_INSTANCES) {
    throw new Error('Web document has too many instances')
  }
  const parsedComponents: Record<string, WebComponent> = {}
  for (const [id, component] of componentEntries) {
    parsedComponents[id] = assertWebComponent(
      component,
      id,
      nodes as Record<WebNodeId, WebNode>,
      stylesheets as Record<string, { id: string }>,
    )
  }
  const parsedInstances: Record<string, WebInstance> = {}
  for (const [id, instance] of instanceEntries) {
    parsedInstances[id] = assertWebInstance(
      instance,
      id,
      nodes as Record<WebNodeId, WebNode>,
      parsedComponents,
    )
  }
  assertAcyclicComponents(
    nodes as Record<WebNodeId, WebNode>,
    parsedComponents,
    parsedInstances,
  )
  return { components: parsedComponents, instances: parsedInstances }
}

/**
 * Live node ID -> its instance and template counterpart. Rebuilt per
 * transaction from the instances index; the single place bound-node checks
 * consult.
 */
export function boundNodeIndex(
  instances: Record<string, WebInstance>,
): Map<WebNodeId, { instanceId: string; templateId: WebNodeId }> {
  const index = new Map<WebNodeId, { instanceId: string; templateId: WebNodeId }>()
  for (const instance of Object.values(instances)) {
    for (const [liveId, templateId] of Object.entries(instance.bindings)) {
      index.set(liveId, { instanceId: instance.id, templateId })
    }
  }
  return index
}


