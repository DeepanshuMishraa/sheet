import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  EllipsisIcon,
  LayoutGridIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from '@sheet/ui/icons'
import { Button } from '@sheet/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@sheet/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sheet/ui/dropdown-menu'
import { Input } from '@sheet/ui/input'
import { DotMatrixLoader } from '@sheet/ui/dot-matrix-loader'
import { Skeleton } from '@sheet/ui/skeleton'
import { Spinner } from '@sheet/ui/spinner'
import { orpc } from '@sheet/rpc/client'
import { createDesign, relativeTime, type DesignSummary } from '@sheet/editor/lib/designs'
import { WebDocumentPreview } from '@sheet/editor/web-preview'
import type { WebDocument } from '@sheet/canvas/web-model'
import { cn } from '@sheet/ui/utils'
import { useDashboardSearchQuery } from '../lib/dashboard-search'
import { subscribeCanvasChanges } from '@sheet/editor/lib/canvas-events'

const VIEW_STORAGE_KEY = 'sheet:files-view'

type FilesView = 'grid' | 'list'

function initialView(): FilesView {
  if (typeof window === 'undefined') return 'grid'
  return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'
}

function byRecent(left: DesignSummary, right: DesignSummary) {
  return right.updatedAt - left.updatedAt
}

function ActionsTrigger({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={`Actions for ${name}`}
        className={cn(
          'flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground',
          className,
        )}
      >
        <EllipsisIcon className="size-3" />
      </button>
    </DropdownMenuTrigger>
  )
}

function FileActions({
  name,
  onRename,
  onArchive,
  className,
}: {
  name: string
  onRename: () => void
  onArchive: () => void
  className?: string
}) {
  return (
    <DropdownMenu>
      <ActionsTrigger name={name} className={className} />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onRename}>
          <PencilIcon data-slot="icon" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onArchive}>
          <Trash2Icon data-slot="icon" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const previewCache = new Map<string, WebDocument | null>()

