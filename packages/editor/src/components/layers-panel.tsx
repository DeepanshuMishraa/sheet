import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { PanelBottomIcon, PanelRightIcon } from '@sheet/ui/icons'
import {
  ComponentIcon,
  File01Icon,
  ImageIcon,
  LayoutGridIcon,
  PanelLeftIcon,
  PlusIcon,
  ShapesIcon,
  TypeIcon,
} from '@sheet/ui/icons'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FrameIcon,
  GripVerticalIcon,
  LockIcon,
  SearchIcon,
  SquareIcon,
  UnlockIcon,
} from '@sheet/ui/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sheet/ui/dropdown-menu'
import {
  useCanvasDocument,
  useCanvasReadOnly,
  useCanvasSelection,
  useCanvasSession,
  useCanvasTransaction,
} from '@sheet/canvas/react'
import {
  buildChildIndex,
  canvasId,
  orderedChildren,
  type CanvasChildIndex,
  type CanvasDocument,
  type CanvasNode,
  type DesignToken,
  type NodePatch,
  type NodeRef,
} from '@sheet/canvas/model'
import {
  preconditionsForNodeMove,
  type CanvasOperation,
} from '@sheet/canvas/engine'
import { Button } from '@sheet/ui/button'
import { cn } from '@sheet/ui/utils'

export type CanvasReorderDirection = 'forward' | 'front' | 'backward' | 'back'
export type CanvasPanelPosition = 'left' | 'right' | 'bottom'

export type DropPosition = 'before' | 'after' | 'inside'

const ORDER_STEP = 1024
const AUTO_SCROLL_EDGE = 40
const AUTO_SCROLL_MAX = 14
const CONTAINERS = new Set(['page', 'component', 'frame', 'group'])

/**
 * Where a pointer sitting `ratio` down a row wants to drop. Containers keep a
 * middle band that means "put it inside"; everything else only reorders.
 */
export function dropPositionFor(node: CanvasNode, ratio: number): DropPosition {
  if (!CONTAINERS.has(node.type)) return ratio < 0.5 ? 'before' : 'after'
  if (ratio < 0.28) return 'before'
  if (ratio > 0.72) return 'after'
  return 'inside'
}

function isDescendant(
  document: CanvasDocument,
  candidateId: string | null,
  ancestorId: string,
) {
  let current = candidateId
  while (current) {
    if (current === ancestorId) return true
    current = document.nodes[current]?.parentId ?? null
  }
  return false
}

/**
 * The parent and order a drop resolves to, or null when the move is not legal:
 * dropping a node into itself or its own subtree, moving a Page off the
 * document root, dropping into something that cannot hold children, or a drag
 * that would leave the tree exactly as it was.
 */
export interface DropPlan {
  parentId: string | null
  moves: { id: string; order: number }[]
}

/** Selected ids that do not already travel inside another selected subtree. */
export function dragRoots(document: CanvasDocument, ids: string[]) {
  const wanted = ids.filter((id) => document.nodes[id])
  const selected = new Set(wanted)
  return wanted.filter((id) => {
    let parentId = document.nodes[id]?.parentId ?? null
    while (parentId) {
      if (selected.has(parentId)) return false
      parentId = document.nodes[parentId]?.parentId ?? null
    }
    return true
  })
}

/** Orders that place `count` nodes between two neighbours, or past the last one. */
function ordersBetween(before: number | undefined, after: number | undefined, count: number) {
  if (before === undefined && after === undefined) {
    return Array.from({ length: count }, (_, index) => (index + 1) * ORDER_STEP)
  }
  if (after === undefined) {
    return Array.from({ length: count }, (_, index) => before! + (index + 1) * ORDER_STEP)
  }
  if (before === undefined) {
    return Array.from(
      { length: count },
      (_, index) => after - (count - index) * ORDER_STEP,
    )
  }
  const step = (after - before) / (count + 1)
  return Array.from({ length: count }, (_, index) => before + step * (index + 1))
}

