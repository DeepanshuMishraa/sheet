import { describe, expect, it } from 'vitest'
import { BOUND_NODE_ERROR } from './web-components'
import {
  applyWebTransaction,
  assertWebDocument,
  createWebDocument,
  createWebElement,
  createWebText,
  detachComponents,
  parseWebDocument,
  type WebDocument,
  type WebElementNode,
  type WebNode,
  type WebTransaction,
} from './web-model'

function buttonTemplate() {
  const button = createWebElement('button', {
    id: 'btn-template',
    parentId: null,
    order: 1_024,
    attributes: { class: 'btn' },
  })
  const icon = createWebElement('span', {
    id: 'btn-icon-template',
    parentId: 'btn-template',
    order: 1_024,
    attributes: { class: 'icon' },
  })
  const label = createWebElement('span', {
    id: 'btn-label-template',
    parentId: 'btn-template',
    order: 2_048,
    attributes: { class: 'label' },
  })
  const labelText = createWebText('Label', {
    id: 'btn-label-text-template',
    parentId: 'btn-label-template',
    order: 1_024,
  })
  return { button, icon, label, labelText }
}

function defineButton(document: WebDocument) {
  const template = buttonTemplate()
  return applyWebTransaction(document, {
    id: 'define-button',
    label: 'Define Button',
    operations: [{
      type: 'component.define',
      component: {
        id: 'button',
        name: 'Button',
        templateRootIds: ['btn-template'],
        stylesheetId: null,
      },
      template: [template.button, template.icon, template.label, template.labelText],
    }],
  }).document
}

function createInstance(document: WebDocument, id: string, order = 1_024) {
  return applyWebTransaction(document, {
    id: `create-${id}`,
    label: 'Create instance',
    operations: [{ type: 'instance.create', id, componentId: 'button', parentId: null, order }],
  })
}

function fixture() {
  return assertWebDocument(createWebDocument('Components', 'components'))
}

function liveRoot(document: WebDocument, instanceId: string) {
  const instance = document.instances[instanceId]
  if (!instance) throw new Error(`Instance ${instanceId} is missing`)
  const root = document.nodes[instance.rootId]
  if (!root || root.kind !== 'element') throw new Error(`Instance ${instanceId} root is missing`)
  return { instance, root }
}

