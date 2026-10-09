import { createFileRoute } from '@tanstack/react-router'
import { SettingsWindow } from '@sheet/shell/settings-window'

/** The Settings window's only screen. The host opens it from the application menu. */
export const Route = createFileRoute('/settings')({ component: SettingsWindow })
