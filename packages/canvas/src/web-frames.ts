import { createWebElement, orderedWebChildren, type WebDocument } from './web-model'
import { NAME_ATTRIBUTE } from './web-pages'

export type FramePreset = {
  name: string
  width: number
  height: number
}

export type FramePresetGroup = {
  id: 'phone' | 'tablet' | 'desktop' | 'presentation' | 'smartwatch' | 'paper' | 'social'
  label: string
  presets: readonly FramePreset[]
}

const sized = (name: string, width: number, height: number): FramePreset => ({ name, width, height })

/** The sizes the Frame tool offers, grouped by what the frame is for. Sizes are CSS px. */
export const FRAME_PRESET_GROUPS: readonly FramePresetGroup[] = [
  {
    id: 'phone',
    label: 'Phone',
    presets: [
      sized('iPhone 18 Pro', 402, 874),
      sized('iPhone 18 Pro Max', 440, 956),
      sized('iPhone Duo', 466, 678),
      sized('iPhone Duo unfolded', 890, 626),
      sized('iPhone 17', 402, 874),
      sized('iPhone Air', 420, 912),
      sized('iPhone 16', 393, 852),
      sized('iPhone 16 Plus', 430, 932),
      sized('iPhone 16e', 390, 844),
      sized('iPhone 13 mini', 375, 812),
      sized('iPhone SE', 375, 667),
      sized('Google Pixel 11', 412, 924),
      sized('Google Pixel 11 Pro', 410, 914),
      sized('Google Pixel 11 Pro XL', 448, 997),
      sized('Google Pixel 11 Pro Fold', 791, 820),
    ],
  },
  {
    id: 'tablet',
    label: 'Tablet',
    presets: [
      sized('iPad mini 8.3″', 744, 1133),
      sized('iPad Air 11″', 820, 1180),
      sized('iPad Air 13″', 1024, 1366),
      sized('iPad Pro 11″', 834, 1210),
      sized('iPad Pro 13″', 1032, 1376),
      sized('Google Pixel Tablet', 1280, 800),
      sized('Surface Pro 11', 1440, 960),
    ],
  },
  {
    id: 'desktop',
    label: 'Desktop',
    presets: [
      sized('MacBook Air', 1280, 832),
      sized('MacBook Pro 14″', 1512, 982),
      sized('MacBook Pro 16″', 1728, 1117),
      sized('iMac 24″', 2240, 1260),
      sized('Studio Display 27″', 2560, 1440),
      sized('Full HD', 1920, 1080),
      sized('Wireframe', 1440, 1024),
    ],
  },
  {
    id: 'presentation',
    label: 'Presentation',
    presets: [sized('Slide 16:9', 1920, 1080), sized('Slide 4:3', 1024, 768)],
  },
  {
    id: 'smartwatch',
    label: 'Smartwatch',
    presets: [
      sized('Apple Watch Ultra 3', 211, 257),
      sized('Apple Watch 46mm', 208, 248),
      sized('Apple Watch 45mm', 198, 242),
      sized('Apple Watch 44mm', 184, 224),
      sized('Apple Watch 42mm', 187, 223),
      sized('Apple Watch 41mm', 176, 215),
      sized('Apple Watch 40mm', 162, 197),
    ],
  },
  {
    id: 'paper',
    label: 'Paper',
    presets: [
      sized('A4', 595, 842),
      sized('A5', 420, 595),
      sized('A6', 297, 420),
      sized('Letter', 612, 792),
      sized('Tabloid', 792, 1224),
    ],
  },
  {
    id: 'social',
    label: 'Social media',
    presets: [
      sized('X post', 1200, 675),
      sized('X header', 1500, 500),
      sized('Facebook post', 1200, 630),
      sized('Facebook cover', 820, 312),
      sized('Instagram post', 1080, 1350),
      sized('Instagram square', 1080, 1080),
      sized('Instagram story', 1080, 1920),
      sized('Dribbble shot', 1600, 1200),
      sized('LinkedIn cover', 1584, 396),
      sized('YouTube thumbnail', 1280, 720),
    ],
  },
]

/** A preset by name, ignoring case and surrounding space; `null` when there is none. */
export function findFramePreset(name: string): FramePreset | null {
  const wanted = name.trim().toLowerCase()
  for (const group of FRAME_PRESET_GROUPS) {
    const hit = group.presets.find((preset) => preset.name.toLowerCase() === wanted)
    if (hit) return hit
  }
  return null
}

/** The size of a frame made without a preset. */
export const NEW_FRAME_SIZE = { width: 320, height: 240 } as const

const FRAME_GAP = 48
const FIRST_FRAME_ORIGIN = { x: 80, y: 80 } as const

function pixels(value: string | undefined) {
  const match = value?.trim().match(/^(-?\d+(?:\.\d+)?)px$/)
  return match ? Number(match[1]) : null
}

/**
 * Where the next top-level frame goes: one gap to the right of the rightmost
 * positioned child, level with the highest, so frames line up in a row instead
 * of stacking on each other. An empty page starts a margin in from the corner.
 */
export function freeFrameSpot(document: WebDocument, parentId: string | null) {
  let right: number | null = null
  let top: number | null = null
  for (const child of orderedWebChildren(document, parentId)) {
    if (child.kind !== 'element' || child.styles.position !== 'absolute') continue
    const left = pixels(child.styles.left)
    const width = pixels(child.styles.width)
    if (left === null || width === null) continue
    right = Math.max(right ?? Number.NEGATIVE_INFINITY, left + width)
    top = Math.min(top ?? Number.POSITIVE_INFINITY, pixels(child.styles.top) ?? 0)
  }
  return right === null
    ? { ...FIRST_FRAME_ORIGIN }
    : { x: right + FRAME_GAP, y: top ?? FIRST_FRAME_ORIGIN.y }
}

export interface FrameOptions {
  parentId: string | null
  order: number
  name: string
  width: number
  height: number
  left: number
  top: number
}

/**
 * A frame as the editor makes one: a white, free-positioned box with a name,
 * which the person can move and resize. The editor's size list and the agent
 * tools both build frames here, so a frame is the same thing either way.
 */
export function frameNode(options: FrameOptions) {
  return createWebElement('div', {
    parentId: options.parentId,
    order: options.order,
    attributes: { [NAME_ATTRIBUTE]: options.name },
    styles: {
      position: 'absolute',
      left: `${options.left}px`,
      top: `${options.top}px`,
      width: `${options.width}px`,
      height: `${options.height}px`,
      background: '#ffffff',
      overflow: 'hidden',
    },
  })
}
