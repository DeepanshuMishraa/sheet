import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeCanvasChanges } from './canvas-events'

class FakeEventSource extends EventTarget {
  static latest: FakeEventSource | null = null
  readonly url: string
  closed = false

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    FakeEventSource.latest = this
  }

  close() {
    this.closed = true
  }
}

const originalEventSource = globalThis.EventSource

afterEach(() => {
  Object.defineProperty(globalThis, 'EventSource', {
    configurable: true,
    value: originalEventSource,
  })
  FakeEventSource.latest = null
})

describe('subscribeCanvasChanges', () => {
  it('subscribes to one design and forwards canvas revisions', () => {
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: FakeEventSource,
    })
    const changed = vi.fn()
    const stop = subscribeCanvasChanges('design-a', changed)
    const source = FakeEventSource.latest
    expect(source?.url).toContain('designId=design-a')

    source?.dispatchEvent(new MessageEvent('canvas', {
      data: JSON.stringify({ type: 'canvas.changed', revision: 3, nodeIds: ['root'], sentAt: 1 }),
    }))
    expect(changed).toHaveBeenCalledWith(3)

    stop()
    expect(source?.closed).toBe(true)
  })

  it('uses a wildcard stream for the file dashboard', () => {
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: FakeEventSource,
    })
    const stop = subscribeCanvasChanges(null, vi.fn())
    expect(FakeEventSource.latest?.url).not.toContain('designId=')
    stop()
  })
})
