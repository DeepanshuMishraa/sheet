import { diffWebDocuments } from './web-diff'
import type { WebNodeId } from './web-model'
import {
  assertWebDocument,
  liveNodeFromTemplate,
  type WebDocument,
} from './web-model'

export type WebMergeSide = 'left' | 'right'

export type WebMergeScope =
  | 'node'
  | 'stylesheet'
  | 'rule'
  | 'component'
  | 'instance'
  | 'document'

export interface WebMergeConflict {
  id: string
  scope: WebMergeScope
  targetId: string
  path: string
  base: unknown
  left: unknown
  right: unknown
}

export interface WebMergeResult {
  merged: WebDocument
  conflicts: WebMergeConflict[]
  unresolved: string[]
  summary: {
    added: number
    removed: number
    changed: number
  }
}

export type WebMergeResolutions = Readonly<Record<string, WebMergeSide>>

const missing = Symbol('missing')

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function conflictId(scope: WebMergeScope, targetId: string, path: string) {
  return `${scope}:${targetId}:${path || '$'}`
}

interface MergeContext {
  scope: WebMergeScope
  targetId: string
  path: string
  conflicts: WebMergeConflict[]
  unresolved: string[]
  resolutions: WebMergeResolutions
}

/**
 * Field-level three-way merge, mirroring the legacy `mergeValue` idiom:
 * agreement wins, one-sided change wins, kids recurse, everything else is a
 * conflict that resolves to the left (main) value unless a resolution picks
 * the right (draft). Deterministic for identical inputs — order conflicts
 * never invent an ordering; divergent orders conflict instead, because CSS
 * and DOM order are behavior, not metadata.
 */
function mergeValue(
  base: unknown,
  left: unknown,
  right: unknown,
  context: MergeContext,
): unknown {
  if (same(left, right)) return left
  if (same(base, left)) return right
  if (same(base, right)) return left

  if (isPlainObject(left) && isPlainObject(right) && (isPlainObject(base) || base === missing)) {
    const baseRecord = isPlainObject(base) ? base : {}
    const keys = new Set([...Object.keys(baseRecord), ...Object.keys(left), ...Object.keys(right)])
    const result: Record<string, unknown> = {}
    for (const key of keys) {
      const value = mergeValue(
        key in baseRecord ? baseRecord[key] : missing,
        key in left ? left[key] : missing,
        key in right ? right[key] : missing,
        { ...context, path: context.path ? `${context.path}.${key}` : key },
      )
      if (value !== missing) result[key] = value
    }
    return result
  }

  const id = conflictId(context.scope, context.targetId, context.path)
  const resolution = context.resolutions[id]
  context.conflicts.push({
    id,
    scope: context.scope,
    targetId: context.targetId,
    path: context.path,
    base: base === missing ? undefined : base,
    left: left === missing ? undefined : left,
    right: right === missing ? undefined : right,
  })
  if (!resolution) context.unresolved.push(id)
  return resolution === 'right' ? right : left
}

function mergeCollection(
  scope: WebMergeScope,
  base: Record<string, unknown>,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  conflicts: WebMergeConflict[],
  unresolved: string[],
  resolutions: WebMergeResolutions,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const ids = new Set([...Object.keys(base), ...Object.keys(left), ...Object.keys(right)])
  for (const id of ids) {
    const value = mergeValue(
      id in base ? base[id] : missing,
      id in left ? left[id] : missing,
      id in right ? right[id] : missing,
      { scope, targetId: id, path: '', conflicts, unresolved, resolutions },
    )
    if (value !== missing) result[id] = value as Record<string, unknown>
  }
  return result
}

/**
 * Drops binding/override entries and instance records that reference merged-
 * away nodes — the merge-time equivalent of transaction prune semantics.
 * Derived state follows the nodes; it never conflicts on its own.
 */
function pruneMergedInstances(document: WebDocument): void {
  for (const instance of Object.values(document.instances)) {
    for (const liveId of Object.keys(instance.bindings)) {
      const templateId = instance.bindings[liveId]
      if (
        !document.nodes[liveId] ||
        !templateId ||
        !document.nodes[templateId]
      ) {
        delete instance.bindings[liveId]
        delete instance.overrides[liveId]
      }
    }
  }
  for (const instance of Object.values(document.instances)) {
    if (!document.nodes[instance.rootId]) delete document.instances[instance.id]
  }
}

/**
 * Bound live content is derived, never independently authored: recompute
 * every bound node from (merged template, merged journal) with the same
 * pure function transactions use, and drop the duplicate content conflicts
 * so one authorship surfaces once — at the template field or the journal
 * entry that actually diverged. Structural fields (parentId/order) are not
 * recomputed here; their conflicts stay visible for review.
 */
function reconcileBoundContent(
  document: WebDocument,
  conflicts: WebMergeConflict[],
  unresolved: string[],
): void {
  const bound = new Set<WebNodeId>()
  for (const instance of Object.values(document.instances)) {
    for (const [liveId, templateId] of Object.entries(instance.bindings)) {
      const live = document.nodes[liveId]
      const template = templateId ? document.nodes[templateId] : undefined
      if (!live || !template) continue
      document.nodes[liveId] = liveNodeFromTemplate(template, live, instance.overrides[liveId])
      bound.add(liveId)
    }
  }
  const isContentPath = (path: string) =>
    path === 'tag' ||
    path === 'text' ||
    path.startsWith('attributes') ||
    path.startsWith('styles')
  const dropped = new Set(
    conflicts
      .filter((conflict) =>
        conflict.scope === 'node' &&
        bound.has(conflict.targetId) &&
        isContentPath(conflict.path),
      )
      .map((conflict) => conflict.id),
  )
  if (dropped.size === 0) return
  conflicts.splice(0, conflicts.length, ...conflicts.filter((conflict) => !dropped.has(conflict.id)))
  unresolved.splice(0, unresolved.length, ...unresolved.filter((id) => !dropped.has(id)))
}

