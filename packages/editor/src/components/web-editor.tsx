import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CodeXmlIcon,
  ComponentIcon,
  CropIcon,
  EyeIcon,
  EyeOffIcon,
  File01Icon,
  FrameIcon,
  HandIcon,
  ImageIcon,
  LayoutGridIcon,
  MousePointer2Icon,
  PanelLeftIcon,
  PencilIcon,
  PenTool01Icon,
  PlusCircleIcon,
  PlusIcon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
} from '@sheet/ui/icons'
import { ConnectAgent } from './connect-agent'
import { IconsPanel } from './icon-panel'
import { documentFonts, firstFamily, SYSTEM_FONT_STACKS, type DocumentFont } from '../lib/fonts'
import { iconInfo, iconStyleOperation, isIconNode, type IconLibrary } from '@sheet/canvas/web-icon-style'
import { Button } from '@sheet/ui/button'
import { cn } from '@sheet/ui/utils'
import {
  applyWebTransaction,
  webId,
  createWebElement,
  createWebStyleRule,
  createWebStyleSheet,
  createWebText,
  orderedWebChildren,
  webNodeIdFromElement,
  type WebDocument,
  type WebNode,
  type WebRulePatch,
  type WebTransaction,
} from '@sheet/canvas/web-model'
import type { WebStyleRule } from '@sheet/canvas/web-css'
import { boundNodeIndex, type WebOverride } from '@sheet/canvas/web-components'
import { WebDocumentView } from '@sheet/canvas/web-react'
import { AssetsPanel, assetSrc } from './assets-panel'
import { DocumentTabBar } from './tab-bar'
import { orpc } from '@sheet/rpc/client'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '@sheet/ui/dialog'
import {
  formatBuiltInChord,
  isEditableTarget,
  loadCachedShortcuts,
  matchShortcut,
  normalizeConfig,
  type BuiltInShortcutId,
  type ShortcutConfig,
} from '../lib/shortcuts'
import { subscribeCanvasChanges } from '../lib/canvas-events'

const ELEMENT_TAGS = [
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'nav',
  'button',
  'input',
  'img',
  'h1',
  'h2',
  'h3',
  'p',
  'span',
  'a',
] as const

const STYLE_GROUPS = [
  {
    label: 'Layout',
    properties: [
      'display',
      'position',
      'width',
      'height',
      'margin',
      'padding',
      'gap',
      'flex-direction',
      'flex-wrap',
      'align-items',
      'justify-content',
      'grid-template-columns',
    ],
  },
  {
    label: 'Typography',
    properties: [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'color',
    ],
  },
  {
    label: 'Appearance',
    properties: [
      'background',
      'border',
      'border-radius',
      'opacity',
    ],
  },
] as const

interface Camera {
  x: number
  y: number
  zoom: number
}

interface OverlayRect {
  left: number
  top: number
  width: number
  height: number
}

interface DrawingDraft {
  pointerId: number
  tool: 'frame' | 'box' | 'pen' | 'text' | 'image'
  start: { x: number; y: number }
  end: { x: number; y: number }
  points: { x: number; y: number }[]
}

interface DragState {
  mode: 'move' | 'resize' | 'pan' | 'page-resize'
  pointerId: number
  startX: number
  startY: number
  element?: HTMLElement | SVGElement
  moveKind?: DragMoveKind
  authoredLeft: number | null
  authoredTop: number | null
  authoredWidth: number | null
  authoredHeight: number | null
  camera?: Camera
  pageCorner?: 'nw' | 'ne' | 'sw' | 'se'
}

export type DragMoveKind = 'reorder' | 'absolute'

export function dragMoveKind(computedPosition: string): DragMoveKind {
  return computedPosition === 'absolute' || computedPosition === 'fixed'
    ? 'absolute'
    : 'reorder'
}

const PX_AUTHORED = /^(-?\d+(?:\.\d+)?)px$/

export function parsePxAuthored(value: string | undefined): number | null {
  if (value === undefined) return null
  const match = value.trim().match(PX_AUTHORED)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

export function roundAuthoredCss(value: number): number {
  return Math.round(value * 100) / 100
}

export function commitAbsoluteMove(
  start: { left: number; top: number },
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
  zoom: number,
): { left: string; top: string } {
  return {
    left: `${roundAuthoredCss(start.left + (clientX - startX) / zoom)}px`,
    top: `${roundAuthoredCss(start.top + (clientY - startY) / zoom)}px`,
  }
}

export interface ResizeCommit {
  width?: string
  height?: string
  declined: string[]
}

export function commitResize(
  start: { width: number | null; height: number | null },
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
  zoom: number,
): ResizeCommit {
  const commit: ResizeCommit = { declined: [] }
  if (start.width !== null) {
    commit.width = `${roundAuthoredCss(Math.max(1, start.width + (clientX - startX) / zoom))}px`
  } else {
    commit.declined.push('width')
  }
  if (start.height !== null) {
    commit.height = `${roundAuthoredCss(Math.max(1, start.height + (clientY - startY) / zoom))}px`
  } else {
    commit.declined.push('height')
  }
  return commit
}

export function reorderAxis(computedDisplay: string, computedFlexDirection: string): 'x' | 'y' {
  if (computedDisplay.includes('flex') && computedFlexDirection.includes('row')) return 'x'
  return 'y'
}

export interface ReorderSibling {
  id: string
  order: number
  top: number
  left: number
  bottom: number
  right: number
}

export function computeReorderOrder(
  siblings: ReorderSibling[],
  draggedId: string,
  draggedOrder: number,
  pointerX: number,
  pointerY: number,
  axis: 'x' | 'y',
): number | null {
  const sorted = [...siblings].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  )
  const pointer = axis === 'x' ? pointerX : pointerY
  let index = sorted.length
  for (let cursor = 0; cursor < sorted.length; cursor += 1) {
    const sibling = sorted[cursor] as ReorderSibling
    const center = axis === 'x'
      ? (sibling.left + sibling.right) / 2
      : (sibling.top + sibling.bottom) / 2
    if (pointer < center) {
      index = cursor
      break
    }
  }
  const withoutDragged = sorted.filter((sibling) => sibling.id !== draggedId)
  const fromIndex = sorted.findIndex((sibling) => sibling.id === draggedId)
  const slot = fromIndex !== -1 && index > fromIndex ? index - 1 : index
  if (fromIndex !== -1 && slot === fromIndex) return null
  const before = slot === 0 ? null : withoutDragged[slot - 1]?.order
  const after = slot >= withoutDragged.length ? null : withoutDragged[slot]?.order
  if (before === undefined || after === undefined) return null
  if (before === null && after === null) return draggedOrder
  if (before === null) return (after as number) - 1_024
  if (after === null) return before + 1_024
  if (after - before < 2) return before + 1
  return (before + after) / 2
}

/** Shapes inside an icon are not editable on their own: canvas picks resolve to the icon's svg. */
function pickTarget(document: WebDocument, id: string | null) {
  for (let current = id ? document.nodes[id] : undefined; current; current = current.parentId ? document.nodes[current.parentId] : undefined) {
    if (isIconNode(current)) return current.id
  }
  return id
}

function nodeLabel(node: WebNode) {
  if (node.kind === 'text') {
    const value = node.text.trim().replace(/\s+/g, ' ')
    return value ? `"${value.slice(0, 32)}${value.length > 32 ? '…' : ''}"` : 'text'
  }
  return node.tag
}

function nodeIcon(node: WebNode) {
  if (node.kind === 'text') return <TypeIcon className="size-3.5 text-muted-foreground shrink-0" />
  if (node.tag === 'img') return <ImageIcon className="size-3.5 text-muted-foreground shrink-0" />
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a'].includes(node.tag)) {
    return <TypeIcon className="size-3.5 text-muted-foreground shrink-0" />
  }
  if (node.tag === 'button') return <CodeXmlIcon className="size-3.5 text-muted-foreground shrink-0" />
  if (node.tag === 'input') return <PencilIcon className="size-3.5 text-muted-foreground shrink-0" />
  if (['section', 'article', 'main', 'header', 'footer'].includes(node.tag)) {
    return <FrameIcon className="size-3.5 text-muted-foreground shrink-0" />
  }
  return <SquareIcon className="size-3.5 text-muted-foreground shrink-0" />
}

function nextOrder(document: WebDocument, parentId: string | null) {
  return (orderedWebChildren(document, parentId).at(-1)?.order ?? 0) + 1_024
}

function collectSubtreeIds(document: WebDocument, rootId: string): string[] {
  const ids: string[] = []
  const visit = (id: string) => {
    const node = document.nodes[id]
    if (!node) return
    ids.push(id)
    for (const child of orderedWebChildren(document, id)) visit(child.id)
  }
  visit(rootId)
  return ids
}

export function cloneSubtreeFresh(document: WebDocument, rootId: string): WebNode[] {
  const root = document.nodes[rootId]
  if (!root) throw new Error(`Node ${rootId} does not exist`)
  const clones: WebNode[] = []
  const visit = (source: WebNode, parentId: string | null): void => {
    const id = webId(source.kind)
    clones.push(
      source.kind === 'text'
        ? { ...source, id, parentId }
        : {
          ...source,
          id,
          parentId,
          attributes: { ...source.attributes },
          styles: { ...source.styles },
        },
    )
    for (const child of orderedWebChildren(document, source.id)) visit(child, id)
  }
  visit(root, null)
  return clones
}

function initialStyles(tag: string): Record<string, string> {
  if (tag === 'div') {
    return {
      width: '160px',
      height: '96px',
      background: '#2a2a2a',
    }
  }
  if (tag === 'button') {
    return {
      padding: '10px 16px',
      background: '#18181b',
      color: '#ffffff',
      border: '0',
      'border-radius': '8px',
    }
  }
  if (tag === 'img') return { width: '240px', height: '160px', 'object-fit': 'cover' }
  if (tag === 'input') return { padding: '8px 10px', border: '1px solid #333333', background: '#222222', color: '#ffffff' }
  return {}
}

function initialText(tag: string) {
  if (tag === 'button') return 'Button'
  if (tag === 'h1') return 'Heading 1'
  if (tag === 'h2') return 'Heading 2'
  if (tag === 'h3') return 'Heading 3'
  if (tag === 'p') return 'Paragraph'
  if (tag === 'span') return 'Text'
  if (tag === 'a') return 'Link'
  return null
}

