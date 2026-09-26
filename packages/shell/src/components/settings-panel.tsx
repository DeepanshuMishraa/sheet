import { useQueryStates } from 'nuqs'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@loora/ui/tabs'
import { PanelShell } from '@loora/ui/panel-shell'
import { ShortcutsSettings } from './shortcuts-settings'
import { AppearanceSettings } from './appearance-settings'
import { editorSearchParams, type SettingsTab } from '../lib/url-state'
import type { ShortcutConfig } from '@loora/editor/lib/shortcuts'

export function SettingsPanel({
  onClose,
  shortcutConfig,
  onShortcutConfigChange,
}: {
  onClose?: () => void
  shortcutConfig: ShortcutConfig
  onShortcutConfigChange: (next: ShortcutConfig) => void
}) {
  const [{ settings }, setUrlState] = useQueryStates(editorSearchParams, {
    history: 'replace',
  })
  const tab: SettingsTab = settings ?? 'appearance'

  return (
    <PanelShell title="Settings" onClose={onClose} bodyClassName="p-4" className="bg-transparent">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          void setUrlState({ settings: value as SettingsTab })
        }}
        className="flex flex-col gap-4"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTab value="appearance">Appearance</TabsTab>
          <TabsTab value="shortcuts">Shortcuts</TabsTab>
        </TabsList>

        <TabsPanel value="appearance" className="flex flex-col gap-4">
          <AppearanceSettings />
        </TabsPanel>

        <TabsPanel value="shortcuts">
          <ShortcutsSettings
            config={shortcutConfig}
            onChange={onShortcutConfigChange}
          />
        </TabsPanel>
      </Tabs>
    </PanelShell>
  )
}
