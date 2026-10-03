import {
  assertWebCondition,
  assertWebStyleRule,
  assertWebStyleSheet,
  assertWebStylesheets,
  MAX_WEB_RULES_PER_SHEET,
  MAX_WEB_STYLESHEETS,
  orderedWebRules,
  orderedWebStyleSheets,
  serializeWebStyleSheet,
  validStyleName,
  validStyleValue,
  validWebId,
  type WebCondition,
  type WebStyleRule,
  type WebStyleSheet,
} from './web-css'
import {
  assertOverride,
  assertWebComponent,
  assertWebComponents,
  assertWebInstance,
  boundNodeIndex,
  BOUND_NODE_ERROR,
  createsDependencyCycle,
  MAX_WEB_COMPONENTS,
  MAX_WEB_INSTANCES,
  MAX_COMPONENT_NESTING_DEPTH,
  templateMemberIds,
  templateOwner,
  type WebComponent,
  type WebInstance,
  type WebOverride,
} from './web-components'

export type WebNodeId = string

export function webId(prefix = 'web') {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export const WEB_DOCUMENT_SCHEMA_VERSION = 3 as const
export const WEB_DOCUMENT_SCHEMA_VERSION_V1 = 1 as const
export const WEB_DOCUMENT_SCHEMA_VERSION_V2 = 2 as const
export const WEB_CANVAS_STORAGE_VERSION = 3 as const
export const MAX_WEB_DOCUMENT_NODES = 25_000

export type WebNamespace = 'html' | 'svg'

interface WebNodeBase {
  id: WebNodeId
  parentId: WebNodeId | null
  order: number
}

export interface WebElementNode extends WebNodeBase {
  kind: 'element'
  namespace: WebNamespace
  tag: string
  attributes: Record<string, string>
  styles: Record<string, string>
}

export interface WebTextNode extends WebNodeBase {
  kind: 'text'
  text: string
}

export type WebNode = WebElementNode | WebTextNode

export interface WebDocument {
  model: 'web'
  schemaVersion: typeof WEB_DOCUMENT_SCHEMA_VERSION
  id: string
  name: string
  nodes: Record<WebNodeId, WebNode>
  roots: WebNodeId[]
  stylesheets: Record<string, WebStyleSheet>
  stylesheetOrder: string[]
  components: Record<string, WebComponent>
  instances: Record<string, WebInstance>
  metadata: {
    createdAt: number
    updatedAt: number
    migratedFrom?: number
    migrationWarnings?: string[]
    page?: { width: number; height: number }
  }
}

export type WebNodePatch =
  | {
      kind: 'element'
      tag?: string
      attributes?: Record<string, string | null>
      styles?: Record<string, string | null>
    }
  | { kind: 'text'; text: string }

export interface WebStylesheetPatch {
  name?: string
  order?: number
}

export interface WebRulePatch {
  selector?: string
  declarations?: Record<string, string | null>
  conditions?: WebCondition[]
}

export type WebOperation =
  | { type: 'page.resize'; width: number; height: number }
  | { type: 'page.reset' }
  | { type: 'node.insert'; node: WebNode }
  | { type: 'node.patch'; id: WebNodeId; patch: WebNodePatch }
  | { type: 'node.move'; id: WebNodeId; parentId: WebNodeId | null; order: number }
  | { type: 'node.delete'; id: WebNodeId }
  | { type: 'stylesheet.insert'; stylesheet: WebStyleSheet }
  | { type: 'stylesheet.patch'; id: string; patch: WebStylesheetPatch }
  | { type: 'stylesheet.delete'; id: string }
  | { type: 'rule.insert'; stylesheetId: string; rule: WebStyleRule }
  | {
      type: 'rule.patch'
      stylesheetId: string
      id: string
      patch: WebRulePatch
    }
  | { type: 'rule.move'; stylesheetId: string; id: string; order: number }
  | { type: 'rule.delete'; stylesheetId: string; id: string }
  | {
      type: 'component.define'
      component: WebComponent
      template: WebNode[]
      stylesheet?: WebStyleSheet
    }
  | { type: 'component.delete'; id: string }
  | {
      type: 'instance.create'
      id?: string
      componentId: string
      parentId: WebNodeId | null
      order: number
    }
  | { type: 'instance.delete'; id: string }
  | {
      type: 'instance.setOverride'
      instanceId: string
      id: WebNodeId
      override: WebOverride
    }
  | { type: 'instance.clearOverride'; instanceId: string; id: WebNodeId }
  | { type: 'instance.restore'; instance: WebInstance }

export interface WebTransaction {
  id: string
  label: string
  operations: WebOperation[]
}

export interface WebTransactionResult {
  document: WebDocument
  inverse: WebTransaction
  changedNodeIds: Set<WebNodeId>
}

const forbiddenTags = new Set([
  'base',
  'embed',
  'iframe',
  'link',
  'meta',
  'object',
  'script',
  'style',
  'template',
])
const urlAttributes = new Set(['action', 'formaction', 'href', 'poster', 'src', 'xlink:href'])
const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validTag(tag: string) {
  return /^[a-z][a-z0-9._-]*$/i.test(tag) && !forbiddenTags.has(tag.toLowerCase())
}

function validAttributeName(name: string) {
  return (
    /^[a-z_:][a-z0-9:._-]*$/i.test(name) &&
    name.toLowerCase() !== 'style' &&
    name.toLowerCase() !== 'srcdoc' &&
    !name.toLowerCase().startsWith('on') &&
    name !== 'data-sheet-node'
  )
}

function validUrl(value: string) {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.startsWith('#') ||
    normalized.startsWith('/') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:') ||
    /^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(normalized)
  )
}

function assertStringRecord(
  value: unknown,
  name: string,
  validateKey: (key: string) => boolean,
  validateValue: (key: string, value: string) => boolean = () => true,
) {
  if (!record(value)) throw new Error(`${name} must be an object`)
  for (const [key, entry] of Object.entries(value)) {
    if (!validateKey(key)) {
      throw new Error(
        `${name}.${key} is invalid: "${key}" is not a valid name.${/styles|declarations/.test(name) ? ' Use a lowercase CSS property like "font-size", a vendor-prefixed one like "-webkit-font-smoothing", or a "--custom-property".' : ''}`,
      )
    }
    if (typeof entry !== 'string') throw new Error(`${name}.${key} is invalid: must be a string`)
    if (!validateValue(key, entry)) {
      throw new Error(
        `${name}.${key} is invalid: values must be under 10,000 characters and cannot contain <style>, <script>, comments, expression() or javascript: URLs.`,
      )
    }
  }
}

function assertWebNode(value: unknown, id: string): asserts value is WebNode {
  if (!record(value) || value.id !== id) throw new Error(`nodes.${id} is invalid`)
  if (
    (value.parentId !== null && typeof value.parentId !== 'string') ||
    typeof value.order !== 'number' ||
    !Number.isFinite(value.order)
  ) {
    throw new Error(`nodes.${id} needs "parentId" (a node id or null) and a numeric "order"`)
  }
  if (value.kind === 'text') {
    if (typeof value.text !== 'string') throw new Error(`nodes.${id}.text is invalid`)
    return
  }
  if (value.kind !== 'element') {
    throw new Error(`nodes.${id}.kind must be "element" or "text", got ${JSON.stringify(value.kind)}. Put the tag name in "tag", for example { "kind": "element", "tag": "span" }`)
  }
  if (value.namespace !== 'html' && value.namespace !== 'svg') {
    throw new Error(`nodes.${id}.namespace must be "html" or "svg"`)
  }
  if (typeof value.tag !== 'string' || !validTag(value.tag)) {
    throw new Error(`nodes.${id}.tag ${JSON.stringify(value.tag)} is not a valid tag name`)
  }
  assertStringRecord(
    value.attributes,
    `nodes.${id}.attributes`,
    validAttributeName,
    (key, entry) => !urlAttributes.has(key.toLowerCase()) || validUrl(entry),
  )
  assertStringRecord(value.styles, `nodes.${id}.styles`, validStyleName, (_, entry) =>
    validStyleValue(entry),
  )
}

