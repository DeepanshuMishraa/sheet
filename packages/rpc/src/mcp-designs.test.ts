import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureLocalUser, LOCAL_USER_ID } from '@sheet/db'

const publishCanvasRealtimeEvent = vi.hoisted(() => vi.fn())
vi.mock('@sheet/db/canvas-realtime', () => ({
  publishCanvasRealtimeEvent,
  publishBranchChanged: vi.fn(),
}))

import { createDesign } from './mcp-designs'

describe('MCP design changes', () => {
  beforeEach(async () => {
    publishCanvasRealtimeEvent.mockReset()
    await ensureLocalUser()
  })

  it('publishes a new design so the dashboard can refresh immediately', async () => {
    const created = await createDesign(LOCAL_USER_ID, 'Live design')

    expect(publishCanvasRealtimeEvent).toHaveBeenCalledWith(
      LOCAL_USER_ID,
      { designId: created.id },
      { type: 'canvas.changed', revision: created.revision, nodeIds: [] },
    )
  })
})
