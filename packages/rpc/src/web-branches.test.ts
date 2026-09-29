import { describe, expect, it } from 'vitest'
import { db, ensureLocalUser, LOCAL_USER_ID } from '@sheet/db'
import { design } from '@sheet/db/schema'
import {
  assertWebDocument,
  createWebDocument,
  createWebElement,
  WEB_CANVAS_STORAGE_VERSION,
  type WebDocument,
} from '@sheet/canvas/web-model'
import { createSheetToolExecutor } from './mcp-server'
import type { McpUsageController } from './mcp-server'
import { appRouter } from './router'

/**
 * M8b-4 proof: web branches snapshot, edit independently, compare through
 * the web merge, and apply atomically, with conflicts blocking apply.
 */

const context = {
  context: { request: new Request('http://localhost/api/rpc') },
}

function usage(): McpUsageController {
  const snapshot = {
    metric: 'mcp_tool_calls' as const,
    plan: 'free' as const,
    included: 200,
    used: 0,
    remaining: 200,
    periodStart: '2026-07-27T00:00:00.000Z',
    resetsAt: '2026-08-03T00:00:00.000Z',
  }
  return {
    current: async () => snapshot,
    reserve: async () => snapshot,
  }
}

function cardFixture() {
  const document = createWebDocument('Branch base', 'branch-base')
  document.nodes.card = createWebElement('div', {
    id: 'card',
    order: 1_024,
    attributes: { class: 'card' },
    styles: { display: 'flex', gap: '16px' },
  })
  document.nodes.one = createWebElement('div', { id: 'one', parentId: 'card', order: 1_024 })
  document.nodes.two = createWebElement('div', { id: 'two', parentId: 'card', order: 2_048 })
  document.roots = ['card']
  return assertWebDocument(document)
}

async function seedDesign(document: WebDocument) {
  await ensureLocalUser()
  const id = `web-branch-${crypto.randomUUID()}`
  await db.insert(design).values({
    id,
    userId: LOCAL_USER_ID,
    name: document.name,
    shapes: [],
    pages: [],
    canvasVersion: WEB_CANVAS_STORAGE_VERSION,
    canvasDocument: document,
    revision: 0,
  })
  return id
}

