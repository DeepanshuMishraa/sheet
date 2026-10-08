import { useState } from 'react'
import { orpc } from '@sheet/rpc/client'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@sheet/ui/menu'
import { ChevronDownIcon, CodeXmlIcon, DownloadIcon, ImageIcon } from '@sheet/ui/icons'
import { copyText } from '../lib/copy-text'

type Format = 'png' | 'jpg' | 'html' | 'json'

function saveFile(file: { filename: string; mimeType: string; encoding: 'utf8' | 'base64'; data: string }) {
  const bytes =
    file.encoding === 'base64'
      ? Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
      : new TextEncoder().encode(file.data)
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Header export: images and complete code, built server-side from the saved
 * document (the same path the MCP `exportDesign` tool uses).
 */
export function ExportMenu({
  designId,
  draftId,
  onError,
}: {
  designId: string
  draftId?: string | null
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  async function run(label: string, format: Format, then: 'save' | 'copy') {
    setBusy(label)
    try {
      const file = await orpc.webCanvas.export({
        designId,
        draftId: draftId ?? null,
        format,
        width: 1_440,
        pixelRatio: 2,
      })
      if (then === 'copy') await copyText(file.data)
      else saveFile(file)
    } catch (cause) {
      onError(
        cause instanceof Error
          ? `Export failed: ${cause.message}. Your design is unchanged; try again.`
          : 'Export failed. Your design is unchanged; try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <Menu>
      <MenuTrigger
        aria-label="Export design"
        title="Export design"
        disabled={busy !== null}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-xs text-foreground shadow-lift outline-none transition-[box-shadow,transform] duration-150 ease-smooth hover:shadow-lift-hover focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-60"
      >
        <DownloadIcon className="size-3.5 text-muted-foreground" />
        <span className="max-md:sr-only">{busy ? 'Exporting…' : 'Export'}</span>
        <ChevronDownIcon className="size-3 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
        <MenuGroupLabel>Image</MenuGroupLabel>
        <MenuItem onClick={() => void run('PNG', 'png', 'save')}>
          <ImageIcon /> Download PNG
        </MenuItem>
        <MenuItem onClick={() => void run('JPG', 'jpg', 'save')}>
          <ImageIcon /> Download JPG
        </MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
        <MenuGroupLabel>Code</MenuGroupLabel>
        <MenuItem onClick={() => void run('HTML', 'html', 'save')}>
          <CodeXmlIcon /> Download HTML
        </MenuItem>
        <MenuItem onClick={() => void run('Copy', 'html', 'copy')}>
          <CodeXmlIcon /> Copy HTML
        </MenuItem>
        <MenuItem onClick={() => void run('JSON', 'json', 'save')}>
          <CodeXmlIcon /> Download JSON
        </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )
}
