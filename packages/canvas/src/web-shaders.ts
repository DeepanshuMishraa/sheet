import {
  defaultObjectSizing,
  getShaderColorFromString,
  grainGradientFragmentShader,
  GrainGradientShapes,
  meshGradientFragmentShader,
  ShaderFitOptions,
  ShaderMount,
  staticMeshGradientFragmentShader,
  swirlFragmentShader,
  type ShaderMountUniforms,
} from '@paper-design/shaders'
import {
  createWebElement,
  type WebElementNode,
  type WebNode,
  type WebOperation,
} from './web-model'

export const SHADER_NAME_ATTRIBUTE = 'data-shader'
export const SHADER_PARAMS_ATTRIBUTE = 'data-shader-params'

const MAX_COLORS = 10
const MAX_COLOR_LENGTH = 64

type NumberSpec = { kind: 'number'; min: number; max: number; default: number }
type ColorSpec = { kind: 'color'; default: string }
type ColorsSpec = { kind: 'colors'; default: readonly string[] }
type EnumSpec = { kind: 'enum'; options: readonly string[]; default: string }
type ParamSpec = NumberSpec | ColorSpec | ColorsSpec | EnumSpec
type ParamSpecs = Readonly<Record<string, ParamSpec>>

export type ShaderParamValue = number | string | string[]
export type ShaderParams = Record<string, ShaderParamValue>

const num = (min: number, max: number, value: number): NumberSpec => ({ kind: 'number', min, max, default: value })
const colors = (value: readonly string[]): ColorsSpec => ({ kind: 'colors', default: value })
const color = (value: string): ColorSpec => ({ kind: 'color', default: value })

/** Every param is read as a number, color or enum member and clamped, never passed through raw. */
interface ShaderDefinition {
  label: string
  description: string
  params: ParamSpecs
  fragmentShader: string
  uniforms: (params: ShaderParams) => ShaderMountUniforms
}

const numberParam = (params: ShaderParams, key: string) => {
  const value = params[key]
  return typeof value === 'number' ? value : 0
}
const colorList = (params: ShaderParams, key: string) => {
  const value = params[key]
  return Array.isArray(value) ? value : []
}
const colorParam = (params: ShaderParams, key: string) => {
  const value = params[key]
  return typeof value === 'string' ? value : '#000000'
}

const sizingUniforms = () => ({
  u_fit: ShaderFitOptions[defaultObjectSizing.fit],
  u_rotation: defaultObjectSizing.rotation,
  u_scale: defaultObjectSizing.scale,
  u_offsetX: defaultObjectSizing.offsetX,
  u_offsetY: defaultObjectSizing.offsetY,
  u_originX: defaultObjectSizing.originX,
  u_originY: defaultObjectSizing.originY,
  u_worldWidth: defaultObjectSizing.worldWidth,
  u_worldHeight: defaultObjectSizing.worldHeight,
})

const colorUniforms = (params: ShaderParams) => {
  const list = colorList(params, 'colors')
  return { u_colors: list.map(getShaderColorFromString), u_colorsCount: list.length }
}

