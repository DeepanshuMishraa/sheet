import { createFileRoute } from '@tanstack/react-router'
import { DesignsDashboard } from '@sheet/shell/designs-dashboard'

export const Route = createFileRoute('/app/files')({ component: AppFilesPage })

function AppFilesPage() {
  return <DesignsDashboard title="Files" />
}
