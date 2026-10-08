import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureLocalUser, LOCAL_USER_ID } from '@sheet/db'

vi.mock('@sheet/db/canvas-realtime', () => ({
  publishCanvasRealtimeEvent: vi.fn(),
  publishBranchChanged: vi.fn(),
}))

import {
  addDesignComment,
  deleteDesignComment,
  listDesignComments,
  setDesignCommentResolved,
} from './comments'
import { createDesign } from './mcp-designs'

const note = { nodeId: 'node_a', nodeLabel: 'Hero heading', author: 'user' } as const

describe('element comments', () => {
  beforeEach(async () => {
    await ensureLocalUser()
  })

  it('lists open comments for one element and hides resolved ones', async () => {
    const { id } = await createDesign(LOCAL_USER_ID, 'Comments')
    const first = await addDesignComment(LOCAL_USER_ID, id, { ...note, body: 'Tighter leading' })
    await addDesignComment(LOCAL_USER_ID, id, { ...note, nodeId: 'node_b', body: 'Use the brand blue' })

    const onA = await listDesignComments(LOCAL_USER_ID, id, { nodeId: 'node_a' })
    expect(onA.map((comment) => comment.body)).toEqual(['Tighter leading'])

    await setDesignCommentResolved(LOCAL_USER_ID, id, first.id, true)
    expect(await listDesignComments(LOCAL_USER_ID, id, { nodeId: 'node_a' })).toEqual([])
    const all = await listDesignComments(LOCAL_USER_ID, id, { status: 'all' })
    expect(all).toHaveLength(2)
    expect(all.find((comment) => comment.id === first.id)?.resolved).toBe(true)
  })

  it('rejects an empty comment and a missing design', async () => {
    const { id } = await createDesign(LOCAL_USER_ID, 'Comments')
    await expect(
      addDesignComment(LOCAL_USER_ID, id, { ...note, body: '   ' }),
    ).rejects.toThrow('needs some text')
    await expect(listDesignComments(LOCAL_USER_ID, 'missing')).rejects.toThrow('was not found')
  })

  it('deletes a comment and reports a missing one', async () => {
    const { id } = await createDesign(LOCAL_USER_ID, 'Comments')
    const created = await addDesignComment(LOCAL_USER_ID, id, { ...note, body: 'Remove me' })
    await deleteDesignComment(LOCAL_USER_ID, id, created.id)
    expect(await listDesignComments(LOCAL_USER_ID, id, { status: 'all' })).toEqual([])
    await expect(deleteDesignComment(LOCAL_USER_ID, id, created.id)).rejects.toThrow('was not found')
  })
})