describe('web branches', () => {
  it('branches, edits both sides, compares clean, and applies', async () => {
    const designId = await seedDesign(cardFixture())
    const tag = crypto.randomUUID().slice(0, 8)
    const create = appRouter.draft.create.callable(context)
    const created = await create({ id: `dr-${tag}`, designId, name: 'Spacing' })
    expect(created).toMatchObject({ status: 'active', baseRevision: 0 })

    const applyTx = appRouter.webCanvas.applyTransaction.callable(context)
    const mainEdit = await applyTx({
      designId,
      expectedRevision: 0,
      transaction: {
        id: `main-${tag}`,
        label: 'Main gap',
        operations: [{
          type: 'node.patch', id: 'card',
          patch: { kind: 'element', styles: { gap: '32px' } },
        }],
      },
    })
    expect(mainEdit).toMatchObject({ applied: true, revision: 1 })
    const draftEdit = await applyTx({
      designId,
      draftId: `dr-${tag}`,
      expectedRevision: 0,
      transaction: {
        id: `draft-${tag}`,
        label: 'Draft class',
        operations: [{
          type: 'node.patch', id: 'card',
          patch: { kind: 'element', attributes: { class: 'card wide' } },
        }],
      },
    })
    expect(draftEdit).toMatchObject({ applied: true, revision: 1 })

    const compareWeb = appRouter.draft.compare.callable(context)
    const comparison = await compareWeb({ designId, id: `dr-${tag}` })
    expect(comparison.unresolved).toEqual([])
    expect(comparison.mainRevision).toBe(1)

    const applyWeb = appRouter.draft.apply.callable(context)
    const applied = await applyWeb({ designId, id: `dr-${tag}`, expectedMainRevision: 1, expectedDraftRevision: 1, resolutions: {} })
    expect(applied).toMatchObject({ applied: true, revision: 2 })
    if (!applied.applied) throw new Error('Expected apply')
    expect(applied.document.nodes.card).toMatchObject({
      styles: expect.objectContaining({ gap: '32px' }),
      attributes: { class: 'card wide' },
    })

    // The draft is terminal now; its transactions refuse.
    const closed = await applyTx({
      designId,
      draftId: `dr-${tag}`,
      expectedRevision: 1,
      transaction: { id: `late-${tag}`, label: 'Late', operations: [{ type: 'node.move', id: 'one', parentId: 'card', order: 3_072 }] },
    }).catch((error: unknown) => error)
    expect(closed).toBeInstanceOf(Error)
  })

  it('blocks apply on unresolved conflicts until resolved', async () => {
    const designId = await seedDesign(cardFixture())
    const tag = crypto.randomUUID().slice(0, 8)
    const create = appRouter.draft.create.callable(context)
    await create({ id: `dr-${tag}`, designId, name: 'Conflict' })
    const applyTx = appRouter.webCanvas.applyTransaction.callable(context)
    await applyTx({
      designId,
      expectedRevision: 0,
      transaction: {
        id: `main-${tag}`, label: 'Main',
        operations: [{ type: 'node.patch', id: 'card', patch: { kind: 'element', styles: { gap: '32px' } } }],
      },
    })
    await applyTx({
      designId,
      draftId: `dr-${tag}`,
      expectedRevision: 0,
      transaction: {
        id: `draft-${tag}`, label: 'Draft',
        operations: [{ type: 'node.patch', id: 'card', patch: { kind: 'element', styles: { gap: '8px' } } }],
      },
    })

    const compareWeb = appRouter.draft.compare.callable(context)
    const comparison = await compareWeb({ designId, id: `dr-${tag}` })
    expect(comparison.unresolved).toEqual(['node:card:styles.gap'])

    const applyWeb = appRouter.draft.apply.callable(context)
    const blocked = await applyWeb({
      designId, id: `dr-${tag}`, expectedMainRevision: 1, expectedDraftRevision: 1, resolutions: {},
    })
    expect(blocked).toMatchObject({ applied: false })
    if (blocked.applied) throw new Error('Expected block')
    expect(blocked.unresolved).toEqual(['node:card:styles.gap'])

    const resolved = await applyWeb({
      designId, id: `dr-${tag}`, expectedMainRevision: 1, expectedDraftRevision: 1,
      resolutions: { 'node:card:styles.gap': 'draft' },
    })
    expect(resolved).toMatchObject({ applied: true, revision: 2 })
    if (!resolved.applied) throw new Error('Expected apply')
    expect(resolved.document.nodes.card).toMatchObject({
      styles: expect.objectContaining({ gap: '8px' }),
    })
  })

  it('drives the same lifecycle through MCP branch tools', async () => {
    const designId = await seedDesign(cardFixture())
    const execute = createSheetToolExecutor(LOCAL_USER_ID, usage())
    const read = async (tool: string, args: Record<string, unknown>) => {
      const result = await execute(tool, args) as {
        isError?: boolean
        content: Array<{ type: string; text: string }>
      }
      if (result.isError) throw new Error(`MCP ${tool} failed: ${result.content[0]?.text}`)
      return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
    }
    const created = await read('createBranch', { designId, name: 'MCP branch' }) as { id: string }
    const draftId = created.id as string
    await read('applyWebTransaction', {
      designId,
      draftId,
      expectedRevision: 0,
      transaction: {
        id: 'mcp-draft-edit',
        label: 'MCP draft edit',
        operations: [{ type: 'node.move', id: 'two', parentId: 'card', order: 512 }],
      },
    })
    const comparison = await read('compareBranch', { designId, draftId }) as {
      unresolved?: unknown[]
      summary: { added: number; removed: number; changed: number }
    }
    expect(comparison.summary).toMatchObject({ added: 0, removed: 0, changed: 1 })
    const applied = await read('applyBranch', {
      designId,
      draftId,
      expectedMainRevision: 0,
      expectedDraftRevision: 1,
      resolutions: {},
    }) as { applied: boolean; revision: number; document: WebDocument }
    expect(applied.applied).toBe(true)
    expect(applied.revision).toBe(1)
    expect(applied.document.nodes.two).toMatchObject({ order: 512 })
  })
})
