import { useCallback, useRef } from 'react'
import {
  assertWebDocument,
  materializeWebNode,
  materializeWebStylesheets,
  type WebDocument,
} from './web-model'
import { mountShaders } from './web-shaders'

export interface WebDocumentViewProps {
  document: WebDocument
  className?: string
  onMaterialize?: (element: HTMLDivElement) => void
}

/**
 * Tracer-bullet host for the canonical web document. React owns the editor
 * mount; the document materializes as native DOM/CSS beneath it: authored
 * stylesheets become `<style>` elements in cascade order ahead of the design
 * DOM, and the browser resolves everything from there.
 */
export function WebDocumentView({
  document,
  className,
  onMaterialize,
}: WebDocumentViewProps) {
  const disposeShaders = useRef<(() => void) | null>(null)
  const mount = useCallback(
    (element: HTMLDivElement | null) => {
      // React detaches the previous ref (null) before attaching the next, so
      // shader canvases from the last materialization are always disposed.
      disposeShaders.current?.()
      disposeShaders.current = null
      if (!element) return
      assertWebDocument(document)
      const defaults = element.ownerDocument.createElement('style')
      defaults.textContent = ':where([data-sheet-document]){background:#fff;color:#000;color-scheme:light;font-family:Arial,sans-serif}'
      element.replaceChildren(
        defaults,
        ...materializeWebStylesheets(document, element.ownerDocument),
        ...document.roots.map((id) =>
          materializeWebNode(document, id, element.ownerDocument),
        ),
      )
      disposeShaders.current = mountShaders(element)
      onMaterialize?.(element)
    },
    [document, onMaterialize],
  )

  return (
    <div
      data-sheet-document=""
      className={className}
      ref={mount}
    />
  )
}
