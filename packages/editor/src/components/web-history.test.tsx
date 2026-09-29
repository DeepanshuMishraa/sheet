import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertWebDocument,
  createWebDocument,
  createWebElement,
} from '@sheet/canvas/web-model'
import { WebHistory } from './web-history'

const historyMocks = vi.hoisted(() => ({
  list: vi.fn(),
  compareWeb: vi.fn(),
  commitWeb: vi.fn(),
  restoreWeb: vi.fn(),
}))
vi.mock('@sheet/rpc/client', () => ({
  orpc: { history: historyMocks },
}))

function fixture() {
  const document = createWebDocument('History UI', 'history-ui')
  document.nodes.card = createWebElement('div', {
    id: 'card',
    order: 1_024,
    attributes: { class: 'card' },
  })
  document.roots = ['card']
  return assertWebDocument(document)
}

const versionRow = (id: string, message: string) => ({
  id,
  message,
  canvasVersion: 3,
  added: 1,
  removed: 0,
  changed: 0,
  at: Date.now(),
})

describe('WebHistory', () => {
  beforeEach(() => {
    for (const mock of Object.values(historyMocks)) mock.mockClear()
    historyMocks.list.mockResolvedValue({ items: [versionRow('v1', 'Base')], nextCursor: null })
    historyMocks.compareWeb.mockResolvedValue({
      current: { id: 'v1', message: 'Base', document: fixture(), at: Date.now() },
      previous: null,
    })
    historyMocks.commitWeb.mockResolvedValue({ id: 'v2', message: 'Manual', added: 0, removed: 0, changed: 0, at: Date.now() })
    historyMocks.restoreWeb.mockResolvedValue({ revision: 2, document: fixture() })
  })

  it('lists checkpoints, previews the document, and checkpoints on save', async () => {
    const view = render(
      <WebHistory designId="history-ui" document={fixture()} revision={1} onAdopt={() => {}} />,
    )
    fireEvent.click(view.getByRole('button', { name: 'History' }))
    await waitFor(() => {
      expect(historyMocks.list).toHaveBeenCalledWith({ designId: 'history-ui', limit: 20 })
    })
    await waitFor(() => {
      expect(view.getAllByText('Base').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(historyMocks.compareWeb).toHaveBeenCalledWith({ designId: 'history-ui', id: 'v1' })
    })

    fireEvent.change(view.getByLabelText('Checkpoint name'), { target: { value: 'Manual' } })
    fireEvent.click(view.getByText('Save'))
    await waitFor(() => {
      expect(historyMocks.commitWeb).toHaveBeenCalled()
    })
    const commit = historyMocks.commitWeb.mock.calls.at(-1)?.[0] as { message: string }
    expect(commit.message).toBe('Manual')
  })

  it('checkpoints before restore and adopts the restored document', async () => {
    const onAdopt = vi.fn()
    const view = render(
      <WebHistory designId="history-ui" document={fixture()} revision={1} onAdopt={onAdopt} />,
    )
    fireEvent.click(view.getByRole('button', { name: 'History' }))
    await waitFor(() => {
      expect(view.getAllByText('Base').length).toBeGreaterThan(0)
    })
    fireEvent.click(view.getByText('Restore'))
    await waitFor(() => {
      expect(historyMocks.commitWeb).toHaveBeenCalled()
    })
    const checkpoint = historyMocks.commitWeb.mock.calls.at(-1)?.[0] as { message: string }
    expect(checkpoint.message).toBe('Before restore')
    await waitFor(() => {
      expect(historyMocks.restoreWeb).toHaveBeenCalledWith({
        designId: 'history-ui',
        id: 'v1',
        expectedRevision: 1,
      })
    })
    await waitFor(() => {
      expect(onAdopt).toHaveBeenCalled()
    })
    expect(onAdopt.mock.calls.at(-1)?.[1]).toBe(2)
  })
})