export function assertWebDocument(value: unknown): WebDocument {
  if (
    !record(value) ||
    value.model !== 'web' ||
    value.schemaVersion !== WEB_DOCUMENT_SCHEMA_VERSION
  ) {
    throw new Error('Web document schema version is invalid')
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !record(value.nodes) ||
    !Array.isArray(value.roots) ||
    !record(value.metadata)
  ) {
    throw new Error('Web document is invalid')
  }
  if (value.metadata.page !== undefined) {
    const page = value.metadata.page
    if (!record(page) || !validPageSize(page.width) || !validPageSize(page.height)) {
      throw new Error('Web page size is invalid')
    }
  }
  const entries = Object.entries(value.nodes)
  if (entries.length > MAX_WEB_DOCUMENT_NODES) throw new Error('Web document is too large')
  for (const [id, node] of entries) assertWebNode(node, id)

  const nodes = value.nodes as Record<WebNodeId, WebNode>
  const { components, instances } = assertWebComponents({
    nodes: value.nodes,
    stylesheets: (value as { stylesheets?: unknown }).stylesheets,
    components: (value as { components?: unknown }).components,
    instances: (value as { instances?: unknown }).instances,
  })
  const templateIds = new Set<WebNodeId>()
  for (const component of Object.values(components)) {
    for (const id of templateMemberIds(nodes, component.templateRootIds)) {
      templateIds.add(id)
    }
  }
  const expectedRoots = entries
    .map(([, node]) => node as WebNode)
    .filter((node) => node.parentId === null && !templateIds.has(node.id))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((node) => node.id)
  if (
    value.roots.length !== expectedRoots.length ||
    value.roots.some((id, index) => id !== expectedRoots[index])
  ) {
    throw new Error('Web document roots do not match its node tree')
  }
  for (const node of Object.values(nodes)) {
    if (node.parentId !== null || templateIds.has(node.id) || expectedRoots.includes(node.id)) {
      continue
    }
    throw new Error(`nodes.${node.id} is an orphaned null-parent node`)
  }
  for (const node of Object.values(nodes)) {
    if (node.parentId === null) continue
    const parent = nodes[node.parentId]
    if (!parent || parent.kind !== 'element') {
      throw new Error(`nodes.${node.id}.parentId must reference an element`)
    }
    const visited = new Set<WebNodeId>([node.id])
    let ancestor: WebNode | undefined = parent
    while (ancestor) {
      if (visited.has(ancestor.id)) throw new Error('Web document contains a cycle')
      visited.add(ancestor.id)
      ancestor = ancestor.parentId ? nodes[ancestor.parentId] : undefined
    }
  }
  const { stylesheets, stylesheetOrder } = assertWebStylesheets({
    stylesheets: (value as { stylesheets?: unknown }).stylesheets,
    stylesheetOrder: (value as { stylesheetOrder?: unknown }).stylesheetOrder,
  })
  return { ...(value as unknown as WebDocument), stylesheets, stylesheetOrder, components, instances }
}

/**
 * Reads a stored web document at schema v1, v2, or v3 and returns v3. v1
 * documents predate authored stylesheets and v2 documents predate
 * components; migration adds the empty state without touching nodes.
 * v3 documents validate strictly.
 */
export function parseWebDocument(value: unknown): WebDocument {
  if (record(value) && value.model === 'web') {
    const source = value as Record<string, unknown>
    if (value.schemaVersion === WEB_DOCUMENT_SCHEMA_VERSION_V1) {
      return assertWebDocument({
        ...source,
        schemaVersion: WEB_DOCUMENT_SCHEMA_VERSION,
        stylesheets: record(source.stylesheets) ? source.stylesheets : {},
        stylesheetOrder: Array.isArray(source.stylesheetOrder)
          ? source.stylesheetOrder
          : [],
        components: record(source.components) ? source.components : {},
        instances: record(source.instances) ? source.instances : {},
      })
    }
    if (value.schemaVersion === WEB_DOCUMENT_SCHEMA_VERSION_V2) {
      return assertWebDocument({
        ...source,
        schemaVersion: WEB_DOCUMENT_SCHEMA_VERSION,
        components: record(source.components) ? source.components : {},
        instances: record(source.instances) ? source.instances : {},
      })
    }
  }
  return assertWebDocument(value)
}

function parsePatchRecord(value: unknown, name: string) {
  if (value === undefined) return undefined
  if (!record(value)) throw new Error(`${name} is invalid`)
  const parsed: Record<string, string | null> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && typeof entry !== 'string') {
      throw new Error(`${name}.${key} is invalid`)
    }
    parsed[key] = entry
  }
  return parsed
}

function parseStylesheetId(value: unknown, name: string) {
  if (typeof value !== 'string' || !validWebId(value)) {
    throw new Error(`${name} is invalid`)
  }
  return value
}

function validPageSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 100_000
}