describe('web components', () => {
  it('defines a component and instantiates ordinary nodes with bindings', () => {
    const defined = defineButton(fixture())
    expect(defined.roots).toEqual([])
    expect(defined.components.button?.templateRootIds).toEqual(['btn-template'])

    const created = createInstance(defined, 'a')
    expect(created.document.roots).toEqual([created.document.instances.a?.rootId])
    const { instance, root } = liveRoot(created.document, 'a')
    expect(root).toMatchObject({ kind: 'element', tag: 'button', parentId: null })
    expect(root.attributes).toEqual({ class: 'btn' })
    expect(instance.bindings[instance.rootId]).toBe('btn-template')
    expect(Object.values(instance.bindings)).toHaveLength(4)
    // Every node kind is ordinary DOM vocabulary.
    for (const node of Object.values(created.document.nodes)) {
      expect(['element', 'text']).toContain(node.kind)
    }
  })

  it('sets explicit overrides and rejects every other override shape', () => {
    const created = createInstance(defineButton(fixture()), 'a').document
    const { instance } = liveRoot(created, 'a')
    const labelTextId = Object.entries(instance.bindings).find(
      ([, templateId]) => templateId === 'btn-label-text-template',
    )?.[0] as string

    const overridden = applyWebTransaction(created, {
      id: 'override-label',
      label: 'Override label',
      operations: [{
        type: 'instance.setOverride',
        instanceId: 'a',
        id: labelTextId,
        override: { kind: 'text', text: 'Go' },
      }],
    }).document
    expect(overridden.nodes[labelTextId]).toMatchObject({ kind: 'text', text: 'Go' })
    expect(overridden.instances.a?.overrides[labelTextId]).toEqual({ kind: 'text', text: 'Go' })

    const rootId = overridden.instances.a?.rootId as string
    const withProp = applyWebTransaction(overridden, {
      id: 'override-prop',
      label: 'Override custom property',
      operations: [{
        type: 'instance.setOverride',
        instanceId: 'a',
        id: rootId,
        override: { kind: 'custom-properties', properties: { '--btn-bg': '#b91c1c' } },
      }],
    }).document
    expect(withProp.nodes[rootId]).toMatchObject({
      styles: { '--btn-bg': '#b91c1c' },
    })

    // A plain CSS property is not an override: it must travel as a class.
    expect(() =>
      applyWebTransaction(withProp, {
        id: 'bad-override',
        label: 'Bad override',
        operations: [{
          type: 'instance.setOverride',
          instanceId: 'a',
          id: rootId,
          override: { kind: 'custom-properties', properties: { width: '10px' } },
        }],
      }),
    ).toThrow('must start with "--"')
    // Text overrides target text nodes only.
    expect(() =>
      applyWebTransaction(withProp, {
        id: 'bad-target',
        label: 'Bad target',
        operations: [{
          type: 'instance.setOverride',
          instanceId: 'a',
          id: rootId,
          override: { kind: 'text', text: 'Nope' },
        }],
      }),
    ).toThrow('cannot apply to element')
  })

  it('rejects direct mutation of bound live nodes', () => {
    const created = createInstance(defineButton(fixture()), 'a').document
    const { instance } = liveRoot(created, 'a')
    const labelTextId = Object.entries(instance.bindings).find(
      ([, templateId]) => templateId === 'btn-label-text-template',
    )?.[0] as string
    const labelId = instance.bindings
      ? (Object.entries(instance.bindings).find(([, templateId]) => templateId === 'btn-label-template')?.[0] as string)
      : ''

    for (const operations of [
      [{ type: 'node.patch', id: labelTextId, patch: { kind: 'text', text: 'Hack' } }],
      [{
        type: 'node.patch',
        id: labelId,
        patch: { kind: 'element', attributes: { class: 'hacked' } },
      }],
      [{ type: 'node.move', id: labelId, parentId: null, order: 9_999 }],
      [{ type: 'node.delete', id: labelId }],
    ] as WebTransaction['operations'][]) {
      expect(() =>
        applyWebTransaction(created, { id: 'direct', label: 'Direct edit', operations }),
      ).toThrow(BOUND_NODE_ERROR)
    }
    expect(() =>
      applyWebTransaction(created, {
        id: 'insert-under-bound',
        label: 'Insert under bound',
        operations: [{
          type: 'node.insert',
          node: createWebElement('div', { id: 'sneaky', parentId: labelId, order: 1_024 }),
        }],
      }),
    ).toThrow(BOUND_NODE_ERROR)
  })

  it('propagates definition text changes around overrides', () => {
    const first = createInstance(defineButton(fixture()), 'a')
    const second = createInstance(first.document, 'b', 2_048)
    const labelOf = (document: WebDocument, instanceId: string) => {
      const bindings = document.instances[instanceId]?.bindings ?? {}
      return Object.entries(bindings).find(([, templateId]) => templateId === 'btn-label-text-template')?.[0] as string
    }
    const withOverride = applyWebTransaction(second.document, {
      id: 'override-b',
      label: 'Override b label',
      operations: [{
        type: 'instance.setOverride',
        instanceId: 'b',
        id: labelOf(second.document, 'b'),
        override: { kind: 'text', text: 'Custom' },
      }],
    }).document
    const patched = applyWebTransaction(withOverride, {
      id: 'relabel-template',
      label: 'Relabel template',
      operations: [{
        type: 'node.patch',
        id: 'btn-label-text-template',
        patch: { kind: 'text', text: 'Submit' },
      }],
    }).document
    // Un-overridden instance follows the definition; overridden keeps diverging.
    expect(patched.nodes[labelOf(patched, 'a')]).toMatchObject({ text: 'Submit' })
    expect(patched.nodes[labelOf(patched, 'b')]).toMatchObject({ text: 'Custom' })

    // Undo restores both through the same pure recomputation.
    const undone = applyWebTransaction(
      patched,
      applyWebTransaction(withOverride, {
        id: 'relabel-template-2',
        label: 'Relabel',
        operations: [{
          type: 'node.patch',
          id: 'btn-label-text-template',
          patch: { kind: 'text', text: 'Submit' },
        }],
      }).inverse,
    ).document
    expect(undone.nodes[labelOf(undone, 'a')]).toMatchObject({ text: 'Label' })
    expect(undone.nodes[labelOf(undone, 'b')]).toMatchObject({ text: 'Custom' })
  })

  it('mirrors template structural edits and drops overrides of removed nodes', () => {
    const created = createInstance(defineButton(fixture()), 'a').document
    const bindings = created.instances.a?.bindings ?? {}
    const iconId = Object.entries(bindings).find(([, templateId]) => templateId === 'btn-icon-template')?.[0] as string
    const withOverride = applyWebTransaction(created, {
      id: 'override-icon',
      label: 'Override icon class',
      operations: [{
        type: 'instance.setOverride',
        instanceId: 'a',
        id: iconId,
        override: { kind: 'attributes', attributes: { class: 'icon large' } },
      }],
    }).document
    const deleted = applyWebTransaction(withOverride, {
      id: 'delete-icon-template',
      label: 'Delete icon template',
      operations: [{ type: 'node.delete', id: 'btn-icon-template' }],
    }).document
    expect(deleted.nodes[iconId]).toBeUndefined()
    expect(deleted.instances.a?.bindings[iconId]).toBeUndefined()
    expect(deleted.instances.a?.overrides[iconId]).toBeUndefined()

    const undone = applyWebTransaction(
      deleted,
      applyWebTransaction(withOverride, {
        id: 'delete-again',
        label: 'Delete again',
        operations: [{ type: 'node.delete', id: 'btn-icon-template' }],
      }).inverse,
    ).document
    expect(undone.nodes[iconId]).toMatchObject({ kind: 'element', tag: 'span' })
    expect(undone.instances.a?.overrides[iconId]).toEqual({
      kind: 'attributes',
      attributes: { class: 'icon large' },
    })
  })

  it('rejects dependency cycles and refuses component delete with live instances', () => {
    const defined = defineButton(fixture())
    const created = createInstance(defined, 'a').document
    // Self-nesting: Button inside Button's own template.
    expect(() =>
      applyWebTransaction(created, {
        id: 'self-nest',
        label: 'Self nest',
        operations: [{ type: 'instance.create', componentId: 'button', parentId: 'btn-template', order: 3_072 }],
      }),
    ).toThrow('dependency cycle')

    expect(() =>
      applyWebTransaction(created, {
        id: 'delete-component',
        label: 'Delete component',
        operations: [{ type: 'component.delete', id: 'button' }],
      }),
    ).toThrow('while 1 instance(s) exist')

    const emptied = applyWebTransaction(created, {
      id: 'delete-instance',
      label: 'Delete instance',
      operations: [{ type: 'instance.delete', id: 'a' }],
    }).document
    expect(emptied.roots).toEqual([])
    expect(emptied.instances).toEqual({})
    const deleted = applyWebTransaction(emptied, {
      id: 'delete-component-now',
      label: 'Delete component',
      operations: [{ type: 'component.delete', id: 'button' }],
    }).document
    expect(deleted.components).toEqual({})
    expect(deleted.nodes['btn-template']).toBeUndefined()
  })

  it('nests components with placeholder semantics and propagates through them', () => {
    const outer = createWebElement('div', {
      id: 'card-template',
      parentId: null,
      order: 1_024,
      attributes: { class: 'card' },
    })
    const withCard = applyWebTransaction(fixture(), {
      id: 'define-card',
      label: 'Define Card',
      operations: [{
        type: 'component.define',
        component: { id: 'card', name: 'Card', templateRootIds: ['card-template'], stylesheetId: null },
        template: [outer],
      }],
    }).document
    const withButton = applyWebTransaction(withCard, {
      id: 'define-button-2',
      label: 'Define Button',
      operations: [{
        type: 'component.define',
        component: {
          id: 'button2',
          name: 'Button',
          templateRootIds: ['btn-template'],
          stylesheetId: null,
        },
        template: Object.values(buttonTemplate()),
      }],
    }).document
    const nested = applyWebTransaction(withButton, {
      id: 'nest-button',
      label: 'Nest Button in Card',
      operations: [{
        type: 'instance.create',
        id: 'nested',
        componentId: 'button2',
        parentId: 'card-template',
        order: 1_024,
      }],
    }).document
    const placeholderId = nested.instances.nested?.rootId as string
    expect(nested.nodes[placeholderId]).toMatchObject({ kind: 'element', tag: 'button' })

    const instantiated = applyWebTransaction(nested, {
      id: 'create-card',
      label: 'Create Card',
      operations: [{ type: 'instance.create', id: 'card-a', componentId: 'card', parentId: null, order: 1_024 }],
    }).document
    const cardRoot = instantiated.instances['card-a']?.rootId as string
    const livePlaceholder = (Object.values(instantiated.nodes).find((node) =>
      node.parentId === cardRoot && node.kind === 'element'
    ) as WebElementNode | undefined)?.id as string
    // The nested Button materialized inside the live Card with its own record.
    const nestedLive = Object.values(instantiated.instances).find(
      (instance) => instance.componentId === 'button2' && instance.rootId === livePlaceholder,
    )
    expect(nestedLive).toBeDefined()
    expect(Object.values(nestedLive?.bindings ?? {})).toHaveLength(4)

    // A Button definition change reaches the nested live copy.
    const patched = applyWebTransaction(instantiated, {
      id: 'relabel-nested-template',
      label: 'Relabel nested template',
      operations: [{
        type: 'node.patch',
        id: 'btn-label-text-template',
        patch: { kind: 'text', text: 'Nested!' },
      }],
    }).document
    const nestedLabel = Object.entries(
      (patched.instances[nestedLive?.id as string]?.bindings ?? {}),
    ).find(([, templateId]) => templateId === 'btn-label-text-template')?.[0] as string
    expect(patched.nodes[nestedLabel]).toMatchObject({ text: 'Nested!' })
  })

  it('detaches component metadata while the live tree stays ordinary content', () => {
    const created = createInstance(defineButton(fixture()), 'a').document
    const overridden = applyWebTransaction(created, {
      id: 'override-detach',
      label: 'Override',
      operations: [{
        type: 'instance.setOverride',
        instanceId: 'a',
        id: Object.entries(created.instances.a?.bindings ?? {}).find(
          ([, templateId]) => templateId === 'btn-label-text-template',
        )?.[0] as string,
        override: { kind: 'text', text: 'Go' },
      }],
    }).document
    const detached = detachComponents(overridden)
    expect(detached.components).toEqual({})
    expect(detached.instances).toEqual({})
    expect(detached.nodes['btn-template']).toBeUndefined()
    // The live Button survives verbatim, overrides applied, as plain nodes.
    const live = Object.values(detached.nodes).filter((node) => node.kind === 'element')
    expect(live.map((node) => (node as WebElementNode).tag)).toEqual(['button', 'span', 'span'])
    expect(serializeLiveText(detached)).toContain('Go')
    assertWebDocument(detached)
  })

  it('migrates schema v2 documents and validates v3 strictly', () => {
    const v2 = {
      model: 'web',
      schemaVersion: 2,
      id: 'legacy-web',
      name: 'Legacy web',
      nodes: {},
      roots: [],
      stylesheets: {},
      stylesheetOrder: [],
      metadata: { createdAt: 1, updatedAt: 1 },
    }
    const migrated = parseWebDocument(v2)
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.components).toEqual({})
    expect(migrated.instances).toEqual({})
    expect(() => assertWebDocument(v2)).toThrow('schema version')
  })
})

function serializeLiveText(document: WebDocument) {
  return Object.values(document.nodes)
    .filter((node): node is Extract<WebNode, { kind: 'text' }> => node.kind === 'text')
    .map((node) => node.text)
    .join('')
}
