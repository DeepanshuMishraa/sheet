import type { CanvasDocument } from '@sheet/canvas/legacy-model'
import { migrateLegacyDocument } from '@sheet/canvas/legacy-migration'
import { Button } from '@sheet/ui/button'
import { WebDocumentPreview } from './web-preview'
import { DocumentTabBar } from './tab-bar'

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
  return (
    <div className="flex h-full min-h-0 flex-col bg-cx-canvas text-foreground">
      <header
        data-tauri-drag-region
        className="z-30 flex h-10 w-full shrink-0 select-none items-center justify-between border-b border-line bg-surface pe-3 ps-20 shadow-[0_1px_3px_rgba(0,0,0,0.02)]"
      >
        <DocumentTabBar activeDocument={designId ? { id: designId, name } : undefined} />
        <div data-tauri-drag-region className="h-full flex-1" />
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b bg-surface px-3 py-2">
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
