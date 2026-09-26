import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createContext, useContext, type ReactNode } from 'react'
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing'

const TabsContext = createContext('')

vi.doMock('@sheet/ui/tabs', () => ({
  Tabs: ({ value, children }: { value: string; children: ReactNode }) => (
    <TabsContext.Provider value={value}>{children}</TabsContext.Provider>
  ),
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTab: ({ value, children }: { value: string; children: ReactNode }) => (
    <button role="tab" data-value={value}>{children}</button>
  ),
  TabsPanel: ({ value, children }: { value: string; children: ReactNode }) => (
    useContext(TabsContext) === value ? <div>{children}</div> : null
  ),
}))
// `vi.doMock` is process-global, so this stub is what every later test file
// in the run sees too — the canvas panels render their header buttons through
// PanelShell. Keep the shape of the real thing: title, actions, close, body.
vi.doMock('@sheet/ui/panel-shell', () => ({
  PanelShell: ({
    title,
    actions,
    onClose,
    children,
  }: {
    title: string
    actions?: ReactNode
    onClose?: () => void
    children: ReactNode
  }) => (
    <div>
      <h2>{title}</h2>
      {actions}
      {onClose ? (
        <button type="button" aria-label={`Close ${title}`} onClick={onClose} />
      ) : null}
      {children}
    </div>
  ),
  PanelEmpty: ({ title, description }: { title?: string; description?: ReactNode }) => (
    <div>
      {title}
      {description}
    </div>
  ),
  PanelLoading: ({ label }: { label: string }) => <div>{label}</div>,
}))
vi.doMock('./shortcuts-settings', () => ({
  ShortcutsSettings: () => <div>Keyboard shortcuts</div>,
}))
// theme.ts is deliberately NOT mocked. vi.doMock is process-global, so
// stubbing it here would hand every other test file in the run the stub — which
// is exactly how theme.test.ts started reading the wrong default. The real
// module tolerates a missing `localStorage`, so it is safe to let it run.

const { SettingsPanel } = await import('./settings-panel')

function renderSettings(searchParams = '') {
  return render(
    <SettingsPanel shortcutConfig={{} as never} onShortcutConfigChange={() => {}} />,
    { wrapper: withNuqsTestingAdapter({ searchParams }) },
  )
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    window.localStorage.removeItem('sheet:theme')
    window.localStorage.removeItem('sheet:ui-sans')
    window.localStorage.removeItem('sheet:ui-mono')
    document.documentElement.classList.remove('dark')
    document.documentElement.style.removeProperty('--sheet-font-sans')
    document.documentElement.style.removeProperty('--sheet-font-mono')
  })

  afterEach(() => {
    cleanup()
    window.localStorage.removeItem('sheet:theme')
    window.localStorage.removeItem('sheet:ui-sans')
    window.localStorage.removeItem('sheet:ui-mono')
    document.documentElement.classList.remove('dark')
    document.documentElement.style.removeProperty('--sheet-font-sans')
    document.documentElement.style.removeProperty('--sheet-font-mono')
  })

  test('opens on appearance with no account surface', async () => {
    renderSettings()

    expect(await screen.findByRole('tab', { name: 'Appearance' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Account' })).toBeNull()
    expect(screen.queryByText('Signed in to sheet.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  test('shows shortcuts on its tab', async () => {
    renderSettings('?settings=shortcuts')

    expect(await screen.findByText('Keyboard shortcuts')).toBeTruthy()
  })

  test('applies and persists the selected appearance', async () => {
    renderSettings()

    const dark = await screen.findByRole('button', { name: 'Dark' })
    fireEvent.click(dark)

    expect(dark.getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem('sheet:theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  test('picks the interface font from the grouped dropdown', async () => {
    renderSettings()

    fireEvent.click(await screen.findByRole('combobox', { name: 'Interface font' }))

    // Sans and Monospace groups, each option set in its own face.
    expect(await screen.findByText('Sans')).toBeTruthy()
    expect(screen.getByText('Monospace')).toBeTruthy()

    // Base UI only honours a mouse click that starts on the item.
    const option = await screen.findByRole('option', { name: 'JetBrains Mono' })
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    expect(window.localStorage.getItem('sheet:ui-sans')).toBe('jetbrains-mono')
    expect(
      document.documentElement.style.getPropertyValue('--sheet-font-sans'),
    ).toContain('JetBrains Mono')
  })
})