export function resolveDrop(
  document: CanvasDocument,
  draggedIds: string[],
  targetId: string,
  position: DropPosition,
  childIndex?: CanvasChildIndex,
): DropPlan | null {
  const target = document.nodes[targetId]
  const dragging = dragRoots(document, draggedIds)
  if (!target || dragging.length === 0 || dragging.includes(targetId)) return null
  if (position === 'inside' && !CONTAINERS.has(target.type)) return null

  const parentId = position === 'inside' ? target.id : target.parentId
  if (parentId) {
    const parent = document.nodes[parentId]
    if (!parent || !CONTAINERS.has(parent.type)) return null
  }
  for (const id of dragging) {
    const dragged = document.nodes[id]!
    if (dragged.locked) return null
    const isRootType = dragged.type === 'page' || dragged.type === 'component'
    if (isRootType !== (parentId === null)) return null
    // Re-parenting a node under itself would detach the subtree from the tree.
    if (parentId && isDescendant(document, parentId, id)) return null
  }

  // Dragged nodes keep their relative order, wherever they came from.
  const moving = new Set(dragging)
  const ordered = dragging
    .map((id) => document.nodes[id]!)
    .sort((left, right) => left.order - right.order)
  const siblings = orderedChildren(document, parentId, childIndex).filter(
    (node) => !moving.has(node.id),
  )

  if (position === 'inside') {
    const unchanged =
      siblings.length === 0 && ordered.every((node) => node.parentId === parentId)
    if (unchanged) return null
    const orders = ordersBetween(siblings.at(-1)?.order, undefined, ordered.length)
    return {
      parentId,
      moves: ordered.map((node, index) => ({ id: node.id, order: orders[index]! })),
    }
  }

  const index = siblings.findIndex((node) => node.id === targetId)
  if (index === -1) return null
  const insertAt = position === 'before' ? index : index + 1
  const alreadyThere =
    ordered.every((node) => node.parentId === parentId) &&
    insertAt ===
      siblings.filter((node) => node.order < ordered[0]!.order).length &&
    ordered.every(
      (node, offset) =>
        offset === 0 ||
        // Contiguous already: nothing sits between the dragged nodes.
        !siblings.some(
          (sibling) =>
            sibling.order > ordered[offset - 1]!.order && sibling.order < node.order,
        ),
    )
  if (alreadyThere) return null

  const orders = ordersBetween(
    siblings[insertAt - 1]?.order,
    siblings[insertAt]?.order,
    ordered.length,
  )
  return {
    parentId,
    moves: ordered.map((node, index) => ({ id: node.id, order: orders[index]! })),
  }
}

function keyFor(ref: NodeRef) {
  return ref.instancePath.length > 0
    ? `${ref.instancePath.join('/')}:${ref.nodeId}`
    : ref.nodeId
}

function nodeIcon(node: CanvasNode) {
  if (node.type === 'text') return TypeIcon
  if (node.type === 'image') return ImageIcon
  if (node.type === 'component' || node.type === 'instance') return ComponentIcon
  if (node.type === 'vector') return ShapesIcon
  if (node.type === 'frame' && node.layout.mode === 'flex') return LayoutGridIcon
  return FrameIcon
}

interface LayerDragHandlers {
  draggedIds: string[]
  target: { id: string; position: DropPosition } | null
  onStart: (node: CanvasNode, event: DragEvent<HTMLDivElement>) => void
  onEnd: () => void
  onOver: (event: DragEvent<HTMLDivElement>, node: CanvasNode) => void
  onLeave: (node: CanvasNode) => void
  onDrop: (event: DragEvent<HTMLDivElement>, node: CanvasNode) => void
}

function patchOperation(ref: NodeRef, patch: NodePatch): CanvasOperation {
  const instanceId = ref.instancePath.at(-1)
  return instanceId
    ? {
        type: 'instance.patchOverride',
        id: instanceId,
        targetId: ref.nodeId,
        patch,
      }
    : { type: 'node.patch', id: ref.nodeId, patch }
}

const DEFAULT_THEME_TOKENS: DesignToken[] = [
  // Color
  { id: 'color-ink', name: 'color-ink', type: 'color', value: '#121214' },
  { id: 'color-muted', name: 'color-muted', type: 'color', value: '#6b7280' },
  { id: 'color-line', name: 'color-line', type: 'color', value: '#ffffff' },
  { id: 'color-wash', name: 'color-wash', type: 'color', value: '#fafafa' },
  { id: 'color-primary', name: 'color-primary', type: 'color', value: '#15803d' },
  { id: 'color-accent', name: 'color-accent', type: 'color', value: '#d97706' },
  { id: 'color-pine', name: 'color-pine', type: 'color', value: '#143823' },
  { id: 'color-emerald', name: 'color-emerald', type: 'color', value: '#10b981' },
  { id: 'color-brass', name: 'color-brass', type: 'color', value: '#b4832c' },
  { id: 'color-cream', name: 'color-cream', type: 'color', value: '#fef3c7' },
  { id: 'color-glass', name: 'color-glass', type: 'color', value: '#a1a1aa' },
  { id: 'lime', name: 'lime', type: 'color', value: '#a3e635' },
  { id: 'ink-black', name: 'ink-black', type: 'color', value: '#09090b' },
  { id: 'dark-card', name: 'dark-card', type: 'color', value: '#18181b' },
  { id: 'dark-line', name: 'dark-line', type: 'color', value: '#27272a' },
  { id: 'light-ground', name: 'light-ground', type: 'color', value: '#ffffff' },

  // Radius
  { id: 'radius-lg', name: 'radius-lg', type: 'number', value: 20 },
  { id: 'radius-md', name: 'radius-md', type: 'number', value: 14 },
  { id: 'radius-pill', name: 'radius-pill', type: 'number', value: 100 },
  { id: 'radius-card', name: 'radius-card', type: 'number', value: 28 },
  { id: 'radius-sm', name: 'radius-sm', type: 'number', value: 8 },

  // Spacing
  { id: 'spacing-md', name: 'spacing-md', type: 'number', value: 16 },
  { id: 'spacing-lg', name: 'spacing-lg', type: 'number', value: 24 },
  { id: 'spacing-sm', name: 'spacing-sm', type: 'number', value: 12 },
  { id: 'spacing-xl', name: 'spacing-xl', type: 'number', value: 32 },

  // Font family
  { id: 'font-sans', name: 'font-sans', type: 'font', value: 'Inter' },
  { id: 'font-mono', name: 'font-mono', type: 'font', value: 'monospace' },

  // Opacity
  { id: 'opacity-dim', name: 'opacity-dim', type: 'number', value: 0.5 },
  { id: 'opacity-ghost', name: 'opacity-ghost', type: 'number', value: 0.2 },
]

function OpacityIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="2" width="6" height="6" fill="currentColor" />
      <rect x="8" y="8" width="6" height="6" fill="currentColor" />
      <rect x="8" y="2" width="6" height="6" fill="currentColor" opacity="0.25" />
      <rect x="2" y="8" width="6" height="6" fill="currentColor" opacity="0.25" />
    </svg>
  )
}

function RadiusIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 5.5V3.5A1 1 0 0 1 3.5 2.5h2M10.5 2.5h2a1 1 0 0 1 1 1v2M2.5 10.5v2a1 1 0 0 0 1 1h2M10.5 13.5h2a1 1 0 0 0 1-1v-2" />
    </svg>
  )
}

function SpacingIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 12L12 4M12 4H7M12 4V9" />
    </svg>
  )
}

function ContainerIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <line x1="8" y1="2" x2="8" y2="14" />
    </svg>
  )
}

function BreakpointIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
      <path d="M6 14h4M8 11v3" />
    </svg>
  )
}

function FontFamilyIcon({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex size-3.5 items-center justify-center font-serif italic text-xs select-none leading-none', className)}>
      ℱ
    </span>
  )
}

function FontWeightIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M5.5 10.5L8 4l2.5 6.5M6.2 8.5h3.6" strokeWidth="1.5" />
      <path d="M3 13.5h10M3 13.5l1.5-1.5M3 13.5l1.5 1.5M13 13.5l-1.5-1.5M13 13.5l-1.5 1.5" strokeWidth="1" />
    </svg>
  )
}

function FontSizeIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M7 11.5L9.5 5 12 11.5M7.7 9.5h3.6" strokeWidth="1.5" />
      <path d="M3.5 3v10M3.5 3L2 4.5M3.5 3L5 4.5M3.5 13L2 11.5M3.5 13L5 11.5" strokeWidth="1" />
    </svg>
  )
}

function LineHeightIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <line x1="3" y1="2.5" x2="13" y2="2.5" strokeWidth="1.5" />
      <path d="M5.5 11.5L8 5l2.5 6.5M6.2 9.5h3.6" strokeWidth="1.5" />
      <line x1="3" y1="13.5" x2="13" y2="13.5" strokeWidth="1.5" />
    </svg>
  )
}

function LetterSpacingIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5 shrink-0', className)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <line x1="2.5" y1="3" x2="2.5" y2="13" strokeWidth="1.5" />
      <path d="M5.5 11.5L8 5l2.5 6.5M6.2 9.5h3.6" strokeWidth="1.5" />
      <line x1="13.5" y1="3" x2="13.5" y2="13" strokeWidth="1.5" />
    </svg>
  )
}

function getTokenCategory(token: DesignToken): string {
  const name = token.name.toLowerCase()
  if (token.type === 'color' || name.startsWith('color') || name.includes('ink') || name.includes('lime') || name.includes('card') || name.includes('ground') || name.includes('line') || (typeof token.value === 'string' && (token.value.startsWith('#') || token.value.startsWith('rgb')))) {
    return 'Color'
  }
  if (name.startsWith('radius')) return 'Radius'
  if (name.startsWith('spacing')) return 'Spacing'
  if (name.startsWith('font-family') || name === 'font-sans' || name === 'font-mono' || name === 'font-serif' || token.type === 'font') return 'Font family'
  if (name.startsWith('font-weight')) return 'Font weight'
  if (name.startsWith('font-size')) return 'Font size'
  if (name.startsWith('line-height')) return 'Line height'
  if (name.startsWith('letter-spacing')) return 'Letter spacing'
  if (name.startsWith('opacity')) return 'Opacity'
  if (name.startsWith('container')) return 'Container'
  if (name.startsWith('breakpoint')) return 'Breakpoint'
  return 'Other'
}

