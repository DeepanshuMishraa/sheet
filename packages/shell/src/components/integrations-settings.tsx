import { ConnectAgent } from '@sheet/editor/connect-agent'

export function IntegrationsSettings() {
  return (
    <main className="app-page-enter flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface text-foreground">
      <div className="mx-auto w-full max-w-2xl px-6 pb-16 pt-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Connect your agent</h1>
        <ConnectAgent />
      </div>
    </main>
  )
}