function syncMergedOrders(document: WebDocument): void {
  document.roots = Object.values(document.nodes)
    .filter((node) => {
      if (node.parentId !== null) return false
      return !Object.values(document.components).some((component) =>
        component.templateRootIds.includes(node.id),
      )
    })
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((node) => node.id)
  document.stylesheetOrder = Object.values(document.stylesheets)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((sheet) => sheet.id)
  for (const sheet of Object.values(document.stylesheets)) {
    sheet.ruleOrder = Object.values(sheet.rules)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((rule) => rule.id)
  }
}

/**
 * Three-way merge of web documents: base plus main (left) plus draft
 * (right). Operates directly on WebNodes, rules, sheets, components, and
 * instances — `CanvasDocument` never appears in this pipeline. Order and
 * cascade arrays are re-derived from merged order fields; divergent orders
 * conflict at the field rather than inventing an interleaving.
 */
export function mergeWebDocuments(
  base: WebDocument,
  left: WebDocument,
  right: WebDocument,
  resolutions: WebMergeResolutions = {},
): WebMergeResult {
  assertWebDocument(base)
  assertWebDocument(left)
  assertWebDocument(right)
  const conflicts: WebMergeConflict[] = []
  const unresolved: string[] = []

  const nodes = mergeCollection(
    'node',
    base.nodes as Record<string, unknown>,
    left.nodes as Record<string, unknown>,
    right.nodes as Record<string, unknown>,
    conflicts,
    unresolved,
    resolutions,
  )
  // Order arrays are derived from order fields (see syncMergedOrders), so
  // they are stripped before merging: merging them atomically would turn
  // two independent rule inserts into a whole-array conflict, while
  // re-deriving keeps cascade order exact and flags only real order-field
  // divergence. Same reason roots/stylesheetOrder never enter the merge.
  // Rules merge per rule id under their own scope (not nested inside the
  // sheet scope) so review surfaces `rule:<id>:<path>` conflicts directly.
  const stripSheet = (sheet: unknown) => {
    const record = { ...(sheet as Record<string, unknown>) }
    delete record.rules
    delete record.ruleOrder
    return record
  }
  const stripSheets = (sheets: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(sheets).map(([id, sheet]) => [id, stripSheet(sheet)]))
  const stylesheets = mergeCollection(
    'stylesheet',
    stripSheets(base.stylesheets as Record<string, unknown>),
    stripSheets(left.stylesheets as Record<string, unknown>),
    stripSheets(right.stylesheets as Record<string, unknown>),
    conflicts,
    unresolved,
    resolutions,
  )
  const rulesBySheet = new Map<string, Record<string, unknown>>()
  for (const id of Object.keys(stylesheets)) {
    const baseRules = (base.stylesheets[id]?.rules ?? {}) as Record<string, unknown>
    const leftRules = (left.stylesheets[id]?.rules ?? {}) as Record<string, unknown>
    const rightRules = (right.stylesheets[id]?.rules ?? {}) as Record<string, unknown>
    rulesBySheet.set(
      id,
      mergeCollection('rule', baseRules, leftRules, rightRules, conflicts, unresolved, resolutions),
    )
  }
  const components = mergeCollection(
    'component',
    base.components as Record<string, unknown>,
    left.components as Record<string, unknown>,
    right.components as Record<string, unknown>,
    conflicts,
    unresolved,
    resolutions,
  )
  const instances = mergeCollection(
    'instance',
    base.instances as Record<string, unknown>,
    left.instances as Record<string, unknown>,
    right.instances as Record<string, unknown>,
    conflicts,
    unresolved,
    resolutions,
  )
  const name = mergeValue(base.name, left.name, right.name, {
    scope: 'document',
    targetId: left.id,
    path: 'name',
    conflicts,
    unresolved,
    resolutions,
  })

  for (const [id, rules] of rulesBySheet) {
    const sheet = stylesheets[id] as Record<string, unknown> | undefined
    if (!sheet) continue
    sheet.rules = rules
    sheet.ruleOrder = []
  }
  const merged = {
    model: 'web',
    schemaVersion: left.schemaVersion,
    id: left.id,
    name,
    nodes,
    roots: [],
    stylesheets,
    stylesheetOrder: [],
    components,
    instances,
    metadata: { ...left.metadata, updatedAt: Date.now() },
  } as WebDocument
  reconcileBoundContent(merged, conflicts, unresolved)
  pruneMergedInstances(merged)
  syncMergedOrders(merged)
  // Pruning only removes derived entries and sync only re-derives order
  // arrays, so this validation is exact, not a repair pass: anything
  // structurally broken still throws here.
  const validated = assertWebDocument(merged)
  return {
    merged: validated,
    conflicts,
    unresolved,
    summary: diffWebDocuments(base, validated),
  }
}

/** Node IDs whose content differs between two documents, for realtime fan-out. */
export function changedWebNodeIds(previous: WebDocument, next: WebDocument): WebNodeId[] {
  assertWebDocument(previous)
  assertWebDocument(next)
  const changed: WebNodeId[] = []
  for (const id of Object.keys(next.nodes)) {
    if (JSON.stringify(previous.nodes[id]) !== JSON.stringify(next.nodes[id])) {
      changed.push(id)
    }
  }
  for (const id of Object.keys(previous.nodes)) {
    if (!next.nodes[id]) changed.push(id)
  }
  return [...new Set(changed)]
}
