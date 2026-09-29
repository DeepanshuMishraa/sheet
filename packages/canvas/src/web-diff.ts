import { boundNodeIndex } from './web-components'
import {
  assertWebDocument,
  type WebDocument,
} from './web-model'

export interface WebDocumentDiff {
  added: number
  removed: number
  changed: number
}

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Counts what changed between two web documents for version checkpoints.
 *
 * Identity is by stable ID everywhere; order and cascade included:
 * - Nodes: added/removed by presence; present-in-both compared as JSON,
 *   except bound live nodes, which are pure functions of (template,
 *   override). A template edit that propagates to N clones counts once at
 *   the template node, not N times — the clones carry no independent
 *   authorship. An override entry that differs counts once at its node.
 * - Stylesheets, rules (including order and condition stacks), components,
 *   and instances: added/removed by ID, changed by JSON comparison. Rule
 *   order is behavior (cascade), so it counts.
 */
export function diffWebDocuments(previous: WebDocument, next: WebDocument): WebDocumentDiff {
  assertWebDocument(previous)
  assertWebDocument(next)
  let added = 0
  let removed = 0
  let changed = 0

  const prevBound = boundNodeIndex(previous.instances)
  const nextBound = boundNodeIndex(next.instances)
  for (const id of Object.keys(next.nodes)) {
    const before = previous.nodes[id]
    const after = next.nodes[id]
    if (!before) {
      added += 1
      continue
    }
    if (!after) continue
    if (prevBound.has(id) && nextBound.has(id)) {
      // Bound live content is a pure function of (template, journal): the
      // template edit counts at its node, the override counts at its
      // record. Counting the clone too would triple-count one authorship.
      continue
    }
    if (!jsonEqual(before, after)) changed += 1
  }
  for (const id of Object.keys(previous.nodes)) {
    if (!next.nodes[id]) removed += 1
  }

  for (const id of Object.keys(next.stylesheets)) {
    const before = previous.stylesheets[id]
    const after = next.stylesheets[id]
    if (!before || !after) {
      if (!before) added += 1
      continue
    }
    if (before.name !== after.name || before.order !== after.order) changed += 1
    for (const ruleId of Object.keys(after.rules)) {
      if (!before.rules[ruleId]) added += 1
      else if (!jsonEqual(before.rules[ruleId], after.rules[ruleId])) changed += 1
    }
    for (const ruleId of Object.keys(before.rules)) {
      if (!after.rules[ruleId]) removed += 1
    }
  }
  for (const id of Object.keys(previous.stylesheets)) {
    if (!next.stylesheets[id]) removed += 1
  }

  const diffRecords = (
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) => {
    for (const id of Object.keys(after)) {
      if (before[id] === undefined) added += 1
      else if (!jsonEqual(before[id], after[id])) changed += 1
    }
    for (const id of Object.keys(before)) {
      if (after[id] === undefined) removed += 1
    }
  }
  diffRecords(previous.components, next.components)
  diffRecords(previous.instances, next.instances)

  return { added, removed, changed }
}
