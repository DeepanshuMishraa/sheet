import {
  colorPanelsFragmentShader,
  defaultObjectSizing,
  defaultPatternSizing,
  dotGridFragmentShader,
  DotGridShapes,
  dotOrbitFragmentShader,
  getShaderColorFromString,
  getShaderNoiseTexture,
  godRaysFragmentShader,
  grainGradientFragmentShader,
  GrainGradientShapes,
  meshGradientFragmentShader,
  metaballsFragmentShader,
  neuroNoiseFragmentShader,
  perlinNoiseFragmentShader,
  pulsingBorderFragmentShader,
  PulsingBorderAspectRatios,
  ShaderFitOptions,
  ShaderMount,
  simplexNoiseFragmentShader,
  smokeRingFragmentShader,
  spiralFragmentShader,
  staticMeshGradientFragmentShader,
  staticRadialGradientFragmentShader,
  swirlFragmentShader,
  voronoiFragmentShader,
  warpFragmentShader,
  WarpPatterns,
  wavesFragmentShader,
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
/** `max` is the most colors the fragment shader's uniform array can hold. */
type ColorsSpec = { kind: 'colors'; default: readonly string[]; max?: number }
type EnumSpec = { kind: 'enum'; options: readonly string[]; default: string }
export type ParamSpec = NumberSpec | ColorSpec | ColorsSpec | EnumSpec
type ParamSpecs = Readonly<Record<string, ParamSpec>>

export type ShaderParamValue = number | string | string[]
export type ShaderParams = Record<string, ShaderParamValue>

const num = (min: number, max: number, value: number): NumberSpec => ({ kind: 'number', min, max, default: value })
const colors = (value: readonly string[], max?: number): ColorsSpec => ({ kind: 'colors', default: value, max })
const color = (value: string): ColorSpec => ({ kind: 'color', default: value })
const choice = (options: readonly string[], value: string): EnumSpec => ({ kind: 'enum', options, default: value })

/** How the gallery groups a shader: a gradient, a pattern or noise field, or an effect. */
export type ShaderGroup = 'gradient' | 'pattern' | 'effect'

/** Every param is read as a number, color or enum member and clamped, never passed through raw. */
interface ShaderDefinition {
  label: string
  description: string
  group: ShaderGroup
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

/** The few sizing values a shader's own default differs on. */
type SizingOverrides = Partial<Pick<typeof defaultObjectSizing, 'scale' | 'rotation' | 'offsetX' | 'offsetY'>>

/**
 * Shaders size to their box in one of two ways: an object (a form fitted into
 * the box) or a pattern (a texture repeated across it). Each has its own
 * defaults, and a few shaders start off scaled or shifted; those are overrides.
 */
const sizingFrom = (base: typeof defaultObjectSizing, overrides: SizingOverrides = {}) => {
  const sizing = { ...base, ...overrides }
  return {
    u_fit: ShaderFitOptions[sizing.fit],
    u_rotation: sizing.rotation,
    u_scale: sizing.scale,
    u_offsetX: sizing.offsetX,
    u_offsetY: sizing.offsetY,
    u_originX: sizing.originX,
    u_originY: sizing.originY,
    u_worldWidth: sizing.worldWidth,
    u_worldHeight: sizing.worldHeight,
  }
}
const sizingUniforms = (overrides?: SizingOverrides) => sizingFrom(defaultObjectSizing, overrides)
const patternSizing = (overrides?: SizingOverrides) => sizingFrom(defaultPatternSizing, overrides)

/**
 * The noise image several shaders sample. Paper's `getShaderNoiseTexture()`
 * hands back a new image that has not loaded yet, and a shader refuses to start
 * with an image that is not fully loaded, so each of those shaders failed and
 * left an empty box. One image is made, loaded once, and shared: shaders that
 * need it wait for `loadNoise`, then read it here.
 */
let noiseImage: HTMLImageElement | null = null
let noiseLoad: Promise<HTMLImageElement | null> | null = null

function loadNoise(): Promise<HTMLImageElement | null> {
  noiseLoad ??= new Promise((resolve) => {
    const image = getShaderNoiseTexture()
    if (!image) return resolve(null)
    const ready = () => {
      noiseImage = image.naturalWidth > 0 ? image : null
      resolve(noiseImage)
    }
    if (image.complete && image.naturalWidth > 0) ready()
    else {
      image.onload = ready
      image.onerror = () => resolve(null)
    }
  })
  return noiseLoad
}

const noiseTexture = () => noiseImage ?? undefined

const colorUniforms = (params: ShaderParams) => {
  const list = colorList(params, 'colors')
  return { u_colors: list.map(getShaderColorFromString), u_colorsCount: list.length }
}

export const SHADERS = {
  'mesh-gradient': {
    label: 'Mesh gradient',
    group: 'gradient',
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
    group: 'gradient',
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
    group: 'gradient',
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
    group: 'gradient',
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
  'static-radial-gradient': {
    label: 'Static radial gradient',
    group: 'gradient',
    description: 'A radial gradient with a movable focal point, falloff and optional grain. Renders one still frame.',
    params: {
      speed: num(-4, 4, 0),
      colorBack: color('#000000'),
      colors: colors(['#00bbff', '#00ffe1', '#ffffff'], 10),
      radius: num(0, 3, 0.8),
      focalDistance: num(0, 3, 0.99),
      focalAngle: num(0, 360, 0),
      falloff: num(-1, 1, 0.24),
      mixing: num(0, 1, 0.5),
      distortion: num(0, 1, 0),
      distortionShift: num(-1, 1, 0),
      distortionFreq: num(0, 20, 12),
      grainMixer: num(0, 1, 0),
      grainOverlay: num(0, 1, 0),
    },
    fragmentShader: staticRadialGradientFragmentShader,
    uniforms: (params) => ({
      ...sizingUniforms(),
      ...colorUniforms(params),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_radius: numberParam(params, 'radius'),
      u_focalDistance: numberParam(params, 'focalDistance'),
      u_focalAngle: numberParam(params, 'focalAngle'),
      u_falloff: numberParam(params, 'falloff'),
      u_mixing: numberParam(params, 'mixing'),
      u_distortion: numberParam(params, 'distortion'),
      u_distortionShift: numberParam(params, 'distortionShift'),
      u_distortionFreq: numberParam(params, 'distortionFreq'),
      u_grainMixer: numberParam(params, 'grainMixer'),
      u_grainOverlay: numberParam(params, 'grainOverlay'),
    }),
  },
  'simplex-noise': {
    label: 'Simplex noise',
    group: 'gradient',
    description: 'A soft, drifting field of color bands cut from simplex noise.',
    params: {
      speed: num(-4, 4, 0.5),
      colors: colors(['#4449CF', '#FFD1E0', '#F94446', '#FFD36B', '#FFFFFF'], 10),
      stepsPerColor: num(1, 10, 2),
      softness: num(0, 1, 0),
    },
    fragmentShader: simplexNoiseFragmentShader,
    uniforms: (params) => ({
      ...patternSizing({ scale: 0.6 }),
      ...colorUniforms(params),
      u_stepsPerColor: numberParam(params, 'stepsPerColor'),
      u_softness: numberParam(params, 'softness'),
    }),
  },
  warp: {
    label: 'Warp',
    group: 'gradient',
    description: 'Checks, stripes or an edge, bent into swirling folds of color.',
    params: {
      speed: num(-4, 4, 1),
      colors: colors(['#121212', '#9470ff', '#121212', '#8838ff'], 10),
      proportion: num(0, 1, 0.45),
      softness: num(0, 1, 1),
      distortion: num(0, 1, 0.25),
      swirl: num(0, 1, 0.8),
      swirlIterations: num(0, 20, 10),
      shapeScale: num(0, 1, 0.1),
      shape: choice(Object.keys(WarpPatterns), 'checks'),
    },
    fragmentShader: warpFragmentShader,
    uniforms: (params) => ({
      ...patternSizing(),
      ...colorUniforms(params),
      u_proportion: numberParam(params, 'proportion'),
      u_softness: numberParam(params, 'softness'),
      u_distortion: numberParam(params, 'distortion'),
      u_swirl: numberParam(params, 'swirl'),
      u_swirlIterations: numberParam(params, 'swirlIterations'),
      u_shapeScale: numberParam(params, 'shapeScale'),
      u_shape: enumLookup(WarpPatterns, params.shape, 'checks'),
      u_noiseTexture: noiseTexture(),
    }),
  },
  spiral: {
    label: 'Spiral',
    group: 'gradient',
    description: 'A single tapering spiral stroke over a flat color.',
    params: {
      speed: num(-4, 4, 1),
      colorBack: color('#001429'),
      colorFront: color('#79D1FF'),
      density: num(0, 1, 1),
      distortion: num(0, 1, 0),
      strokeWidth: num(0, 1, 0.5),
      strokeTaper: num(0, 1, 0),
      strokeCap: num(0, 1, 0),
      noise: num(0, 1, 0),
      noiseFrequency: num(0, 1, 0),
      softness: num(0, 1, 0),
    },
    fragmentShader: spiralFragmentShader,
    uniforms: (params) => ({
      ...patternSizing(),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_colorFront: getShaderColorFromString(colorParam(params, 'colorFront')),
      u_density: numberParam(params, 'density'),
      u_distortion: numberParam(params, 'distortion'),
      u_strokeWidth: numberParam(params, 'strokeWidth'),
      u_strokeTaper: numberParam(params, 'strokeTaper'),
      u_strokeCap: numberParam(params, 'strokeCap'),
      u_noise: numberParam(params, 'noise'),
      u_noiseFrequency: numberParam(params, 'noiseFrequency'),
      u_softness: numberParam(params, 'softness'),
    }),
  },
  'color-panels': {
    label: 'Color panels',
    group: 'gradient',
    description: 'Overlapping translucent panels of color that fan across the box.',
    params: {
      speed: num(-4, 4, 0.5),
      colors: colors(['#ff9d00', '#fd4f30', '#809bff', '#6d2eff', '#333aff', '#f15cff', '#ffd557'], 7),
      colorBack: color('#000000'),
      angle1: num(-360, 360, 0),
      angle2: num(-360, 360, 0),
      length: num(0, 3, 1.1),
      edges: choice(['off', 'on'], 'off'),
      blur: num(0, 1, 0),
      fadeIn: num(0, 1, 1),
      fadeOut: num(0, 1, 0.3),
      gradient: num(0, 1, 0),
      density: num(0, 10, 3),
    },
    fragmentShader: colorPanelsFragmentShader,
    uniforms: (params) => ({
      ...sizingUniforms({ scale: 0.8 }),
      ...colorUniforms(params),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_angle1: numberParam(params, 'angle1'),
      u_angle2: numberParam(params, 'angle2'),
      u_length: numberParam(params, 'length'),
      u_edges: params.edges === 'on',
      u_blur: numberParam(params, 'blur'),
      u_fadeIn: numberParam(params, 'fadeIn'),
      u_fadeOut: numberParam(params, 'fadeOut'),
      u_density: numberParam(params, 'density'),
      u_gradient: numberParam(params, 'gradient'),
    }),
  },
  'neuro-noise': {
    label: 'Neuro noise',
    group: 'pattern',
    description: 'Glowing, branching filaments like a neural net, in three colors.',
    params: {
      speed: num(-4, 4, 1),
      colorFront: color('#ffffff'),
      colorMid: color('#47a6ff'),
      colorBack: color('#000000'),
      brightness: num(0, 1, 0.05),
      contrast: num(0, 1, 0.3),
    },
    fragmentShader: neuroNoiseFragmentShader,
    uniforms: (params) => ({
      ...patternSizing(),
      u_colorFront: getShaderColorFromString(colorParam(params, 'colorFront')),
      u_colorMid: getShaderColorFromString(colorParam(params, 'colorMid')),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_brightness: numberParam(params, 'brightness'),
      u_contrast: numberParam(params, 'contrast'),
    }),
  },
  'perlin-noise': {
    label: 'Perlin noise',
    group: 'pattern',
    description: 'Two-color cloud and marble patterns from layered Perlin noise.',
    params: {
      speed: num(-4, 4, 0.5),
      colorBack: color('#632ad5'),
      colorFront: color('#fccff7'),
      proportion: num(0, 1, 0.35),
      softness: num(0, 1, 0.1),
      octaveCount: num(1, 8, 1),
      persistence: num(0.3, 1, 1),
      lacunarity: num(1, 10, 1.5),
    },
    fragmentShader: perlinNoiseFragmentShader,
    uniforms: (params) => ({
      ...patternSizing(),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_colorFront: getShaderColorFromString(colorParam(params, 'colorFront')),
      u_proportion: numberParam(params, 'proportion'),
      u_softness: numberParam(params, 'softness'),
      u_octaveCount: numberParam(params, 'octaveCount'),
      u_persistence: numberParam(params, 'persistence'),
      u_lacunarity: numberParam(params, 'lacunarity'),
    }),
  },
  voronoi: {
    label: 'Voronoi',
    group: 'pattern',
    description: 'Glowing cells split by thin gaps, colored in steps.',
    params: {
      speed: num(-4, 4, 0.5),
      colors: colors(['#ff8247', '#ffe53d'], 5),
      stepsPerColor: num(1, 10, 3),
      colorGlow: color('#ffffff'),
      colorGap: color('#2e0000'),
      distortion: num(0, 1, 0.4),
      gap: num(0, 1, 0.04),
      glow: num(0, 1, 0),
    },
    fragmentShader: voronoiFragmentShader,
    uniforms: (params) => ({
      ...patternSizing({ scale: 0.5 }),
      ...colorUniforms(params),
      u_stepsPerColor: numberParam(params, 'stepsPerColor'),
      u_colorGlow: getShaderColorFromString(colorParam(params, 'colorGlow')),
      u_colorGap: getShaderColorFromString(colorParam(params, 'colorGap')),
      u_distortion: numberParam(params, 'distortion'),
      u_gap: numberParam(params, 'gap'),
      u_glow: numberParam(params, 'glow'),
      u_noiseTexture: noiseTexture(),
    }),
  },
  waves: {
    label: 'Waves',
    group: 'pattern',
    description: 'Rows of wavy lines in two colors. Renders one still frame.',
    params: {
      colorFront: color('#ffbb00'),
      colorBack: color('#000000'),
      shape: num(0, 3, 0),
      frequency: num(0, 2, 0.5),
      amplitude: num(0, 1, 0.5),
      spacing: num(0, 5, 1.2),
      proportion: num(0, 1, 0.1),
      softness: num(0, 1, 0),
    },
    fragmentShader: wavesFragmentShader,
    uniforms: (params) => ({
      ...patternSizing({ scale: 0.6 }),
      u_colorFront: getShaderColorFromString(colorParam(params, 'colorFront')),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_shape: numberParam(params, 'shape'),
      u_frequency: numberParam(params, 'frequency'),
      u_amplitude: numberParam(params, 'amplitude'),
      u_spacing: numberParam(params, 'spacing'),
      u_proportion: numberParam(params, 'proportion'),
      u_softness: numberParam(params, 'softness'),
    }),
  },
  'dot-grid': {
    label: 'Dot grid',
    group: 'pattern',
    description: 'A regular grid of circles, diamonds, squares or triangles. Renders one still frame.',
    params: {
      colorBack: color('#000000'),
      colorFill: color('#ffffff'),
      colorStroke: color('#ffaa00'),
      size: num(0, 50, 2),
      gapX: num(2, 500, 32),
      gapY: num(2, 500, 32),
      strokeWidth: num(0, 50, 0),
      sizeRange: num(0, 1, 0),
      opacityRange: num(0, 1, 0),
      shape: choice(Object.keys(DotGridShapes), 'circle'),
    },
    fragmentShader: dotGridFragmentShader,
    uniforms: (params) => ({
      ...patternSizing(),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_colorFill: getShaderColorFromString(colorParam(params, 'colorFill')),
      u_colorStroke: getShaderColorFromString(colorParam(params, 'colorStroke')),
      u_dotSize: numberParam(params, 'size'),
      u_gapX: numberParam(params, 'gapX'),
      u_gapY: numberParam(params, 'gapY'),
      u_strokeWidth: numberParam(params, 'strokeWidth'),
      u_sizeRange: numberParam(params, 'sizeRange'),
      u_opacityRange: numberParam(params, 'opacityRange'),
      u_shape: enumLookup(DotGridShapes, params.shape, 'circle'),
    }),
  },
  'dot-orbit': {
    label: 'Dot orbit',
    group: 'pattern',
    description: 'Dots circling in rings, colored in steps along their orbit.',
    params: {
      speed: num(-4, 4, 1.5),
      colorBack: color('#000000'),
      colors: colors(['#ffc96b', '#ff6200', '#ff2f00', '#421100', '#1a0000'], 10),
      size: num(0, 5, 1),
      sizeRange: num(0, 1, 0),
      spreading: num(0, 2, 1),
      stepsPerColor: num(1, 10, 4),
    },
    fragmentShader: dotOrbitFragmentShader,
    uniforms: (params) => ({
      ...patternSizing(),
      ...colorUniforms(params),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_size: numberParam(params, 'size'),
      u_sizeRange: numberParam(params, 'sizeRange'),
      u_spreading: numberParam(params, 'spreading'),
      u_stepsPerColor: numberParam(params, 'stepsPerColor'),
      u_noiseTexture: noiseTexture(),
    }),
  },
  'god-rays': {
    label: 'God rays',
    group: 'effect',
    description: 'Beams of light fanning out from a glowing center, with bloom.',
    params: {
      speed: num(-4, 4, 0.75),
      colorBack: color('#000000'),
      colorBloom: color('#0000ff'),
      colors: colors(['#a600ff6e', '#6200fff0', '#ffffff', '#33fff5'], 5),
      density: num(0, 1, 0.3),
      spotty: num(0, 1, 0.3),
      midIntensity: num(0, 1, 0.4),
      midSize: num(0, 1, 0.2),
      intensity: num(0, 1, 0.8),
      bloom: num(0, 1, 0.4),
    },
    fragmentShader: godRaysFragmentShader,
    uniforms: (params) => ({
      ...sizingUniforms({ offsetY: -0.55 }),
      ...colorUniforms(params),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_colorBloom: getShaderColorFromString(colorParam(params, 'colorBloom')),
      u_density: numberParam(params, 'density'),
      u_spotty: numberParam(params, 'spotty'),
      u_midIntensity: numberParam(params, 'midIntensity'),
      u_midSize: numberParam(params, 'midSize'),
      u_intensity: numberParam(params, 'intensity'),
      u_bloom: numberParam(params, 'bloom'),
      u_noiseTexture: noiseTexture(),
    }),
  },
  'smoke-ring': {
    label: 'Smoke ring',
    group: 'effect',
    description: 'A ring of drifting smoke, one or more colors on a flat background.',
    params: {
      speed: num(-4, 4, 0.5),
      colorBack: color('#000000'),
      colors: colors(['#ffffff'], 10),
      noiseScale: num(0.01, 5, 3),
      noiseIterations: num(1, 8, 8),
      radius: num(0, 1, 0.25),
      thickness: num(0, 1, 0.65),
      innerShape: num(0, 1, 0.7),
    },
    fragmentShader: smokeRingFragmentShader,
    uniforms: (params) => ({
      ...sizingUniforms({ scale: 0.8 }),
      ...colorUniforms(params),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_noiseScale: numberParam(params, 'noiseScale'),
      u_thickness: numberParam(params, 'thickness'),
      u_radius: numberParam(params, 'radius'),
      u_innerShape: numberParam(params, 'innerShape'),
      u_noiseIterations: numberParam(params, 'noiseIterations'),
      u_noiseTexture: noiseTexture(),
    }),
  },
  metaballs: {
    label: 'Metaballs',
    group: 'effect',
    description: 'Soft blobs of color that drift and merge.',
    params: {
      speed: num(-4, 4, 1),
      colorBack: color('#000000'),
      colors: colors(['#6e33cc', '#ff5500', '#ffc105', '#ffc800', '#f585ff'], 8),
      count: num(1, 20, 10),
      size: num(0, 1, 0.83),
    },
    fragmentShader: metaballsFragmentShader,
    uniforms: (params) => ({
      ...sizingUniforms(),
      ...colorUniforms(params),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_size: numberParam(params, 'size'),
      u_count: numberParam(params, 'count'),
      u_noiseTexture: noiseTexture(),
    }),
  },
  'pulsing-border': {
    label: 'Pulsing border',
    group: 'effect',
    description: 'A glowing, pulsing outline that runs around the edge of the box.',
    params: {
      speed: num(-4, 4, 1),
      colorBack: color('#000000'),
      colors: colors(['#0dc1fd', '#d915ef', '#ff3f2ecc'], 5),
      roundness: num(0, 1, 0.25),
      thickness: num(0, 1, 0.1),
      marginLeft: num(0, 1, 0),
      marginRight: num(0, 1, 0),
      marginTop: num(0, 1, 0),
      marginBottom: num(0, 1, 0),
      aspectRatio: choice(Object.keys(PulsingBorderAspectRatios), 'auto'),
      softness: num(0, 1, 0.75),
      intensity: num(0, 1, 0.2),
      bloom: num(0, 1, 0.25),
      spots: num(1, 4, 4),
      spotSize: num(0, 1, 0.5),
      pulse: num(0, 1, 0.25),
      smoke: num(0, 1, 0.3),
      smokeSize: num(0, 1, 0.6),
    },
    fragmentShader: pulsingBorderFragmentShader,
    uniforms: (params) => ({
      ...sizingUniforms({ scale: 0.6 }),
      ...colorUniforms(params),
      u_colorBack: getShaderColorFromString(colorParam(params, 'colorBack')),
      u_roundness: numberParam(params, 'roundness'),
      u_thickness: numberParam(params, 'thickness'),
      u_marginLeft: numberParam(params, 'marginLeft'),
      u_marginRight: numberParam(params, 'marginRight'),
      u_marginTop: numberParam(params, 'marginTop'),
      u_marginBottom: numberParam(params, 'marginBottom'),
      u_aspectRatio: enumLookup(PulsingBorderAspectRatios, params.aspectRatio, 'auto'),
      u_softness: numberParam(params, 'softness'),
      u_intensity: numberParam(params, 'intensity'),
      u_bloom: numberParam(params, 'bloom'),
      u_spots: numberParam(params, 'spots'),
      u_spotSize: numberParam(params, 'spotSize'),
      u_pulse: numberParam(params, 'pulse'),
      u_smoke: numberParam(params, 'smoke'),
      u_smokeSize: numberParam(params, 'smokeSize'),
      u_noiseTexture: noiseTexture(),
    }),
  },
} as const satisfies Record<string, ShaderDefinition>

/** A named enum param read back as the number the shader expects, or the default's number. */
function enumLookup<T extends Record<string, number>>(
  table: T,
  value: ShaderParamValue | undefined,
  fallback: keyof T & string,
) {
  return typeof value === 'string' && value in table ? table[value] : table[fallback]
}

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
        .slice(0, Math.min(MAX_COLORS, spec.max ?? MAX_COLORS))
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
  /**
   * Place the shader at this point of its parent, free-positioned, so it can be
   * moved and resized like a frame. Without both, it sits in the parent's flow.
   */
  left?: number
  top?: number
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
      ...(options.left !== undefined && options.top !== undefined
        ? { position: 'absolute', left: `${options.left}px`, top: `${options.top}px` }
        : {}),
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
  let disposed = false

  const start = (element: HTMLElement, name: ShaderName, params: ShaderParams) => {
    const definition: ShaderDefinition = SHADERS[name]
    const uniforms = definition.uniforms(params)
    // A shader that samples the noise image waits for it, then starts. The node
    // may have been replaced or the mount disposed while it loaded.
    if ('u_noiseTexture' in uniforms && !noiseImage) {
      void loadNoise().then((image) => {
        if (image && !disposed && element.isConnected) start(element, name, params)
        else if (!image) console.warn(`Shader "${name}" needs its noise image, which did not load; the node stays empty.`)
      })
      return
    }
    try {
      mounts.push(
        new ShaderMount(element, definition.fragmentShader, uniforms, undefined, numberParam(params, 'speed')),
      )
    } catch (error) {
      console.warn(`Shader "${name}" could not start; the node stays empty.`, error)
    }
  }

  for (const element of root.querySelectorAll<HTMLElement>(`[${SHADER_NAME_ATTRIBUTE}]`)) {
    const name = element.getAttribute(SHADER_NAME_ATTRIBUTE)
    if (!isShaderName(name) || !hasWebGl2(element)) continue
    let raw: unknown = null
    try {
      raw = JSON.parse(element.getAttribute(SHADER_PARAMS_ATTRIBUTE) ?? '{}')
    } catch {
      // Falls back to defaults, same as shaderInfo.
    }
    start(element, name, parseShaderParams(name, raw))
  }
  return () => {
    disposed = true
    for (const mount of mounts) mount.dispose()
  }
}

const THUMB_WIDTH = 320
const THUMB_HEIGHT = 240
/** Where in its animation a moving shader is frozen for its thumbnail, in ms. */
const THUMB_FRAME_MS = 4_000

const thumbnails = new Map<ShaderName, string>()
const thumbnailJobs = new Map<ShaderName, Promise<string | null>>()
let thumbnailQueue: Promise<unknown> = Promise.resolve()

const nextFrames = async (count: number) => {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

async function renderThumbnail(name: ShaderName): Promise<string | null> {
  if (typeof document === 'undefined') return null
  const definition: ShaderDefinition = SHADERS[name]
  const params = parseShaderParams(name, undefined)
  let uniforms = definition.uniforms(params)
  if ('u_noiseTexture' in uniforms) {
    if (!(await loadNoise())) return null
    uniforms = definition.uniforms(params)
  }
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${THUMB_WIDTH}px;height:${THUMB_HEIGHT}px;pointer-events:none`
  document.body.append(host)
  let mount: ShaderMount | null = null
  try {
    if (!hasWebGl2(host)) return null
    const moving = numberParam(params, 'speed') !== 0
    // Speed 0 draws one frame at the time given and stops, so this costs one render.
    mount = new ShaderMount(
      host,
      definition.fragmentShader,
      uniforms,
      { preserveDrawingBuffer: true },
      0,
      moving ? THUMB_FRAME_MS : 0,
      1,
    )
    await nextFrames(3)
    return mount.canvasElement.width > 1 ? mount.canvasElement.toDataURL('image/jpeg', 0.85) : null
  } catch (error) {
    console.warn(`Shader "${name}" could not draw a thumbnail.`, error)
    return null
  } finally {
    mount?.dispose()
    host.remove()
  }
}

/**
 * A still picture of a shader, for the gallery. Thumbnails are drawn one at a
 * time through one throwaway context, so opening the gallery never compiles
 * every shader at once, and each is kept once drawn, so the second look is
 * instant. `null` means the shader could not be drawn here.
 */
export function shaderThumbnail(name: ShaderName): Promise<string | null> {
  const done = thumbnails.get(name)
  if (done) return Promise.resolve(done)
  const waiting = thumbnailJobs.get(name)
  if (waiting) return waiting
  const job = thumbnailQueue
    .then(async () => {
      const url = await renderThumbnail(name)
      if (url) thumbnails.set(name, url)
      thumbnailJobs.delete(name)
      // Give the page a turn between shaders, so nothing waits on a compile.
      await new Promise((resolve) => setTimeout(resolve, 0))
      return url
    })
  thumbnailJobs.set(name, job)
  thumbnailQueue = job.catch(() => undefined)
  return job
}

/** Draws every thumbnail in the background, so the gallery is ready before it is asked for. */
export function prewarmShaderThumbnails() {
  for (const name of SHADER_NAMES) void shaderThumbnail(name)
}