function parseWebOperation(value: unknown): WebOperation {
  if (!record(value) || typeof value.type !== 'string') {
    throw new Error('Web transaction operation is invalid')
  }
  if (value.type === 'page.reset') return { type: 'page.reset' }
  if (value.type === 'page.resize') {
    if (!validPageSize(value.width) || !validPageSize(value.height)) {
      throw new Error('Web page size must be between 1 and 100,000 pixels')
    }
    return { type: 'page.resize', width: value.width, height: value.height }
  }
  if (value.type === 'node.insert') {
    const node = structuredClone(value.node)
    if (!record(node) || typeof node.id !== 'string') {
      throw new Error('Web node insertion is invalid')
    }
    assertWebNode(node, node.id)
    return { type: 'node.insert', node }
  }
  if (value.type === 'stylesheet.insert') {
    const stylesheet = structuredClone(value.stylesheet)
    if (!record(stylesheet) || typeof stylesheet.id !== 'string') {
      throw new Error('Web stylesheet insertion is invalid')
    }
    parseStylesheetId(stylesheet.id, 'stylesheet.id')
    return { type: 'stylesheet.insert', stylesheet: assertWebStyleSheet(stylesheet, stylesheet.id) }
  }
  if (value.type === 'rule.insert') {
    const stylesheetId = parseStylesheetId(value.stylesheetId, 'stylesheetId')
    const rule = structuredClone(value.rule)
    if (!record(rule) || typeof rule.id !== 'string') {
      throw new Error('Web rule insertion is invalid')
    }
    parseStylesheetId(rule.id, 'rule.id')
    return { type: 'rule.insert', stylesheetId, rule: assertWebStyleRule(rule, rule.id) }
  }
  if (value.type === 'component.define') {
    const component = structuredClone(value.component)
    const template = structuredClone(value.template)
    if (!record(component) || typeof component.id !== 'string') {
      throw new Error('Web component definition is invalid')
    }
    parseStylesheetId(component.id, 'component.id')
    if (!Array.isArray(template) || template.length === 0) {
      throw new Error('Web component template is invalid')
    }
    const nodes: WebNode[] = template.map((node) => {
      if (!record(node) || typeof node.id !== 'string') {
        throw new Error('Web component template node is invalid')
      }
      assertWebNode(node, node.id)
      return node
    })
    let stylesheet: WebStyleSheet | undefined
    if (value.stylesheet !== undefined) {
      const sheet = structuredClone(value.stylesheet)
      if (!record(sheet) || typeof sheet.id !== 'string') {
        throw new Error('Web component stylesheet is invalid')
      }
      parseStylesheetId(sheet.id, 'component.stylesheet.id')
      stylesheet = assertWebStyleSheet(sheet, sheet.id)
    }
    if (
      typeof component.name !== 'string' ||
      component.name.length === 0 ||
      component.name.length > 200
    ) {
      throw new Error('Web component name is invalid')
    }
    if (
      !Array.isArray(component.templateRootIds) ||
      component.templateRootIds.some((id: unknown) => typeof id !== 'string')
    ) {
      throw new Error('Web component template roots are invalid')
    }
    if (
      component.stylesheetId !== null &&
      component.stylesheetId !== undefined &&
      component.stylesheetId !== stylesheet?.id
    ) {
      throw new Error('Web component stylesheet reference is invalid')
    }
    return {
      type: 'component.define',
      component: {
        id: component.id,
        name: component.name,
        templateRootIds: component.templateRootIds,
        stylesheetId: stylesheet?.id ?? null,
        ...(typeof component.description === 'string' ? { description: component.description } : {}),
      },
      template: nodes,
      ...(stylesheet === undefined ? {} : { stylesheet }),
    }
  }
  if (value.type === 'instance.restore') {
    const instance = structuredClone(value.instance)
    if (!record(instance) || typeof instance.id !== 'string') {
      throw new Error('Web instance restore is invalid')
    }
    parseStylesheetId(instance.id, 'instance.id')
    if (typeof instance.componentId !== 'string' || typeof instance.rootId !== 'string') {
      throw new Error('Web instance restore is invalid')
    }
    if (!record(instance.bindings) || !record(instance.overrides)) {
      throw new Error('Web instance restore is invalid')
    }
    for (const [liveId, templateId] of Object.entries(instance.bindings)) {
      if (typeof templateId !== 'string') {
        throw new Error(`Web instance restore binding ${liveId} is invalid`)
      }
    }
    for (const [liveId, override] of Object.entries(instance.overrides)) {
      assertOverride(override, `Web instance restore override ${liveId}`)
    }
    return {
      type: 'instance.restore',
      instance: {
        id: instance.id,
        componentId: instance.componentId,
        rootId: instance.rootId,
        bindings: instance.bindings as Record<WebNodeId, WebNodeId>,
        overrides: instance.overrides as Record<WebNodeId, WebOverride>,
      },
    }
  }
  if (value.type === 'instance.create') {
    const componentId = parseStylesheetId(value.componentId, 'componentId')
    if (
      (value.parentId !== null && typeof value.parentId !== 'string') ||
      typeof value.order !== 'number' ||
      !Number.isFinite(value.order)
    ) {
      throw new Error('Web instance creation is invalid')
    }
    const id = value.id === undefined ? undefined : parseStylesheetId(value.id, 'instance.id')
    return {
      type: 'instance.create',
      ...(id === undefined ? {} : { id }),
      componentId,
      parentId: value.parentId,
      order: value.order,
    }
  }
  if (typeof value.id !== 'string') {
    throw new Error('Web transaction operation is invalid')
  }
  if (value.type === 'component.delete') {
    return { type: 'component.delete', id: parseStylesheetId(value.id, 'component.id') }
  }
  if (value.type === 'instance.delete') {
    return { type: 'instance.delete', id: parseStylesheetId(value.id, 'instance.id') }
  }
  if (value.type === 'instance.clearOverride') {
    return {
      type: 'instance.clearOverride',
      instanceId: parseStylesheetId(value.instanceId, 'instanceId'),
      id: parseStylesheetId(value.id, 'override.nodeId'),
    }
  }
  if (value.type === 'instance.setOverride') {
    if (!record(value.override)) throw new Error('Web instance override is invalid')
    return {
      type: 'instance.setOverride',
      instanceId: parseStylesheetId(value.instanceId, 'instanceId'),
      id: parseStylesheetId(value.id, 'override.nodeId'),
      override: assertOverride(value.override, 'override'),
    }
  }
  if (value.type === 'stylesheet.delete') {
    return { type: 'stylesheet.delete', id: parseStylesheetId(value.id, 'stylesheet.id') }
  }
  if (value.type === 'stylesheet.patch') {
    if (!record(value.patch)) throw new Error('Web stylesheet patch is invalid')
    const patch: WebStylesheetPatch = {}
    if (value.patch.name !== undefined) {
      if (
        typeof value.patch.name !== 'string' ||
        value.patch.name.length === 0 ||
        value.patch.name.length > 200
      ) {
        throw new Error('Web stylesheet patch name is invalid')
      }
      patch.name = value.patch.name
    }
    if (value.patch.order !== undefined) {
      if (typeof value.patch.order !== 'number' || !Number.isFinite(value.patch.order)) {
        throw new Error('Web stylesheet patch order is invalid')
      }
      patch.order = value.patch.order
    }
    return { type: 'stylesheet.patch', id: parseStylesheetId(value.id, 'stylesheet.id'), patch }
  }
  if (value.type === 'rule.delete' || value.type === 'rule.move') {
    const stylesheetId = parseStylesheetId(value.stylesheetId, 'stylesheetId')
    const id = parseStylesheetId(value.id, 'rule.id')
    if (value.type === 'rule.delete') return { type: 'rule.delete', stylesheetId, id }
    if (typeof value.order !== 'number' || !Number.isFinite(value.order)) {
      throw new Error('Web rule move is invalid')
    }
    return { type: 'rule.move', stylesheetId, id, order: value.order }
  }
  if (value.type === 'rule.patch') {
    const stylesheetId = parseStylesheetId(value.stylesheetId, 'stylesheetId')
    const id = parseStylesheetId(value.id, 'rule.id')
    if (!record(value.patch)) throw new Error('Web rule patch is invalid')
    const patch: WebRulePatch = {}
    if (value.patch.selector !== undefined) {
      if (typeof value.patch.selector !== 'string') {
        throw new Error('Web rule patch selector is invalid')
      }
      patch.selector = value.patch.selector
    }
    const declarations = parsePatchRecord(value.patch.declarations, 'declarations')
    if (declarations !== undefined) patch.declarations = declarations
    if (value.patch.conditions !== undefined) {
      if (!Array.isArray(value.patch.conditions)) {
        throw new Error('Web rule patch conditions are invalid')
      }
      patch.conditions = value.patch.conditions.map(assertWebCondition)
    }
    return { type: 'rule.patch', stylesheetId, id, patch }
  }
  if (value.type === 'node.delete') return { type: 'node.delete', id: value.id }
  if (value.type === 'node.move') {
    if (
      (value.parentId !== null && typeof value.parentId !== 'string') ||
      typeof value.order !== 'number' ||
      !Number.isFinite(value.order)
    ) {
      throw new Error('Web node move is invalid')
    }
    return {
      type: 'node.move',
      id: value.id,
      parentId: value.parentId,
      order: value.order,
    }
  }
  if (value.type !== 'node.patch' || !record(value.patch)) {
    throw new Error('Web transaction operation is invalid')
  }
  if (value.patch.kind === 'text' && typeof value.patch.text === 'string') {
    return {
      type: 'node.patch',
      id: value.id,
      patch: { kind: 'text', text: value.patch.text },
    }
  }
  if (
    value.patch.kind !== 'element' ||
    (value.patch.tag !== undefined && typeof value.patch.tag !== 'string')
  ) {
    throw new Error('Web node patch is invalid')
  }
  return {
    type: 'node.patch',
    id: value.id,
    patch: {
      kind: 'element',
      tag: value.patch.tag,
      attributes: parsePatchRecord(value.patch.attributes, 'attributes'),
      styles: parsePatchRecord(value.patch.styles, 'styles'),
    },
  }
}