export const SHADERS = {
  'mesh-gradient': {
    label: 'Mesh gradient',
    description: 'Flowing color spots moving along distinct trajectories with organic distortion.',
    params: {
      speed: num(-4, 4, 1),
      colors: colors(['#e0eaff', '#241d9a', '#f75092', '#9f50d3']),
      distortion: num(0, 1, 0.8),
      swirl: num(0, 1, 0.1),
      grainMixer: num(0, 1, 0),
      grainOverlay: num(0, 1, 0),
    },
    fragmentShader: meshGradientFragmentShader,
    uniforms: (params) => ({
      ...sizingUniforms(),
      ...colorUniforms(params),
      u_distortion: numberParam(params, 'distortion'),
      u_swirl: numberParam(params, 'swirl'),
      u_grainMixer: numberParam(params, 'grainMixer'),
      u_grainOverlay: numberParam(params, 'grainOverlay'),
    }),
  },
  'static-mesh-gradient': {
    label: 'Static mesh gradient',
    description: 'Multi-point mesh gradient with two-direction warping. Renders one still frame.',
    params: {
      speed: num(-4, 4, 0),
      colors: colors(['#ffad0a', '#6200ff', '#e2a3ff', '#ff99fd']),
      positions: num(0, 100, 2),
      waveX: num(0, 1, 1),
      waveXShift: num(0, 1, 0.6),
      waveY: num(0, 1, 1),
      waveYShift: num(0, 1, 0.21),
      mixing: num(0, 1, 0.93),
      grainMixer: num(0, 1, 0),
      grainOverlay: num(0, 1, 0),
    },
    fragmentShader: staticMeshGradientFragmentShader,
    uniforms: (params) => ({
      ...sizingUniforms(),
      ...colorUniforms(params),
      u_positions: numberParam(params, 'positions'),
      u_waveX: numberParam(params, 'waveX'),
      u_waveXShift: numberParam(params, 'waveXShift'),
      u_waveY: numberParam(params, 'waveY'),
      u_waveYShift: numberParam(params, 'waveYShift'),
      u_mixing: numberParam(params, 'mixing'),
      u_grainMixer: numberParam(params, 'grainMixer'),
      u_grainOverlay: numberParam(params, 'grainOverlay'),
    }),
  },
  swirl: {
    label: 'Swirl',
    description: 'Animated bands of color twisting into spirals, arcs and circular flows.',
    params: {
      speed: num(-4, 4, 0.32),
      colorBack: color('#330000'),
      colors: colors(['#ffd1d1', '#ff8a8a', '#660000']),
      bandCount: num(0, 15, 4),
      twist: num(0, 1, 0.1),
      center: num(0, 1, 0.2),
      proportion: num(0, 1, 0.5),
      softness: num(0, 1, 0),
      noiseFrequency: num(0, 1, 0.4),
      noise: num(0, 1, 0.2),
    },
    fragmentShader: swirlFragmentShader,
    uniforms: (params) => ({
      ...sizingUniforms(),
      ...colorUniforms(params),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_bandCount: numberParam(params, 'bandCount'),
      u_twist: numberParam(params, 'twist'),
      u_center: numberParam(params, 'center'),
      u_proportion: numberParam(params, 'proportion'),
      u_softness: numberParam(params, 'softness'),
      u_noiseFrequency: numberParam(params, 'noiseFrequency'),
      u_noise: numberParam(params, 'noise'),
    }),
  },
  'grain-gradient': {
    label: 'Grain gradient',
    description: 'Multi-color gradient with noise-textured distortion in seven abstract forms.',
    params: {
      speed: num(-4, 4, 1),
      colorBack: color('#000000'),
      colors: colors(['#7300ff', '#eba8ff', '#00bfff', '#2a00ff']),
      softness: num(0, 1, 0.5),
      intensity: num(0, 1, 0.5),
      noise: num(0, 1, 0.25),
      shape: { kind: 'enum', options: Object.keys(GrainGradientShapes), default: 'corners' },
    },
    fragmentShader: grainGradientFragmentShader,
    uniforms: (params) => ({
      ...sizingUniforms(),
      ...colorUniforms(params),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_softness: numberParam(params, 'softness'),
      u_intensity: numberParam(params, 'intensity'),
      u_noise: numberParam(params, 'noise'),
      u_shape: grainShape(params.shape),
    }),
  },
} as const satisfies Record<string, ShaderDefinition>

function grainShape(value: ShaderParamValue | undefined) {
  return typeof value === 'string' && value in GrainGradientShapes
    ? GrainGradientShapes[value as keyof typeof GrainGradientShapes]
    : GrainGradientShapes.corners
}

export type ShaderName = keyof typeof SHADERS

export const SHADER_NAMES = Object.keys(SHADERS) as [ShaderName, ...ShaderName[]]

export function isShaderName(value: unknown): value is ShaderName {
  return typeof value === 'string' && Object.hasOwn(SHADERS, value)
}

function parseParam(spec: ParamSpec, value: unknown): ShaderParamValue {
  switch (spec.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(spec.max, Math.max(spec.min, value))
        : spec.default
    case 'color':
      return typeof value === 'string' && value.length > 0 && value.length <= MAX_COLOR_LENGTH
        ? value
        : spec.default
    case 'colors': {
      if (!Array.isArray(value)) return [...spec.default]
      const list = value
        .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= MAX_COLOR_LENGTH)
        .slice(0, MAX_COLORS)
      return list.length ? list : [...spec.default]
    }
    case 'enum':
      return typeof value === 'string' && spec.options.includes(value) ? value : spec.default
  }
}

