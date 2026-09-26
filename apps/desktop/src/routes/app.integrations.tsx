import { createFileRoute } from '@tanstack/react-router'
import { AppPageShell } from '@loora/shell/app-page-shell'
import { IntegrationsSettings } from '@loora/shell/integrations-settings'

export const Route = createFileRoute('/app/integrations')({
  component: IntegrationsPage,
})

function IntegrationsPage() {
  return (
    <AppPageShell
      title="Integrations"
      description="Point an MCP client at this app's local server."
    >
      <IntegrationsSettings />
    </AppPageShell>
  )
}
