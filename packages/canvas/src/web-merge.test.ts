import { describe, expect, it } from 'vitest'
import { mergeWebDocuments } from './web-merge'
import {
  applyWebTransaction,
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebStyleRule,
  createWebStyleSheet,
  createWebText,
  type WebDocument,
  type WebTransaction,
} from './web-model'

function baseFixture() {
  const document = createWebDocument('Merge base', 'merge-base')
  document.nodes.card = createWebElement('div', {
    id: 'card',
    order: 1_024,
    attributes: { class: 'card' },
    styles: { display: 'flex', gap: '16px' },
  })
  document.nodes.one = createWebElement('div', { id: 'one', parentId: 'card', order: 1_024 })
  document.nodes.two = createWebElement('div', { id: 'two', parentId: 'card', order: 2_048 })
  document.nodes.copy = createWebText('Hello', { id: 'copy', parentId: 'two', order: 1_024 })
  document.roots = ['card']
  document.stylesheets.main = createWebStyleSheet('main', { id: 'main', order: 1_024 })
  document.stylesheets.main.rules.base = createWebStyleRule(
    '.card',
    { gap: '16px', padding: '20px' },
    { id: 'base', order: 1_024 },
  )
  document.stylesheets.main.rules.accent = createWebStyleRule(
    '.accent',
    { color: 'red' },
    { id: 'accent', order: 2_048 },
  )
  document.stylesheets.main.ruleOrder = ['base', 'accent']
  document.stylesheetOrder = ['main']
  return assertWebDocument(document)
}

function fork(base: WebDocument, id: string, operations: WebTransaction['operations']) {
  return applyWebTransaction(base, { id, label: id, operations }).document
}