/** Fill defaults, clamp ranges and drop unknown keys: what reaches a fragment shader is always in range. */
export function parseShaderParams(name: ShaderName, raw: unknown): ShaderParams {
  const source = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
  const specs: ParamSpecs = SHADERS[name].params
  return Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [key, parseParam(spec, source[key])]),
  )
}

export function isShaderNode(node: WebNode | null | undefined): node is WebElementNode {
  return node?.kind === 'element' && isShaderName(node.attributes[SHADER_NAME_ATTRIBUTE])
}

/** The shader a node draws and its params, or `null` when the node is not a shader. */
export function shaderInfo(node: WebNode | null | undefined) {
  if (!isShaderNode(node)) return null
  const name = node.attributes[SHADER_NAME_ATTRIBUTE]
  if (!isShaderName(name)) return null
  let raw: unknown = null
  try {
    raw = JSON.parse(node.attributes[SHADER_PARAMS_ATTRIBUTE] ?? '{}')
  } catch {
    // Unreadable params fall back to the shader's defaults.
  }
  return { name, params: parseShaderParams(name, raw) }
}

export interface ShaderOptions {
  parentId: string | null
  order: number
  /** Width and height in px. */
  width?: number
  height?: number
  params?: unknown
}

/** A `div` the renderer mounts a shader canvas into. Params live in one validated attribute. */
export function shaderNode(name: ShaderName, options: ShaderOptions) {
  return createWebElement('div', {
    parentId: options.parentId,
    order: options.order,
    attributes: {
      [SHADER_NAME_ATTRIBUTE]: name,
      [SHADER_PARAMS_ATTRIBUTE]: JSON.stringify(parseShaderParams(name, options.params)),
      'aria-label': SHADERS[name].label,
    },
    styles: {
      width: `${options.width ?? 400}px`,
      height: `${options.height ?? 300}px`,
    },
  })
}

/** One `node.patch` changing shader params (merged over current) and size; `null` when nothing was asked for. */
export function shaderPatchOperation(
  node: WebNode | null | undefined,
  change: { params?: unknown; width?: number; height?: number },
): WebOperation | null {
  const info = shaderInfo(node)
  if (!info || !isShaderNode(node)) return null
  const styles: Record<string, string> = {}
  if (change.width !== undefined) styles.width = `${change.width}px`
  if (change.height !== undefined) styles.height = `${change.height}px`
  const attributes: Record<string, string> = {}
  if (change.params !== undefined) {
    const patch = typeof change.params === 'object' && change.params !== null && !Array.isArray(change.params)
      ? change.params
      : {}
    attributes[SHADER_PARAMS_ATTRIBUTE] = JSON.stringify(
      parseShaderParams(info.name, { ...info.params, ...patch }),
    )
  }
  if (!Object.keys(styles).length && !Object.keys(attributes).length) return null
  return {
    type: 'node.patch',
    id: node.id,
    patch: {
      kind: 'element',
      ...(Object.keys(styles).length ? { styles } : {}),
      ...(Object.keys(attributes).length ? { attributes } : {}),
    },
  }
}

function hasWebGl2(element: HTMLElement) {
  const view = element.ownerDocument.defaultView
  return view !== null && 'WebGL2RenderingContext' in view
}

/**
 * Mount a shader canvas into every shader node under `root`. Returns a cleanup
 * that disposes each mount. A shader that cannot start (no WebGL2, context
 * lost) leaves its node as an empty box; the document is untouched.
 */
export function mountShaders(root: ParentNode) {
  const mounts: ShaderMount[] = []
  for (const element of root.querySelectorAll<HTMLElement>(`[${SHADER_NAME_ATTRIBUTE}]`)) {
    const name = element.getAttribute(SHADER_NAME_ATTRIBUTE)
    if (!isShaderName(name) || !hasWebGl2(element)) continue
    let raw: unknown = null
    try {
      raw = JSON.parse(element.getAttribute(SHADER_PARAMS_ATTRIBUTE) ?? '{}')
    } catch {
      // Falls back to defaults, same as shaderInfo.
    }
    const params = parseShaderParams(name, raw)
    const definition: ShaderDefinition = SHADERS[name]
    try {
      mounts.push(
        new ShaderMount(
          element,
          definition.fragmentShader,
          definition.uniforms(params),
          undefined,
          numberParam(params, 'speed'),
        ),
      )
    } catch (error) {
      console.warn(`Shader "${name}" could not start; the node stays empty.`, error)
    }
  }
  return () => {
    for (const mount of mounts) mount.dispose()
  }
}
