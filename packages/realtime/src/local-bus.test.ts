import { describe, expect, it } from 'vitest'
import { messageTargetsRoom, type LocalBusMessage } from './local-bus'

const message: LocalBusMessage = {
  userId: 'local',
  target: { designId: 'design-a', draftId: null },
  event: { type: 'canvas.changed', revision: 2, nodeIds: [] },
  sentAt: 1,
}

describe('messageTargetsRoom', () => {
  it('lets the dashboard subscribe to changes across all designs', () => {
    expect(messageTargetsRoom(message, '', null)).toBe(true)
    expect(messageTargetsRoom(message, 'design-b', null)).toBe(false)
  })
})
