import type { CanvasDocument } from '@sheet/canvas/legacy-model'
import { migrateLegacyDocument } from '@sheet/canvas/legacy-migration'
import { Button } from '@sheet/ui/button'
import { WebDocumentPreview } from './web-preview'
import { useRegisterOpenTab } from '../lib/open-tabs'

/** Frozen compatibility viewer. It has no mutation, history, or save path. */
export function LegacyDocumentViewer({
  designId,
  document,
  name,
  onMigrate,
  onArchive,
}: {
  designId?: string
  document: CanvasDocument
  name: string
  onMigrate: () => void
  onArchive?: () => void
}) {
  // Opening a file puts it in the sidebar's open list.
  useRegisterOpenTab(designId ? { id: designId, name } : undefined)
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          read-only legacy
        </span>
        <span className="w-full text-[11px] text-muted-foreground sm:w-auto">
          This design predates the web document. Migrate it to edit.
        </span>
        {onArchive ? <Button size="sm" variant="outline" onClick={onArchive}>Archive</Button> : null}
        <Button size="sm" onClick={onMigrate}>Migrate</Button>
      </div>
      <div className="min-h-0 flex-1">
        <WebDocumentPreview document={migrateLegacyDocument(document)} />
      </div>
    </div>
  )
}