export function parseWebTransaction(value: unknown): WebTransaction {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    value.id.length > 200 ||
    typeof value.label !== 'string' ||
    !value.label ||
    value.label.length > 200 ||
    !Array.isArray(value.operations) ||
    value.operations.length === 0 ||
    value.operations.length > 2_000
  ) {
    throw new Error('Web transaction is invalid')
  }
  // Check every operation so one pass reports every problem, not just the first.
  const operations: WebOperation[] = []
  const problems: string[] = []
  value.operations.forEach((operation, index) => {
    try {
      operations.push(parseWebOperation(operation))
    } catch (error) {
      const type = record(operation) && typeof operation.type === 'string' ? ` (${operation.type})` : ''
      problems.push(`operations[${index}]${type}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  if (problems.length > 0) {
    const shown = problems.slice(0, 25)
    const more = problems.length > shown.length ? `\n…and ${problems.length - shown.length} more` : ''
    throw new Error(`${problems.length} invalid operation${problems.length === 1 ? '' : 's'}. Nothing was applied.\n${shown.join('\n')}${more}`)
  }
  return { id: value.id, label: value.label, operations }
}

export function createWebDocument(name = 'Untitled', id = webId('doc')): WebDocument {
  const now = Date.now()
  return {
    model: 'web',
    schemaVersion: WEB_DOCUMENT_SCHEMA_VERSION,
    id,
    name,
    nodes: {},
    roots: [],
    stylesheets: {},
    stylesheetOrder: [],
    components: {},
    instances: {},
    metadata: { createdAt: now, updatedAt: now },
  }
}

export function createWebComponent(
  name: string,
  patch: Partial<Omit<WebComponent, 'name'>> = {},
): WebComponent {
  return {
    id: patch.id ?? webId('component'),
    name,
    templateRootIds: patch.templateRootIds ?? [],
    stylesheetId: patch.stylesheetId ?? null,
    ...(patch.description === undefined ? {} : { description: patch.description }),
  }
}

/**
 * The deletion invariant made executable: drop component metadata and
 * template nodes, keep the live tree. What remains must be an ordinary
 * document that materializes and behaves identically — proof that
 * components are authoring machinery, not rendering machinery.
 */
export function detachComponents(document: WebDocument): WebDocument {
  const source = assertWebDocument(document)
  const templateIds = new Set<WebNodeId>()
  for (const component of Object.values(source.components)) {
    for (const id of templateMemberIds(source.nodes, component.templateRootIds)) {
      templateIds.add(id)
    }
  }
  return assertWebDocument({
    ...source,
    nodes: Object.fromEntries(
      Object.entries(source.nodes).filter(([id]) => !templateIds.has(id)),
    ),
    roots: source.roots.filter((id) => !templateIds.has(id)),
    components: {},
    instances: {},
  })
}

export function createWebStyleSheet(
  name = 'main',
  patch: Partial<Omit<WebStyleSheet, 'name'>> = {},
): WebStyleSheet {
  return {
    id: patch.id ?? webId('stylesheet'),
    name,
    order: patch.order ?? 1_024,
    rules: patch.rules ?? {},
    ruleOrder: patch.ruleOrder ?? [],
  }
}

export function createWebStyleRule(
  selector: string,
  declarations: Record<string, string> = {},
  patch: Partial<Omit<WebStyleRule, 'selector' | 'declarations'>> = {},
): WebStyleRule {
  return {
    id: patch.id ?? webId('rule'),
    selector,
    declarations: { ...declarations },
    conditions: patch.conditions ?? [],
    order: patch.order ?? 1_024,
  }
}

export function nextStylesheetOrder(document: WebDocument) {
  return (
    Math.max(0, ...orderedWebStyleSheets(document.stylesheets, document.stylesheetOrder).map((sheet) => sheet.order)) +
    1_024
  )
}

export function nextRuleOrder(sheet: WebStyleSheet) {
  return Math.max(0, ...orderedWebRules(sheet).map((rule) => rule.order)) + 1_024
}

export function createWebElement(
  tag = 'div',
  patch: Partial<Omit<WebElementNode, 'kind' | 'tag'>> = {},
): WebElementNode {
  return {
    id: patch.id ?? webId('element'),
    kind: 'element',
    parentId: patch.parentId ?? null,
    order: patch.order ?? 1_024,
    namespace: patch.namespace ?? 'html',
    tag,
    attributes: patch.attributes ?? {},
    styles: patch.styles ?? {},
  }
}

export function createWebText(
  text: string,
  patch: Partial<Omit<WebTextNode, 'kind' | 'text'>> = {},
): WebTextNode {
  return {
    id: patch.id ?? webId('text'),
    kind: 'text',
    parentId: patch.parentId ?? null,
    order: patch.order ?? 1_024,
    text,
  }
}

function cloneDocument(document: WebDocument): WebDocument {
  return structuredClone(document)
}

export function orderedWebChildren(
  document: WebDocument,
  parentId: WebNodeId | null,
) {
  return Object.values(document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

function syncRoots(document: WebDocument) {
  const templateIds = new Set<WebNodeId>()
  for (const component of Object.values(document.components)) {
    for (const id of templateMemberIds(document.nodes, component.templateRootIds)) {
      templateIds.add(id)
    }
  }
  document.roots = Object.values(document.nodes)
    .filter((node) => node.parentId === null && !templateIds.has(node.id))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((node) => node.id)
}

function syncStylesheetOrder(document: WebDocument) {
  document.stylesheetOrder = Object.values(document.stylesheets)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((sheet) => sheet.id)
}

function syncRuleOrder(sheet: WebStyleSheet) {
  sheet.ruleOrder = Object.values(sheet.rules)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((rule) => rule.id)
}

function requireSheet(document: WebDocument, stylesheetId: string): WebStyleSheet {
  const sheet = document.stylesheets[stylesheetId]
  if (!sheet) throw new Error(`Stylesheet ${stylesheetId} does not exist`)
  return sheet
}

function requireRule(sheet: WebStyleSheet, id: string): WebStyleRule {
  const rule = sheet.rules[id]
  if (!rule) throw new Error(`Rule ${id} does not exist`)
  return rule
}

function requireComponent(document: WebDocument, id: string): WebComponent {
  const component = document.components[id]
  if (!component) throw new Error(`Component ${id} does not exist`)
  return component
}

function requireInstance(document: WebDocument, id: string): WebInstance {
  const instance = document.instances[id]
  if (!instance) throw new Error(`Instance ${id} does not exist`)
  return instance
}

function templateOwnerOf(document: WebDocument, nodeId: WebNodeId): string | null {
  return templateOwner(document.nodes, document.components, nodeId)
}

/** Root-first collection of a subtree for removal and inverse rebuild. */
function collectSubtree(document: WebDocument, rootId: WebNodeId): WebNode[] {
  const collected: WebNode[] = []
  const visit = (id: WebNodeId) => {
    const node = document.nodes[id]
    if (!node) return
    collected.push(node)
    for (const child of orderedWebChildren(document, id)) visit(child.id)
  }
  visit(rootId)
  return collected
}

/**
 * Drops instance records rooted inside `removedIds` and prunes binding /
 * override entries that reference removed nodes. Returns snapshots of every
 * touched record so inverses can restore them exactly; IDs are never
 * reused, so a dropped override can never attach to a recreated node.
 */
function pruneInstanceRecords(
  document: WebDocument,
  removedIds: Set<WebNodeId>,
): WebInstance[] {
  const snapshots: WebInstance[] = []
  for (const instance of Object.values(document.instances)) {
    if (removedIds.has(instance.rootId)) {
      snapshots.push(structuredClone(instance))
      delete document.instances[instance.id]
      continue
    }
    let touched = false
    for (const liveId of Object.keys(instance.bindings)) {
      const templateId = instance.bindings[liveId]
      if (
        (templateId && removedIds.has(templateId)) ||
        removedIds.has(liveId)
      ) {
        touched = true
        break
      }
    }
    if (!touched) continue
    snapshots.push(structuredClone(instance))
    for (const liveId of Object.keys(instance.bindings)) {
      const templateId = instance.bindings[liveId]
      if (
        (templateId && removedIds.has(templateId)) ||
        removedIds.has(liveId)
      ) {
        delete instance.bindings[liveId]
        delete instance.overrides[liveId]
      }
    }
  }
  return snapshots
}

/**
 * Removes a subtree and prunes affected instance records. Inverse rebuild
 * is node inserts (root-first) followed by instance restores.
 */
function removeSubtree(
  document: WebDocument,
  rootId: WebNodeId,
  inverse: WebOperation[],
  changedNodeIds: Set<WebNodeId>,
): void {
  const removed = collectSubtree(document, rootId)
  const removedIds = new Set(removed.map((node) => node.id))
  const snapshots = pruneInstanceRecords(document, removedIds)
  for (const node of removed) {
    delete document.nodes[node.id]
    changedNodeIds.add(node.id)
  }
  for (const snapshot of snapshots) {
    inverse.unshift({ type: 'instance.restore', instance: snapshot })
  }
  for (let index = removed.length - 1; index >= 0; index -= 1) {
    inverse.unshift({ type: 'node.insert', node: removed[index] as WebNode })
  }
}

/**
 * Refresh-then-apply: the live node is first reset to its template content,
 * then the journal entry is applied. Override state is therefore always a
 * pure function of (template, entry), which keeps propagation and undo
 * exact no matter how the template evolved since the override was set.
 */
export function liveNodeFromTemplate(
  template: WebNode,
  live: WebNode,
  override: WebOverride | undefined,
): WebNode {
  if (template.kind === 'text' && live.kind === 'text') {
    return {
      ...live,
      text: override?.kind === 'text' ? override.text : template.text,
    }
  }
  if (template.kind === 'element' && live.kind === 'element') {
    const refreshed: WebElementNode = {
      ...live,
      tag: template.tag,
      attributes: { ...template.attributes },
      styles: { ...template.styles },
    }
    if (!override) return refreshed
    if (override.kind === 'text') {
      throw new Error(`Text override cannot apply to element ${live.id}`)
    }
    if (override.kind === 'attributes') {
      return { ...refreshed, attributes: mergeRecord(refreshed.attributes, override.attributes) }
    }
    return {
      ...refreshed,
      styles: mergeRecord(refreshed.styles, override.properties),
    }
  }
  throw new Error(`Instance binding kind does not match for ${live.id}`)
}

/**
 * Template patch propagation: recompute every live node bound to the edited
 * template node from (new template, unchanged journal). The journal is never
 * mutated here, so the template patch's own inverse restores live content
 * exactly on undo. No inverse ops are recorded for propagation itself.
 */
function propagateTemplatePatch(
  document: WebDocument,
  templateId: WebNodeId,
  changedNodeIds: Set<WebNodeId>,
): void {
  const template = document.nodes[templateId]
  if (!template) return
  for (const instance of Object.values(document.instances)) {
    for (const [liveId, boundTemplateId] of Object.entries(instance.bindings)) {
      if (boundTemplateId !== templateId) continue
      const live = document.nodes[liveId]
      if (!live) continue
      document.nodes[liveId] = liveNodeFromTemplate(template, live, instance.overrides[liveId])
      changedNodeIds.add(liveId)
    }
  }
}

/** The live clone of a template node within one instance, if present. */
function boundClone(
  document: WebDocument,
  instance: WebInstance,
  templateId: WebNodeId,
): WebNodeId | null {
  for (const [liveId, boundTemplateId] of Object.entries(instance.bindings)) {
    if (boundTemplateId === templateId && document.nodes[liveId]) return liveId
  }
  return null
}

function instancesOf(document: WebDocument, componentId: string): WebInstance[] {
  return Object.values(document.instances).filter(
    (instance) => instance.componentId === componentId,
  )
}

/** Records rooted inside one component's template: placeholders awaiting content. */
function nestedRecordsOf(document: WebDocument, componentId: string): WebInstance[] {
  return Object.values(document.instances).filter(
    (instance) => templateOwnerOf(document, instance.rootId) === componentId,
  )
}

function checkNestingDepth(depth: number): void {
  if (depth > MAX_COMPONENT_NESTING_DEPTH) {
    throw new Error('Component nesting exceeds the M4 depth limit')
  }
}

/**
 * Fills a live node with a component's template-root content and clones the
 * template descendants beneath it, expanding nested placeholders
 * recursively. `bindings` is extended with every created node. Placeholders
 * stay empty in the template; content flows template -> live only.
 */
function fillInstanceContent(
  document: WebDocument,
  component: WebComponent,
  liveRootId: WebNodeId,
  bindings: Record<WebNodeId, WebNodeId>,
  changedNodeIds: Set<WebNodeId>,
  depth: number,
): void {
  checkNestingDepth(depth)
  const templateRoot = document.nodes[component.templateRootIds[0] as WebNodeId]
  const liveRoot = document.nodes[liveRootId]
  if (!templateRoot || !liveRoot || templateRoot.kind !== 'element' || liveRoot.kind !== 'element') {
    throw new Error(`Instance of component ${component.id} cannot materialize`)
  }
  document.nodes[liveRootId] = {
    ...liveRoot,
    tag: templateRoot.tag,
    attributes: { ...templateRoot.attributes },
    styles: { ...templateRoot.styles },
  }
  bindings[liveRootId] = templateRoot.id
  changedNodeIds.add(liveRootId)
  const cloneMap = new Map<WebNodeId, WebNodeId>([[templateRoot.id, liveRootId]])
  const cloneChildren = (templateParentId: WebNodeId, liveParentId: WebNodeId) => {
    for (const child of orderedWebChildren(document, templateParentId)) {
      // Template children only: node IDs are unique, so a template parent
      // ID can never parent live nodes from another subtree.
      if (templateOwnerOf(document, child.id) !== component.id) continue
      const clone: WebNode = child.kind === 'text'
        ? {
          ...child,
          id: webId(child.kind === 'text' ? 'text' : 'element'),
          parentId: liveParentId,
        }
        : {
          ...child,
          id: webId('element'),
          parentId: liveParentId,
          attributes: { ...child.attributes },
          styles: { ...child.styles },
        }
      if (document.nodes[clone.id]) {
        throw new Error(`Instance clone collided on node ${clone.id}`)
      }
      document.nodes[clone.id] = clone
      bindings[clone.id] = child.id
      cloneMap.set(child.id, clone.id)
      changedNodeIds.add(clone.id)
      if (child.kind === 'element') cloneChildren(child.id, clone.id)
    }
  }
  cloneChildren(templateRoot.id, liveRootId)
  for (const nested of nestedRecordsOf(document, component.id)) {
    const livePlaceholder = cloneMap.get(nested.rootId)
    if (!livePlaceholder || !document.nodes[livePlaceholder]) continue
    expandNestedInstance(document, nested, livePlaceholder, changedNodeIds, depth + 1)
  }
}

/**
 * Materializes a template-nested placeholder into live content and records
 * the nested live instance. The template placeholder record stays untouched;
 * the live tree gains a fresh record with empty overrides.
 */
function expandNestedInstance(
  document: WebDocument,
  nested: WebInstance,
  livePlaceholderId: WebNodeId,
  changedNodeIds: Set<WebNodeId>,
  depth: number,
): void {
  if (Object.keys(document.instances).length >= MAX_WEB_INSTANCES) {
    throw new Error('Web document has too many instances')
  }
  const component = requireComponent(document, nested.componentId)
  const bindings: Record<WebNodeId, WebNodeId> = {}
  fillInstanceContent(document, component, livePlaceholderId, bindings, changedNodeIds, depth)
  const record: WebInstance = {
    id: webId('instance'),
    componentId: component.id,
    rootId: livePlaceholderId,
    bindings,
    overrides: {},
  }
  document.instances[record.id] = record
  assertWebInstance(record, record.id, document.nodes, document.components)
}

function mergeRecord(
  current: Record<string, string>,
  patch: Record<string, string | null>,
) {
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

export function applyWebTransaction(
  source: WebDocument,
  transaction: WebTransaction,
): WebTransactionResult {
  const document = cloneDocument(assertWebDocument(source))
  transaction = parseWebTransaction(transaction)
  const inverse: WebOperation[] = []
  const changedNodeIds = new Set<WebNodeId>()
  // Undo rebuilds deleted subtrees with node.insert ops whose parents are
  // bound. Those exact node IDs are named by an instance.restore in the same
  // transaction, so they are the only inserts permitted under bound parents:
  // restoration of snapshotted state, never fresh divergence.
  const restoringLiveIds = new Set<WebNodeId>()
  for (const operation of transaction.operations) {
    if (operation.type === 'instance.restore') {
      for (const liveId of Object.keys(operation.instance.bindings)) {
        restoringLiveIds.add(liveId)
      }
    }
  }

  for (const operation of transaction.operations) {
    if (operation.type === 'page.resize' || operation.type === 'page.reset') {
      const previous = document.metadata.page
      if (operation.type === 'page.reset') delete document.metadata.page
      else document.metadata.page = { width: operation.width, height: operation.height }
      inverse.unshift(previous ? { type: 'page.resize', ...previous } : { type: 'page.reset' })
      continue
    }
    if (operation.type === 'node.insert') {
      if (document.nodes[operation.node.id]) {
        throw new Error(`Node ${operation.node.id} already exists`)
      }
      const newParent = operation.node.parentId
      if (
        newParent !== null &&
        boundNodeIndex(document.instances).has(newParent) &&
        !restoringLiveIds.has(operation.node.id)
      ) {
        throw new Error(BOUND_NODE_ERROR)
      }
      document.nodes[operation.node.id] = structuredClone(operation.node)
      changedNodeIds.add(operation.node.id)
      if (newParent !== null && templateOwnerOf(document, newParent) !== null) {
        // Template insert: clone the node under every bound parent so all
        // instances gain the content. The delete-inverse cascades the clones
        // back out, so no extra inverse ops are needed.
        const owner = templateOwnerOf(document, newParent) as string
        for (const outer of instancesOf(document, owner)) {
          const liveParent = boundClone(document, outer, newParent)
          if (!liveParent) {
            throw new Error(`Instance ${outer.id} is missing its template content`)
          }
          const clone: WebNode = operation.node.kind === 'text'
            ? { ...structuredClone(operation.node), id: webId('text'), parentId: liveParent }
            : { ...structuredClone(operation.node), id: webId('element'), parentId: liveParent }
          document.nodes[clone.id] = clone
          outer.bindings[clone.id] = operation.node.id
          changedNodeIds.add(clone.id)
        }
      }
      inverse.unshift({ type: 'node.delete', id: operation.node.id })
      continue
    }

    if (operation.type === 'stylesheet.insert') {
      if (document.stylesheets[operation.stylesheet.id]) {
        throw new Error(`Stylesheet ${operation.stylesheet.id} already exists`)
      }
      if (Object.keys(document.stylesheets).length >= MAX_WEB_STYLESHEETS) {
        throw new Error('Web document has too many stylesheets')
      }
      document.stylesheets[operation.stylesheet.id] = structuredClone(operation.stylesheet)
      syncStylesheetOrder(document)
      inverse.unshift({ type: 'stylesheet.delete', id: operation.stylesheet.id })
      continue
    }

    if (operation.type === 'stylesheet.patch') {
      const sheet = requireSheet(document, operation.id)
      inverse.unshift({
        type: 'stylesheet.patch',
        id: sheet.id,
        patch: {
          ...(operation.patch.name === undefined ? {} : { name: sheet.name }),
          ...(operation.patch.order === undefined ? {} : { order: sheet.order }),
        },
      })
      document.stylesheets[sheet.id] = {
        ...sheet,
        name: operation.patch.name ?? sheet.name,
        order: operation.patch.order ?? sheet.order,
      }
      syncStylesheetOrder(document)
      continue
    }

    if (operation.type === 'stylesheet.delete') {
      const sheet = requireSheet(document, operation.id)
      inverse.unshift({ type: 'stylesheet.insert', stylesheet: structuredClone(sheet) })
      delete document.stylesheets[sheet.id]
      syncStylesheetOrder(document)
      continue
    }

    if (operation.type === 'rule.insert') {
      const sheet = requireSheet(document, operation.stylesheetId)
      if (sheet.rules[operation.rule.id]) {
        throw new Error(`Rule ${operation.rule.id} already exists`)
      }
      if (Object.keys(sheet.rules).length >= MAX_WEB_RULES_PER_SHEET) {
        throw new Error(`Stylesheet ${sheet.id} has too many rules`)
      }
      sheet.rules[operation.rule.id] = structuredClone(operation.rule)
      syncRuleOrder(sheet)
      inverse.unshift({
        type: 'rule.delete',
        stylesheetId: sheet.id,
        id: operation.rule.id,
      })
      continue
    }

    if (operation.type === 'rule.patch') {
      const sheet = requireSheet(document, operation.stylesheetId)
      const rule = requireRule(sheet, operation.id)
      const previousDeclarations = Object.fromEntries(
        Object.keys(operation.patch.declarations ?? {}).map((key) => [
          key,
          rule.declarations[key] ?? null,
        ]),
      )
      inverse.unshift({
        type: 'rule.patch',
        stylesheetId: sheet.id,
        id: rule.id,
        patch: {
          ...(operation.patch.selector === undefined ? {} : { selector: rule.selector }),
          ...(
            operation.patch.declarations === undefined
              ? {}
              : { declarations: previousDeclarations }
          ),
          ...(
            operation.patch.conditions === undefined
              ? {}
              : { conditions: structuredClone(rule.conditions) }
          ),
        },
      })
      sheet.rules[rule.id] = {
        ...rule,
        selector: operation.patch.selector ?? rule.selector,
        declarations: mergeRecord(rule.declarations, operation.patch.declarations ?? {}),
        conditions: operation.patch.conditions ?? rule.conditions,
      }
      continue
    }

    if (operation.type === 'rule.move') {
      const sheet = requireSheet(document, operation.stylesheetId)
      const rule = requireRule(sheet, operation.id)
      inverse.unshift({
        type: 'rule.move',
        stylesheetId: sheet.id,
        id: rule.id,
        order: rule.order,
      })
      sheet.rules[rule.id] = { ...rule, order: operation.order }
      syncRuleOrder(sheet)
      continue
    }

    if (operation.type === 'rule.delete') {
      const sheet = requireSheet(document, operation.stylesheetId)
      const rule = requireRule(sheet, operation.id)
      inverse.unshift({
        type: 'rule.insert',
        stylesheetId: sheet.id,
        rule: structuredClone(rule),
      })
      delete sheet.rules[rule.id]
      syncRuleOrder(sheet)
      continue
    }

    if (operation.type === 'component.define') {
      if (document.components[operation.component.id]) {
        throw new Error(`Component ${operation.component.id} already exists`)
      }
      if (Object.keys(document.components).length >= MAX_WEB_COMPONENTS) {
        throw new Error('Web document has too many components')
      }
      const templateIds = new Set(operation.template.map((node) => node.id))
      if (templateIds.size !== operation.template.length) {
        throw new Error('Web component template has duplicate node IDs')
      }
      for (const node of operation.template) {
        if (document.nodes[node.id]) {
          throw new Error(`Node ${node.id} already exists`)
        }
        if (node.parentId !== null && !templateIds.has(node.parentId)) {
          throw new Error(`Template node ${node.id} has a parent outside the template`)
        }
      }
      const roots = operation.template.filter((node) => node.parentId === null)
      if (
        roots.length !== operation.component.templateRootIds.length ||
        roots.some((node) => !operation.component.templateRootIds.includes(node.id))
      ) {
        throw new Error('Web component template roots do not match its record')
      }
      if (operation.stylesheet) {
        if (document.stylesheets[operation.stylesheet.id]) {
          throw new Error(`Stylesheet ${operation.stylesheet.id} already exists`)
        }
        if (Object.keys(document.stylesheets).length >= MAX_WEB_STYLESHEETS) {
          throw new Error('Web document has too many stylesheets')
        }
      }
      for (const node of operation.template) {
        document.nodes[node.id] = structuredClone(node)
        changedNodeIds.add(node.id)
      }
      document.components[operation.component.id] = { ...operation.component }
      if (operation.stylesheet) {
        document.stylesheets[operation.stylesheet.id] = structuredClone(operation.stylesheet)
        syncStylesheetOrder(document)
      }
      syncRoots(document)
      assertWebComponent(
        document.components[operation.component.id],
        operation.component.id,
        document.nodes,
        document.stylesheets,
      )
      inverse.unshift({ type: 'component.delete', id: operation.component.id })
      continue
    }

    if (operation.type === 'component.delete') {
      const component = requireComponent(document, operation.id)
      const referencing = instancesOf(document, component.id)
      if (referencing.length > 0) {
        throw new Error(
          `Cannot delete component "${component.name}" while ${referencing.length} instance(s) exist. Delete the instances first.`,
        )
      }
      const templateRoot = component.templateRootIds[0] as WebNodeId
      const removed = collectSubtree(document, templateRoot)
      const removedIds = new Set(removed.map((node) => node.id))
      const snapshots = pruneInstanceRecords(document, removedIds)
      for (const node of removed) {
        delete document.nodes[node.id]
        changedNodeIds.add(node.id)
      }
      const sheet = component.stylesheetId ? document.stylesheets[component.stylesheetId] : undefined
      if (sheet && component.stylesheetId) delete document.stylesheets[component.stylesheetId]
      delete document.components[component.id]
      syncRoots(document)
      if (sheet) syncStylesheetOrder(document)
      for (const snapshot of snapshots) {
        inverse.unshift({ type: 'instance.restore', instance: snapshot })
      }
      inverse.unshift({
        type: 'component.define',
        component: structuredClone(component),
        template: removed,
        ...(sheet === undefined ? {} : { stylesheet: structuredClone(sheet) }),
      })
      continue
    }

    if (operation.type === 'instance.create') {
      const component = requireComponent(document, operation.componentId)
      if (Object.keys(document.instances).length >= MAX_WEB_INSTANCES) {
        throw new Error('Web document has too many instances')
      }
      const recordId = operation.id ?? webId('instance')
      if (document.instances[recordId]) {
        throw new Error(`Instance ${recordId} already exists`)
      }
      if (operation.parentId !== null) {
        const parent = document.nodes[operation.parentId]
        if (!parent || parent.kind !== 'element') {
          throw new Error(`Parent ${operation.parentId} must be an element`)
        }
        if (boundNodeIndex(document.instances).has(operation.parentId)) {
          throw new Error(
            'Cannot place an instance inside a bound instance subtree. Edit the component template instead.',
          )
        }
      }
      const owner = operation.parentId === null
        ? null
        : templateOwnerOf(document, operation.parentId)
      if (owner !== null) {
        const ownerComponent = requireComponent(document, owner)
        if (
          createsDependencyCycle(
            document.nodes,
            document.components,
            document.instances,
            owner,
            component.id,
          )
        ) {
          throw new Error(
            `Cannot nest component "${component.name}" inside "${ownerComponent.name}": it would create a dependency cycle`,
          )
        }
        const placeholder: WebElementNode = {
          id: webId('element'),
          kind: 'element',
          parentId: operation.parentId,
          order: operation.order,
          namespace: 'html',
          tag: (document.nodes[component.templateRootIds[0] as WebNodeId] as WebElementNode).tag,
          attributes: {},
          styles: {},
        }
        if (document.nodes[placeholder.id]) {
          throw new Error(`Node ${placeholder.id} already exists`)
        }
        document.nodes[placeholder.id] = placeholder
        changedNodeIds.add(placeholder.id)
        const nested: WebInstance = {
          id: recordId,
          componentId: component.id,
          rootId: placeholder.id,
          bindings: { [placeholder.id]: component.templateRootIds[0] as WebNodeId },
          overrides: {},
        }
        document.instances[recordId] = nested
        assertWebInstance(nested, recordId, document.nodes, document.components)
        for (const outer of instancesOf(document, owner)) {
          const liveParent = boundClone(document, outer, operation.parentId as WebNodeId)
          if (!liveParent) {
            throw new Error(`Instance ${outer.id} is missing its template content`)
          }
          const clone: WebElementNode = {
            ...placeholder,
            id: webId('element'),
            parentId: liveParent,
          }
          document.nodes[clone.id] = clone
          changedNodeIds.add(clone.id)
          outer.bindings[clone.id] = placeholder.id
          expandNestedInstance(document, nested, clone.id, changedNodeIds, 2)
        }
        syncRoots(document)
      } else {
        const templateRoot = document.nodes[component.templateRootIds[0] as WebNodeId]
        if (!templateRoot || templateRoot.kind !== 'element') {
          throw new Error(`Component ${component.id} has no element template root`)
        }
        const rootId = webId('element')
        document.nodes[rootId] = {
          id: rootId,
          kind: 'element',
          parentId: operation.parentId,
          order: operation.order,
          namespace: templateRoot.namespace,
          tag: templateRoot.tag,
          attributes: { ...templateRoot.attributes },
          styles: { ...templateRoot.styles },
        }
        const bindings: Record<WebNodeId, WebNodeId> = {}
        fillInstanceContent(document, component, rootId, bindings, changedNodeIds, 1)
        const record: WebInstance = {
          id: recordId,
          componentId: component.id,
          rootId,
          bindings,
          overrides: {},
        }
        document.instances[recordId] = record
        assertWebInstance(record, recordId, document.nodes, document.components)
        syncRoots(document)
      }
      inverse.unshift({ type: 'instance.delete', id: recordId })
      continue
    }

    if (operation.type === 'instance.delete') {
      const instance = requireInstance(document, operation.id)
      removeSubtree(document, instance.rootId, inverse, changedNodeIds)
      syncRoots(document)
      continue
    }

    if (operation.type === 'instance.restore') {
      // Upsert, not insert: restores re-add dropped records and repair
      // records whose bindings were pruned. No referential validation here:
      // restores apply alongside the node inserts that rebuild their
      // subtrees, and the end-of-transaction assert validates the assembled
      // document.
      document.instances[operation.instance.id] = structuredClone(operation.instance)
      continue
    }

    if (operation.type === 'instance.setOverride') {
      const instance = requireInstance(document, operation.instanceId)
      const templateId = instance.bindings[operation.id]
      if (!templateId) {
        throw new Error(`Node ${operation.id} is not bound in instance ${instance.id}`)
      }
      const template = document.nodes[templateId]
      const live = document.nodes[operation.id]
      if (!template || !live) {
        throw new Error(`Override target ${operation.id} does not exist`)
      }
      if (operation.override.kind === 'text' && live.kind !== 'text') {
        throw new Error(`Text override cannot apply to element ${operation.id}`)
      }
      if (operation.override.kind !== 'text' && live.kind !== 'element') {
        throw new Error(`Override cannot apply to text node ${operation.id}`)
      }
      const previous = instance.overrides[operation.id]
      if (previous && previous.kind !== operation.override.kind) {
        throw new Error(
          `Node ${operation.id} already has a different override. Clear it first.`,
        )
      }
      inverse.unshift(
        previous === undefined
          ? { type: 'instance.clearOverride', instanceId: instance.id, id: operation.id }
          : {
            type: 'instance.setOverride',
            instanceId: instance.id,
            id: operation.id,
            override: structuredClone(previous),
          },
      )
      instance.overrides[operation.id] = structuredClone(operation.override)
      document.nodes[operation.id] = liveNodeFromTemplate(template, live, instance.overrides[operation.id])
      changedNodeIds.add(operation.id)
      continue
    }

    if (operation.type === 'instance.clearOverride') {
      const instance = requireInstance(document, operation.instanceId)
      const templateId = instance.bindings[operation.id]
      if (!templateId) {
        throw new Error(`Node ${operation.id} is not bound in instance ${instance.id}`)
      }
      const previous = instance.overrides[operation.id]
      if (!previous) throw new Error(`Node ${operation.id} has no override to clear`)
      const template = document.nodes[templateId]
      const live = document.nodes[operation.id]
      if (!template || !live) {
        throw new Error(`Override target ${operation.id} does not exist`)
      }
      inverse.unshift({
        type: 'instance.setOverride',
        instanceId: instance.id,
        id: operation.id,
        override: structuredClone(previous),
      })
      delete instance.overrides[operation.id]
      document.nodes[operation.id] = liveNodeFromTemplate(template, live, undefined)
      changedNodeIds.add(operation.id)
      continue
    }

    const current = document.nodes[operation.id]
    if (!current) throw new Error(`Node ${operation.id} does not exist`)

    if (operation.type === 'node.patch') {
      if (boundNodeIndex(document.instances).has(operation.id)) {
        throw new Error(BOUND_NODE_ERROR)
      }
      if (current.kind !== operation.patch.kind) {
        throw new Error(`Node ${operation.id} patch kind does not match`)
      }
      if (current.kind === 'text' && operation.patch.kind === 'text') {
        inverse.unshift({
          type: 'node.patch',
          id: current.id,
          patch: { kind: 'text', text: current.text },
        })
        document.nodes[current.id] = { ...current, text: operation.patch.text }
      } else if (current.kind === 'element' && operation.patch.kind === 'element') {
        const previousAttributes = Object.fromEntries(
          Object.keys(operation.patch.attributes ?? {}).map((key) => [
            key,
            current.attributes[key] ?? null,
          ]),
        )
        const previousStyles = Object.fromEntries(
          Object.keys(operation.patch.styles ?? {}).map((key) => [
            key,
            current.styles[key] ?? null,
          ]),
        )
        inverse.unshift({
          type: 'node.patch',
          id: current.id,
          patch: {
            kind: 'element',
            tag: operation.patch.tag === undefined ? undefined : current.tag,
            attributes: previousAttributes,
            styles: previousStyles,
          },
        })
        document.nodes[current.id] = {
          ...current,
          tag: operation.patch.tag ?? current.tag,
          attributes: mergeRecord(current.attributes, operation.patch.attributes ?? {}),
          styles: mergeRecord(current.styles, operation.patch.styles ?? {}),
        }
      }
      changedNodeIds.add(current.id)
      if (templateOwnerOf(document, operation.id) !== null) {
        // Template patch: recompute bound live nodes from (new template,
        // unchanged journal). The patch's own inverse replays the same way
        // on undo, so propagation records no inverse ops of its own.
        propagateTemplatePatch(document, operation.id, changedNodeIds)
      }
      continue
    }

    if (operation.type === 'node.move') {
      if (boundNodeIndex(document.instances).has(operation.id)) {
        throw new Error(BOUND_NODE_ERROR)
      }
      const owner = templateOwnerOf(document, operation.id)
      if (owner !== null) {
        if (operation.parentId === null) {
          if (current.parentId !== null) {
            throw new Error('Cannot move a template node outside its component template.')
          }
        } else {
          const parent = document.nodes[operation.parentId]
          if (!parent || parent.kind !== 'element') {
            throw new Error(`Parent ${operation.parentId} must be an element`)
          }
          if (templateOwnerOf(document, operation.parentId) !== owner) {
            throw new Error('Cannot move a template node outside its component template.')
          }
        }
        inverse.unshift({
          type: 'node.move',
          id: current.id,
          parentId: current.parentId,
          order: current.order,
        })
        document.nodes[current.id] = {
          ...current,
          parentId: operation.parentId,
          order: operation.order,
        }
        changedNodeIds.add(current.id)
        for (const outer of instancesOf(document, owner)) {
          const clone = boundClone(document, outer, current.id)
          if (!clone) {
            throw new Error(`Instance ${outer.id} is missing its template content`)
          }
          const cloneNode = document.nodes[clone]
          if (!cloneNode) continue
          const liveParent = operation.parentId === null
            ? cloneNode.parentId
            : boundClone(document, outer, operation.parentId)
          if (operation.parentId !== null && !liveParent) {
            throw new Error(`Instance ${outer.id} is missing its template content`)
          }
          document.nodes[clone] = {
            ...cloneNode,
            parentId: liveParent ?? cloneNode.parentId,
            order: operation.order,
          }
          changedNodeIds.add(clone)
        }
        continue
      }
      if (operation.parentId !== null) {
        if (boundNodeIndex(document.instances).has(operation.parentId)) {
          throw new Error(BOUND_NODE_ERROR)
        }
        if (
          document.nodes[operation.parentId] &&
          templateOwnerOf(document, operation.parentId) !== null
        ) {
          throw new Error('Cannot move a live node into a component template.')
        }
      }
      inverse.unshift({
        type: 'node.move',
        id: current.id,
        parentId: current.parentId,
        order: current.order,
      })
      document.nodes[current.id] = {
        ...current,
        parentId: operation.parentId,
        order: operation.order,
      }
      changedNodeIds.add(current.id)
      continue
    }

    if (boundNodeIndex(document.instances).has(current.id)) {
      throw new Error(BOUND_NODE_ERROR)
    }
    if (templateOwnerOf(document, current.id) !== null) {
      // Template delete: remove the template subtree plus every bound clone.
      // Records touched by the removal snapshot into instance.restores, so a
      // single uniform inverse rebuilds nodes first, records second.
      const owner = templateOwnerOf(document, current.id) as string
      const removals = [current.id]
      for (const outer of instancesOf(document, owner)) {
        const clone = boundClone(document, outer, current.id)
        if (!clone) {
          throw new Error(`Instance ${outer.id} is missing its template content`)
        }
        removals.push(clone)
      }
      // Nested-live clones bound through other instances' bindings travel
      // with their own subtrees via pruneInstanceRecords.
      for (const rootId of removals) {
        removeSubtree(document, rootId, inverse, changedNodeIds)
      }
      continue
    }
    removeSubtree(document, current.id, inverse, changedNodeIds)
  }

  document.metadata.updatedAt = Date.now()
  syncRoots(document)
  assertWebDocument(document)
  return {
    document,
    inverse: {
      id: `${transaction.id}:inverse`,
      label: `Undo ${transaction.label}`,
      operations: inverse,
    },
    changedNodeIds,
  }
}

function importedAttributes(element: Element) {
  return Object.fromEntries(
    [...element.attributes]
      .filter(({ name, value }) =>
        validAttributeName(name) &&
        (!urlAttributes.has(name.toLowerCase()) || validUrl(value)),
      )
      .map(({ name, value }) => [name, value]),
  )
}

function importedStyles(element: Element) {
  const declaration = (element as HTMLElement | SVGElement).style
  const styles: Record<string, string> = {}
  for (let index = 0; index < declaration.length; index += 1) {
    const name = declaration.item(index)
    const value = declaration.getPropertyValue(name)
    if (validStyleName(name) && validStyleValue(value)) styles[name] = value
  }
  return styles
}

export function parseWebHtml(
  html: string,
  options: { id?: string; name?: string } = {},
): WebDocument {
  if (typeof DOMParser === 'undefined') {
    throw new Error('HTML import requires a browser DOMParser')
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const document = createWebDocument(options.name ?? 'Imported HTML', options.id)
  let order = 0

  const visit = (source: ChildNode, parentId: WebNodeId | null, namespace: WebNamespace) => {
    if (source.nodeType === Node.TEXT_NODE) {
      const text = source.textContent ?? ''
      if (!text) return
      const node = createWebText(text, { parentId, order: (order += 1_024) })
      document.nodes[node.id] = node
      return
    }
    if (!(source instanceof Element)) return
    const nodeNamespace =
      namespace === 'svg' || source.namespaceURI === 'http://www.w3.org/2000/svg'
        ? 'svg'
        : 'html'
    const tag = nodeNamespace === 'svg' ? source.localName : source.localName.toLowerCase()
    if (!validTag(tag)) return
    const node = createWebElement(tag, {
      parentId,
      order: (order += 1_024),
      namespace: nodeNamespace,
      attributes: importedAttributes(source),
      styles: importedStyles(source),
    })
    document.nodes[node.id] = node
    for (const child of source.childNodes) visit(child, node.id, nodeNamespace)
  }

  for (const child of parsed.body.childNodes) visit(child, null, 'html')
  syncRoots(document)
  return assertWebDocument(document)
}

export function writeWebHtml(
  source: WebDocument,
  parentId: WebNodeId,
  html: string,
  transactionId = webId('transaction'),
) {
  const parent = source.nodes[parentId]
  if (!parent || parent.kind !== 'element') {
    throw new Error(`Parent ${parentId} must be an element`)
  }
  const imported = parseWebHtml(html)
  const currentOrders = orderedWebChildren(source, parentId).map((node) => node.order)
  const offset = Math.max(0, ...currentOrders)
  const rootOrders = new Map(imported.roots.map((id, index) => [id, offset + (index + 1) * 1_024]))
  return applyWebTransaction(source, {
    id: transactionId,
    label: 'Write HTML',
    operations: Object.values(imported.nodes).map((node) => ({
      type: 'node.insert' as const,
      node: {
        ...node,
        parentId: node.parentId ?? parentId,
        order: rootOrders.get(node.id) ?? node.order,
      },
    })),
  })
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export interface SerializeWebNodeOptions {
  /**
   * Emit `data-sheet-node` identity hooks (the same attribute
   * `materializeWebNode` sets). Off by default so portable HTML stays clean;
   * on for capture/export shells that address subtrees, like screenshots.
   */
  includeNodeIds?: boolean
}

export function serializeWebNode(
  document: WebDocument,
  nodeId: WebNodeId,
  options: SerializeWebNodeOptions = {},
): string {
  const node = document.nodes[nodeId]
  if (!node) throw new Error(`Node ${nodeId} does not exist`)
  if (node.kind === 'text') return escapeHtml(node.text)
  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('')
  const style = Object.entries(node.styles)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
  const identity = options.includeNodeIds ? ` data-sheet-node="${escapeHtml(node.id)}"` : ''
  const opening = `<${node.tag}${identity}${attributes}${style ? ` style="${escapeHtml(style)}"` : ''}>`
  if (node.namespace === 'html' && voidTags.has(node.tag)) return opening
  return `${opening}${orderedWebChildren(document, node.id)
    .map((child) => serializeWebNode(document, child.id, options))
    .join('')}</${node.tag}>`
}

export function serializeWebDocument(document: WebDocument, options: SerializeWebNodeOptions = {}) {
  assertWebDocument(document)
  return document.roots.map((id) => serializeWebNode(document, id, options)).join('')
}

export function materializeWebNode(
  document: WebDocument,
  nodeId: WebNodeId,
  ownerDocument: Document,
): globalThis.Node {
  const node = document.nodes[nodeId]
  if (!node) throw new Error(`Node ${nodeId} does not exist`)
  if (node.kind === 'text') return ownerDocument.createTextNode(node.text)
  const element =
    node.namespace === 'svg'
      ? ownerDocument.createElementNS('http://www.w3.org/2000/svg', node.tag)
      : ownerDocument.createElement(node.tag)
  element.setAttribute('data-sheet-node', node.id)
  for (const [name, value] of Object.entries(node.attributes)) {
    element.setAttribute(name, value)
  }
  for (const [name, value] of Object.entries(node.styles)) {
    ;(element as HTMLElement | SVGElement).style.setProperty(name, value)
  }
  for (const child of orderedWebChildren(document, node.id)) {
    element.append(materializeWebNode(document, child.id, ownerDocument))
  }
  return element
}

export function webNodeIdFromElement(element: Element) {
  return element.closest('[data-sheet-node]')?.getAttribute('data-sheet-node') ?? null
}

/**
 * Authored stylesheets as native `<style>` elements in cascade order. The
 * browser owns everything after this point: matching, cascade, media and
 * container evaluation, pseudo-classes, pseudo-elements, computed values.
 */
export function materializeWebStylesheets(
  document: WebDocument,
  ownerDocument: Document,
): HTMLStyleElement[] {
  assertWebDocument(document)
  return orderedWebStyleSheets(document.stylesheets, document.stylesheetOrder).map((sheet) => {
    const element = ownerDocument.createElement('style')
    element.setAttribute('data-sheet-stylesheet', sheet.id)
    const scopedRules = Object.fromEntries(Object.entries(sheet.rules).map(([id, rule]) => [
      id,
      { ...rule, selector: rule.selector.replace(/(^|[\s,>+~])(:root|html|body)(?=$|[\s,>+~.#[:])/gi, '$1:scope') },
    ]))
    element.textContent = `@scope ([data-sheet-document]){${serializeWebStyleSheet({ ...sheet, rules: scopedRules })}}`
    return element
  })
}
