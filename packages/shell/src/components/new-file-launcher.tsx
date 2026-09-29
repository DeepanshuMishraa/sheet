import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { SearchIcon } from '@sheet/ui/icons'
import { DotMatrixLoader } from '@sheet/ui/dot-matrix-loader'
import { Spinner } from '@sheet/ui/spinner'
import { orpc } from '@sheet/rpc/client'
import { createDesign, relativeTime, type DesignSummary } from '@sheet/editor/lib/designs'
import { WebDocumentPreview } from '@sheet/editor/web-preview'
import type { WebDocument } from '@sheet/canvas/web-model'
import { cn } from '@sheet/ui/utils'
import { subscribeCanvasChanges } from '@sheet/editor/lib/canvas-events'

const previewCache = new Map<string, WebDocument | null>()

function LauncherThumbnail({ designId, revision }: { designId: string; revision: number }) {
  const cacheKey = `${designId}:${revision}`
  const [doc, setDoc] = useState<WebDocument | null>(() => previewCache.get(cacheKey) ?? null)
  const [loaded, setLoaded] = useState(() => previewCache.has(cacheKey))
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
        const document = res?.status === 'ready' ? res.document : null
        previewCache.set(cacheKey, document)
        if (active) {
          setDoc(document)
          setLoaded(true)
        }
      })
      .catch(() => {
        previewCache.set(cacheKey, null)
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [cacheKey, designId])

  return (
    <div className="relative flex aspect-[16/10] w-18 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-cx-canvas sm:w-22">
      {!loaded && showLoader ? (
        <DotMatrixLoader className="size-4 text-muted-foreground" />
      ) : null}
      <WebDocumentPreview
        document={doc}
        className="size-full"
      />
    </div>
  )
}

function byRecent(left: DesignSummary, right: DesignSummary) {
  return right.updatedAt - left.updatedAt
}

export function NewFileLauncher() {
  const navigate = useNavigate()
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const loadDesigns = useCallback(async () => {
    try {
      const own = await orpc.design.list()
      setDesigns([...own].sort(byRecent))
    } catch {
      setDesigns([])
    }
  }, [])

  useEffect(() => {
    void loadDesigns()
    return subscribeCanvasChanges(null, () => void loadDesigns())
  }, [loadDesigns])

  const handleNewFile = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const created = await createDesign()
      await navigate({ to: '/design/$id', params: { id: created.id } })
    } catch {
      setCreating(false)
    }
  }, [creating, navigate])

  const handleBrowseAll = useCallback(() => {
    void navigate({ to: '/app' })
  }, [navigate])

  // Keyboard shortcut listener: Cmd/Ctrl+N to new file, Cmd/Ctrl+F to search
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCmd = event.metaKey || event.ctrlKey
      if (isCmd && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void handleNewFile()
      } else if (isCmd && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleNewFile])

  const visibleDesigns = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = designs ?? []
    if (!needle) return all
    return all.filter((d) => d.name.toLowerCase().includes(needle))
  }, [designs, query])

  return (
    <div className="min-h-full w-full bg-cx-canvas px-4 pb-20 pt-16 sm:px-6">
      <div className="mx-auto flex w-full max-w-xl flex-col items-center">
        {/* Top Segmented Action Buttons */}
        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            onClick={() => void handleNewFile()}
            disabled={creating}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-foreground px-5 font-medium text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {creating ? (
              <Spinner className="size-4" />
            ) : (
              <>
                <span className="text-sm">New file</span>
                <kbd className="font-sans text-xs opacity-60">⌘N</kbd>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleBrowseAll}
            className="flex h-11 flex-1 items-center justify-center rounded-xl border border-line bg-surface-2 px-5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            Browse all files
          </button>
        </div>

        {/* Search Input with ⌘F */}
        <div className="relative mb-6 mt-4 w-full">
          <SearchIcon className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Search files"
            placeholder="Search files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 w-full rounded-xl border border-line bg-surface-2 pe-10 ps-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <kbd className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
            ⌘F
          </kbd>
        </div>

        {/* File List */}
        <div className="flex w-full flex-col gap-0.5">
          {designs === null ? (
            <div className="flex flex-col gap-2 py-4">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className="flex h-16 w-full animate-pulse items-center gap-4 rounded-xl px-2"
                >
                  <div className="h-11 w-20 rounded-md bg-surface-2" />
                  <div className="h-4 flex-1 rounded bg-surface-2" />
                  <div className="h-3 w-16 rounded bg-surface-2" />
                </div>
              ))}
            </div>
          ) : visibleDesigns.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {designs.length === 0 ? 'No files yet' : 'No matching files found'}
            </div>
          ) : (
            visibleDesigns.map((design) => (
              <button
                key={design.id}
                type="button"
                onClick={() => void navigate({ to: '/design/$id', params: { id: design.id } })}
                className={cn(
                  'group flex w-full items-center justify-between rounded-xl p-2 text-start transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring',
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3.5 pe-3">
                  <LauncherThumbnail
                    key={design.revision}
                    designId={design.id}
                    revision={design.revision}
                  />
                  <span className="truncate text-sm font-normal text-foreground transition-colors group-hover:text-foreground">
                    {design.name}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                  {relativeTime(design.updatedAt).replace('about ', '')}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
