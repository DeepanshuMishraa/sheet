import { createFileRoute } from '@tanstack/react-router'
import { IntegrationsSettings } from '@sheet/shell/integrations-settings'

export const Route = createFileRoute('/app/integrations')({
  component: IntegrationsPage,
})

function IntegrationsPage() {
  return <IntegrationsSettings />
}
