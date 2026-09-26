import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'

const list = vi.fn()
const listShared = vi.fn()
const listArchived = vi.fn()
const archive = vi.fn()
const restore = vi.fn()
const deleteDesign = vi.fn()
const create = vi.fn()
const rename = vi.fn()
const getPreferences = vi.fn()

vi.doMock('@sheet/rpc/client', () => ({
  orpc: {
    design: {
      list,
      listShared,
      listArchived,
      archive,
      restore,
      delete: deleteDesign,
    },
    canvas: { create, rename },
    // The dashboard renders the upgrade button, which reads billing status.
    billing: { status: vi.fn(async () => ({ required: false, plan: null })) },
    preferences: {
      get: getPreferences,
      save: vi.fn(),
    },
  },
}))
vi.doMock('@sheet/auth/client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'user-1', name: 'Lasse' } } }),
    signOut: vi.fn(),
  },
}))
vi.doMock('./settings-panel', () => ({
  SettingsPanel: () => <div>Settings panel</div>,
}))

const navigate = vi.fn()
const routerModule = await import('@tanstack/react-router')
vi.doMock('@tanstack/react-router', () => ({
  ...routerModule,
  useNavigate: () => navigate,
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    search?: Record<string, unknown>
    children?: ReactNode
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (current, [key, value]) => current.replace(`$${key}`, encodeURIComponent(value)),
      to,
    )
    const query = new URLSearchParams(search as Record<string, string>).toString()
    return (
      <a href={query ? `${path}?${query}` : path} {...props}>
        {children}
      </a>
    )
  },
}))

const { DesignsDashboard } = await import('./designs-dashboard')

const HOUR = 3_600_000

/**
 * Radix opens a menu on pointerdown, and reaches for pointer-capture and
 * scroll APIs jsdom does not ship.
 */
function openMenu(name: string) {
  const element = Element.prototype as unknown as Record<string, unknown>
  element.hasPointerCapture ??= () => false
  element.setPointerCapture ??= () => {}
  element.releasePointerCapture ??= () => {}
  element.scrollIntoView ??= () => {}
  fireEvent.pointerDown(screen.getByRole('button', { name }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  })
}

import { resetDashboardSearchQuery } from '../lib/dashboard-search'

describe('DesignsDashboard', () => {
  beforeEach(() => {
    resetDashboardSearchQuery()
    window.localStorage.clear()
    navigate.mockReset().mockResolvedValue(undefined)
    getPreferences.mockReset().mockResolvedValue({ shortcuts: null })
    create.mockReset().mockResolvedValue({ revision: 1 })
    rename.mockReset()
    deleteDesign.mockReset().mockResolvedValue({ deleted: true })
    archive.mockReset().mockResolvedValue({ archivedAt: Date.now() })
    restore.mockReset().mockResolvedValue({ restored: true })
    listArchived.mockReset().mockResolvedValue([])
    listShared.mockReset().mockResolvedValue([])
    list.mockReset().mockResolvedValue([
      { id: 'design-old', name: 'Portfolio Design', revision: 3, updatedAt: Date.now() - 48 * HOUR },
      { id: 'design-new', name: 'Ideal pine', revision: 7, updatedAt: Date.now() - 2 * HOUR },
    ])
  })

  afterEach(() => cleanup())

  test('lists files most recently edited first and links each to its canvas', async () => {
    render(<DesignsDashboard />)

    await screen.findByText('Ideal pine')
    const links = screen.getAllByRole('link', { name: /^Open / })
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Open Ideal pine',
      'Open Portfolio Design',
    ])
    expect(links[0]?.getAttribute('href')).toBe('/design/design-new')
    expect(screen.getByText('Edited 2 hours ago')).toBeTruthy()
  })

  test('filters the list by name', async () => {
    render(<DesignsDashboard />)
    await screen.findByText('Ideal pine')

    fireEvent.change(screen.getByLabelText('Search files'), {
      target: { value: 'portfolio' },
    })

    expect(screen.queryByText('Ideal pine')).toBeNull()
    expect(screen.getByText('Portfolio Design')).toBeTruthy()
  })

  test('opens the new file on the canvas route after creating it', async () => {
    render(<DesignsDashboard />)
    await screen.findByText('Ideal pine')

    fireEvent.click(screen.getByRole('button', { name: 'New file' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const created = create.mock.calls[0]?.[0] as { designId: string; name: string }
    expect(created.name).toBe('Untitled')
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/design/$id',
        params: { id: created.designId },
      }),
    )
  })

  test('offers to start a file when the account has none', async () => {
    list.mockResolvedValue([])
    render(<DesignsDashboard />)

    expect(await screen.findByText('No design files yet')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'New file' }).length).toBe(2)
  })

  test('surfaces a failed load without leaving the shimmer up', async () => {
    list.mockRejectedValue(new Error('offline'))
    render(<DesignsDashboard />)

    expect(await screen.findByText('offline')).toBeTruthy()
    expect(screen.queryByText('Loading your files…')).toBeNull()
  })

  test('confirms deletion and moves the file to the archive', async () => {
    render(<DesignsDashboard />)
    await screen.findByText('Ideal pine')

    openMenu('Actions for Ideal pine')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(await screen.findByText('Delete “Ideal pine”?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(archive).toHaveBeenCalledWith({ id: 'design-new' }),
    )
    expect(deleteDesign).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Ideal pine')).toBeNull())
    expect(screen.getByText('Portfolio Design')).toBeTruthy()
  })

  test('displays scratchpad with permanent draft subtitle', async () => {
    list.mockResolvedValue([
      { id: 'design-scratch', name: 'Scratchpad', revision: 1, updatedAt: Date.now() - HOUR },
    ])
    render(<DesignsDashboard />)

    expect(await screen.findByText('Scratchpad')).toBeTruthy()
    expect(screen.getByText('Your permanent draft')).toBeTruthy()
  })

  test('toggles between grid and list views', async () => {
    render(<DesignsDashboard />)
    await screen.findByText('Ideal pine')

    const listBtn = screen.getByRole('button', { name: 'List view' })
    fireEvent.click(listBtn)
    expect(listBtn.getAttribute('aria-pressed')).toBe('true')

    const gridBtn = screen.getByRole('button', { name: 'Grid view' })
    fireEvent.click(gridBtn)
    expect(gridBtn.getAttribute('aria-pressed')).toBe('true')
  })
})
