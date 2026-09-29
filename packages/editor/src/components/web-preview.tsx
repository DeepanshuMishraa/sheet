import { useCallback, useState } from 'react'
import type { WebDocument } from '@sheet/canvas/web-model'
import { WebDocumentView } from '@sheet/canvas/web-react'
import { cn } from '@sheet/ui/utils'

const FALLBACK_BOUNDS = { width: 1_440, height: 900 }

function px(value: string | undefined) {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)px$/)
  return match ? Number(match[1]) : null
}

export function webPreviewBounds(document: WebDocument) {
  if (document.metadata.page) return document.metadata.page
  const root = document.nodes[document.roots[0] ?? '']
  if (root?.kind !== 'element') return FALLBACK_BOUNDS
  return {
    width: px(root.styles.width) ?? FALLBACK_BOUNDS.width,
    height: px(root.styles.height) ?? FALLBACK_BOUNDS.height,
  }
}

/** Read-only browser preview. Chromium owns layout and CSS. */
export function WebDocumentPreview({
  document,
  className,
}: {
  document: WebDocument | null
  className?: string
}) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const observe = useCallback((element: HTMLDivElement | null) => {
    if (!element) return
    const measure = () => setViewport({
      width: element.clientWidth,
      height: element.clientHeight,
    })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const bounds = document ? webPreviewBounds(document) : FALLBACK_BOUNDS
  const scale = viewport.width > 0 && viewport.height > 0
    ? Math.min(viewport.width / bounds.width, viewport.height / bounds.height)
    : 0.35

  return (
    <div
      ref={observe}
      aria-hidden="true"
      className={cn('pointer-events-none relative size-full overflow-hidden bg-white', className)}
    >
      {document?.roots.length === 0 ? (
        <span className="absolute inset-0 grid place-items-center text-xs font-medium text-neutral-500">Empty design</span>
      ) : document ? (
        <div
          className="absolute top-0 origin-top-left overflow-hidden"
          style={{
            left: `${Math.max(0, (viewport.width - bounds.width * scale) / 2)}px`,
            width: bounds.width,
            height: bounds.height,
            transform: `scale(${scale})`,
          }}
        >
          <WebDocumentView document={document} className="size-full overflow-hidden" />
        </div>
      ) : null}
    </div>
  )
}
