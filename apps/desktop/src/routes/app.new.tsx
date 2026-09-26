import { createFileRoute } from '@tanstack/react-router'
import { NewFileLauncher } from '@sheet/shell/new-file-launcher'

export const Route = createFileRoute('/app/new')({ component: NewFileLauncherPage })

function NewFileLauncherPage() {
  return <NewFileLauncher />
}