function ThemeTokensView() {
  const document = useCanvasDocument()
  const transact = useCanvasTransaction()
  const readOnly = useCanvasReadOnly()
  const [showSearch, setShowSearch] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => new Set())

  const tokens = useMemo(() => {
    const docTokens = Object.values(document.tokens)
    return docTokens.length > 0 ? docTokens : DEFAULT_THEME_TOKENS
  }, [document.tokens])

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const handleAddToken = (kind: string) => {
    if (readOnly) return
    const id = canvasId('token')
    const initialOps: CanvasOperation[] = Object.keys(document.tokens).length === 0
      ? DEFAULT_THEME_TOKENS.map((tok) => ({ type: 'token.upsert', token: tok }))
      : []

    let newToken: DesignToken
    switch (kind) {
      case 'color':
        newToken = { id, name: `color-${tokens.filter((t) => t.type === 'color').length + 1}`, type: 'color', value: '#3b82f6' }
        break
      case 'opacity':
        newToken = { id, name: `opacity-${Date.now().toString(36).slice(-3)}`, type: 'number', value: 0.8 }
        break
      case 'radius':
        newToken = { id, name: `radius-${Date.now().toString(36).slice(-3)}`, type: 'number', value: 8 }
        break
      case 'spacing':
        newToken = { id, name: `spacing-${Date.now().toString(36).slice(-3)}`, type: 'number', value: 16 }
        break
      case 'container':
        newToken = { id, name: `container-${Date.now().toString(36).slice(-3)}`, type: 'number', value: 1200 }
        break
      case 'breakpoint':
        newToken = { id, name: `breakpoint-${Date.now().toString(36).slice(-3)}`, type: 'number', value: 768 }
        break
      case 'font-family':
        newToken = { id, name: `font-${Date.now().toString(36).slice(-3)}`, type: 'font', value: 'Inter' }
        break
      case 'font-weight':
        newToken = { id, name: `font-weight-${Date.now().toString(36).slice(-3)}`, type: 'number', value: 500 }
        break
      case 'font-size':
        newToken = { id, name: `font-size-${Date.now().toString(36).slice(-3)}`, type: 'number', value: 16 }
        break
      case 'line-height':
        newToken = { id, name: `line-height-${Date.now().toString(36).slice(-3)}`, type: 'number', value: 24 }
        break
      case 'letter-spacing':
        newToken = { id, name: `letter-spacing-${Date.now().toString(36).slice(-3)}`, type: 'number', value: 0 }
        break
      default:
        newToken = { id, name: `token-${Date.now().toString(36).slice(-3)}`, type: 'color', value: '#3b82f6' }
    }

    transact({
      id: canvasId('tx'),
      label: `Add ${newToken.name} token`,
      operations: [...initialOps, { type: 'token.upsert', token: newToken }],
    })
  }

  const categories = useMemo(() => {
    const map = new Map<string, DesignToken[]>()
    const order = ['Color', 'Radius', 'Spacing', 'Font family', 'Opacity', 'Container', 'Breakpoint', 'Font weight', 'Font size', 'Line height', 'Letter spacing', 'Other']
    for (const cat of order) map.set(cat, [])
    for (const token of tokens) {
      if (search && !token.name.toLowerCase().includes(search.toLowerCase())) continue
      const cat = getTokenCategory(token)
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(token)
    }
    return Array.from(map.entries()).filter(([_, items]) => items.length > 0)
  }, [tokens, search])

  const renderTokenIcon = (token: DesignToken) => {
    const cat = getTokenCategory(token)
    if (cat === 'Color') {
      return (
        <span
          className="size-4 shrink-0 rounded border border-white/10"
          style={{ backgroundColor: String(token.value) }}
        />
      )
    }
    if (cat === 'Radius') return <RadiusIcon className="text-muted-foreground" />
    if (cat === 'Spacing') return <SpacingIcon className="text-muted-foreground" />
    if (cat === 'Font family') return <FontFamilyIcon className="text-muted-foreground" />
    if (cat === 'Opacity') return <OpacityIcon className="text-muted-foreground" />
    if (cat === 'Container') return <ContainerIcon className="text-muted-foreground" />
    if (cat === 'Breakpoint') return <BreakpointIcon className="text-muted-foreground" />
    if (cat === 'Font weight') return <FontWeightIcon className="text-muted-foreground" />
    if (cat === 'Font size') return <FontSizeIcon className="text-muted-foreground" />
    if (cat === 'Line height') return <LineHeightIcon className="text-muted-foreground" />
    if (cat === 'Letter spacing') return <LetterSpacingIcon className="text-muted-foreground" />
    return <SquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="text-xs text-muted-foreground font-normal">
          {tokens.length} tokens
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowSearch(!showSearch)}
            className={cn(
              'flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground',
              showSearch && 'bg-surface-2 text-foreground',
            )}
            aria-label="Search tokens"
            title="Search tokens"
          >
            <SearchIcon className="size-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-md bg-surface-2 text-muted-foreground transition-colors hover:bg-surface-2/80 hover:text-foreground"
                aria-label="Add token"
                title="Add token"
              >
                <PlusIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 p-1 bg-surface border border-line shadow-lg rounded-lg">
              <DropdownMenuItem onClick={() => handleAddToken('color')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <SquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span>Color</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddToken('opacity')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <OpacityIcon className="text-muted-foreground" />
                <span>Opacity</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddToken('radius')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <RadiusIcon className="text-muted-foreground" />
                <span>Radius</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1 border-t border-line" />

              <DropdownMenuItem onClick={() => handleAddToken('spacing')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <SpacingIcon className="text-muted-foreground" />
                <span>Spacing</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddToken('container')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <ContainerIcon className="text-muted-foreground" />
                <span>Container</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddToken('breakpoint')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <BreakpointIcon className="text-muted-foreground" />
                <span>Breakpoint</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1 border-t border-line" />

              <DropdownMenuItem onClick={() => handleAddToken('font-family')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <FontFamilyIcon className="text-muted-foreground" />
                <span>Font family</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddToken('font-weight')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <FontWeightIcon className="text-muted-foreground" />
                <span>Font weight</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddToken('font-size')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <FontSizeIcon className="text-muted-foreground" />
                <span>Font size</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddToken('line-height')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <LineHeightIcon className="text-muted-foreground" />
                <span>Line height</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddToken('letter-spacing')} className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-surface-2">
                <LetterSpacingIcon className="text-muted-foreground" />
                <span>Letter spacing</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showSearch && (
        <div className="px-3 pb-2 pt-0.5">
          <input
            autoFocus
            type="text"
            placeholder="Search tokens..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {/* Categories & Tokens List */}
      <div className="flex-1 overflow-y-auto pb-4">
        {categories.map(([category, items]) => {
          const isCollapsed = collapsedCategories.has(category)
          return (
            <div key={category} className="mb-2">
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                className="flex h-7 w-full items-center gap-1.5 px-3 text-left text-xs font-medium text-foreground hover:bg-surface-2/40 transition-colors select-none"
              >
                {isCollapsed ? (
                  <ChevronRightIcon className="size-3 text-muted-foreground" />
                ) : (
                  <ChevronDownIcon className="size-3 text-muted-foreground" />
                )}
                <span>{category}</span>
              </button>
              {!isCollapsed && (
                <div className="flex flex-col">
                  {items.map((token) => {
                    const isColor = getTokenCategory(token) === 'Color'
                    return (
                      <div
                        key={token.id}
                        className="group flex h-7 items-center justify-between px-3 text-xs hover:bg-surface-2/60 transition-colors"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {renderTokenIcon(token)}
                          <span className="truncate text-xs text-foreground font-normal">
                            {token.name}
                          </span>
                        </div>
                        {!isColor && (
                          <span className="shrink-0 text-xs text-muted-foreground font-normal">
                            {String(token.value)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CanvasLayersPanel({
  documentName,
  onReorder: _onReorder,
  canReorder: _canReorder = false,
  onAddPage,
  position = 'left',
  onPositionChange,
  onClose,
  onTokensOpen: _onTokensOpen,
}: {
  documentName?: string
  onReorder?: (direction: CanvasReorderDirection) => void
  canReorder?: boolean
  onAddPage?: () => void
  position?: CanvasPanelPosition
  onPositionChange?: (position: CanvasPanelPosition) => void
  onClose?: () => void
  onTokensOpen?: () => void
}) {
  const document = useCanvasDocument()
  const selection = useCanvasSelection()
  const session = useCanvasSession()
  const transact = useCanvasTransaction()
  const readOnly = useCanvasReadOnly()
  const [sidebarTab, setSidebarTab] = useState<'design' | 'theme'>('design')
  const [pagesOpen, setPagesOpen] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(Object.values(document.nodes).filter((node) => node.type === 'page').map((node) => node.id)),
  )
  const [draggedIds, setDraggedIds] = useState<string[]>([])
  const listRef = useRef<HTMLDivElement | null>(null)
  const autoScroll = useRef(0)
  const scrollFrame = useRef<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    position: DropPosition
  } | null>(null)
  const query = ''
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const search = query.trim().toLowerCase()
  // LayerRow walks the whole expanded tree. Building this once keeps that
  // traversal linear instead of making every row rescan every document node.
  const childIndex = useMemo(() => buildChildIndex(document), [document])
  const matches = useMemo(
    () =>
      search
        ? Object.values(document.nodes).filter((node) =>
            node.name.toLowerCase().includes(search),
          )
        : [],
    [document, search],
  )
  const roots = useMemo(
    () =>
      orderedChildren(document, null, childIndex).filter(
        (node) => node.type === 'page',
      ),
    [childIndex, document],
  )
  const components = useMemo(
    () =>
      orderedChildren(document, null, childIndex).filter(
        (node) => node.type === 'component',
      ),
    [childIndex, document],
  )

  const pages = roots
  const [activePageId, setActivePageId] = useState<string>('')
  const currentActivePageId = activePageId || pages[0]?.id || ''
  const activePage = pages.find((p) => p.id === currentActivePageId) ?? pages[0] ?? null
  const pageLayers = useMemo(
    () =>
      activePage
        ? orderedChildren(document, activePage.id, childIndex)
        : roots,
    [activePage, childIndex, document, roots],
  )

  const selectedKeys = useMemo(
    () => new Set(selection.map((ref) => keyFor(ref))),
    [selection],
  )

  /** Cmd or Ctrl adds to the selection, so a group can be dragged at once. */
  const selectLayer = (ref: NodeRef, additive: boolean) => {
    if (!additive) {
      session.select([ref])
      return
    }
    const key = keyFor(ref)
    const next = selection.filter((current) => keyFor(current) !== key)
    session.select(next.length === selection.length ? [...selection, ref] : next)
  }

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Hovering a collapsed container opens it, so a drag can reach nested layers.
  useEffect(() => {
    if (!dropTarget || dropTarget.position !== 'inside') return
    if (expanded.has(dropTarget.id)) return
    const timer = window.setTimeout(() => {
      setExpanded((current) => new Set(current).add(dropTarget.id))
    }, 600)
    return () => window.clearTimeout(timer)
  }, [dropTarget, expanded])

  const endDrag = () => {
    setDraggedIds([])
    setDropTarget(null)
    autoScroll.current = 0
  }

  /**
   * Dragging past either edge of the list scrolls it, so a layer can be moved
   * somewhere the drag started too far away to reach.
   */
  const runAutoScroll = () => {
    scrollFrame.current = null
    const list = listRef.current
    if (!list || autoScroll.current === 0) return
    list.scrollTop += autoScroll.current
    scrollFrame.current = requestAnimationFrame(runAutoScroll)
  }

  const onListDragOver = (event: DragEvent<HTMLDivElement>) => {
    const list = listRef.current
    if (!list || draggedIds.length === 0) return
    const rect = list.getBoundingClientRect()
    const above = event.clientY - rect.top
    const below = rect.bottom - event.clientY
    const speed = (distance: number) =>
      Math.ceil(((AUTO_SCROLL_EDGE - distance) / AUTO_SCROLL_EDGE) * AUTO_SCROLL_MAX)
    autoScroll.current =
      above < AUTO_SCROLL_EDGE
        ? -speed(Math.max(0, above))
        : below < AUTO_SCROLL_EDGE
          ? speed(Math.max(0, below))
          : 0
    if (autoScroll.current !== 0 && scrollFrame.current === null) {
      scrollFrame.current = requestAnimationFrame(runAutoScroll)
    }
  }

  const onRowDragOver = (
    event: DragEvent<HTMLDivElement>,
    node: CanvasNode,
  ) => {
    if (draggedIds.length === 0 || readOnly) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
    const position = dropPositionFor(node, ratio)
    if (!resolveDrop(document, draggedIds, node.id, position, childIndex)) {
      // No drop effect, so the row reads as rejected instead of silently eating
      // the drag.
      setDropTarget(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget((current) =>
      current?.id === node.id && current.position === position
        ? current
        : { id: node.id, position },
    )
  }

  const onRowDrop = (event: DragEvent<HTMLDivElement>, node: CanvasNode) => {
    event.preventDefault()
    const target = dropTarget
    const dragging = draggedIds
    endDrag()
    if (dragging.length === 0 || readOnly || !target || target.id !== node.id) return
    const plan = resolveDrop(
      document,
      dragging,
      node.id,
      target.position,
      childIndex,
    )
    if (!plan) return
    const first = document.nodes[plan.moves[0]!.id]
    transact({
      id: canvasId('tx'),
      label:
        plan.moves.length > 1
          ? `Move ${plan.moves.length} layers`
          : target.position === 'inside'
            ? `Move ${first?.name ?? 'layer'} into ${node.name}`
            : `Reorder ${first?.name ?? 'layer'}`,
      preconditions: plan.moves.flatMap((move) =>
        preconditionsForNodeMove(document, move.id),
      ),
      operations: plan.moves.map((move) => ({
        type: 'node.move' as const,
        id: move.id,
        parentId: plan.parentId,
        order: move.order,
      })),
    })
    if (plan.parentId) {
      setExpanded((current) => new Set(current).add(plan.parentId!))
    }
  }

  const dragHandlers: LayerDragHandlers = {
    draggedIds,
    target: dropTarget,
    onStart: (node, event) => {
      // Grabbing a row that is part of the selection drags the whole selection.
      const selectedIds = selection
        .filter((ref) => ref.instancePath.length === 0)
        .map((ref) => ref.nodeId)
      const ids = dragRoots(
        document,
        selectedIds.includes(node.id) ? selectedIds : [node.id],
      )
      setDraggedIds(ids)
      // Firefox refuses to start a drag without payload on the transfer.
      event.dataTransfer.setData('text/plain', ids.join(','))
      event.dataTransfer.effectAllowed = 'move'
    },
    onEnd: endDrag,
    onOver: onRowDragOver,
    onLeave: (node) =>
      setDropTarget((current) => (current?.id === node.id ? null : current)),
    onDrop: onRowDrop,
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-surface">
      {/* Header: Document Title & Collapse Button */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-2">
          <File01Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium text-foreground">
            {documentName || document.name || 'Untitled'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onPositionChange ? (
            <>
              <Button
                size="icon-xs"
                variant={position === 'left' ? 'secondary' : 'ghost'}
                aria-label="Move layers panel to left"
                aria-pressed={position === 'left'}
                title="Dock left"
                onClick={() => onPositionChange('left')}
              >
                <PanelLeftIcon />
              </Button>
              <Button
                size="icon-xs"
                variant={position === 'bottom' ? 'secondary' : 'ghost'}
                aria-label="Move layers panel to bottom"
                aria-pressed={position === 'bottom'}
                title="Dock bottom"
                onClick={() => onPositionChange('bottom')}
              >
                <PanelBottomIcon />
              </Button>
              <Button
                size="icon-xs"
                variant={position === 'right' ? 'secondary' : 'ghost'}
                aria-label="Move layers panel to right"
                aria-pressed={position === 'right'}
                title="Dock right"
                onClick={() => onPositionChange('right')}
              >
                <PanelRightIcon />
              </Button>
            </>
          ) : null}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Segmented Switcher: Design | Theme */}
      <div className="border-b border-line p-2">
        <div className="flex rounded-lg bg-surface-2 p-0.5">
          <button
            type="button"
            onClick={() => setSidebarTab('design')}
            className={cn(
              'flex-1 rounded-md py-1 text-center text-xs font-medium transition-colors',
              sidebarTab === 'design'
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Design
          </button>
          <button
            type="button"
            onClick={() => setSidebarTab('theme')}
            className={cn(
              'flex-1 rounded-md py-1 text-center text-xs font-medium transition-colors',
              sidebarTab === 'theme'
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Theme
          </button>
        </div>
      </div>

      {sidebarTab === 'theme' ? (
        <ThemeTokensView />
      ) : (
        <>
          {/* Pages Section */}
          <div className="border-b border-line py-1">
            <div className="flex h-7 items-center justify-between px-3">
              <button
                type="button"
                onClick={() => setPagesOpen(!pagesOpen)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {pagesOpen ? (
                  <ChevronDownIcon className="size-3" />
                ) : (
                  <ChevronRightIcon className="size-3" />
                )}
                <span>Pages</span>
              </button>
              {onAddPage && (
                <button
                  type="button"
                  onClick={onAddPage}
                  disabled={readOnly}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                  aria-label="New page"
                  title="New page"
                >
                  <PlusIcon className="size-3" />
                </button>
              )}
            </div>
            {pagesOpen && (
              <div className="flex flex-col gap-0.5 px-2 pb-1 pt-0.5">
                {pages.map((page) => {
                  const isSelected = activePage?.id === page.id
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => {
                        setActivePageId(page.id)
                        session.select([{ nodeId: page.id, instancePath: [] }])
                      }}
                      onContextMenu={() => {
                        setActivePageId(page.id)
                        session.select([{ nodeId: page.id, instancePath: [] }])
                      }}
                      className={cn(
                        'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                        isSelected
                          ? 'bg-surface-2 font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-surface-2/60 hover:text-foreground',
                      )}
                    >
                      <File01Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{page.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Layers Tree */}
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto py-1"
            onDragOver={onListDragOver}
            onDragLeave={() => {
              autoScroll.current = 0
            }}
            onDrop={() => {
              autoScroll.current = 0
            }}
          >
            {search ? (
              matches.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No matches
                </p>
              ) : (
                matches.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className={cn(
                      'flex h-7 w-full items-center gap-1.5 px-3 text-left text-xs',
                      selection[0]?.nodeId === node.id
                        ? 'bg-secondary text-foreground'
                        : 'hover:bg-secondary/60',
                    )}
                    onClick={() =>
                      session.select([{ nodeId: node.id, instancePath: [] }])
                    }
                    onContextMenu={() =>
                      session.select([{ nodeId: node.id, instancePath: [] }])
                    }
                  >
                    {(() => {
                      const Icon = nodeIcon(node)
                      return <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    })()}
                    <span className="truncate">{node.name}</span>
                  </button>
                ))
              )
            ) : (roots.length === 0 && components.length === 0) ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No layers yet
              </p>
            ) : null}
            {search ? null : (pageLayers.length > 0 ? pageLayers : roots).map((node) => (
              <LayerRow
                key={node.id}
                node={node}
                refValue={{ nodeId: node.id, instancePath: [] }}
                depth={0}
                document={document}
                childIndex={childIndex}
                selectedKeys={selectedKeys}
                expanded={expanded}
                onToggle={toggle}
                onSelect={selectLayer}
                onPatch={(ref, patch) =>
                  !readOnly && transact({
                    id: canvasId('tx'),
                    label: `Update ${document.nodes[ref.nodeId]?.name ?? 'node'}`,
                    operations: [patchOperation(ref, patch)],
                  })
                }
                drag={dragHandlers}
                readOnly={readOnly}
                renamingKey={renamingKey}
                onRenamingKeyChange={setRenamingKey}
              />
            ))}
            {!search && components.length > 0 ? (
              <section className="mt-2 border-t pt-1">
                <p className="px-3 py-1 text-xs text-muted-foreground">
                  Components
                </p>
                {components.map((node) => (
                  <LayerRow
                    key={node.id}
                    node={node}
                    refValue={{ nodeId: node.id, instancePath: [] }}
                    depth={0}
                    document={document}
                    childIndex={childIndex}
                    selectedKeys={selectedKeys}
                    expanded={expanded}
                    onToggle={toggle}
                    onSelect={selectLayer}
                    onPatch={(ref, patch) =>
                      !readOnly && transact({
                        id: canvasId('tx'),
                        label: `Update ${document.nodes[ref.nodeId]?.name ?? 'node'}`,
                        operations: [patchOperation(ref, patch)],
                      })
                    }
                    drag={dragHandlers}
                    readOnly={readOnly}
                    renamingKey={renamingKey}
                    onRenamingKeyChange={setRenamingKey}
                  />
                ))}
              </section>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function LayerRow({
  node,
  refValue,
  depth,
  document,
  childIndex,
  selectedKeys,
  expanded,
  onToggle,
  onSelect,
  onPatch,
  drag,
  readOnly,
  renamingKey,
  onRenamingKeyChange,
}: {
  node: CanvasNode
  refValue: NodeRef
  depth: number
  document: ReturnType<typeof useCanvasDocument>
  childIndex: CanvasChildIndex
  selectedKeys: Set<string>
  expanded: Set<string>
  onToggle: (key: string) => void
  onSelect: (ref: NodeRef, additive: boolean) => void
  onPatch: (ref: NodeRef, patch: NodePatch) => void
  drag: LayerDragHandlers
  readOnly: boolean
  renamingKey: string | null
  onRenamingKeyChange: (key: string | null) => void
}) {
  const session = useCanvasSession()
  const instance =
    node.type === 'instance' ? node : null
  const component =
    instance ? document.nodes[instance.componentId] : null
  const childParentId =
    component?.type === 'component' ? component.id : node.id
  const children = ['page', 'component', 'frame', 'group', 'instance'].includes(node.type)
    ? orderedChildren(document, childParentId, childIndex)
    : []
  const childPath =
    instance ? [...refValue.instancePath, instance.id] : refValue.instancePath
  const key = keyFor(refValue)
  const open = expanded.has(key)
  const Icon = nodeIcon(node)
  const sourceDraggable = refValue.instancePath.length === 0
  const dropTarget =
    drag.target?.id === node.id && sourceDraggable ? drag.target.position : null
  const dropEdge = dropTarget === 'inside' ? null : dropTarget
  const dropInside = dropTarget === 'inside'
  return (
    <>
      <div
        className={cn(
          'group relative flex h-7 items-center gap-0.5 pe-1 text-xs',
          selectedKeys.has(key)
            ? 'bg-secondary text-foreground'
            : 'hover:bg-secondary/60',
          drag.draggedIds.includes(node.id) && 'opacity-40',
          dropInside && 'bg-cx-accent/12 ring-1 ring-cx-accent ring-inset',
        )}
        style={{ paddingInlineStart: 4 + depth * 14 }}
        draggable={sourceDraggable && !readOnly}
        onDragStart={(event) => drag.onStart(node, event)}
        onDragEnd={drag.onEnd}
        onDragOver={(event) => sourceDraggable && drag.onOver(event, node)}
        onDragLeave={() => drag.onLeave(node)}
        onDrop={(event) => drag.onDrop(event, node)}
        onContextMenu={(event) =>
          onSelect(refValue, event.metaKey || event.ctrlKey)
        }
      >
        {dropEdge ? (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 h-0.5 bg-cx-accent',
              dropEdge === 'before' ? 'top-0' : 'bottom-0',
            )}
          />
        ) : null}
        {sourceDraggable ? (
          <GripVerticalIcon className="size-3 shrink-0 cursor-grab opacity-0 group-hover:opacity-50" />
        ) : (
          <span className="w-3" />
        )}
        {children.length > 0 ? (
          <button
            type="button"
            className="grid size-5 shrink-0 place-items-center rounded hover:bg-secondary"
            aria-label={open ? 'Collapse layer' : 'Expand layer'}
            onClick={() => onToggle(key)}
          >
            {open ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
          </button>
        ) : (
          // A leaf still needs the indent, but not a hoverable button that does nothing.
          <span className="size-5 shrink-0" />
        )}
        {renamingKey === key ? (
          <input
            autoFocus
            defaultValue={node.name}
            aria-label={`Rename ${node.name}`}
            className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim()
              if (name && name !== node.name) onPatch(refValue, { name })
              onRenamingKeyChange(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = node.name
                event.currentTarget.blur()
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => onSelect(refValue, event.metaKey || event.ctrlKey)}
            onDoubleClick={(event) => {
              // Alt keeps the old isolation gesture; a plain double-click renames.
              if (event.altKey && children.length > 0) {
                onSelect(refValue, false)
                session.setEditingRoot(refValue)
                onToggle(key)
                return
              }
              if (!readOnly) onRenamingKeyChange(key)
            }}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{node.name}</span>
            {node.type === 'instance' ? (
                <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                Instance
              </span>
            ) : null}
          </button>
        )}
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded opacity-0 hover:bg-secondary group-hover:opacity-100"
          aria-label={node.hidden ? 'Show layer' : 'Hide layer'}
          disabled={readOnly}
          onClick={() => onPatch(refValue, { hidden: !node.hidden })}
        >
          {node.hidden ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
        </button>
        <button
          type="button"
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded hover:bg-secondary',
            !node.locked && 'opacity-0 group-hover:opacity-100',
          )}
          aria-label={node.locked ? 'Unlock layer' : 'Lock layer'}
          disabled={readOnly}
          onClick={() => onPatch(refValue, { locked: !node.locked })}
        >
          {node.locked ? <LockIcon className="size-3" /> : <UnlockIcon className="size-3" />}
        </button>
      </div>
      {open
        ? children.map((child) => (
            <LayerRow
              key={`${childPath.join('/')}:${child.id}`}
              node={child}
              refValue={{ nodeId: child.id, instancePath: childPath }}
              depth={depth + 1}
              document={document}
              childIndex={childIndex}
              selectedKeys={selectedKeys}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onPatch={onPatch}
              drag={drag}
              readOnly={readOnly}
              renamingKey={renamingKey}
              onRenamingKeyChange={onRenamingKeyChange}
            />
          ))
        : null}
    </>
  )
}