function FileCardPreview({ designId, revision }: { designId: string; revision: number }) {
  const cacheKey = `${designId}:${revision}`
  const [doc, setDoc] = useState<WebDocument | null>(() => previewCache.get(cacheKey) ?? null)
  const [loaded, setLoaded] = useState(() => previewCache.has(cacheKey))
  // Local fetches usually resolve in a frame or two; only show the mark when
  // the wait is long enough to notice.
  const [showLoader, setShowLoader] = useState(false)

  useEffect(() => {
    if (loaded) return
    const timer = window.setTimeout(() => setShowLoader(true), 200)
    return () => window.clearTimeout(timer)
  }, [loaded])

  useEffect(() => {
    if (typeof orpc.webCanvas?.get !== 'function') return
    if (previewCache.has(cacheKey)) return
    let active = true
    void orpc.webCanvas
      .get({ designId })
      .then((res) => {
        const document = res.status === 'ready' ? res.document : null
        previewCache.set(cacheKey, document)
        if (active) {
          setDoc(document)
          setLoaded(true)
        }
      })
      .catch(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [cacheKey, designId])

  return (
    <span className="relative flex size-full items-center justify-center">
      {!loaded && showLoader ? (
        <DotMatrixLoader className="size-5 text-muted-foreground" />
      ) : null}
      <WebDocumentPreview
        document={doc}
        className="size-full"
      />
      {loaded && !doc ? (
        <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">No preview</span>
      ) : null}
    </span>
  )
}

function FileCard({
  design,
  onRename,
  onArchive,
}: {
  design: DesignSummary
  onRename: () => void
  onArchive: () => void
}) {
  const isScratchpad = design.name.trim().toLowerCase() === 'scratchpad'

  return (
    <div className="group relative flex flex-col rounded-md border border-line bg-surface p-4 shadow-xs transition-[box-shadow,border-color,transform] duration-base ease-out hover:border-line hover:shadow-md hover:-translate-y-0.5 focus-within:border-ring/40 focus-within:shadow-md">
      <Link
        to="/design/$id"
        params={{ id: design.id }}
        aria-label={`Open ${design.name}`}
        className="absolute inset-0 rounded-md focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      />
      <div className="flex items-start justify-between min-w-0">
        <div className="min-w-0 flex-1 pe-2">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {design.name}
            </span>
            {isScratchpad ? (
              <PencilIcon className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {isScratchpad
              ? 'Your permanent draft'
              : `Edited ${relativeTime(design.updatedAt)}`}
          </p>
        </div>
        <FileActions
          name={design.name}
          onRename={onRename}
          onArchive={onArchive}
          className="relative z-10 shrink-0 opacity-0 transition-all duration-150 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 hover:scale-105 active:scale-95"
        />
      </div>

      <div className="pointer-events-none relative mt-4 aspect-[16/10] w-full overflow-hidden rounded-xl border border-line bg-cx-canvas shadow-inner">
        <div className="size-full">
          <FileCardPreview key={design.revision} designId={design.id} revision={design.revision} />
        </div>
      </div>
    </div>
  )
}

function FileRow({
  design,
  onRename,
  onArchive,
}: {
  design: DesignSummary
  onRename: () => void
  onArchive: () => void
}) {
  const isScratchpad = design.name.trim().toLowerCase() === 'scratchpad'

  return (
    <div className="group relative flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 transition-colors duration-fast ease-out hover:bg-surface-2 active:scale-[0.998] motion-reduce:transition-none">
      <Link
        to="/design/$id"
        params={{ id: design.id }}
        aria-label={`Open ${design.name}`}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
      />
      <div className="pointer-events-none size-9 shrink-0 overflow-hidden rounded-md border border-line bg-cx-canvas shadow-xs">
        <FileCardPreview key={design.revision} designId={design.id} revision={design.revision} />
      </div>
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">
            {design.name}
          </span>
          {isScratchpad ? (
            <PencilIcon className="size-3 shrink-0 text-muted-foreground" />
          ) : null}
        </div>
        {isScratchpad ? (
          <p className="text-2xs text-muted-foreground">Your permanent draft</p>
        ) : null}
      </div>
      <p className="pointer-events-none hidden shrink-0 text-xs text-muted-foreground sm:block">
        Edited {relativeTime(design.updatedAt)}
      </p>
      <FileActions
        name={design.name}
        onRename={onRename}
        onArchive={onArchive}
        className="relative z-10 shrink-0 opacity-0 transition-all duration-150 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 hover:scale-105 active:scale-95"
      />
    </div>
  )
}

const GRID_CLASSES = 'grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3'

/**
 * The empty state, drawn in the same language as the canvas it invites you
 * onto: the dot ground, a plate, and the bar of a frame waiting to be filled.
 * It is chrome, not an illustration — no gradient, no accent, nothing that
 * competes with the first real card for attention.
 */
function EmptyCanvasPlate() {
  return (
    <div
      aria-hidden="true"
      className="relative mb-6 h-28 w-44 shrink-0 overflow-hidden rounded-xl border border-line bg-cx-canvas shadow-inner"
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--cx-dot) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      />
      <div className="absolute inset-x-6 top-6 h-2 w-14 rounded-full bg-cx-ink/15" />
      <div className="absolute inset-x-6 top-11 h-10 rounded-md border border-dashed border-cx-ink/20" />
    </div>
  )
}

function FilesLoading({ view }: { view: FilesView }) {
  const rows = Array.from({ length: view === 'grid' ? 6 : 6 }, (_, index) => index)
  if (view === 'list') {
    return (
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-panel" aria-busy="true">
        {rows.map((row) => (
          <div key={row} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
            <Skeleton className="size-9 shrink-0 rounded-md" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className={GRID_CLASSES} aria-busy="true">
      {rows.map((row) => (
        <div key={row} className="flex flex-col rounded-md border border-line bg-surface p-4 shadow-panel">
          <div className="flex flex-col gap-1.5 pb-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="mt-4 aspect-[16/10] w-full rounded-xl" />
        </div>
      ))}
    </div>
  )
}

/**
 * The file browser at `/app`.
 */
export function DesignsDashboard({
  title = 'Recents',
}: {
  title?: string
} = {}) {
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useDashboardSearchQuery()
  const [view, setView] = useState<FilesView>(initialView)
  const [creating, setCreating] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DesignSummary | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<DesignSummary | null>(null)
  const [archiving, setArchiving] = useState(false)

  const loadDesigns = useCallback(async () => {
    setError(null)
    try {
      const own = await orpc.design.list()
      setDesigns([...own].sort(byRecent))
    } catch (cause) {
      setDesigns([])
      setError(
        cause instanceof Error ? cause.message : 'Your files could not be loaded',
      )
    }
  }, [])

  useEffect(() => {
    void loadDesigns()
    return subscribeCanvasChanges(null, () => void loadDesigns())
  }, [loadDesigns])

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  }, [view])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = designs ?? []
    if (!needle) return all
    return all.filter((design) => design.name.toLowerCase().includes(needle))
  }, [designs, query])

  const newFile = async () => {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const created = await createDesign()
      await navigate({ to: '/design/$id', params: { id: created.id } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be created')
      setCreating(false)
    }
  }

  const renameDesign = async () => {
    const target = renameTarget
    const name = renameName.trim()
    if (!target || !name || renaming) return
    setRenaming(true)
    try {
      const renamed = await orpc.webCanvas.rename({
        designId: target.id,
        name,
      })
      setDesigns((current) =>
        (current ?? [])
          .map((design) =>
            design.id === target.id
              ? { ...design, name, revision: renamed.revision, updatedAt: Date.now() }
              : design,
          )
          .sort(byRecent),
      )
      setRenameTarget(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The file could not be renamed'
      setError(message)
      setRenameTarget(null)
    } finally {
      setRenaming(false)
    }
  }

  const archiveDesign = async () => {
    const target = archiveTarget
    if (!target || archiving) return
    setArchiving(true)
    try {
      await orpc.design.archive({ id: target.id })
      setDesigns((current) => (current ?? []).filter((design) => design.id !== target.id))
      setArchiveTarget(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be archived')
      setArchiveTarget(null)
    } finally {
      setArchiving(false)
    }
  }

  return (
    <>
      <main className="app-page-enter flex min-w-0 flex-1 flex-col overflow-y-auto bg-background">
        {/* Hidden accessible search input for screen readers / tests */}
        <input
          ref={searchRef}
          type="search"
          aria-label="Search files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="sr-only"
        />

        {/* Dashboard Header matching screenshot */}
        <header className="flex flex-wrap items-center justify-between gap-4 px-8 pb-6 pt-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground text-balance">
            {title}
          </h1>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void newFile()}
              disabled={creating}
              className="flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background shadow-xs transition-[transform,box-shadow,opacity] duration-fast ease-spring hover:-translate-y-px hover:shadow-sm hover:opacity-95 active:translate-y-0 active:scale-[0.97] disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none"
            >
              {creating ? (
                <Spinner className="size-3.5" />
              ) : (
                <PlusIcon className="size-3.5 stroke-[2.5]" />
              )}
              <span>New file</span>
            </button>

            <div
              role="group"
              aria-label="Layout"
              className="flex items-center gap-0.5 rounded-lg border border-line bg-well p-0.5 shadow-xs"
            >
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
                className={cn(
                  'flex size-7 items-center justify-center rounded-md transition-all duration-fast ease-spring active:scale-95',
                  view === 'grid'
                    ? 'bg-surface text-foreground shadow-xs font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <LayoutGridIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
                className={cn(
                  'flex size-7 items-center justify-center rounded-md transition-all duration-fast ease-spring active:scale-95',
                  view === 'list'
                    ? 'bg-surface text-foreground shadow-xs font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <ListIcon className="size-3.5" />
              </button>
            </div>
          </div>
        </header>

        {error ? (
          <div className="mx-8 mb-4 flex items-center gap-2 rounded-md border border-destructive/32 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
            <span className="min-w-0 flex-1">{error}</span>
            <Button size="xs" variant="outline" onClick={() => void loadDesigns()}>
              Try again
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={() => setError(null)}>
              <XIcon />
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 px-8 pb-12">
          {designs === null ? (
            <FilesLoading view={view} />
          ) : visible.length === 0 ? (
            <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center rounded-md border border-line bg-surface px-6 py-12 text-center shadow-panel">
              <EmptyCanvasPlate />
              <p className="text-sm font-medium">
                {designs.length === 0 ? 'No design files yet' : 'No files match that search'}
              </p>
              <p className="mt-1.5 max-w-xs text-pretty text-xs text-muted-foreground">
                {designs.length === 0
                  ? 'Start a file and open it on the canvas.'
                  : 'Try a different name.'}
              </p>
              {designs.length === 0 ? (
                <button
                  type="button"
                  onClick={() => void newFile()}
                  disabled={creating}
                  className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background shadow-xs transition-[transform,box-shadow,opacity] duration-fast ease-spring hover:-translate-y-px hover:shadow-sm hover:opacity-95 active:translate-y-0 active:scale-[0.97] disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none"
                >
                  {creating ? <Spinner className="size-3.5" /> : <PlusIcon className="size-3.5 stroke-[2.5]" />}
                  <span>New file</span>
                </button>
              ) : null}
            </div>
          ) : view === 'grid' ? (
            <div className={GRID_CLASSES}>
              {visible.map((design) => (
                <FileCard
                  key={design.id}
                  design={design}
                  onRename={() => {
                    setRenameName(design.name)
                    setRenameTarget(design)
                  }}
                  onArchive={() => setArchiveTarget(design)}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-panel">
              {visible.map((design) => (
                <FileRow
                  key={design.id}
                  design={design}
                  onRename={() => {
                    setRenameName(design.name)
                    setRenameTarget(design)
                  }}
                  onArchive={() => setArchiveTarget(design)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>
              The structured document and its generated output use this name.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              value={renameName}
              aria-label="File name"
              onChange={(event) => setRenameName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && renameName.trim()) void renameDesign()
              }}
            />
          </DialogPanel>
          <DialogFooter>
            <Button disabled={!renameName.trim() || renaming} onClick={() => void renameDesign()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{archiveTarget?.name}”?</DialogTitle>
            <DialogDescription>
              This removes the file from Recents. Its data stays in the archive.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={archiving} onClick={() => void archiveDesign()}>
              {archiving ? <Spinner /> : <Trash2Icon />}
              Delete
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}