function WebTreeNode({
  document,
  node,
  selectedId,
  onSelect,
}: {
  document: WebDocument
  node: WebNode
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const children = node.kind === 'element' ? orderedWebChildren(document, node.id) : []
  const [open, setOpen] = useState(true)
  const isSelected = selectedId === node.id
  return (
    <div>
      <div
        className={cn(
          'group flex h-7 cursor-pointer select-none items-center rounded-md border px-1.5 text-xs transition-colors',
          isSelected
            ? 'border-line/80 bg-surface-2 font-medium text-foreground shadow-xs'
            : 'border-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
        )}
        onClick={() => onSelect(node.id)}
      >
        <button
          type="button"
          className="grid size-4 shrink-0 place-items-center text-muted-foreground/60 hover:text-foreground"
          aria-label={open ? 'Collapse element' : 'Expand element'}
          disabled={children.length === 0}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((value) => !value)
          }}
        >
          {children.length > 0 ? (
            open ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />
          ) : <span className="size-3" />}
        </button>
        <div className="flex items-center gap-1.5 min-w-0 flex-1 ps-1">
          {nodeIcon(node)}
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left text-xs',
              node.kind === 'text' ? 'italic text-muted-foreground' : 'text-foreground',
            )}
          >
            {nodeLabel(node)}
          </span>
        </div>
      </div>
      {open && children.length > 0 ? (
        <div className="ms-2.5 border-s border-line ps-1">
          {children.map((child) => (
            <WebTreeNode
              key={child.id}
              document={document}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function InspectorInput({
  label,
  value,
  placeholder,
  prefix,
  suffix,
  className,
  layout = 'row',
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  prefix?: ReactNode
  suffix?: ReactNode
  className?: string
  /** `row` puts the label beside the input, `stack` above it, `bare` hides it (aria-label only). */
  layout?: 'row' | 'stack' | 'bare'
  onCommit: (value: string) => void
}) {
  return (
    <label
      className={cn(
        'group min-w-0 text-xs text-muted-foreground',
        layout === 'stack' ? 'flex flex-col gap-1' : 'flex items-center gap-1.5',
        className,
      )}
    >
      {prefix ? (
        <span className="min-w-4 shrink-0 text-center font-mono text-[11px] text-muted-foreground">{prefix}</span>
      ) : layout === 'bare' ? null : (
        <span
          className={cn(
            'truncate text-[11px] text-muted-foreground',
            layout === 'row' && 'w-20 shrink-0',
          )}
          title={label}
        >
          {label}
        </span>
      )}
      <div className="relative flex min-w-0 flex-1 items-center">
        <input
          key={`${label}:${value}`}
          aria-label={label}
          defaultValue={value}
          placeholder={placeholder}
          className={cn(
            'h-7 w-full min-w-0 rounded-md border border-input bg-surface-2 px-2 font-mono text-xs text-foreground outline-none transition-colors hover:border-line focus:border-ring focus:bg-surface',
            suffix ? 'pe-7' : null,
          )}
          onBlur={(event) => {
            if (event.currentTarget.value !== value) onCommit(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        {suffix ? (
          <span className="pointer-events-none absolute end-2 text-[10px] text-muted-foreground/70">{suffix}</span>
        ) : null}
      </div>
    </label>
  )
}

function InspectorSelect({
  label,
  value,
  options,
  placeholder = 'Default',
  layout = 'stack',
  onCommit,
}: {
  label: string
  value: string
  options: readonly (string | { value: string; label: string })[]
  placeholder?: string
  layout?: 'row' | 'stack'
  onCommit: (value: string) => void
}) {
  const normalized = options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option))
  // A value authored outside the list (a raw CSS keyword, a stack) must stay visible and selectable.
  const listed = value && !normalized.some((option) => option.value === value)
    ? [{ value, label: value }, ...normalized]
    : normalized
  return (
    <label
      className={cn(
        'min-w-0 text-xs text-muted-foreground',
        layout === 'stack' ? 'flex flex-col gap-1' : 'flex items-center gap-1.5',
      )}
    >
      <span className={cn('truncate text-[11px]', layout === 'row' && 'w-20 shrink-0')} title={label}>{label}</span>
      <select
        aria-label={label}
        value={value}
        className="h-7 w-full min-w-0 rounded-md border border-input bg-surface-2 px-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-line focus:border-ring"
        onChange={(event) => onCommit(event.currentTarget.value)}
      >
        <option value="">{placeholder}</option>
        {listed.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

const DISPLAY_OPTIONS = ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'none'] as const
const FLEX_DIRECTION_OPTIONS = ['row', 'row-reverse', 'column', 'column-reverse'] as const
const ALIGN_OPTIONS = ['flex-start', 'center', 'flex-end', 'stretch', 'baseline'] as const
const JUSTIFY_OPTIONS = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] as const
const POSITION_OPTIONS = ['static', 'relative', 'absolute', 'fixed', 'sticky'] as const
const OVERFLOW_OPTIONS = ['visible', 'hidden', 'scroll', 'auto'] as const
const FONT_WEIGHT_OPTIONS = [
  { value: '100', label: '100 · Thin' },
  { value: '200', label: '200 · Extra light' },
  { value: '300', label: '300 · Light' },
  { value: '400', label: '400 · Regular' },
  { value: '500', label: '500 · Medium' },
  { value: '600', label: '600 · Semibold' },
  { value: '700', label: '700 · Bold' },
  { value: '800', label: '800 · Extra bold' },
  { value: '900', label: '900 · Black' },
] as const
const TEXT_ALIGN_OPTIONS = ['left', 'center', 'right', 'justify'] as const
const FONT_STYLE_OPTIONS = ['normal', 'italic'] as const

function WebToolButton({
  label,
  active = false,
  disabled = false,
  children,
  onClick,
  'aria-label': ariaLabel,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  children: ReactNode
  onClick: () => void
  'aria-label'?: string
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel || label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'size-8 grid place-items-center rounded-lg transition-colors',
        active
          ? 'border border-cx-accent/60 bg-cx-accent/10 font-medium text-foreground shadow-xs'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground',
      )}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

export interface MatchingAuthoredRule {
  stylesheetId: string
  stylesheetName: string
  rule: WebStyleRule
  viaPseudoElement: boolean
}

export function matchingAuthoredRules(
  element: Element | null,
  document: WebDocument,
): MatchingAuthoredRule[] {
  if (!element) return []
  const grouped: MatchingAuthoredRule[] = []
  for (const sheetId of document.stylesheetOrder) {
    const sheet = document.stylesheets[sheetId]
    if (!sheet) continue
    for (const ruleId of sheet.ruleOrder) {
      const rule = sheet.rules[ruleId]
      if (!rule) continue
      try {
        if (element.matches(rule.selector)) {
          grouped.push({
            stylesheetId: sheet.id,
            stylesheetName: sheet.name,
            rule,
            viaPseudoElement: false,
          })
          continue
        }
      } catch {
        // Pseudo-element selector fallback
      }
      const base = rule.selector.replace(/::[a-z-]+(\(.*\))?$/i, '').trim()
      if (!base || base === rule.selector) continue
      try {
        if (element.matches(base)) {
          grouped.push({
            stylesheetId: sheet.id,
            stylesheetName: sheet.name,
            rule,
            viaPseudoElement: true,
          })
        }
      } catch {
        // Not matchable
      }
    }
  }
  return grouped
}

export interface BoundInspectorInfo {
  instanceId: string
  componentName: string
  isInstanceRoot: boolean
}

function WebInspector({
  node,
  geometry,
  computed,
  matchingRules,
  bound,
  override,
  pageBackground,
  pageSize,
  fonts,
  onSetPageBackground,
  onResizePage,
  onConnectAgent,
  onPatch,
  onPatchRule,
  onSetOverride,
  onClearOverride,
  onDeleteInstance,
}: {
  node: WebNode | null
  geometry: OverlayRect | null
  computed: Record<string, string>
  matchingRules: MatchingAuthoredRule[]
  bound: BoundInspectorInfo | null
  override: WebOverride | undefined
  pageBackground: string
  pageSize: { width: number; height: number }
  fonts: readonly DocumentFont[]
  onSetPageBackground: (color: string) => void
  onResizePage: (size: { width?: number; height?: number }) => void
  onConnectAgent: () => void
  onPatch: (patch: {
    tag?: string
    attributes?: Record<string, string | null>
    styles?: Record<string, string | null>
  }) => void
  onPatchRule: (stylesheetId: string, id: string, patch: WebRulePatch) => void
  onSetOverride: (override: WebOverride) => void
  onClearOverride: () => void
  onDeleteInstance: () => void
}) {
  const fillPickerRef = useRef<HTMLInputElement>(null)
  const pagePickerRef = useRef<HTMLInputElement>(null)
  // When no node is selected: Render Page & MCP sections (Image 2)
  if (!node) {
    return (
      <div>
        {/* Page Section */}
        <section className="space-y-2 border-b border-line p-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Page
          </div>
          <div className="grid grid-cols-2 gap-2">
            <InspectorInput label="Page width" layout="stack" value={String(pageSize.width)} onCommit={(value) => {
              const size = Number(value)
              if (Number.isFinite(size) && size > 0) onResizePage({ width: size })
            }} />
            <InspectorInput label="Page height" layout="stack" value={String(pageSize.height)} onCommit={(value) => {
              const size = Number(value)
              if (Number.isFinite(size) && size > 0) onResizePage({ height: size })
            }} />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 p-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <input
                ref={pagePickerRef}
                type="color"
                aria-label="Page background color"
                className="size-6 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0"
                value={pageBackground}
                onChange={(event) => onSetPageBackground(event.currentTarget.value)}
              />
              <span className="truncate font-mono text-xs uppercase text-foreground">{pageBackground.replace('#', '')}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onSetPageBackground(pageBackground === '#2a2a2a' ? '#181818' : '#2a2a2a')}
                title="Toggle canvas theme"
              >
                <LayoutGridIcon className="size-3.5" />
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => pagePickerRef.current?.click()}
                title="Edit color"
              >
                <PencilIcon className="size-3.5" />
              </button>
            </div>
          </div>
        </section>

        {/* MCP Section */}
        <section className="space-y-2 p-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            MCP
          </div>
          <Button
            variant="outline"
            className="w-full rounded-lg border-line bg-surface-2 hover:bg-secondary hover:text-foreground text-xs font-medium text-foreground py-2.5 flex items-center justify-center gap-2 shadow-xs transition-colors"
            onClick={onConnectAgent}
          >
            Connect your agent
          </Button>
        </section>
      </div>
    )
  }

  if (node.kind === 'text') {
    if (bound) {
      const text = override?.kind === 'text' ? override.text : node.text
      return (
        <div className="space-y-2 p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Instance override · text
          </div>
          <p className="text-[11px] text-muted-foreground">
            Bound to {bound.componentName}; direct edits are rejected.
          </p>
          <InspectorInput
            label="text"
            value={text}
            onCommit={(value) => onSetOverride({ kind: 'text', text: value })}
          />
          {override ? (
            <Button size="sm" variant="outline" className="w-full text-xs" onClick={onClearOverride}>
              Clear override
            </Button>
          ) : null}
        </div>
      )
    }
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Text nodes are edited on the canvas. Select their parent element for CSS.
      </div>
    )
  }

  const attributeNames = ['id', 'class', 'aria-label']
  if (node.tag === 'a') attributeNames.push('href')
  if (node.tag === 'img') attributeNames.push('src', 'alt')
  const computedProperties = STYLE_GROUPS.flatMap((group) => group.properties)
  const customProperties = Object.entries(node.styles).filter(([name]) => name.startsWith('--'))

  const commitAttributeOverride = (change: Record<string, string | null>) => {
    const base = override?.kind === 'attributes' ? override.attributes : {}
    onSetOverride({ kind: 'attributes', attributes: { ...base, ...change } })
  }
  const commitCustomPropertyOverride = (change: Record<string, string | null>) => {
    const base = override?.kind === 'custom-properties' ? override.properties : {}
    onSetOverride({ kind: 'custom-properties', properties: { ...base, ...change } })
  }

  const icon = iconInfo(node)
  const iconColor = node.styles.color ?? ''
  const iconSize = parseInt(node.styles.width ?? '', 10)
  const iconStroke = node.attributes['stroke-width'] ?? ''
  const styleIcon = (style: { color?: string; size?: number; strokeWidth?: number }) => {
    const operation = iconStyleOperation(node.id, style)
    if (operation?.type === 'node.patch' && operation.patch.kind === 'element') {
      onPatch({ styles: operation.patch.styles, attributes: operation.patch.attributes })
    }
  }

  return (
    <div>
      {icon && !bound ? (
        <section className="space-y-2.5 border-b border-line p-3">
          <div className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Icon</span>
            <span className="min-w-0 truncate font-mono text-[10px] lowercase" title={`${icon.name} · ${icon.library}`}>
              {icon.name} · {icon.library}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Icon color picker"
              className="size-7 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0 shadow-xs"
              value={/^#[\da-f]{6}$/i.test(iconColor) ? iconColor : '#000000'}
              onChange={(event) => styleIcon({ color: event.currentTarget.value })}
            />
            <div className="min-w-0 flex-1">
              <InspectorInput
                label="Icon color"
                layout="bare"
                value={iconColor}
                placeholder="currentColor"
                onCommit={(val) => onPatch({ styles: { color: val ? val : null } })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <InspectorInput
              label="Icon size"
              layout="stack"
              value={Number.isFinite(iconSize) ? String(iconSize) : ''}
              placeholder="24"
              suffix="px"
              onCommit={(val) => {
                const size = Number(val)
                if (Number.isFinite(size) && size > 0) styleIcon({ size })
              }}
            />
            <InspectorInput
              label="Stroke width"
              layout="stack"
              value={iconStroke}
              placeholder="1.5"
              onCommit={(val) => {
                const width = Number(val)
                if (Number.isFinite(width) && width > 0) styleIcon({ strokeWidth: width })
              }}
            />
          </div>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.25}
            aria-label="Stroke weight"
            value={Number(iconStroke) || 1.5}
            onChange={(event) => styleIcon({ strokeWidth: Number(event.currentTarget.value) })}
            className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-surface-2 accent-primary"
          />
        </section>
      ) : null}

      {/* Layout Section (Image 4) */}
      <section className="space-y-2.5 border-b border-line p-3">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Layout</span>
          <span className="font-mono text-[10px] text-muted-foreground lowercase">&lt;{node.tag}&gt;</span>
        </div>

        {bound ? (
          <div className="space-y-1.5 rounded-md border border-line bg-surface-2 p-2 text-xs">
            <div className="font-mono text-[11px] text-foreground">&lt;{node.tag}&gt;</div>
            <p className="text-[11px] text-muted-foreground">
              Instance of {bound.componentName}; structure comes from template.
            </p>
            {bound.isInstanceRoot ? (
              <Button size="sm" variant="outline" className="w-full text-xs border-line" onClick={onDeleteInstance}>
                Delete instance
              </Button>
            ) : null}
          </div>
        ) : (
          <InspectorInput label="tag" value={node.tag} onCommit={(tag) => onPatch({ tag })} />
        )}

        {/* X, Y */}
        <div className="grid grid-cols-2 gap-1.5">
          <InspectorInput
            label="left"
            prefix="X"
            value={node.styles.left ?? (geometry ? `${Math.round(geometry.left)}px` : '')}
            placeholder={geometry ? `${Math.round(geometry.left)}px` : '0'}
            onCommit={(val) => onPatch({ styles: { left: val ? val : null } })}
          />
          <InspectorInput
            label="top"
            prefix="Y"
            value={node.styles.top ?? (geometry ? `${Math.round(geometry.top)}px` : '')}
            placeholder={geometry ? `${Math.round(geometry.top)}px` : '0'}
            onCommit={(val) => onPatch({ styles: { top: val ? val : null } })}
          />
        </div>

        {/* W, H */}
        <div className="grid grid-cols-2 gap-1.5">
          <InspectorInput
            label="width"
            prefix="W"
            value={node.styles.width ?? (geometry ? `${Math.round(geometry.width)}px` : '')}
            placeholder={geometry ? `${Math.round(geometry.width)}px` : 'auto'}
            onCommit={(val) => onPatch({ styles: { width: val ? val : null } })}
          />
          <InspectorInput
            label="height"
            prefix="H"
            value={node.styles.height ?? (geometry ? `${Math.round(geometry.height)}px` : '')}
            placeholder={geometry ? `${Math.round(geometry.height)}px` : 'auto'}
            onCommit={(val) => onPatch({ styles: { height: val ? val : null } })}
          />
        </div>

        {/* Wrap in flex button (Image 4) */}
        <button
          type="button"
          className="w-full h-7 rounded-md border border-line bg-surface-2 hover:bg-secondary hover:text-foreground text-xs font-normal text-foreground flex items-center justify-between px-2.5 transition-colors"
          onClick={() => {
            onPatch({
              styles: {
                display: 'flex',
                'flex-direction': node.styles['flex-direction'] || 'column',
                gap: node.styles.gap || '12px',
              },
            })
          }}
        >
          <span>Wrap in flex</span>
          <span className="font-mono text-[10px] text-muted-foreground">⇧A</span>
        </button>

        {/* Additional Layout Properties */}
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <InspectorSelect
            label="display"
            value={node.styles.display ?? ''}
            options={DISPLAY_OPTIONS}
            placeholder={computed.display || 'Default'}
            onCommit={(val) => onPatch({ styles: { display: val ? val : null } })}
          />
          <InspectorSelect
            label="position"
            value={node.styles.position ?? ''}
            options={POSITION_OPTIONS}
            placeholder={computed.position || 'Default'}
            onCommit={(val) => onPatch({ styles: { position: val ? val : null } })}
          />
          {/^(inline-)?(flex|grid)$/.test(node.styles.display ?? computed.display ?? '') ? (
            <>
              <InspectorSelect
                label="flex-direction"
                value={node.styles['flex-direction'] ?? ''}
                options={FLEX_DIRECTION_OPTIONS}
                placeholder="row"
                onCommit={(val) => onPatch({ styles: { 'flex-direction': val ? val : null } })}
              />
              <InspectorSelect
                label="align-items"
                value={node.styles['align-items'] ?? ''}
                options={ALIGN_OPTIONS}
                onCommit={(val) => onPatch({ styles: { 'align-items': val ? val : null } })}
              />
              <InspectorSelect
                label="justify-content"
                value={node.styles['justify-content'] ?? ''}
                options={JUSTIFY_OPTIONS}
                onCommit={(val) => onPatch({ styles: { 'justify-content': val ? val : null } })}
              />
              <InspectorInput
                label="gap"
                layout="stack"
                value={node.styles.gap ?? ''}
                placeholder="0"
                onCommit={(val) => onPatch({ styles: { gap: val ? val : null } })}
              />
            </>
          ) : null}
          <InspectorSelect
            label="overflow"
            value={node.styles.overflow ?? ''}
            options={OVERFLOW_OPTIONS}
            placeholder={computed.overflow || 'Default'}
            onCommit={(val) => onPatch({ styles: { overflow: val ? val : null } })}
          />
        </div>
      </section>

      {/* Radius Section (Image 4) */}
      <section className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Radius</span>
          <SquareIcon className="size-3 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={64}
            value={parseInt(node.styles['border-radius'] ?? '0', 10) || 0}
            onChange={(e) => onPatch({ styles: { 'border-radius': `${e.target.value}px` } })}
            aria-label="Border radius"
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg bg-surface-2 accent-primary"
          />
          <div className="w-20 shrink-0">
            <InspectorInput
              label="border-radius"
              layout="bare"
              value={node.styles['border-radius'] ?? '0'}
              placeholder="0"
              onCommit={(val) => onPatch({ styles: { 'border-radius': val ? val : null } })}
            />
          </div>
        </div>
      </section>

      {/* Blending Section (Image 4) */}
      <section className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Blending</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              const isHidden = node.styles.opacity === '0'
              onPatch({ styles: { opacity: isHidden ? '1' : '0' } })
            }}
          >
            {node.styles.opacity === '0' ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
          </button>
        </div>
        <div className="grid grid-cols-2 items-end gap-2">
          <InspectorInput
            label="opacity"
            layout="stack"
            value={node.styles.opacity ?? '1'}
            placeholder="1"
            onCommit={(val) => onPatch({ styles: { opacity: val ? val : null } })}
          />
          <select
            aria-label="Blend mode"
            value={node.styles['mix-blend-mode'] ?? 'normal'}
            onChange={(e) => onPatch({ styles: { 'mix-blend-mode': e.target.value === 'normal' ? null : e.target.value } })}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-surface-2 px-2 font-mono text-xs text-foreground outline-none hover:border-line focus:border-ring"
          >
            <option value="normal">Normal</option>
            <option value="multiply">Multiply</option>
            <option value="screen">Screen</option>
            <option value="overlay">Overlay</option>
            <option value="darken">Darken</option>
            <option value="lighten">Lighten</option>
          </select>
        </div>
      </section>

      {/* Fill Section (Image 4) */}
      <section className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Fill</span>
          <button
            type="button"
            aria-label="Choose fill color"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => fillPickerRef.current?.click()}
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fillPickerRef}
            type="color"
            aria-label="Fill color"
            className="size-7 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0 shadow-xs"
            value={/^#[\da-f]{6}$/i.test(node.styles.background || node.styles['background-color'] || '') ? (node.styles.background || node.styles['background-color']) : '#ffffff'}
            onChange={(event) => onPatch({ styles: { background: event.currentTarget.value } })}
          />
          <div className="min-w-0 flex-1">
            <InspectorInput
              label="background"
              layout="bare"
              value={node.styles.background || node.styles['background-color'] || ''}
              placeholder="#ffffff"
              onCommit={(val) => onPatch({ styles: { background: val ? val : null } })}
            />
          </div>
        </div>
      </section>

      {/* Border & Outline Section (Image 4) */}
      <section className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Border</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => onPatch({ styles: { border: '1px solid #3e3e3e' } })}
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-20 shrink-0">
            <InspectorInput
              label="border-width"
              layout="bare"
              value={node.styles['border-width'] ?? (node.styles.border ? '1px' : '')}
              placeholder="1px"
              onCommit={(val) => onPatch({ styles: { 'border-width': val ? val : null } })}
            />
          </div>
          <div className="min-w-0 flex-1">
            <InspectorInput
              label="border"
              layout="bare"
              value={node.styles.border ?? ''}
              placeholder="1px solid #333"
              onCommit={(val) => onPatch({ styles: { border: val ? val : null } })}
            />
          </div>
        </div>
      </section>

      {/* Typography Section (Image 4 & tests) */}
      <section className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Typography</span>
        </div>
        <div className="space-y-1.5">
          <InspectorInput
            label="color"
            value={node.styles.color ?? ''}
            placeholder="rgb(20, 20, 24)"
            onCommit={(val) => onPatch({ styles: { color: val ? val : null } })}
          />
          <InspectorSelect
            label="font-family"
            layout="row"
            value={node.styles['font-family'] ?? ''}
            placeholder={firstFamily(computed['font-family'] ?? '') || 'Default'}
            options={[
              ...fonts.map((font) => ({ value: font.stack, label: font.family })),
              ...SYSTEM_FONT_STACKS.filter((system) => !fonts.some((font) => font.stack === system.stack)).map(
                (system) => ({ value: system.stack, label: system.label }),
              ),
            ]}
            onCommit={(val) => onPatch({ styles: { 'font-family': val ? val : null } })}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <InspectorInput
              label="font-size"
              layout="stack"
              value={node.styles['font-size'] ?? ''}
              placeholder="14px"
              onCommit={(val) => onPatch({ styles: { 'font-size': val ? val : null } })}
            />
            <InspectorSelect
              label="font-weight"
              value={node.styles['font-weight'] ?? ''}
              options={FONT_WEIGHT_OPTIONS}
              placeholder={computed['font-weight'] || 'Default'}
              onCommit={(val) => onPatch({ styles: { 'font-weight': val ? val : null } })}
            />
            <InspectorSelect
              label="text-align"
              value={node.styles['text-align'] ?? ''}
              options={TEXT_ALIGN_OPTIONS}
              onCommit={(val) => onPatch({ styles: { 'text-align': val ? val : null } })}
            />
            <InspectorSelect
              label="font-style"
              value={node.styles['font-style'] ?? ''}
              options={FONT_STYLE_OPTIONS}
              onCommit={(val) => onPatch({ styles: { 'font-style': val ? val : null } })}
            />
          </div>
          <InspectorInput
            label="line-height"
            value={node.styles['line-height'] ?? ''}
            placeholder="1.5"
            onCommit={(val) => onPatch({ styles: { 'line-height': val ? val : null } })}
          />
        </div>
      </section>

      {/* Attributes Section (for tests and editing) */}
      <section className="space-y-2 border-b border-line p-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {bound ? 'Instance override · attributes' : 'Attributes'}
        </div>
        {attributeNames.map((name) => (
          <InspectorInput
            key={name}
            label={name}
            value={node.attributes[name] ?? ''}
            onCommit={(value) => {
              const change = { [name]: value.trim() ? value : null }
              if (bound) commitAttributeOverride(change)
              else onPatch({ attributes: change })
            }}
          />
        ))}
        {bound && override?.kind === 'attributes' ? (
          <Button size="sm" variant="outline" className="w-full text-xs border-line" onClick={onClearOverride}>
            Clear override
          </Button>
        ) : null}
      </section>

      {/* Custom Properties (for instances or variables) */}
      {bound && (
        <section className="space-y-2 border-b border-line p-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Instance override · custom properties
          </div>
          {customProperties.map(([name, value]) => (
            <InspectorInput
              key={name}
              label={name}
              value={value}
              onCommit={(next) =>
                commitCustomPropertyOverride({ [name]: next.trim() ? next : null })
              }
            />
          ))}
          {override?.kind === 'custom-properties' ? (
            <Button size="sm" variant="outline" className="w-full text-xs border-line" onClick={onClearOverride}>
              Clear override
            </Button>
          ) : null}
        </section>
      )}

      {/* Authored · matching stylesheet rules */}
      <section className="space-y-3 border-b border-line p-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Authored · matching stylesheet rules
        </div>
        {matchingRules.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No stylesheet rule matches this element. Rules match in the browser.
          </p>
        ) : (
          matchingRules.map(({ stylesheetId, stylesheetName, rule, viaPseudoElement }) => (
            <div key={rule.id} className="space-y-2 rounded-lg border border-line bg-surface-2 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-well px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  {stylesheetName}
                </span>
                {rule.conditions.map((condition, index) => (
                  <span
                    key={`${condition.kind}:${index}`}
                    className="rounded bg-well px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    @{condition.kind} {condition.query}
                  </span>
                ))}
                {viaPseudoElement ? (
                  <span className="rounded bg-well px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    pseudo-element · stays CSS
                  </span>
                ) : null}
              </div>
              <InspectorInput
                label="selector"
                value={rule.selector}
                onCommit={(selector) => {
                  if (selector.trim()) onPatchRule(stylesheetId, rule.id, { selector })
                }}
              />
              {Object.entries(rule.declarations).map(([name, value]) => (
                <InspectorInput
                  key={name}
                  label={name}
                  value={value}
                  onCommit={(next) =>
                    onPatchRule(stylesheetId, rule.id, {
                      declarations: { [name]: next.trim() ? next : null },
                    })
                  }
                />
              ))}
            </div>
          ))
        )}
      </section>

      {/* Computed · browser output · read-only */}
      <section className="space-y-2 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Computed · browser output · read-only
        </div>
        <p className="text-[10px] text-muted-foreground">
          Resolved by the browser from inline style, sheets, and viewport.
        </p>
        {computedProperties.map((property) => (
          <div
            key={property}
            className="grid grid-cols-[6rem_1fr] items-center gap-2 text-xs"
          >
            <span className="truncate text-muted-foreground text-[11px]">{property}</span>
            <span className="min-w-0 truncate font-mono text-[11px] text-foreground">
              {computed[property] || '—'}
            </span>
          </div>
        ))}
      </section>
    </div>
  )
}

export function WebCanvasEditor({
  designId,
  draftId = null,
  initialDocument,
  initialRevision,
  name,
}: {
  designId: string
  draftId?: string | null
  initialDocument: WebDocument
  initialRevision: number
  name: string
}) {
  const [document, setDocument] = useState(initialDocument)
  const [selectedId, setSelectedId] = useState<string | null>(initialDocument.roots[0] ?? null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectionRect, setSelectionRect] = useState<OverlayRect | null>(null)
  const [hoverRect, setHoverRect] = useState<OverlayRect | null>(null)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
  const [computed, setComputed] = useState<Record<string, string>>({})
  const [camera, setCamera] = useState<Camera>({ x: 320, y: 120, zoom: 0.75 })
  const [tool, setToolState] = useState<'select' | 'pan' | 'frame' | 'box' | 'pen' | 'text' | 'image'>('select')
  const [pageSelected, setPageSelected] = useState(false)
  const penDraftRef = useRef<{ pathId: string; points: { x: number; y: number }[] } | null>(null)
  const setTool = useCallback((next: typeof tool) => {
    penDraftRef.current = null
    setToolState(next)
  }, [])
  const [isSpacePanning, setIsSpacePanning] = useState(false)
  const [quickInsertOpen, setQuickInsertOpen] = useState(false)
  const [connectAgentOpen, setConnectAgentOpen] = useState(false)
  const [pagesOpen, setPagesOpen] = useState(true)
  const [pageBackground, setPageBackground] = useState(() => {
    const root = initialDocument.nodes[initialDocument.roots[0] ?? '']
    const value = root?.kind === 'element' ? (root.styles.background ?? root.styles['background-color'] ?? '') : ''
    return /^#[\da-f]{6}$/i.test(value) ? value : '#ffffff'
  })
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024)
  const [leftTab, setLeftTab] = useState<'design' | 'theme' | 'assets' | 'icons'>('design')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [notice, setNotice] = useState<string | null>(null)
  const [shortcutConfig, setShortcutConfig] = useState<ShortcutConfig>(loadCachedShortcuts)
  const [history, setHistory] = useState<WebTransaction[]>([])
  const [redo, setRedo] = useState<WebTransaction[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const documentRef = useRef(document)
  const revisionRef = useRef(initialRevision)
  const selectedRef = useRef(selectedId)
  const hoveredRef = useRef(hoveredId)
  const cameraRef = useRef(camera)
  const savingRef = useRef(false)
  const pendingSavesRef = useRef<{ transaction: WebTransaction; snapshot: WebDocument }[]>([])
  const dragRef = useRef<DragState | null>(null)
  const drawingRef = useRef<DrawingDraft | null>(null)
  const [drawing, setDrawing] = useState<DrawingDraft | null>(null)
  const [pageResizePreview, setPageResizePreview] = useState<{ width: number; height: number } | null>(null)
  const suppressClickRef = useRef(false)

  const findElement = useCallback((id: string | null) => {
    if (!id || !hostRef.current) return null
    const safe = id.replace(/["\\]/g, '\\$&')
    return hostRef.current.querySelector<HTMLElement | SVGElement>(
      `[data-sheet-node="${safe}"]`,
    )
  }, [])

  const measure = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const host = hostRef.current
    if (host) {
      setContentSize({ width: host.scrollWidth, height: host.scrollHeight })
    }
    const stageRect = stage.getBoundingClientRect()
    const rectFor = (id: string | null): OverlayRect | null => {
      const element = findElement(id)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left - stageRect.left,
        top: rect.top - stageRect.top,
        width: rect.width,
        height: rect.height,
      }
    }
    setSelectionRect(rectFor(selectedRef.current))
    setHoverRect(rectFor(hoveredRef.current))
    const selected = findElement(selectedRef.current)
    if (!selected) {
      setComputed({})
      return
    }
    const style = getComputedStyle(selected)
    setComputed(Object.fromEntries(
      STYLE_GROUPS.flatMap((group) => group.properties).map((property) => [
        property,
        style.getPropertyValue(property),
      ]),
    ))
  }, [findElement])

  const scheduleMeasure = useCallback(() => {
    requestAnimationFrame(measure)
  }, [measure])

  const onMaterialize = useCallback((element: HTMLDivElement) => {
    hostRef.current = element
    requestAnimationFrame(measure)
  }, [measure])

  useEffect(() => {
    let active = true
    if (typeof orpc.preferences?.get === 'function') {
      void orpc.preferences.get().then((preferences) => {
        if (active) setShortcutConfig(normalizeConfig(preferences.shortcuts))
      }).catch(() => undefined)
    }
    const stop = subscribeCanvasChanges(designId, (announcedRevision) => {
      if (announcedRevision <= revisionRef.current || pendingSavesRef.current.length > 0) return
      void orpc.webCanvas.get({
        designId,
        ...(draftId ? { draftId } : {}),
      }).then((latest) => {
        if (!active || latest.status !== 'ready' || latest.revision <= revisionRef.current) return
        revisionRef.current = latest.revision
        documentRef.current = latest.document
        setDocument(latest.document)
        setHistory([])
        setRedo([])
        const selected = selectedRef.current
        if (selected && !latest.document.nodes[selected]) {
          selectedRef.current = latest.document.roots[0] ?? null
          setSelectedId(selectedRef.current)
        }
        setSaveStatus('saved')
        scheduleMeasure()
      }).catch(() => undefined)
    })
    return () => {
      active = false
      stop()
    }
  }, [designId, draftId, scheduleMeasure])

  const select = useCallback((id: string | null) => {
    selectedRef.current = id
    setSelectedId(id)
    setPageSelected(false)
    scheduleMeasure()
  }, [scheduleMeasure])

  const hover = useCallback((id: string | null) => {
    hoveredRef.current = id
    setHoveredId(id)
    scheduleMeasure()
  }, [scheduleMeasure])

  const flushSaves = useCallback(async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaveStatus('saving')
    while (pendingSavesRef.current.length > 0) {
      const pending = pendingSavesRef.current[0]
      if (!pending) break
      try {
        const saved = await orpc.webCanvas.applyTransaction({
          designId,
          ...(draftId ? { draftId } : {}),
          expectedRevision: revisionRef.current,
          transaction: pending.transaction,
        })
        revisionRef.current = saved.revision
        pendingSavesRef.current.shift()
        if (pendingSavesRef.current.length === 0 && documentRef.current === pending.snapshot) {
          documentRef.current = saved.document
          setDocument(saved.document)
        }
      } catch (error) {
        setNotice(`Save failed. Edits remain in this window; keep it open and retry. ${error instanceof Error ? error.message : ''}`)
        setSaveStatus('error')
        savingRef.current = false
        return
      }
    }
    savingRef.current = false
    setSaveStatus('saved')
    scheduleMeasure()
  }, [designId, draftId, scheduleMeasure])

  const saveTransaction = useCallback((
    transaction: WebTransaction,
    options: { recordHistory?: boolean } = {},
  ) => {
    let local: ReturnType<typeof applyWebTransaction>
    try {
      local = applyWebTransaction(documentRef.current, transaction)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Transaction is invalid')
      setSaveStatus('error')
      scheduleMeasure()
      return false
    }
    documentRef.current = local.document
    setDocument(local.document)
    scheduleMeasure()
    if (options.recordHistory !== false) {
      setHistory((current) => [...current, local.inverse])
      setRedo([])
    }
    pendingSavesRef.current.push({ transaction, snapshot: local.document })
    if (pendingSavesRef.current.length === 1 && !savingRef.current) {
      setNotice(null)
      void flushSaves()
    }
    return true
  }, [flushSaves, scheduleMeasure])

  const transact = useCallback((label: string, operations: WebTransaction['operations']) => {
    void saveTransaction({ id: webId('webtx'), label, operations })
  }, [saveTransaction])

  const patchRule = useCallback((stylesheetId: string, id: string, patch: WebRulePatch) => {
    transact('Edit stylesheet rule', [{
      type: 'rule.patch',
      stylesheetId,
      id,
      patch,
    }])
  }, [transact])

  const setSelectedOverride = useCallback((override: WebOverride) => {
    const id = selectedRef.current
    const bound = id ? boundNodeIndex(documentRef.current.instances).get(id) : undefined
    if (!id || !bound) return
    transact('Override instance', [{
      type: 'instance.setOverride',
      instanceId: bound.instanceId,
      id,
      override,
    }])
  }, [transact])

  const clearSelectedOverride = useCallback(() => {
    const id = selectedRef.current
    const bound = id ? boundNodeIndex(documentRef.current.instances).get(id) : undefined
    if (!id || !bound) return
    transact('Clear override', [{
      type: 'instance.clearOverride',
      instanceId: bound.instanceId,
      id,
    }])
  }, [transact])

  const deleteSelectedInstance = useCallback(() => {
    const id = selectedRef.current
    if (!id) return
    const record = Object.values(documentRef.current.instances).find(
      (instance) => instance.rootId === id,
    )
    if (!record) return
    selectedRef.current = documentRef.current.nodes[id]?.parentId ?? null
    setSelectedId(selectedRef.current)
    transact('Delete instance', [{ type: 'instance.delete', id: record.id }])
  }, [transact])

  const defineComponentFromSelection = useCallback(() => {
    const id = selectedRef.current
    const source = id ? documentRef.current.nodes[id] : null
    if (!id || source?.kind !== 'element') {
      setNotice('Select an element to define a component from it.')
      return
    }
    const bound = boundNodeIndex(documentRef.current.instances)
    const subtree = collectSubtreeIds(documentRef.current, id)
    if (subtree.some((nodeId) => bound.has(nodeId))) {
      setNotice('Components cannot be defined from instance content. Define from ordinary nodes.')
      return
    }
    const compName = window.prompt('Component name', source.tag) ?? ''
    if (!compName.trim()) return
    const template = cloneSubtreeFresh(documentRef.current, id)
    const sheet = createWebStyleSheet(`component:${compName.trim()}`, {})
    transact(`Define ${compName.trim()}`, [{
      type: 'component.define',
      component: {
        id: webId('component'),
        name: compName.trim(),
        templateRootIds: [template[0]?.id ?? id],
        stylesheetId: sheet.id,
      },
      template,
      stylesheet: sheet,
    }])
  }, [transact])

  const instantiateSelectedComponent = useCallback((componentId: string) => {
    if (!componentId) return
    const selected = selectedRef.current
      ? documentRef.current.nodes[selectedRef.current]
      : null
    const parentId = selected?.kind === 'element'
      ? selected.id
      : (selected?.parentId ?? documentRef.current.roots[0] ?? null)
    transact('Create instance', [{
      type: 'instance.create',
      componentId,
      parentId,
      order: nextOrder(documentRef.current, parentId),
    }])
  }, [transact])

  const selectedNode = pageSelected ? null : selectedId ? document.nodes[selectedId] ?? null : null
  const matchingRules = matchingAuthoredRules(findElement(selectedId), document)
  const selectedBinding = selectedId ? boundNodeIndex(document.instances).get(selectedId) : undefined
  const selectedRecord = selectedBinding ? document.instances[selectedBinding.instanceId] : undefined
  const bound: BoundInspectorInfo | null = selectedBinding && selectedId
    ? {
      instanceId: selectedBinding.instanceId,
      componentName: selectedRecord
        ? (document.components[selectedRecord.componentId]?.name ?? selectedRecord.componentId)
        : selectedBinding.instanceId,
      isInstanceRoot: selectedRecord?.rootId === selectedId,
    }
    : null
  const selectedOverride = selectedBinding && selectedId
    ? document.instances[selectedBinding.instanceId]?.overrides[selectedId]
    : undefined
  const root = document.nodes[document.roots[0] ?? '']
  const authoredCanvasWidth = root?.kind === 'element' ? parsePxAuthored(root.styles.width) : null
  const authoredCanvasHeight = root?.kind === 'element' ? parsePxAuthored(root.styles.height) : null
  const canvasWidth = document.metadata.page?.width ?? Math.max(authoredCanvasWidth ?? 1_440, contentSize.width)
  const canvasHeight = document.metadata.page?.height ?? Math.max(authoredCanvasHeight ?? 900, contentSize.height)
  const fonts = useMemo(() => documentFonts(document), [document])
  const shortcutLabel = (id: BuiltInShortcutId) => formatBuiltInChord(id, shortcutConfig)

  const resizePage = useCallback((size: { width?: number; height?: number }) => {
    transact('Resize page', [{
      type: 'page.resize',
      width: size.width ?? canvasWidth,
      height: size.height ?? canvasHeight,
    }])
  }, [canvasWidth, canvasHeight, transact])

  const patchSelected = useCallback((patch: {
    tag?: string
    attributes?: Record<string, string | null>
    styles?: Record<string, string | null>
  }) => {
    const id = selectedRef.current
    const node = id ? documentRef.current.nodes[id] : null
    if (!id || node?.kind !== 'element') return
    transact('Edit CSS element', [{
      type: 'node.patch',
      id,
      patch: { kind: 'element', ...patch },
    }])
  }, [transact])

  const insertElement = useCallback((tag: (typeof ELEMENT_TAGS)[number], point?: { x: number; y: number }, frame = false, size?: { width: number; height: number }, attributes?: Record<string, string>) => {
    const selected = selectedRef.current
      ? documentRef.current.nodes[selectedRef.current]
      : null
    const parentId = point
      ? documentRef.current.roots[0] ?? null
      : selected?.kind === 'element'
        ? selected.id
        : (selected?.parentId ?? documentRef.current.roots[0] ?? null)
    const element = createWebElement(tag, {
      parentId,
      order: nextOrder(documentRef.current, parentId),
      attributes: attributes ?? (tag === 'input' ? { type: 'text' } : tag === 'img' ? { alt: '' } : {}),
      styles: {
        ...initialStyles(tag),
        ...(frame ? { background: 'transparent', border: '1px solid #888888' } : {}),
        ...(point ? { position: 'absolute', left: `${point.x}px`, top: `${point.y}px` } : {}),
        ...(size ? { width: `${size.width}px`, height: `${size.height}px` } : {}),
      },
    })
    const text = initialText(tag)
    const operations: WebTransaction['operations'] = [
      { type: 'node.insert', node: element },
    ]
    if (text) {
      operations.push({
        type: 'node.insert',
        node: createWebText(text, { parentId: element.id, order: 1_024 }),
      })
    }
    selectedRef.current = element.id
    setSelectedId(element.id)
    setPageSelected(false)
    transact(`Insert <${tag}>`, operations)
  }, [transact])

  const addElement = useCallback(() => insertElement('div'), [insertElement])

  const insertLibraryIcon = useCallback(async (icon: { library: IconLibrary; name: string }) => {
    const { iconNodes } = await import('@sheet/canvas/web-icons')
    const parentId = documentRef.current.roots[0] ?? null
    const nodes = iconNodes(icon.library, icon.name, {
      parentId,
      order: nextOrder(documentRef.current, parentId),
    })
    const svg = nodes?.[0]
    if (!nodes || !svg) {
      setNotice(`The ${icon.library} icon "${icon.name}" could not be found. Nothing was inserted.`)
      return
    }
    selectedRef.current = svg.id
    setSelectedId(svg.id)
    setPageSelected(false)
    transact(`Insert ${icon.name} icon`, nodes.map((node) => ({ type: 'node.insert' as const, node })))
    setTool('select')
    setLeftTab('design')
  }, [setTool, transact])

  const insertPenPath = useCallback((point: { x: number; y: number }, stroke?: { x: number; y: number }[]) => {
    const draft = penDraftRef.current
    if (draft && !stroke) {
      const points = [...draft.points, point]
      penDraftRef.current = { ...draft, points }
      transact('Extend pen path', [{
        type: 'node.patch', id: draft.pathId,
        patch: { kind: 'element', attributes: { d: points.map((p, index) => `${index ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') } },
      }])
      return
    }
    const parentId = documentRef.current.roots[0] ?? null
    const element = createWebElement('svg', {
      namespace: 'svg', parentId, order: nextOrder(documentRef.current, parentId),
      attributes: { viewBox: `0 0 ${canvasWidth} ${canvasHeight}` },
      styles: { width: `${canvasWidth}px`, height: `${canvasHeight}px`, position: 'absolute', left: '0', top: '0', 'pointer-events': 'none' },
    })
    const path = createWebElement('path', {
      namespace: 'svg', parentId: element.id, order: 1_024,
      attributes: { d: stroke && stroke.length > 1
        ? stroke.map((p, index) => `${index ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')
        : `M ${point.x} ${point.y} l 0.1 0.1`, fill: 'none', stroke: '#3b82f6', 'stroke-width': '3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    })
    penDraftRef.current = stroke ? null : { pathId: path.id, points: [point] }
    selectedRef.current = element.id
    setSelectedId(element.id)
    setPageSelected(false)
    transact('Insert pen path', [{ type: 'node.insert', node: element }, { type: 'node.insert', node: path }])
  }, [canvasWidth, canvasHeight, transact])

  const wrapInFlex = useCallback(() => {
    const id = selectedRef.current
    const node = id ? documentRef.current.nodes[id] : null
    if (!id || node?.kind !== 'element') return
    transact('Wrap in flex', [{
      type: 'node.patch',
      id,
      patch: {
        kind: 'element',
        styles: {
          display: 'flex',
          'flex-direction': node.styles['flex-direction'] || 'column',
          gap: node.styles.gap || '12px',
        },
      },
    }])
  }, [transact])

  const nudgeSelected = useCallback((dx: number, dy: number) => {
    const id = selectedRef.current
    const node = id ? documentRef.current.nodes[id] : null
    if (!id || node?.kind !== 'element') return
    const currentLeft = parsePxAuthored(node.styles.left)
    const currentTop = parsePxAuthored(node.styles.top)
    const nextLeft = `${(currentLeft ?? 0) + dx}px`
    const nextTop = `${(currentTop ?? 0) + dy}px`
    transact('Nudge element', [{
      type: 'node.patch',
      id,
      patch: { kind: 'element', styles: { left: nextLeft, top: nextTop } },
    }])
  }, [transact])

  const deleteSelected = useCallback(() => {
    const id = selectedRef.current
    if (!id) return
    const parentId = documentRef.current.nodes[id]?.parentId ?? null
    selectedRef.current = parentId
    setSelectedId(parentId)
    transact('Delete element', [{ type: 'node.delete', id }])
  }, [transact])

  const editText = useCallback((element: HTMLElement | SVGElement, id: string) => {
    const node = documentRef.current.nodes[id]
    if (node?.kind !== 'element') return
    const textNode = orderedWebChildren(documentRef.current, id).find(
      (child) => child.kind === 'text',
    )
    if (!textNode || !(element instanceof HTMLElement)) return
    const bound = boundNodeIndex(documentRef.current.instances).get(textNode.id)
    element.contentEditable = 'true'
    element.focus()
    const selection = window.getSelection()
    selection?.selectAllChildren(element)
    selection?.collapseToEnd()
    element.addEventListener('blur', () => {
      element.removeAttribute('contenteditable')
      const text = element.textContent ?? ''
      if (textNode.kind === 'text' && text !== textNode.text) {
        if (bound) {
          transact('Override text', [{
            type: 'instance.setOverride',
            instanceId: bound.instanceId,
            id: textNode.id,
            override: { kind: 'text', text },
          }])
          return
        }
        transact('Edit text', [{
          type: 'node.patch',
          id: textNode.id,
          patch: { kind: 'text', text },
        }])
      }
    }, { once: true })
  }, [transact])

  const startElementDrag = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    mode: 'move' | 'resize',
  ) => {
    const element = findElement(selectedRef.current)
    if (!element) return
    const node = selectedRef.current ? documentRef.current.nodes[selectedRef.current] : null
    const authored = node?.kind === 'element' ? node.styles : {}
    event.currentTarget.setPointerCapture(event.pointerId)
    const moveKind = mode === 'move'
      ? dragMoveKind(getComputedStyle(element).position)
      : undefined
    let authoredLeft = parsePxAuthored(authored.left)
    let authoredTop = parsePxAuthored(authored.top)
    let authoredWidth = parsePxAuthored(authored.width)
    let authoredHeight = parsePxAuthored(authored.height)
    if (mode === 'move' && moveKind === 'absolute' && (authoredLeft === null || authoredTop === null)) {
      const rect = element.getBoundingClientRect()
      const parentRect = element.parentElement?.getBoundingClientRect() ?? rect
      const zoom = cameraRef.current.zoom
      if (authoredLeft === null) authoredLeft = (rect.left - parentRect.left) / zoom
      if (authoredTop === null) authoredTop = (rect.top - parentRect.top) / zoom
    }
    if (
      mode === 'resize' &&
      selectedRef.current !== null &&
      documentRef.current.roots.includes(selectedRef.current) &&
      (authoredWidth === null || authoredHeight === null)
    ) {
      const rect = element.getBoundingClientRect()
      const zoom = cameraRef.current.zoom
      if (authoredWidth === null) authoredWidth = rect.width / zoom
      if (authoredHeight === null) authoredHeight = rect.height / zoom
    }
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      element,
      moveKind,
      authoredLeft,
      authoredTop,
      authoredWidth,
      authoredHeight,
    }
    event.preventDefault()
    event.stopPropagation()
  }, [findElement])

  const onDragMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !drag.element) return
    const dx = (event.clientX - drag.startX) / cameraRef.current.zoom
    const dy = (event.clientY - drag.startY) / cameraRef.current.zoom
    if (drag.mode === 'move' && drag.moveKind === 'reorder') {
      drag.element.style.transform = `translate(${dx}px, ${dy}px)`
    } else if (drag.mode === 'move') {
      if (drag.authoredLeft !== null) drag.element.style.left = `${drag.authoredLeft + dx}px`
      if (drag.authoredTop !== null) drag.element.style.top = `${drag.authoredTop + dy}px`
    } else {
      if (drag.authoredWidth !== null) {
        drag.element.style.width = `${Math.max(1, drag.authoredWidth + dx)}px`
      }
      if (drag.authoredHeight !== null) {
        drag.element.style.height = `${Math.max(1, drag.authoredHeight + dy)}px`
      }
    }
    measure()
  }, [measure])

  const finishElementDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !drag.element) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    const id = selectedRef.current
    if (!id) return
    if (drag.mode === 'move' && drag.moveKind === 'reorder') {
      const node = documentRef.current.nodes[id]
      const parentElement = drag.element.parentElement
      if (node && parentElement) {
        drag.element.style.transform = ''
        const parentStyle = getComputedStyle(parentElement)
        const axis = reorderAxis(parentStyle.display, parentStyle.flexDirection)
        const siblings = orderedWebChildren(documentRef.current, node.parentId).map((sibling) => {
          const target = sibling.id === id
            ? drag.element
            : parentElement.querySelector(
              `[data-sheet-node="${sibling.id.replace(/["\\]/g, '\\$&')}"]`,
            )
          const rect = target?.getBoundingClientRect()
          return {
            id: sibling.id,
            order: sibling.order,
            top: rect?.top ?? 0,
            left: rect?.left ?? 0,
            bottom: rect?.bottom ?? 0,
            right: rect?.right ?? 0,
          }
        })
        const order = computeReorderOrder(
          siblings,
          id,
          node.order,
          event.clientX,
          event.clientY,
          axis,
        )
        if (order !== null && order !== node.order) {
          transact('Reorder element', [{
            type: 'node.move',
            id,
            parentId: node.parentId,
            order,
          }])
          return
        }
        scheduleMeasure()
        return
      }
    }
    const zoom = cameraRef.current.zoom
    if (drag.mode === 'move' && drag.moveKind === 'absolute') {
      if (event.clientX === drag.startX && event.clientY === drag.startY) {
        drag.element.style.transform = ''
        scheduleMeasure()
        return
      }
      const committed = commitAbsoluteMove(
        { left: drag.authoredLeft ?? 0, top: drag.authoredTop ?? 0 },
        drag.startX,
        drag.startY,
        event.clientX,
        event.clientY,
        zoom,
      )
      drag.element.style.transform = ''
      transact('Move element', [{
        type: 'node.patch',
        id,
        patch: { kind: 'element', styles: { left: committed.left, top: committed.top } },
      }])
      return
    }
    if (drag.mode === 'resize') {
      const committed = commitResize(
        { width: drag.authoredWidth, height: drag.authoredHeight },
        drag.startX,
        drag.startY,
        event.clientX,
        event.clientY,
        zoom,
      )
      drag.element.style.transform = ''
      if (committed.width === undefined && committed.height === undefined) {
        const node = documentRef.current.nodes[id]
        const current = node?.kind === 'element' ? node.styles : {}
        setNotice(
          `Resize needs pixel width/height; current values are width: ${current.width ?? 'unset'}, height: ${current.height ?? 'unset'}.`,
        )
        scheduleMeasure()
        return
      }
      const styles: Record<string, string | null> = {}
      if (committed.width !== undefined) styles.width = committed.width
      if (committed.height !== undefined) styles.height = committed.height
      if (committed.declined.length > 0) {
        setNotice(`Resize skipped non-pixel ${committed.declined.join(' and ')}; no units were converted.`)
      }
      transact('Resize element', [{
        type: 'node.patch',
        id,
        patch: { kind: 'element', styles },
      }])
      return
    }
    drag.element.style.transform = ''
    scheduleMeasure()
  }, [transact, scheduleMeasure])

  const setNextCamera = useCallback((next: Camera) => {
    cameraRef.current = next
    setCamera(next)
    scheduleMeasure()
  }, [scheduleMeasure])

  const fitCamera = useCallback((width: number, height: number): Camera | null => {
    const stage = stageRef.current
    if (!stage || stage.clientWidth === 0 || stage.clientHeight === 0) return null
    const margin = 72
    const zoom = Math.min(
      1,
      Math.max(0.1, Math.min((stage.clientWidth - margin * 2) / width, (stage.clientHeight - margin * 2) / height)),
    )
    return {
      zoom,
      x: Math.round((stage.clientWidth - width * zoom) / 2),
      y: Math.round(Math.max(margin / 2, (stage.clientHeight - height * zoom) / 2)),
    }
  }, [])

  const pageSizeRef = useRef({ width: canvasWidth, height: canvasHeight })
  pageSizeRef.current = { width: canvasWidth, height: canvasHeight }

  const fitToView = useCallback(() => {
    const { width, height } = pageSizeRef.current
    setNextCamera(fitCamera(width, height) ?? { x: 320, y: 120, zoom: 0.75 })
  }, [fitCamera, setNextCamera])

  // Frame the page once the stage has a real size (never in a zero-size stage).
  useEffect(() => {
    const next = fitCamera(pageSizeRef.current.width, pageSizeRef.current.height)
    if (next) setNextCamera(next)
  }, [fitCamera, setNextCamera])

  // Overlays are measured against the stage, so any stage resize (window, panel toggle) must remeasure.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => scheduleMeasure())
    observer.observe(stage)
    return () => observer.disconnect()
  }, [scheduleMeasure])

  // Non-passive so pinch/ctrl+wheel zooms the canvas instead of the webview; plain wheel pans.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest('[role="toolbar"]')) return
      event.preventDefault()
      const current = cameraRef.current
      if (event.ctrlKey || event.metaKey) {
        const zoom = Math.min(4, Math.max(0.1, current.zoom * Math.exp(-event.deltaY * 0.002)))
        const rect = stage.getBoundingClientRect()
        const px = event.clientX - rect.left
        const py = event.clientY - rect.top
        const ratio = zoom / current.zoom
        setNextCamera({ zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio })
        return
      }
      setNextCamera({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [setNextCamera])

  const isPanningActive = tool === 'pan' || isSpacePanning

  const canvasPoint = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.round((event.clientX - rect.left - cameraRef.current.x) / cameraRef.current.zoom)),
      y: Math.max(0, Math.round((event.clientY - rect.top - cameraRef.current.y) / cameraRef.current.zoom)),
    }
  }

  const startDrawing = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isSpacePanning || tool === 'select' || tool === 'pan' || tool === 'image') return
    if (event.target instanceof Element && event.target.closest('button, [role="toolbar"], input, select, textarea')) return
    const start = canvasPoint(event)
    const next: DrawingDraft = { pointerId: event.pointerId, tool, start, end: start, points: [start] }
    drawingRef.current = next
    setDrawing(next)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const moveDrawing = (event: ReactPointerEvent<HTMLElement>) => {
    const draft = drawingRef.current
    if (!draft || draft.pointerId !== event.pointerId) return
    const end = canvasPoint(event)
    const next = { ...draft, end, points: draft.tool === 'pen' ? [...draft.points, end] : draft.points }
    drawingRef.current = next
    setDrawing(next)
  }

  const finishDrawing = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const draft = drawingRef.current
    if (!draft || draft.pointerId !== event.pointerId) return
    drawingRef.current = null
    setDrawing(null)
    event.currentTarget.releasePointerCapture(event.pointerId)
    suppressClickRef.current = true
    window.setTimeout(() => { suppressClickRef.current = false }, 0)
    if (cancelled) return
    const end = canvasPoint(event)
    if (draft.tool === 'pen') {
      insertPenPath(draft.start, [...draft.points, end])
      return
    }
    const width = Math.abs(end.x - draft.start.x)
    const height = Math.abs(end.y - draft.start.y)
    insertElement(
      draft.tool === 'text' ? 'p' : 'div',
      { x: Math.min(draft.start.x, end.x), y: Math.min(draft.start.y, end.y) },
      draft.tool === 'frame',
      width > 3 || height > 3 ? { width: Math.max(1, width), height: Math.max(1, height) } : undefined,
    )
  }

  const startPageResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>, pageCorner: 'nw' | 'ne' | 'sw' | 'se') => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      mode: 'page-resize', pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      authoredLeft: null, authoredTop: null,
      authoredWidth: canvasWidth, authoredHeight: canvasHeight,
      camera: cameraRef.current, pageCorner,
    }
    setPageResizePreview({ width: canvasWidth, height: canvasHeight })
    event.preventDefault()
    event.stopPropagation()
  }, [canvasWidth, canvasHeight])

  const pageSizeAtPointer = (drag: DragState, clientX: number, clientY: number) => {
    const corner = drag.pageCorner ?? 'se'
    const zoom = drag.camera?.zoom ?? cameraRef.current.zoom
    return {
      width: Math.max(1, Math.round(((drag.authoredWidth ?? 0) + (corner.endsWith('e') ? 1 : -1) * (clientX - drag.startX) / zoom) * 100) / 100),
      height: Math.max(1, Math.round(((drag.authoredHeight ?? 0) + (corner.startsWith('s') ? 1 : -1) * (clientY - drag.startY) / zoom) * 100) / 100),
    }
  }

  const movePageCamera = (drag: DragState, size: { width: number; height: number }) => {
    if (!drag.camera) return
    setNextCamera({
      ...drag.camera,
      x: drag.camera.x + (drag.pageCorner?.endsWith('w') ? ((drag.authoredWidth ?? 0) - size.width) * drag.camera.zoom : 0),
      y: drag.camera.y + (drag.pageCorner?.startsWith('n') ? ((drag.authoredHeight ?? 0) - size.height) * drag.camera.zoom : 0),
    })
  }

  const movePageResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (drag?.mode !== 'page-resize' || drag.pointerId !== event.pointerId) return
    const size = pageSizeAtPointer(drag, event.clientX, event.clientY)
    setPageResizePreview(size)
    movePageCamera(drag, size)
    event.stopPropagation()
  }

  const finishPageResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = dragRef.current
    if (drag?.mode !== 'page-resize' || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    setPageResizePreview(null)
    if (cancelled) {
      if (drag.camera) setNextCamera(drag.camera)
    } else {
      const size = pageSizeAtPointer(drag, event.clientX, event.clientY)
      movePageCamera(drag, size)
      resizePage(size)
    }
    event.stopPropagation()
  }, [resizePage, setNextCamera])

  const startPan = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!isPanningActive && event.button !== 1) return
    if (event.target instanceof Element && event.target.closest('button, [role="toolbar"], input, select, textarea')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      mode: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      authoredLeft: null,
      authoredTop: null,
      authoredWidth: null,
      authoredHeight: null,
      camera: cameraRef.current,
    }
    event.preventDefault()
  }, [isPanningActive])

  const movePan = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.mode !== 'pan' || drag.pointerId !== event.pointerId || !drag.camera) return
    setNextCamera({
      ...drag.camera,
      x: drag.camera.x + event.clientX - drag.startX,
      y: drag.camera.y + event.clientY - drag.startY,
    })
  }, [setNextCamera])

  const finishPan = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.mode !== 'pan' || drag.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }, [])

  const undo = useCallback(() => {
    const transaction = history.at(-1)
    if (!transaction) return
    const forward = applyWebTransaction(documentRef.current, transaction).inverse
    setHistory((current) => current.slice(0, -1))
    setRedo((current) => [...current, forward])
    void saveTransaction(
      { ...transaction, id: webId('webtx'), label: `Undo ${transaction.label}` },
      { recordHistory: false },
    )
  }, [history, saveTransaction])

  const redoLast = useCallback(() => {
    const transaction = redo.at(-1)
    if (!transaction) return
    const inverse = applyWebTransaction(documentRef.current, transaction).inverse
    setRedo((current) => current.slice(0, -1))
    setHistory((current) => [...current, inverse])
    void saveTransaction(
      { ...transaction, id: webId('webtx'), label: `Redo ${transaction.label}` },
      { recordHistory: false },
    )
  }, [redo, saveTransaction])

  // Global Keyboard Shortcuts handler
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return

      // Spacebar hold for temporary pan
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        setIsSpacePanning(true)
        return
      }

      const hit = matchShortcut(e, shortcutConfig)
      if (hit === 'tool.select') setTool('select')
      else if (hit === 'tool.hand') setTool('pan')
      else if (hit === 'tool.frame') setTool('frame')
      else if (hit === 'tool.box') setTool('box')
      else if (hit === 'tool.pen') setTool('pen')
      else if (hit === 'tool.text') setTool('text')
      else if (hit === 'tool.image') setTool('image')
      else if (hit === 'delete' && selectedRef.current) deleteSelected()
      else if (hit === 'escape') {
        if (selectedRef.current) select(null)
        else setTool('select')
      } else if (hit === 'undo') undo()
      else if (hit === 'redo') redoLast()
      else if (hit === 'zoomIn') {
        setNextCamera({ ...cameraRef.current, zoom: Math.min(4, cameraRef.current.zoom * 1.2) })
      } else if (hit === 'zoomOut') {
        setNextCamera({ ...cameraRef.current, zoom: Math.max(0.1, cameraRef.current.zoom / 1.2) })
      } else if (hit === 'zoomReset') {
        setNextCamera({ ...cameraRef.current, zoom: 1 })
      } else if (hit === 'zoomToFit') {
        fitToView()
      } else if (selectedRef.current && hit?.startsWith('nudge')) {
        const step = e.shiftKey ? 10 : 1
        const delta: Record<string, [number, number]> = {
          nudgeLeft: [-step, 0],
          nudgeRight: [step, 0],
          nudgeUp: [0, -step],
          nudgeDown: [0, step],
        }
        const [dx, dy] = delta[hit] ?? [0, 0]
        nudgeSelected(dx, dy)
      } else if (hit) {
        return
      } else {
        // Wrap in flex is a document-specific command, not a remappable toolbar tool.
        if (e.shiftKey && (e.key === 'A' || e.key === 'a') && !e.metaKey && !e.ctrlKey) {
          e.preventDefault()
          wrapInFlex()
        }
        return
      }
      e.preventDefault()
      return

    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePanning(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [deleteSelected, fitToView, insertElement, insertPenPath, nudgeSelected, redoLast, select, setNextCamera, shortcutConfig, undo, wrapInFlex])

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[2.5rem_minmax(0,1fr)] bg-background text-foreground font-sans antialiased">
      {/* Top Header Bar */}
      <header
        data-tauri-drag-region
        className="z-30 flex h-10 w-full min-w-0 shrink-0 select-none items-center gap-2 overflow-hidden border-b border-line bg-sidebar pe-3 ps-20"
      >
        <div className="flex min-w-0 items-center gap-2">
          {!leftPanelOpen ? (
            <button
              type="button"
              aria-label="Open layers panel"
              className="flex size-7 items-center justify-center rounded-lg border border-line bg-surface text-muted-foreground hover:bg-surface/80 hover:text-foreground transition-colors shadow-xs"
              onClick={() => setLeftPanelOpen(true)}
              title="Open layers panel"
            >
              <PanelLeftIcon className="size-3.5" />
            </button>
          ) : null}
          <DocumentTabBar activeDocument={{ id: designId, name: name || 'Untitled' }} />
        </div>

        {/* Draggable header area */}
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />

        {/* Notice alert if any */}
        {notice ? (
          <div className="flex min-w-0 max-w-[45%] shrink items-center">
            <span
              role="alert"
              className="min-w-0 truncate rounded bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive border border-destructive/20"
              title={notice}
            >
              {notice}
            </span>
            {pendingSavesRef.current.length > 0 && saveStatus === 'error' ? (
              <button type="button" className="ms-1 shrink-0 whitespace-nowrap rounded border border-line px-2 text-xs text-foreground" onClick={() => void flushSaves()}>Retry save</button>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Main Workspace Layout */}
      <div className={cn(
        'grid min-h-0 min-w-0',
        leftPanelOpen
          ? 'grid-cols-[clamp(13rem,20vw,17rem)_minmax(0,1fr)_clamp(15rem,22vw,19rem)]'
          : 'grid-cols-[minmax(0,1fr)_clamp(15rem,22vw,19rem)]',
      )}>
        {/* Left Sidebar: Pages, Layers, Theme */}
        {leftPanelOpen ? (
          <aside aria-label="Layers" className="flex min-h-0 min-w-0 flex-col overflow-hidden border-e border-line bg-surface">
            {/* Header: Scratchpad + Collapse button */}
            <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
              <div className="flex min-w-0 items-center gap-2">
                <File01Icon className="size-4 text-muted-foreground shrink-0" />
                <span className="min-w-0 truncate text-xs font-medium text-foreground">{name || 'Scratchpad'}</span>
              </div>
              <button
                type="button"
                aria-label="Toggle layers panel"
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                onClick={() => setLeftPanelOpen(false)}
              >
                <PanelLeftIcon className="size-3.5" />
              </button>
            </div>

            {/* Segmented control: Design | Theme */}
            <div className="m-2 grid shrink-0 grid-cols-4 rounded-lg border border-line bg-well p-0.5">
              {(['design', 'theme', 'assets', 'icons'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={cn(
                    'min-w-0 truncate rounded-md px-1 py-1 text-xs capitalize transition-all duration-150',
                    leftTab === tab
                      ? 'bg-surface text-foreground font-medium shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setLeftTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {leftTab === 'design' ? (
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {/* Pages Section */}
                <div className="border-b border-line">
                  <div className="flex h-8 items-center justify-between px-3 text-xs font-medium text-foreground">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setPagesOpen((open) => !open)}
                    >
                      <ChevronDownIcon className={cn('size-3 transition-transform', !pagesOpen && '-rotate-90')} />
                      <span>Pages</span>
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      onClick={() => insertElement('main')}
                      title="Add page"
                    >
                      <PlusIcon className="size-3.5" />
                    </button>
                  </div>
                  {pagesOpen ? (
                    <div className="px-2 pb-2">
                      <button
                        type="button"
                        className={cn(
                          'flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1 text-xs transition-colors',
                          pageSelected
                            ? 'border-line/80 bg-surface-2 font-medium text-foreground shadow-xs'
                            : 'border-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
                        )}
                        onClick={() => {
                          selectedRef.current = null
                          setSelectedId(null)
                          setPageSelected(true)
                          scheduleMeasure()
                        }}
                      >
                        <File01Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">Page 1</span>
                      </button>
                    </div>
                  ) : null}
                </div>

                {/* Layers Section */}
                <div className="px-2 py-2">
                  <div className="flex h-7 items-center justify-between px-1 text-xs font-medium text-muted-foreground">
                    <span>Layers</span>
                    <button
                      type="button"
                      aria-label="Add element"
                      className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      onClick={addElement}
                    >
                      <PlusIcon className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {document.roots.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-line p-4 text-center">
                        <p className="text-xs text-muted-foreground">Start with a page root.</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3 border-line bg-surface-2 text-xs text-foreground hover:bg-secondary"
                          aria-label="Create root element"
                          onClick={() => insertElement('main')}
                        >
                          <PlusIcon className="size-3.5" />
                          Create root
                        </Button>
                      </div>
                    ) : (
                      document.roots.map((id) => {
                        const node = document.nodes[id]
                        return node ? (
                          <WebTreeNode
                            key={id}
                            document={document}
                            node={node}
                            selectedId={selectedId}
                            onSelect={select}
                          />
                        ) : null
                      })
                    )}
                  </div>
                </div>

                {/* Components Section */}
                <div className="mt-2 flex items-center justify-between border-t border-line px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Components</span>
                  <button type="button" aria-label="Create component" title="Create component from selection" className="rounded p-1 hover:bg-secondary hover:text-foreground disabled:opacity-40" disabled={!selectedId} onClick={defineComponentFromSelection}>
                    <PlusIcon className="size-3.5" />
                  </button>
                </div>
                <div className="px-2 pb-3">
                  {Object.keys(document.components).length === 0 ? (
                    <p className="px-1 text-xs text-muted-foreground">Select an element to create a component.</p>
                  ) : (
                    <select
                      aria-label="Component"
                      defaultValue=""
                      className="h-8 w-full min-w-0 rounded-md border border-input bg-surface-2 px-2 text-xs text-foreground outline-none hover:border-line focus:border-ring"
                      onChange={(event) => {
                        if (event.target.value) {
                          instantiateSelectedComponent(event.target.value)
                          event.target.value = ''
                        }
                      }}
                    >
                      <option value="">Insert instance…</option>
                      {Object.values(document.components).map((component) => (
                        <option key={component.id} value={component.id}>
                          {component.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Fonts Section */}
                <div className="border-t border-line px-3 py-2 text-xs font-medium text-muted-foreground">Fonts</div>
                <div className="space-y-0.5 px-2 pb-3">
                  {fonts.length === 0 ? (
                    <p className="px-1 text-xs text-muted-foreground">No fonts set yet. Pick one in Typography.</p>
                  ) : fonts.map((font) => (
                    <div key={font.stack} className="flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/70">
                      <span className="min-w-0 truncate text-sm text-foreground" style={{ fontFamily: font.stack }} title={font.stack}>
                        {font.family}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{font.uses}×</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : leftTab === 'assets' ? (
              <AssetsPanel onInsert={(asset) => {
                insertElement('img', undefined, false, undefined, { src: assetSrc(asset), alt: asset.name })
                setLeftTab('design')
                setTool('select')
              }} />
            ) : leftTab === 'icons' ? (
              <IconsPanel onInsert={insertLibraryIcon} />
            ) : (
              /* Theme Tab */
              <div className="min-h-0 flex-1 overflow-y-auto flex flex-col">
                <div className="flex h-9 items-center justify-between border-b border-line px-3 text-xs text-muted-foreground">
                  <span>No tokens</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      title="Add token"
                      onClick={() => {
                        const sheet = createWebStyleSheet('theme:primary', {})
                        transact('Create token stylesheet', [{
                          type: 'stylesheet.insert',
                          stylesheet: sheet,
                        }])
                      }}
                    >
                      <PlusIcon className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Empty State */}
                <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                  <div className="mb-3 grid size-12 place-items-center rounded-xl border border-line bg-surface-2">
                    <LayoutGridIcon className="size-6 text-muted-foreground" />
                  </div>
                  <h4 className="text-sm font-medium text-foreground">Theme tokens</h4>
                  <p className="mt-1.5 max-w-[12.5rem] text-xs text-muted-foreground leading-relaxed">
                    Create tokens to get started, or explore the starter theme.
                  </p>
                  <div className="mt-5 w-full max-w-[11.25rem] space-y-2">
                    <button
                      type="button"
                      className="w-full rounded-lg border border-line bg-surface-2 hover:bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-colors shadow-xs"
                      onClick={() => {
                        const sheet = createWebStyleSheet('theme:primary', {})
                        transact('Create token stylesheet', [{
                          type: 'stylesheet.insert',
                          stylesheet: sheet,
                        }])
                      }}
                    >
                      Create token
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-lg bg-transparent hover:bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        const starterRule = createWebStyleRule(':root', {
                          '--font-sans': 'Inter, sans-serif',
                          '--color-primary': '#3b82f6',
                          '--radius-card': '12px',
                        })
                        const sheet = createWebStyleSheet('tokens:starter', {
                          rules: { [starterRule.id]: starterRule },
                          ruleOrder: [starterRule.id],
                        })
                        transact('Apply starter theme', [{
                          type: 'stylesheet.insert',
                          stylesheet: sheet,
                        }])
                      }}
                    >
                      Use starter theme
                    </button>
                  </div>
                </div>
              </div>
            )}

          </aside>
        ) : null}

        {/* Canvas Stage & Floating Toolbar */}
        <main
          ref={stageRef}
          className={cn(
            'relative min-h-0 flex-1 overflow-hidden bg-cx-canvas',
            isPanningActive ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
          )}
          onPointerDown={(event) => { startDrawing(event); if (!drawingRef.current) startPan(event) }}
          onPointerMove={(event) => { moveDrawing(event); movePan(event) }}
          onPointerUp={(event) => { finishDrawing(event); finishPan(event) }}
          onPointerCancel={(event) => { finishDrawing(event, true); finishPan(event) }}
          onClick={(event) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false
              return
            }
            const target = event.target
            if (!(target instanceof Element) || target.closest('[role="toolbar"], button, [role="button"]')) return
            if (tool === 'select') {
              select(pickTarget(documentRef.current, webNodeIdFromElement(target)))
              return
            }
            if (tool === 'pan') return
            const point = canvasPoint(event)
            if (tool === 'image') {
              setLeftPanelOpen(true)
              setLeftTab('assets')
              return
            }
            if (tool === 'pen') insertPenPath(point)
            else insertElement(tool === 'text' ? 'p' : 'div', point, tool === 'frame')
          }}
          onDoubleClick={(event) => {
            const target = event.target
            if (!(target instanceof Element)) return
            const id = webNodeIdFromElement(target)
            const element = id ? findElement(id) : null
            if (id && element) editText(element, id)
          }}
          onPointerOver={(event) => {
            const target = event.target
            if (!(target instanceof Element)) return
            hover(pickTarget(documentRef.current, webNodeIdFromElement(target)))
          }}
          onPointerLeave={() => hover(null)}
        >
          {/* Floating Vertical Toolbar (Image 2, 3, 4) */}
          <div
            role="toolbar"
            aria-label="Tools"
            className="absolute left-3 top-3 z-30 flex flex-col items-center gap-0.5 rounded-xl border border-line bg-surface/95 p-1 text-foreground shadow-lg backdrop-blur-md"
          >
            <WebToolButton
              label={`Select (${shortcutLabel('tool.select')})`}
              aria-label="Select"
              active={tool === 'select' && !isSpacePanning}
              onClick={() => setTool('select')}
            >
              <MousePointer2Icon className="size-4" />
            </WebToolButton>
            <WebToolButton
              label={`Hand (${shortcutLabel('tool.hand')})`}
              aria-label="Hand"
              active={tool === 'pan' || isSpacePanning}
              onClick={() => setTool('pan')}
            >
              <HandIcon className="size-4" />
            </WebToolButton>

            <div className="my-0.5 h-px w-5 bg-line" />

            <WebToolButton
              label={`Frame (${shortcutLabel('tool.frame')})`}
              aria-label="Frame"
              active={tool === 'frame'}
              onClick={() => setTool('frame')}
            >
              <FrameIcon className="size-4" />
            </WebToolButton>
            <WebToolButton
              label={`Rectangle (${shortcutLabel('tool.box')})`}
              aria-label="Rectangle"
              active={tool === 'box'}
              onClick={() => setTool('box')}
            >
              <SquareIcon className="size-4" />
            </WebToolButton>
            <WebToolButton
              label={`Pen (${shortcutLabel('tool.pen')})`}
              aria-label="Pen"
              active={tool === 'pen'}
              onClick={() => setTool('pen')}
            >
              <PenTool01Icon className="size-4" />
            </WebToolButton>
            <WebToolButton
              label={`Text (${shortcutLabel('tool.text')})`}
              aria-label="Text"
              active={tool === 'text'}
              onClick={() => setTool('text')}
            >
              <TypeIcon className="size-4" />
            </WebToolButton>

            {/* Quick insert (+) button */}
            <div className="relative">
              <WebToolButton
                label="Insert element (+)"
                aria-label="Insert element"
                active={quickInsertOpen}
                onClick={() => setQuickInsertOpen((open) => !open)}
              >
                <PlusCircleIcon className="size-4" />
              </WebToolButton>
              {quickInsertOpen ? (
                <div className="absolute left-full top-0 z-40 ms-2 w-36 rounded-lg border border-line bg-surface p-1 shadow-2xl z-40 text-foreground">
                  <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Insert element
                  </div>
                  <div className="max-h-[min(14rem,50vh)] space-y-0.5 overflow-y-auto">
                    {ELEMENT_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="flex w-full items-center justify-between rounded px-2 py-1 text-left font-mono text-xs text-foreground hover:bg-secondary"
                        onClick={() => {
                          insertElement(tag)
                          setQuickInsertOpen(false)
                        }}
                      >
                        <span>&lt;{tag}&gt;</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="my-0.5 h-px w-5 bg-line" />

            <WebToolButton
              label="Icon library"
              aria-label="Icon library"
              active={leftPanelOpen && leftTab === 'icons'}
              onClick={() => {
                setLeftPanelOpen(true)
                setLeftTab('icons')
              }}
            >
              <ComponentIcon className="size-4" />
            </WebToolButton>
            <WebToolButton
              label={`Image (${shortcutLabel('tool.image')})`}
              aria-label="Image"
              active={tool === 'image'}
              onClick={() => {
                setTool('image')
                setLeftPanelOpen(true)
                setLeftTab('assets')
              }}
            >
              <ImageIcon className="size-4" />
            </WebToolButton>
            <WebToolButton
              label="Fit canvas"
              aria-label="Fit canvas"
              onClick={fitToView}
            >
              <CropIcon className="size-4" />
            </WebToolButton>
          </div>

          {/* Rendered Document View */}
          <div
            data-testid="page-bounds"
            className={cn('absolute origin-top-left shadow-[0_4px_24px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.5)] rounded-xs', pageSelected && 'ring-2 ring-blue-500')}
            style={{
              width: pageResizePreview?.width ?? canvasWidth,
              height: pageResizePreview?.height ?? canvasHeight,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            }}
          >
            <WebDocumentView
              document={document}
              onMaterialize={onMaterialize}
              className="relative h-full w-full overflow-hidden"
            />
            {pageSelected ? (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
              <button
                key={corner}
                data-testid="page-corner"
                type="button"
                aria-label={corner === 'se' ? 'Resize page' : `Resize page from ${corner === 'nw' ? 'top left' : corner === 'ne' ? 'top right' : 'bottom left'}`}
                className={cn(
                  'pointer-events-auto absolute z-30 size-10 touch-none',
                  corner === 'nw' && '-left-5 -top-5 cursor-nwse-resize',
                  corner === 'ne' && '-right-5 -top-5 cursor-nesw-resize',
                  corner === 'sw' && '-bottom-5 -left-5 cursor-nesw-resize',
                  corner === 'se' && '-bottom-5 -right-5 cursor-nwse-resize',
                )}
                onPointerDown={(event) => startPageResize(event, corner)}
                onPointerMove={movePageResize}
                onPointerUp={finishPageResize}
                onPointerCancel={(event) => finishPageResize(event, true)}
              >
                <span className="pointer-events-none absolute inset-2 rounded-full border-2 border-blue-600 bg-white shadow-sm" />
              </button>
            )) : null}
          </div>

          {drawing ? (
            drawing.tool === 'pen' ? (
              <svg data-testid="drawing-preview" className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible" aria-hidden="true">
                <polyline
                  points={drawing.points.map((point) => `${camera.x + point.x * camera.zoom},${camera.y + point.y * camera.zoom}`).join(' ')}
                  fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            ) : (
              <div
                data-testid="drawing-preview"
                className="pointer-events-none absolute z-20 border border-blue-500 bg-blue-500/15"
                style={{
                  left: camera.x + Math.min(drawing.start.x, drawing.end.x) * camera.zoom,
                  top: camera.y + Math.min(drawing.start.y, drawing.end.y) * camera.zoom,
                  width: Math.max(1, Math.abs(drawing.end.x - drawing.start.x) * camera.zoom),
                  height: Math.max(1, Math.abs(drawing.end.y - drawing.start.y) * camera.zoom),
                }}
              />
            )
          ) : null}

          {/* Hover highlight */}
          {hoverRect && hoveredId !== selectedId ? (
            <div
              className="pointer-events-none absolute border border-sky-400"
              style={hoverRect}
            />
          ) : null}

          {/* Selection Rect & Handles (Image 4) */}
          {selectionRect ? (
            <div
              className="pointer-events-none absolute border border-blue-500"
              style={selectionRect}
            >
              {/* Corner anchors */}
              <div className="absolute -top-1 -left-1 size-2 rounded-xs border border-blue-500 bg-white pointer-events-none" />
              <div className="absolute -top-1 -right-1 size-2 rounded-xs border border-blue-500 bg-white pointer-events-none" />
              <div className="absolute -bottom-1 -left-1 size-2 rounded-xs border border-blue-500 bg-white pointer-events-none" />

              {/* Move handle */}
              {bound ? (
                <div className="pointer-events-auto absolute -top-5 left-0 max-w-48 truncate rounded-sm bg-violet-600 px-1.5 py-0.5 font-mono text-[10px] text-white">
                  {selectedNode ? nodeLabel(selectedNode) : ''} · instance
                </div>
              ) : (
                <div
                  className="pointer-events-auto absolute -top-5 left-0 max-w-48 cursor-move truncate rounded-sm bg-blue-500 px-1.5 py-0.5 font-mono text-[10px] text-white opacity-0 transition-opacity hover:opacity-100"
                  onPointerDown={(event) => startElementDrag(event, 'move')}
                  onPointerMove={onDragMove}
                  onPointerUp={finishElementDrag}
                  onPointerCancel={finishElementDrag}
                >
                  {selectedNode ? nodeLabel(selectedNode) : ''}
                </div>
              )}

              {/* Resize handle */}
              {bound ? null : (
                <div
                  role="button"
                  aria-label="Resize element"
                  tabIndex={0}
                  className="pointer-events-auto absolute -bottom-1 -right-1 size-2.5 cursor-nwse-resize rounded-xs border border-blue-600 bg-white"
                  onPointerDown={(event) => startElementDrag(event, 'resize')}
                  onPointerMove={onDragMove}
                  onPointerUp={finishElementDrag}
                  onPointerCancel={finishElementDrag}
                />
              )}

              {/* Dimensions badge at bottom center (Image 4: 512 × 512) */}
              <div className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-blue-600 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white shadow-md">
                {Math.round(selectionRect.width / camera.zoom)} × {Math.round(selectionRect.height / camera.zoom)}
              </div>
            </div>
          ) : null}
        </main>

        {/* Right Inspector Panel: Design (Image 2 & 4) */}
        <aside aria-label="Design" className="flex min-h-0 min-w-0 flex-col overflow-hidden border-s border-line bg-surface text-foreground">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3 text-xs font-medium text-foreground">
            <span>Design</span>
            <button
              type="button"
              disabled={!selectedId || saveStatus === 'saving'}
              className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none"
              onClick={deleteSelected}
              title="Delete element"
            >
              <Trash2Icon className="size-3.5" />
              <span className="sr-only">Delete selected element</span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <WebInspector
              node={selectedNode}
              geometry={selectionRect ? {
                left: (selectionRect.left - camera.x) / camera.zoom,
                top: (selectionRect.top - camera.y) / camera.zoom,
                width: selectionRect.width / camera.zoom,
                height: selectionRect.height / camera.zoom,
              } : null}
              computed={computed}
              matchingRules={matchingRules}
              bound={bound}
              override={selectedOverride}
              pageBackground={pageBackground}
              pageSize={pageResizePreview ?? { width: canvasWidth, height: canvasHeight }}
              fonts={fonts}
              onSetPageBackground={(color) => {
                setPageBackground(color)
                const id = documentRef.current.roots[0]
                if (id && documentRef.current.nodes[id]?.kind === 'element') {
                  transact('Set page background', [{ type: 'node.patch', id, patch: { kind: 'element', styles: { background: color } } }])
                }
              }}
              onResizePage={resizePage}
              onConnectAgent={() => setConnectAgentOpen(true)}
              onPatch={patchSelected}
              onPatchRule={patchRule}
              onSetOverride={setSelectedOverride}
              onClearOverride={clearSelectedOverride}
              onDeleteInstance={deleteSelectedInstance}
            />
          </div>
        </aside>
      </div>

      {/* Connect Agent Dialog */}
      <Dialog open={connectAgentOpen} onOpenChange={setConnectAgentOpen}>
        <DialogPopup className="max-w-xl border border-line bg-surface text-foreground">
          <DialogHeader>
            <DialogTitle className="text-base">Connect your agent</DialogTitle>
            <DialogDescription className="text-xs">
              Sheet runs a local MCP server. Pick your agent and follow the steps.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
            <ConnectAgent />
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
