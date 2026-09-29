import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArchiveIcon,
  FolderIcon,
  RefreshCwIcon,
  CodeXmlIcon,
} from '@sheet/ui/icons'
import type { CanvasDocument } from '@sheet/canvas/legacy-model'
import { LegacyDocumentViewer } from './legacy-viewer'
import type { WebDocument } from '@sheet/canvas/web-model'
import { WebCanvasEditor } from './web-editor'
import { type DesignSummary } from '../lib/designs'
import { DocumentTabBar } from './tab-bar'
import { orpc } from '@sheet/rpc/client'
import { Button } from '@sheet/ui/button'
import { DotMatrixLoader } from '@sheet/ui/dot-matrix-loader'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '@sheet/ui/dialog'
export function CanvasApp({
  designId,
  branchId,
}: {
  /** The document this editor opens. `/design/$id` remounts on change. */
  designId?: string
  /** The active branch from `/design/$id/b/$branchId`. */
  branchId?: string
  userId?: string
}) {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<DesignSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(designId ?? null)
  const [legacyCanvas, setLegacyCanvas] = useState<{
    document: CanvasDocument
    revision: number
    draftId: string | null
  } | null>(null)
  const [webCanvas, setWebCanvas] = useState<{
    document: WebDocument
    revision: number
    draftId: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState('Opening Canvas')
  const [error, setError] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [webMigrationOpen, setWebMigrationOpen] = useState(false)
  const [webMigrating, setWebMigrating] = useState(false)
  const [webMigrationError, setWebMigrationError] = useState<string | null>(null)

  const openTarget = useCallback(async (target: { designId: string; draftId: string | null }) => {
    setLoading(true)
    setError(null)
    setProgress('Loading canvas')
    setWebCanvas(null)
    setLegacyCanvas(null)
    try {
      const webTarget = await orpc.webCanvas.get({
        designId: target.designId,
        draftId: target.draftId,
      })
      if (webTarget?.status === 'ready') {
        setWebCanvas({
          document: webTarget.document,
          revision: webTarget.revision,
          draftId: target.draftId,
        })
        return
      }
      if (webTarget?.status !== 'legacy') {
        throw new Error('This file uses an unsupported document format.')
      }
      setLegacyCanvas({
        document: webTarget.document,
        revision: webTarget.revision,
        draftId: target.draftId,
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Canvas could not be opened'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!designId) return
    let cancelled = false
    void (async () => {
      try {
        const found = await orpc.design.list().catch(() => [] as DesignSummary[])
        if (cancelled) return
        setDocuments(found)
        setActiveId(designId)
        const foundBranches = await orpc.draft
          .list({ designId, includeArchived: true })
          .catch(() => [])
        const requestedDraft = branchId ?? null
        const openDraft = foundBranches.find(
          (branch) =>
            branch.id === requestedDraft &&
            (branch.status === 'active' || branch.status === 'proposed'),
        )
        if (requestedDraft && !openDraft) {
          await navigate({
            to: '/design/$id',
            params: { id: designId },
            replace: true,
          })
          return
        }
        await openTarget({
          designId,
          draftId: openDraft?.id ?? null,
        })
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load designs')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [branchId, designId, navigate, openTarget])

  if (error) {
    const active = documents.find((document) => document.id === activeId)
    return (
      <div className="flex h-full min-h-0 flex-col bg-cx-canvas text-foreground">
        <header
          data-tauri-drag-region
          className="z-30 flex h-10 w-full shrink-0 select-none items-center justify-between border-b border-line bg-surface pe-3 ps-20 shadow-[0_1px_3px_rgba(0,0,0,0.02)]"
        >
          <DocumentTabBar activeDocument={activeId ? { id: activeId, name: active?.name ?? '' } : undefined} />
          <div data-tauri-drag-region className="h-full flex-1" />
        </header>
        <main className="grid min-h-0 flex-1 place-items-center p-4">
          <div className="max-w-sm rounded-lg border bg-card p-4 text-center">
            <h1 className="text-base font-semibold">Canvas could not open</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              {activeId ? (
                <Button
                  onClick={() => void openTarget({ designId: activeId, draftId: branchId ?? null })}
                >
                  <RefreshCwIcon />
                  Retry
                </Button>
              ) : null}
              <Button variant="outline" render={<Link to="/app" />}>
                <FolderIcon />
                All files
              </Button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (loading || !activeId || (!legacyCanvas && !webCanvas)) {
    const active = documents.find((document) => document.id === activeId)
    return (
      <div className="flex h-full min-h-0 flex-col bg-cx-canvas text-foreground">
        <header
          data-tauri-drag-region
          className="z-30 flex h-10 w-full shrink-0 select-none items-center justify-between border-b border-line bg-surface pe-3 ps-20 shadow-[0_1px_3px_rgba(0,0,0,0.02)]"
        >
          <DocumentTabBar activeDocument={activeId ? { id: activeId, name: active?.name ?? '' } : undefined} />
          <div data-tauri-drag-region className="h-full flex-1" />
        </header>
        <main className="grid min-h-0 flex-1 place-items-center">
          <div className="flex flex-col items-center gap-5">
            <img
              src="/app-icon.png"
              alt="Sheet"
              width={48}
              height={48}
              className="size-12"
              draggable={false}
            />
            <DotMatrixLoader
              rows={3}
              columns={5}
              className="size-8 text-foreground"
              aria-label={progress}
            />
            <p className="text-xs text-muted-foreground">{progress}</p>
          </div>
        </main>
      </div>
    )
  }

  const active = documents.find((document) => document.id === activeId)
  if (webCanvas) {
    return (
      <div className="h-full min-h-0">
        <WebCanvasEditor
          key={`${activeId}:${webCanvas.draftId ?? 'main'}:${webCanvas.revision}`}
          designId={activeId}
          draftId={webCanvas.draftId}
          initialDocument={webCanvas.document}
          initialRevision={webCanvas.revision}
          name={active?.name ?? webCanvas.document.name}
        />
      </div>
    )
  }
  if (!legacyCanvas) return null
  const archiveDesign = async () => {
    await orpc.design.archive({ id: activeId })
    setArchiveOpen(false)
    await navigate({ to: '/app' })
  }
  return (
    <div className="h-full min-h-0">
      <LegacyDocumentViewer
        designId={activeId}
        document={legacyCanvas.document}
        name={active?.name ?? legacyCanvas.document.name}
        onMigrate={() => {
          setWebMigrationError(null)
          setWebMigrationOpen(true)
        }}
        onArchive={legacyCanvas.draftId ? undefined : () => setArchiveOpen(true)}
      />
      <Dialog open={webMigrationOpen} onOpenChange={setWebMigrationOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Migrate this design to the web document?</DialogTitle>
            <DialogDescription>
              This converts the read-only legacy snapshot to WebDocument. Legacy source
              is kept as text; unsupported components, instances, interactions, motion,
              and visual styles remain in the saved historical snapshot.{' '}
              {legacyCanvas.draftId
                ? 'The branch and base snapshots are saved before conversion.'
                : 'The original scene graph is saved before conversion.'}
            </DialogDescription>
          </DialogHeader>
          {webMigrationError ? (
            <p className="px-6 text-sm text-destructive">{webMigrationError}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWebMigrationOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={webMigrating}
              onClick={() => {
                void (async () => {
                  setWebMigrating(true)
                  try {
                    if (!legacyCanvas) throw new Error('No legacy document is open.')
                    const migrated = await orpc.webCanvas.migrate({
                      designId: activeId,
                      expectedRevision: legacyCanvas.revision,
                      draftId: legacyCanvas.draftId,
                    })
                    setLegacyCanvas(null)
                    setWebCanvas({
                      document: migrated.document,
                      revision: migrated.revision,
                      draftId: legacyCanvas.draftId,
                    })
                    setWebMigrationOpen(false)
                  } catch (cause) {
                    setWebMigrationError(
                      cause instanceof Error
                        ? cause.message
                        : 'The web document migration failed. The original design remains intact.',
                    )
                  } finally {
                    setWebMigrating(false)
                  }
                })()
              }}
            >
              <CodeXmlIcon />
              {webMigrating ? 'Migrating' : legacyCanvas.draftId ? 'Migrate Branch' : 'Migrate Main'}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Archive this design?</DialogTitle>
            <DialogDescription>
              It closes here and leaves Recents, keeping Main, every branch, and
              its history. Restore it from Archived on your files page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void archiveDesign()}>
              <ArchiveIcon />
              Archive
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
