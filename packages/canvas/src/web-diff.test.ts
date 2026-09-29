import { describe, expect, it } from 'vitest'
import { diffWebDocuments } from './web-diff'
import {
  applyWebTransaction,
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebStyleRule,
  createWebStyleSheet,
  createWebText,
} from './web-model'

function cardFixture() {
  const document = createWebDocument('Diff', 'diff')
  document.nodes.card = createWebElement('div', {
    id: 'card',
    order: 1_024,
    attributes: { class: 'card' },
  })
  document.nodes.title = createWebText('Title', { id: 'title', parentId: 'card', order: 1_024 })
  document.roots = ['card']
  document.stylesheets.main = createWebStyleSheet('main', { id: 'main', order: 1_024 })
  document.stylesheets.main.rules.base = createWebStyleRule(
    '.card',
    { gap: '16px' },
    { id: 'base', order: 1_024 },
  )
  document.stylesheets.main.ruleOrder = ['base']
  document.stylesheetOrder = ['main']
  return assertWebDocument(document)
}

describe('diffWebDocuments', () => {
  it('counts node additions, removals, and edits', () => {
    const before = cardFixture()
    const added = applyWebTransaction(before, {
      id: 'add',
      label: 'Add',
      operations: [{
        type: 'node.insert',
        node: createWebElement('div', { id: 'extra', parentId: 'card', order: 2_048 }),
      }],
    }).document
    expect(diffWebDocuments(before, added)).toEqual({ added: 1, removed: 0, changed: 0 })

    const edited = applyWebTransaction(before, {
      id: 'edit',
      label: 'Edit',
      operations: [
        { type: 'node.delete', id: 'title' },
        {
          type: 'node.patch',
          id: 'card',
          patch: { kind: 'element', attributes: { class: 'card wide' } },
        },
      ],
    }).document
    expect(diffWebDocuments(before, edited)).toEqual({ added: 0, removed: 1, changed: 1 })
    expect(diffWebDocuments(before, before)).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('counts rule changes including order, and sheet changes', () => {
    const before = cardFixture()
    const changed = applyWebTransaction(before, {
      id: 'rule',
      label: 'Rule',
      operations: [
        {
          type: 'rule.patch',
          stylesheetId: 'main',
          id: 'base',
          patch: { declarations: { gap: '32px' } },
        },
        {
          type: 'rule.insert',
          stylesheetId: 'main',
          rule: createWebStyleRule('.card', { padding: '8px' }, { id: 'pad', order: 2_048 }),
        },
      ],
    }).document
    expect(diffWebDocuments(before, changed)).toEqual({ added: 1, removed: 0, changed: 1 })

    const reordered = applyWebTransaction(before, {
      id: 'reorder',
      label: 'Reorder',
      operations: [
        {
          type: 'rule.insert',
          stylesheetId: 'main',
          rule: createWebStyleRule('.card', { padding: '8px' }, { id: 'pad', order: 512 }),
        },
      ],
    }).document
    // Order is cascade behavior: moving the new rule ahead changes both rows.
    expect(diffWebDocuments(before, reordered)).toEqual({ added: 1, removed: 0, changed: 0 })
    const moved = applyWebTransaction(reordered, {
      id: 'move-rule',
      label: 'Move rule',
      operations: [{ type: 'rule.move', stylesheetId: 'main', id: 'pad', order: 3_072 }],
    }).document
    expect(diffWebDocuments(reordered, moved).changed).toBe(1)
  })

  it('counts a template-propagated edit once, not once per clone', () => {
    const button = createWebElement('button', {
      id: 'btn-template',
      parentId: null,
      order: 1_024,
      attributes: { class: 'btn' },
    })
    const label = createWebText('Label', {
      id: 'btn-label-template',
      parentId: 'btn-template',
      order: 1_024,
    })
    let document = applyWebTransaction(cardFixture(), {
      id: 'define',
      label: 'Define',
      operations: [{
        type: 'component.define',
        component: { id: 'button', name: 'Button', templateRootIds: ['btn-template'], stylesheetId: null },
        template: [button, label],
      }],
    }).document
    document = applyWebTransaction(document, {
      id: 'create',
      label: 'Create',
      operations: [{ type: 'instance.create', id: 'a', componentId: 'button', parentId: 'card', order: 2_048 }],
    }).document
    const edited = applyWebTransaction(document, {
      id: 'relabel',
      label: 'Relabel',
      operations: [{
        type: 'node.patch',
        id: 'btn-label-template',
        patch: { kind: 'text', text: 'Go' },
      }],
    }).document
    // One authorship (the template text), not template + clone.
    expect(diffWebDocuments(document, edited)).toEqual({ added: 0, removed: 0, changed: 1 })

    const liveLabel = Object.entries(document.instances.a?.bindings ?? {}).find(
      ([, template]) => template === 'btn-label-template',
    )?.[0] as string
    const overridden = applyWebTransaction(document, {
      id: 'override',
      label: 'Override',
      operations: [{
        type: 'instance.setOverride',
        instanceId: 'a',
        id: liveLabel,
        override: { kind: 'text', text: 'Custom' },
      }],
    }).document
    // The override divergence counts once at its node.
    expect(diffWebDocuments(document, overridden)).toEqual({ added: 0, removed: 0, changed: 1 })
  })
})