describe('mergeWebDocuments', () => {
  it('conflicts on same-field edits and merges one-sided edits', () => {
    const base = baseFixture()
    const left = fork(base, 'left-gap', [{
      type: 'node.patch', id: 'card',
      patch: { kind: 'element', styles: { gap: '32px' } },
    }])
    const right = fork(base, 'right-gap', [{
      type: 'node.patch', id: 'card',
      patch: { kind: 'element', styles: { gap: '8px' } },
    }])
    const same = mergeWebDocuments(base, left, right)
    expect(same.conflicts.map((conflict) => conflict.id)).toEqual(['node:card:styles.gap'])
    expect(same.unresolved).toEqual(['node:card:styles.gap'])
    // Conflicts resolve to the left (main) value; nothing is invented.
    expect(same.merged.nodes.card).toMatchObject({ styles: expect.objectContaining({ gap: '32px' }) })

    const oneSided = mergeWebDocuments(
      base,
      left,
      fork(base, 'right-class', [{
        type: 'node.patch', id: 'card',
        patch: { kind: 'element', attributes: { class: 'card wide' } },
      }]),
    )
    expect(oneSided.conflicts).toEqual([])
    expect(oneSided.merged.nodes.card).toMatchObject({
      styles: expect.objectContaining({ gap: '32px' }),
      attributes: { class: 'card wide' },
    })
  })

  it('conflicts on delete versus edit, and merges agreement', () => {
    const base = baseFixture()
    const deleted = fork(base, 'delete-two', [{ type: 'node.delete', id: 'two' }])
    const edited = fork(base, 'edit-two', [{
      type: 'node.patch', id: 'two',
      patch: { kind: 'element', attributes: { class: 'two promoted' } },
    }])
    const clash = mergeWebDocuments(base, deleted, edited)
    expect(clash.conflicts.map((conflict) => conflict.id)).toEqual(['node:two:$'])
    expect(clash.unresolved).toEqual(['node:two:$'])

    const agreed = mergeWebDocuments(base, deleted, fork(base, 'delete-two-again', [
      { type: 'node.delete', id: 'two' },
    ]))
    expect(agreed.conflicts).toEqual([])
    expect(agreed.merged.nodes.two).toBeUndefined()
    expect(agreed.merged.nodes.copy).toBeUndefined()
  })

  it('merges independent inserts deterministically and dedupes identical ones', () => {
    const base = baseFixture()
    const left = fork(base, 'left-insert', [{
      type: 'node.insert',
      node: createWebElement('div', { id: 'left-node', parentId: 'card', order: 1_536 }),
    }])
    const right = fork(base, 'right-insert', [{
      type: 'node.insert',
      node: createWebElement('div', { id: 'right-node', parentId: 'card', order: 1_792 }),
    }])
    const first = mergeWebDocuments(base, left, right)
    const second = mergeWebDocuments(base, left, right)
    expect(first.conflicts).toEqual([])
    // updatedAt stamps the merge moment; substance must be identical.
    const { metadata: _firstMeta, ...firstRest } = first.merged
    const { metadata: _secondMeta, ...secondRest } = second.merged
    expect(firstRest).toEqual(secondRest)
    expect(Object.keys(first.merged.nodes)).toContain('left-node')
    expect(Object.keys(first.merged.nodes)).toContain('right-node')

    const sameInsert = mergeWebDocuments(
      base,
      left,
      fork(base, 'same-insert', [{
        type: 'node.insert',
        node: createWebElement('div', { id: 'left-node', parentId: 'card', order: 1_536 }),
      }]),
    )
    expect(sameInsert.conflicts).toEqual([])
    expect(Object.values(sameInsert.merged.nodes).filter((node) => node.id === 'left-node')).toHaveLength(1)
  })

  it('treats divergent reorder as a conflict and shared reorder as clean', () => {
    const base = baseFixture()
    const left = fork(base, 'left-order', [{ type: 'node.move', id: 'two', parentId: 'card', order: 512 }])
    const right = fork(base, 'right-order', [{ type: 'node.move', id: 'two', parentId: 'card', order: 4_096 }])
    const clash = mergeWebDocuments(base, left, right)
    expect(clash.conflicts.map((conflict) => conflict.id)).toEqual(['node:two:order'])

    const shared = mergeWebDocuments(
      base,
      left,
      fork(base, 'shared-order', [{ type: 'node.move', id: 'two', parentId: 'card', order: 512 }]),
    )
    expect(shared.conflicts).toEqual([])
    expect(shared.merged.nodes.two).toMatchObject({ order: 512 })
  })

  it('keeps reorder and independent edits alive together', () => {
    const base = baseFixture()
    const left = fork(base, 'left-move', [{ type: 'node.move', id: 'two', parentId: 'card', order: 512 }])
    const right = fork(base, 'right-text', [{
      type: 'node.patch', id: 'copy', patch: { kind: 'text', text: 'World' },
    }])
    const merged = mergeWebDocuments(base, left, right)
    expect(merged.conflicts).toEqual([])
    expect(merged.merged.nodes.two).toMatchObject({ order: 512 })
    expect(merged.merged.nodes.copy).toMatchObject({ text: 'World' })
  })

  it('never invents cascade order and conflicts condition stacks', () => {
    const base = baseFixture()
    const left = fork(base, 'left-rule-order', [
      { type: 'rule.move', stylesheetId: 'main', id: 'accent', order: 512 },
    ])
    const right = fork(base, 'right-rule-order', [
      { type: 'rule.move', stylesheetId: 'main', id: 'accent', order: 4_096 },
    ])
    const clash = mergeWebDocuments(base, left, right)
    expect(clash.conflicts.map((conflict) => conflict.id)).toEqual(['rule:accent:order'])
    // The merged order comes from a surviving order field (left's 512 sorts
    // accent first), never synthesis.
    expect(clash.merged.stylesheets.main?.ruleOrder).toEqual(['accent', 'base'])

    const leftCond = fork(base, 'left-cond', [{
      type: 'rule.patch', stylesheetId: 'main', id: 'base',
      patch: { conditions: [{ kind: 'media', query: '(max-width: 700px)' }] },
    }])
    const rightCond = fork(base, 'right-cond', [{
      type: 'rule.patch', stylesheetId: 'main', id: 'base',
      patch: { conditions: [{ kind: 'container', query: '(max-width: 500px)' }] },
    }])
    const condClash = mergeWebDocuments(base, leftCond, rightCond)
    expect(condClash.conflicts.map((conflict) => conflict.id)).toEqual(['rule:base:conditions'])
  })

  it('applies resolutions and blocks apply on unresolved conflicts', () => {
    const base = baseFixture()
    const left = fork(base, 'left-gap-2', [{
      type: 'node.patch', id: 'card',
      patch: { kind: 'element', styles: { gap: '32px' } },
    }])
    const right = fork(base, 'right-gap-2', [{
      type: 'node.patch', id: 'card',
      patch: { kind: 'element', styles: { gap: '8px' } },
    }])
    const open = mergeWebDocuments(base, left, right)
    expect(open.unresolved).toHaveLength(1)
    const resolved = mergeWebDocuments(base, left, right, { 'node:card:styles.gap': 'right' })
    expect(resolved.unresolved).toEqual([])
    expect(resolved.conflicts).toHaveLength(1)
    expect(resolved.merged.nodes.card).toMatchObject({
      styles: expect.objectContaining({ gap: '8px' }),
    })
  })

  it('keeps template conflicts at the template level without touching clones', () => {
    const button = createWebElement('button', {
      id: 'btn-template', parentId: null, order: 1_024, attributes: { class: 'btn' },
    })
    const label = createWebText('Label', {
      id: 'btn-label-template', parentId: 'btn-template', order: 1_024,
    })
    const base = applyWebTransaction(baseFixture(), {
      id: 'define', label: 'Define',
      operations: [{
        type: 'component.define',
        component: { id: 'button', name: 'Button', templateRootIds: ['btn-template'], stylesheetId: null },
        template: [button, label],
      }],
    }).document
    const instantiated = applyWebTransaction(base, {
      id: 'create', label: 'Create',
      operations: [{ type: 'instance.create', id: 'a', componentId: 'button', parentId: 'card', order: 3_072 }],
    }).document
    const left = applyWebTransaction(instantiated, {
      id: 'left-label', label: 'Left',
      operations: [{ type: 'node.patch', id: 'btn-label-template', patch: { kind: 'text', text: 'Left' } }],
    }).document
    const right = applyWebTransaction(instantiated, {
      id: 'right-label', label: 'Right',
      operations: [{ type: 'node.patch', id: 'btn-label-template', patch: { kind: 'text', text: 'Right' } }],
    }).document
    const merged = mergeWebDocuments(instantiated, left, right)
    expect(merged.conflicts.map((conflict) => conflict.id)).toEqual(['node:btn-label-template:text'])
    // The clone follows its template's resolution (left default): one
    // authorship, one conflict, internally consistent merged content.
    const liveLabel = Object.entries(merged.merged.instances.a?.bindings ?? {}).find(
      ([, template]) => template === 'btn-label-template',
    )?.[0] as string
    expect(merged.merged.nodes[liveLabel]).toMatchObject({ text: 'Left' })
  })

  it('merges override journals deterministically and races structurally', () => {
    const button = createWebElement('button', {
      id: 'btn-template', parentId: null, order: 1_024, attributes: { class: 'btn' },
    })
    const label = createWebText('Label', {
      id: 'btn-label-template', parentId: 'btn-template', order: 1_024,
    })
    const base = applyWebTransaction(baseFixture(), {
      id: 'define-2', label: 'Define',
      operations: [{
        type: 'component.define',
        component: { id: 'button', name: 'Button', templateRootIds: ['btn-template'], stylesheetId: null },
        template: [button, label],
      }],
    }).document
    const live = (document: WebDocument) => {
      const bindings = document.instances.a?.bindings ?? {}
      return Object.entries(bindings).find(([, template]) => template === 'btn-label-template')?.[0] as string
    }
    const instantiated = applyWebTransaction(base, {
      id: 'create-2', label: 'Create',
      operations: [{ type: 'instance.create', id: 'a', componentId: 'button', parentId: 'card', order: 3_072 }],
    }).document
    const left = applyWebTransaction(instantiated, {
      id: 'left-override', label: 'Left',
      operations: [{
        type: 'instance.setOverride', instanceId: 'a', id: live(instantiated),
        override: { kind: 'text', text: 'Left' },
      }],
    }).document
    const right = applyWebTransaction(instantiated, {
      id: 'right-override', label: 'Right',
      operations: [{
        type: 'instance.setOverride', instanceId: 'a', id: live(instantiated),
        override: { kind: 'text', text: 'Right' },
      }],
    }).document
    const clash = mergeWebDocuments(instantiated, left, right)
    expect(clash.conflicts.map((conflict) => conflict.id)).toEqual([
      `instance:a:overrides.${live(instantiated)}.text`,
    ])

    // Delete (left) versus override-edit (right) is structural: conflict.
    const deleted = applyWebTransaction(instantiated, {
      id: 'delete-instance', label: 'Delete',
      operations: [{ type: 'instance.delete', id: 'a' }],
    }).document
    const race = mergeWebDocuments(instantiated, deleted, right)
    expect(race.conflicts.length).toBeGreaterThan(0)
    expect(race.unresolved.length).toBeGreaterThan(0)
  })
})
