import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  applyWebTransaction,
  parseWebTransaction,
  serializeWebDocument,
  type WebDocument,
} from '@sheet/canvas/web-model'
import { serializeWebStylesheets } from '@sheet/canvas/web-css'
import {
  ICON_LIBRARIES,
  iconNodes,
  iconStyleOperation,
  isIconNode,
  searchIcons,
  type IconLibrary,
} from '@sheet/canvas/web-icons'
import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  canvasParentId,
  listPages,
  nextPageName,
  nextRootOrder,
  pageLayerIds,
  pageNode,
  pageParentId,
  pageRootSize,
  resolvePageId,
  stageColor,
} from '@sheet/canvas/web-pages'
import {
  FRAME_PRESET_GROUPS,
  NEW_FRAME_SIZE,
  findFramePreset,
  frameNode,
  freeFrameSpot,
} from '@sheet/canvas/web-frames'
import {
  SHADERS,
  SHADER_NAMES,
  isShaderNode,
  shaderNode,
  shaderPatchOperation,
  type ShaderName,
} from '@sheet/canvas/web-shaders'
import {
  applyWebCanvasTransactionToStore,
  readWebCanvasStore,
} from './web-canvas-procedures'
import {
  MAX_NAME_LENGTH,
  applyDraft,
  archiveDesign,
  closeDraft,
  compareDraft,
  createDesign,
  createDraft,
  listAssets,
  listDesigns,
  listDrafts,
  listVersions,
  renameDesign,
  reopenDraft,
  requireWebDocument,
  proposeDraft,
} from './mcp-designs'
import { trackAgentActivity } from './mcp-agent-activity'
import { exportOptionsShape, exportWebDocument, type ExportOptions } from './design-export'

export interface McpIncludedUsage {
  metric: string
  plan: string
  included: number | null
  used: number
  remaining: number | null
  periodStart?: string
  resetsAt?: string | null
}

export interface McpUsageController {
  current: () => Promise<McpIncludedUsage>
  reserve: () => Promise<McpIncludedUsage>
}

function usageMeta(usage?: McpIncludedUsage) {
  return usage ? { _meta: { 'sheet/usage': usage } } : {}
}

// Compact on purpose: results feed a model, and the indentation was ~30%
// extra tokens on every read.
function json(data: unknown, usage?: McpIncludedUsage) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    ...usageMeta(usage),
  }
}

function fail(error: unknown, usage?: McpIncludedUsage) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
    ...usageMeta(usage),
  }
}

import {
  commentStatusSchema,
  listDesignComments,
  setDesignCommentResolved,
  type CommentStatus,
} from './comments'

/** What a comment points at right now, or that the element is gone. */
function describeCommentedNode(document: WebDocument | null, nodeId: string) {
  const node = document?.nodes[nodeId]
  if (!node) return { exists: false as const }
  if (node.kind === 'text') {
    return { exists: true as const, kind: 'text' as const, text: node.text.slice(0, 200), parentId: node.parentId }
  }
  const text = Object.values(document?.nodes ?? {})
    .filter((child) => child.parentId === nodeId && child.kind === 'text')
    .map((child) => (child.kind === 'text' ? child.text : ''))
    .join(' ')
    .trim()
    .slice(0, 200)
  return {
    exists: true as const,
    kind: 'element' as const,
    tag: node.tag,
    id: node.attributes.id ?? null,
    className: node.attributes.class ?? null,
    text: text || null,
    parentId: node.parentId,
  }
}

const designId = z.string().min(1).max(128).describe('Design id')
const draftId = z.string().min(1).max(128).describe('Branch id')
/** A stale write comes back as a value, not an error; tools must not report it as success. */
function requireApplied<T extends { applied: boolean; reason?: string; revision: number }>(result: T) {
  if (!result.applied) {
    throw new Error(
      `The design changed (now at revision ${result.revision}) so nothing was applied. Read it again and retry.`,
    )
  }
  return result
}

/** The document grows with every edit; tools report the revision and changed ids, and getWebDocument reads the rest. */
function withoutDocument<T extends { document?: unknown }>(result: T) {
  const { document: _document, ...rest } = result
  return rest
}

const iconLibrary = z
  .enum(ICON_LIBRARIES.map((entry) => entry.id) as [IconLibrary, ...IconLibrary[]])
  .describe('Icon set: hugeicons or lucide')
/**
 * Where an icon goes when the agent names no parent. On a named page that is
 * the page root, as always. Page 1 has no root: with one top-level frame the
 * icon goes inside it, with none it sits top level, and with several there is
 * no right answer, so the agent is asked rather than the icon being dropped
 * into whichever frame happens to be first.
 */
function defaultIconParent(document: WebDocument, pageId: string | null) {
  if (pageId !== null) return pageParentId(document, pageId)
  const frames = pageLayerIds(document, null).filter((id) => document.nodes[id]?.kind === 'element')
  if (frames.length > 1) {
    throw new Error(
      `Page 1 has ${frames.length} top-level frames. Pass parentId to say which frame the icon goes in. Nothing was inserted.`,
    )
  }
  return frames[0] ?? null
}

const iconStyleShape = {
  color: z.string().min(1).max(64).optional().describe('Any CSS color; icons draw in currentColor'),
  size: z.number().positive().max(2_048).optional().describe('Width and height in px'),
  strokeWidth: z.number().positive().max(8).optional().describe('Outline weight in the 24px viewBox'),
}
const shaderName = z
  .enum(SHADER_NAMES)
  .describe(SHADER_NAMES.map((name) => `${name}: ${SHADERS[name].description}`).join(' | '))
const shaderParamsShape = z
  .record(z.string(), z.union([z.number(), z.string(), z.array(z.string().max(64)).max(10)]))
  .optional()
  .describe('Shader params, for example { colors: ["#111","#f0f"], speed: 0.5, distortion: 0.8 }. Unknown keys are dropped and numbers are clamped to range; omitted keys keep their default.')
const pageIdShape = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe('Page to insert into (the pageId from createPage or listPages); defaults to the first page. Ignored when parentId is given. The first page, Page 1, starts empty and has no edge: with nothing on it and no parentId the node becomes a top-level frame, so give it position:absolute with left, top, width and height.')
const targetShape = {
  designId,
  draftId: draftId.optional().describe('Branch target; omit for Main'),
}

/** The desktop host's default loopback origin; the app sets SHEET_APP_URL to its real one. */
const DEFAULT_APP_URL = 'http://127.0.0.1:4300'

export function appUrl(
  design: string,
  branch?: string,
  extra: Record<string, string | undefined> = {},
) {
  const origin = (process.env.SHEET_APP_URL?.trim() || DEFAULT_APP_URL).replace(/\/+$/, '')
  const path = branch
    ? `/design/${encodeURIComponent(design)}/b/${encodeURIComponent(branch)}`
    : `/design/${encodeURIComponent(design)}`
  const url = new URL(path, `${origin}/`)
  for (const [key, value] of Object.entries(extra)) {
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

interface RegisteredToolConfig {
  title?: string
  description?: string
  inputSchema?: z.ZodRawShape
  annotations?: Record<string, unknown>
}

/**
 * The SDK's tools/list handler inlines every shared shape into every tool
 * schema — the manifest came out at ~156KB (patchNodes alone 43KB) because
 * the style/layout/state shapes repeat a dozen times per tool. Converting
 * ourselves hoists the web shapes into named
 * definitions, so each appears once per tool. The catalog is identical for
 * every server instance, so the converted list is built once per process.
 */
let cachedToolList: { tools: unknown[] } | undefined

/** Anything slower than this is worth a log line with the tool name. */
const SLOW_TOOL_MS = 2_000

function logSlowTool(name: string, startedAt: number) {
  const durationMs = performance.now() - startedAt
  if (durationMs >= SLOW_TOOL_MS) {
    console.log(
      `[sheet-mcp] slow tool ${name} took ${Math.round(durationMs)}ms`,
    )
  }
}

function buildToolList(
  catalog: Array<{ name: string; config: RegisteredToolConfig }>,
) {
  return (cachedToolList ??= {
    tools: catalog.map(({ name, config }) => ({
      name,
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema
        ? z.toJSONSchema(z.object(config.inputSchema), {
            target: 'draft-7',
            io: 'input',
          })
        : { type: 'object' },
      annotations: config.annotations,
    })),
  })
}

function createSheetRuntime(
  userId: string,
  usage: McpUsageController,
) {
  const server = new McpServer({ name: 'sheet', version: '0.3.0' })
  const toolCatalog: Array<{ name: string; config: RegisteredToolConfig }> = []
  const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>()
  const registerToolDirect = server.registerTool.bind(server)
  server.registerTool = ((name, config, callback) => {
    toolCatalog.push({ name, config: config as RegisteredToolConfig })
    toolHandlers.set(name, callback as (args: unknown) => Promise<unknown>)
    return registerToolDirect(name, config as never, callback as never)
  }) as typeof server.registerTool

  /**
   * Every design-scoped call announces itself before it runs and settles when
   * it returns, so the editor shows one continuous agent for a whole run
   * instead of a marker that appears only while a write is in flight.
   */
  function tool<Args>(name: string, run: (args: Args) => Promise<unknown>) {
    return async (args: Args) => {
      let currentUsage: McpIncludedUsage | undefined
      const activity = trackAgentActivity(userId, name, args)
      const startedAt = performance.now()
      try {
        currentUsage = await usage.reserve()
        return json(await run(args), currentUsage)
      } catch (error) {
        return fail(error, currentUsage)
      } finally {
        activity?.end()
        logSlowTool(name, startedAt)
      }
    }
  }

  function pngTool<Args>(
    name: string,
    run: (args: Args) => Promise<{
      png: Uint8Array
      metadata: unknown
    }>,
  ) {
    return async (args: Args) => {
      let currentUsage: McpIncludedUsage | undefined
      const activity = trackAgentActivity(userId, name, args)
      const startedAt = performance.now()
      try {
        currentUsage = await usage.reserve()
        const result = await run(args)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result.metadata),
            },
            {
              type: 'image' as const,
              data: Buffer.from(result.png).toString('base64'),
              mimeType: 'image/png',
            },
          ],
          ...usageMeta(currentUsage),
        }
      } catch (error) {
        return fail(error, currentUsage)
      } finally {
        activity?.end()
        logSlowTool(name, startedAt)
      }
    }
  }

  server.registerTool(
    'getUsage',
    {
      description:
        'Read MCP tool call usage. Local-first: usage is unlimited, this status check never consumes anything.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const current = await usage.current()
        return json(current, current)
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'listDesigns',
    {
      description:
        'Start here. List the local Sheet designs and canonical editor URLs.',
      annotations: { readOnlyHint: true },
    },
    tool('listDesigns', async (_args: unknown) =>
      (await listDesigns(userId)).map((design) => ({
        ...design,
        openUrl: appUrl(design.id),
      })),
    ),
  )


  server.registerTool(
    'getWebDocument',
    {
      description:
        'Read a web-native design document: DOM nodes and roots, authored stylesheets and rules with media/container/supports conditions, components, and instances with bindings and overrides. Returns the revision for optimistic concurrency. This is authored source of truth; computed styles are never stored.',
      inputSchema: { designId },
      annotations: { readOnlyHint: true },
    },
    tool('getWebDocument', async (args: { designId: string }) =>
      requireWebDocument(userId, args.designId),
    ),
  )

  server.registerTool(
    'getWebHTML',
    {
      description:
        'Serialize a web-native document to HTML. Direct serialization of the authored DOM; no translation layer.',
      inputSchema: { designId },
      annotations: { readOnlyHint: true },
    },
    tool('getWebHTML', async (args: { designId: string }) => {
      const found = await requireWebDocument(userId, args.designId)
      return { revision: found.revision, html: serializeWebDocument(found.document) }
    }),
  )

  server.registerTool(
    'getWebCSS',
    {
      description:
        'Serialize a web-native document to authored CSS stylesheets. Direct serialization of the authored rules in cascade order; computed values never appear.',
      inputSchema: { designId },
      annotations: { readOnlyHint: true },
    },
    tool('getWebCSS', async (args: { designId: string }) => {
      const found = await requireWebDocument(userId, args.designId)
      return {
        revision: found.revision,
        css: serializeWebStylesheets(found.document.stylesheets, found.document.stylesheetOrder),
      }
    }),
  )

  server.registerTool(
    'applyWebTransaction',
    {
      description:
        'Mutate a web-native document with one validated WebTransaction: the same operation vocabulary, validation, undo inverses, revision compare-and-swap, history, and realtime path the editor uses. Operations: node.insert/node.patch/node.move/node.delete, stylesheet.insert/stylesheet.patch/stylesheet.delete, rule.insert/rule.patch/rule.move/rule.delete, component.define/component.delete, instance.create/instance.delete/instance.setOverride/instance.clearOverride. Page 1 (the unnamed first page) starts empty and has no edge: create each frame as a top-level node (parentId null) with position:absolute, left, top, width and height, and set frames side by side; do not wrap a design in one page-sized root. To resize a named page, node.patch its root element width and height, for example 1440px by 2400px. Never widen or resize a page to fit several designs: every screen or variant (light and dark, option A and B, mobile and desktop) goes in its own page via createPage, then insert into it with parentId = that pageId. Rules: patching a bound instance node directly is rejected (use instance.setOverride with text, attributes, or --custom-properties); template edits propagate to instances automatically; component CSS reaches instances through the normal cascade. Stale expectedRevision returns applied:false with reason stale instead of overwriting. Returns only applied, revision and changedNodeIds; pass verbose: true for the full document. Pass dryRun: true to validate without saving: every invalid operation is reported in one pass. stylesheet.insert accepts rules without ruleOrder (derived from each rule order field); if given, ruleOrder must list every rule id once. Send a large theme stylesheet in its own transaction before the nodes.',
      inputSchema: {
        designId,
        draftId: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .describe('Branch target; omit for Main. Draft writes require an active branch.'),
        expectedRevision: z
          .number()
          .int()
          .nonnegative()
          .describe('Revision from getWebDocument; the write fails stale when it moved.'),
        transaction: z
          .object({
            id: z.string().min(1).max(200).describe('Stable idempotency id; retries reuse it.'),
            label: z.string().min(1).max(200).describe('Human-readable label for history.'),
            operations: z
              .array(z.unknown())
              .min(1)
              .max(2_000)
              .describe('WebOperations validated exactly like editor transactions.'),
          })
          .describe('One atomic batch; applied fully or not at all.'),
        dryRun: z
          .boolean()
          .optional()
          .describe('Validate only: check every operation (and apply it in memory against Main) without saving. Reports all problems at once.'),
        verbose: z
          .boolean()
          .optional()
          .describe('Also return the full updated document. Off by default: the response is just applied, revision and changedNodeIds.'),
      },
    },
    tool('applyWebTransaction', async (args: {
      designId: string
      draftId?: string
      expectedRevision: number
      transaction: unknown
      dryRun?: boolean
      verbose?: boolean
    }) => {
      if (args.dryRun) {
        const transaction = parseWebTransaction(args.transaction)
        if (args.draftId) {
          return { applied: false, dryRun: true, valid: true, checked: 'syntax', operations: transaction.operations.length }
        }
        const found = await requireWebDocument(userId, args.designId)
        const result = applyWebTransaction(found.document, transaction)
        return {
          applied: false,
          dryRun: true,
          valid: true,
          checked: 'syntax and document',
          revision: found.revision,
          changedNodeIds: [...result.changedNodeIds],
        }
      }
      const { document, ...result } = await applyWebCanvasTransactionToStore(
        userId,
        userId,
        args.designId,
        args.expectedRevision,
        args.transaction,
        args.draftId ?? null,
      )
      // The document grows with every edit; send it only when asked.
      return args.verbose ? { ...result, document } : result
    }),
  )


  server.registerTool(
    'getWebScreenshot',
    {
      description:
        'Render a real PNG of a web-native document with the same standalone HTML/CSS serialization the editor materializes. Rendered by the open Sheet app window, so the app must be running; if it is not, the call fails with a message saying so. Call this after meaningful edits to verify the visual result. Read-only: revisions, history, and the document are untouched.',
      inputSchema: {
        designId,
        rootId: z.string().min(1).max(200).optional().describe('Web node id to capture; omit for the whole document.'),
        width: z.number().finite().min(200).max(3_840).default(1_440),
        pixelRatio: z.number().finite().min(1).max(2).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    pngTool('getWebScreenshot',
      async (args: {
        designId: string
        rootId?: string
        width: number
        pixelRatio: number
      }) => {
        const found = await requireWebDocument(userId, args.designId)
        const { renderWebScreenshot } = await import(
          '@sheet/rpc/mcp-screenshot'
        )
        const screenshot = await renderWebScreenshot(
          userId,
          found.document,
          args,
        )
        return {
          png: screenshot.png,
          metadata: {
            mimeType: 'image/png',
            width: screenshot.width,
            height: screenshot.height,
            revision: found.revision,
            target: {
              designId: args.designId,
              draftId: null,
              rootId: screenshot.rootId,
            },
            skippedImages: screenshot.skippedImages,
            timings: screenshot.timings,
            openUrl: appUrl(args.designId, undefined, {
              node: screenshot.rootId ?? undefined,
            }),
          },
        }
      },
    ),
  )


  server.registerTool(
    'exportDesign',
    {
      description:
        'Export a design. format "html" returns the complete self-contained page (all DOM and CSS in one file, ready to save as .html); "png"/"jpg" return a rendered image as base64; "json" returns the authored web document. The result carries filename, mimeType, encoding ("utf8" or "base64") and data.',
      inputSchema: { designId, ...exportOptionsShape },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool('exportDesign', async (args: { designId: string } & ExportOptions) => {
      const found = await requireWebDocument(userId, args.designId)
      const exported = await exportWebDocument(userId, found.document, args)
      return { revision: found.revision, openUrl: appUrl(args.designId), ...exported }
    }),
  )

  server.registerTool(
    'createDesign',
    {
      description: 'Create a new empty Canvas design.',
      inputSchema: {
        name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
      },
    },
    tool(
      'createDesign',
      async ({ name }: { name: string }) =>
        createDesign(userId, name),
    ),
  )

  server.registerTool(
    'renameDesign',
    {
      description: 'Rename a design.',
      inputSchema: {
        designId,
        name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
      },
    },
    tool('renameDesign', (args: { designId: string; name: string }) =>
      renameDesign(userId, args.designId, args.name),
    ),
  )

  server.registerTool(
    'deleteDesign',
    {
      description:
        'Archive a design after explicit confirmation. It leaves every list; the owner restores it, or deletes it for good, from the archive in the app.',
      inputSchema: { designId, confirmed: z.literal(true) },
      annotations: { destructiveHint: true },
    },
    tool(
      'deleteDesign',
      async ({ designId }: { designId: string; confirmed: true }) => ({
        archived: await archiveDesign(userId, designId),
      }),
    ),
  )

  server.registerTool(
    'listBranches',
    {
      description: 'List branches. Branch state is separate from the canvas package.',
      inputSchema: { designId },
    },
    tool('listBranches', ({ designId }: { designId: string }) =>
      listDrafts(userId, designId),
    ),
  )

  server.registerTool(
    'createBranch',
    {
      description: 'Create an isolated app-level branch from current Main.',
      inputSchema: {
        designId,
        name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
      },
    },
    tool(
      'createBranch',
      async (args: { designId: string; name: string }) =>
        createDraft(
          userId,
          args.designId,
          args.name,
        ),
    ),
  )

  server.registerTool(
    'proposeBranch',
    {
      description: 'Freeze an active branch for review.',
      inputSchema: {
        designId,
        draftId,
        description: z.string().trim().max(2_000).default(''),
      },
    },
    tool(
      'proposeBranch',
      (args: { designId: string; draftId: string; description: string }) =>
        proposeDraft(userId, args.designId, args.draftId, args.description),
    ),
  )

  server.registerTool(
    'reopenBranch',
    {
      description: 'Return a proposed branch to editable status.',
      inputSchema: { designId, draftId },
    },
    tool('reopenBranch', (args: { designId: string; draftId: string }) =>
      reopenDraft(userId, args.designId, args.draftId),
    ),
  )

  server.registerTool(
    'compareBranch',
    {
      description: 'Compare a branch with Main using field-level semantic merge.',
      inputSchema: { designId, draftId },
    },
    tool('compareBranch', (args: { designId: string; draftId: string }) =>
      compareDraft(userId, args.designId, args.draftId),
    ),
  )

  server.registerTool(
    'applyBranch',
    {
      description:
        'Apply a branch to Main. Supply a main or draft choice for every reported conflict.',
      inputSchema: {
        designId,
        draftId,
        expectedMainRevision: z.number().int().nonnegative(),
        expectedDraftRevision: z.number().int().nonnegative(),
        resolutions: z
          .record(z.string(), z.enum(['main', 'draft']))
          .default({}),
      },
    },
    tool('applyBranch',
      async (args: {
        designId: string
        draftId: string
        expectedMainRevision: number
        expectedDraftRevision: number
        resolutions: Record<string, 'main' | 'draft'>
      }) =>
        applyDraft(
          userId,
          args.designId,
          args.draftId,
          args.expectedMainRevision,
          args.expectedDraftRevision,
          args.resolutions,
        ),
    ),
  )

  server.registerTool(
    'closeBranch',
    {
      description: 'Close an active or proposed branch without applying it.',
      inputSchema: { designId, draftId, confirmed: z.literal(true) },
      annotations: { destructiveHint: true },
    },
    tool(
      'closeBranch',
      (args: { designId: string; draftId: string; confirmed: true }) =>
        closeDraft(userId, args.designId, args.draftId),
    ),
  )

  server.registerTool(
    'listVersions',
    {
      description: 'List version history for Main or one branch.',
      inputSchema: {
        ...targetShape,
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    tool(
      'listVersions',
      async (args: { designId: string; draftId?: string; limit: number }) =>
        listVersions(
          userId,
          args.designId,
          args.limit,
          args.draftId,
        ),
    ),
  )

  server.registerTool(
    'searchIcons',
    {
      description:
        'Search the supported icon libraries (hugeicons, lucide) by name. Omit library to search all. Use the returned library and name with insertIcon.',
      inputSchema: {
        query: z.string().max(80).default('').describe('Name fragment, for example "arrow" or "heart"'),
        library: iconLibrary.optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    tool('searchIcons', async (args: { query: string; library?: IconLibrary; limit: number }) =>
      searchIcons(args.query, args.library, args.limit),
    ),
  )

  server.registerTool(
    'insertIcon',
    {
      description:
        'Insert a library icon as an editable svg node (tagged data-icon-library / data-icon-name). Color sets the svg color style, size sets width and height, strokeWidth sets the outline weight. Restyle later with styleIcon. Pass parentId to put it in a frame. With no parentId on a named page it goes in the page root; on Page 1 it goes in the only top-level frame, sits top level when there is none, and is refused when there are several, so name the frame.',
      inputSchema: {
        ...targetShape,
        library: iconLibrary,
        name: z.string().min(1).max(80).describe('Icon name from searchIcons'),
        parentId: z.string().min(1).max(200).optional().describe('Element to insert into; defaults to the page root'),
        pageId: pageIdShape,
        ...iconStyleShape,
      },
    },
    tool('insertIcon', async (args: {
      designId: string
      draftId?: string
      library: IconLibrary
      name: string
      parentId?: string
      pageId?: string
      color?: string
      size?: number
      strokeWidth?: number
    }) => {
      const found = await readWebCanvasStore(userId, args.designId, args.draftId ?? null)
      if (found.status !== 'ready') throw new Error('Migrate this legacy design before using MCP.')
      const document = found.document
      const parentId = args.parentId ?? defaultIconParent(document, resolvePageId(document, args.pageId ?? null))
      if (parentId && document.nodes[parentId]?.kind !== 'element') {
        throw new Error(`Parent "${parentId}" is not an element in this design.`)
      }
      const siblings = Object.values(document.nodes).filter((node) => node.parentId === parentId)
      const nodes = iconNodes(args.library, args.name, {
        parentId,
        order: siblings.reduce((max, node) => Math.max(max, node.order), 0) + 1_024,
        color: args.color,
        size: args.size,
        strokeWidth: args.strokeWidth,
      })
      if (!nodes) {
        const suggestions = searchIcons(args.name, args.library, 8).map((icon) => icon.name)
        throw new Error(
          `No ${args.library} icon named "${args.name}". Nothing was inserted. Try: ${suggestions.join(', ') || 'searchIcons with a shorter query'}.`,
        )
      }
      const result = await applyWebCanvasTransactionToStore(
        userId,
        userId,
        args.designId,
        found.revision,
        {
          id: `icon-${crypto.randomUUID()}`,
          label: `Insert ${args.name} icon`,
          operations: nodes.map((node) => ({ type: 'node.insert', node })),
        },
        args.draftId ?? null,
      )
      requireApplied(result)
      return { nodeId: nodes[0]?.id, result: withoutDocument(result) }
    }),
  )

  server.registerTool(
    'styleIcon',
    {
      description:
        'Restyle an icon inserted with insertIcon: color, size (px) and strokeWidth in one atomic edit. Only the fields you pass change.',
      inputSchema: {
        ...targetShape,
        nodeId: z.string().min(1).max(200).describe('The icon svg node id returned by insertIcon'),
        ...iconStyleShape,
      },
    },
    tool('styleIcon', async (args: {
      designId: string
      draftId?: string
      nodeId: string
      color?: string
      size?: number
      strokeWidth?: number
    }) => {
      const found = await readWebCanvasStore(userId, args.designId, args.draftId ?? null)
      if (found.status !== 'ready') throw new Error('Migrate this legacy design before using MCP.')
      if (!isIconNode(found.document.nodes[args.nodeId])) {
        throw new Error(`Node "${args.nodeId}" is not an icon. Pass the nodeId insertIcon returned; nothing was changed.`)
      }
      const operation = iconStyleOperation(args.nodeId, args)
      if (!operation) throw new Error('Pass at least one of color, size or strokeWidth. Nothing was changed.')
      const result = await applyWebCanvasTransactionToStore(
        userId,
        userId,
        args.designId,
        found.revision,
        { id: `icon-${crypto.randomUUID()}`, label: 'Style icon', operations: [operation] },
        args.draftId ?? null,
      )
      return withoutDocument(requireApplied(result))
    }),
  )

  server.registerTool(
    'listPages',
    {
      description:
        'List a design\'s pages. Page 1 (pageId null) is always listed first: it starts empty, has no edge, and holds top-level frames. Every other page is isolated, with its own layers. pageId is the page root node id (use it as parentId, and as rootId for getWebScreenshot or exportDesign); null is the original unnamed page.',
      inputSchema: { ...targetShape },
      annotations: { readOnlyHint: true },
    },
    tool('listPages', async (args: { designId: string; draftId?: string }) => {
      const found = await readWebCanvasStore(userId, args.designId, args.draftId ?? null)
      if (found.status !== 'ready') throw new Error('Migrate this legacy design before using MCP.')
      return listPages(found.document).map((page) => ({
        pageId: page.id,
        name: page.name,
        stageColor: stageColor(found.document, page.id),
        ...(page.id === null
          ? { width: found.document.metadata.page?.width ?? DEFAULT_PAGE_WIDTH, height: found.document.metadata.page?.height ?? DEFAULT_PAGE_HEIGHT }
          : pageRootSize(found.document, page.id)),
      }))
    }),
  )

  server.registerTool(
    'createPage',
    {
      description:
        'Add a page: a new isolated canvas with its own layers, size and background, separate from every other page. Add a page only when the user asks for separate pages. By default design on Page 1, which starts empty and has no edge, with each screen or variant as its own top-level frame set side by side (applyWebTransaction node.insert with parentId null, position absolute, left, top, width, height). A page made here is a bounded, painted artboard. Returns pageId, the page root node id. Put content in it by passing pageId to insertIcon/insertShader, or pageId as parentId in applyWebTransaction node.insert. Rename a page by node.patch on its data-sheet-page attribute; delete one with node.delete on its pageId.',
      inputSchema: {
        ...targetShape,
        name: z.string().trim().min(1).max(200).optional().describe('Page name; defaults to the next "Page N"'),
        width: z.number().positive().max(100_000).optional().describe(`Width in px, default ${DEFAULT_PAGE_WIDTH}`),
        height: z.number().positive().max(100_000).optional().describe(`Height in px, default ${DEFAULT_PAGE_HEIGHT}`),
        background: z.string().min(1).max(64).optional().describe('Any CSS color, default white'),
      },
    },
    tool('createPage', async (args: {
      designId: string
      draftId?: string
      name?: string
      width?: number
      height?: number
      background?: string
    }) => {
      const found = await readWebCanvasStore(userId, args.designId, args.draftId ?? null)
      if (found.status !== 'ready') throw new Error('Migrate this legacy design before using MCP.')
      const node = pageNode(args.name ?? nextPageName(found.document), {
        order: nextRootOrder(found.document),
        width: args.width,
        height: args.height,
        background: args.background,
      })
      const result = await applyWebCanvasTransactionToStore(
        userId,
        userId,
        args.designId,
        found.revision,
        {
          id: `page-${crypto.randomUUID()}`,
          label: `Add page ${node.attributes['data-sheet-page']}`,
          operations: [{ type: 'node.insert', node }],
        },
        args.draftId ?? null,
      )
      requireApplied(result)
      return { pageId: node.id, result: withoutDocument(result) }
    }),
  )

  server.registerTool(
    'listFramePresets',
    {
      description:
        'List the frame sizes the editor offers when you pick the Frame tool, grouped as Phone, Tablet, Desktop, Presentation, Smartwatch, Paper and Social media, each with width and height in px. Pass a preset name to createFrame to make a frame of exactly that size.',
      annotations: { readOnlyHint: true },
    },
    tool('listFramePresets', async (_args: unknown) =>
      FRAME_PRESET_GROUPS.map((group) => ({
        group: group.label,
        presets: group.presets.map((preset) => ({
          name: preset.name,
          width: preset.width,
          height: preset.height,
        })),
      })),
    ),
  )

  server.registerTool(
    'createFrame',
    {
      description:
        'Add a frame to a page: a white, free-positioned box the person can move, resize and rename, built exactly as the editor\'s Frame tool builds one. Give a preset name from listFramePresets (for example "iPhone 16" or "MacBook Air") or a width and height. With no left and top it goes one gap to the right of the page\'s other top-level frames, so several calls set frames side by side. Returns nodeId; build the design inside it by passing nodeId as parentId in applyWebTransaction, insertIcon or insertShader.',
      inputSchema: {
        ...targetShape,
        preset: z.string().trim().min(1).max(100).optional().describe('A name from listFramePresets, matched ignoring case'),
        width: z.number().positive().max(100_000).optional().describe('Width in px; used when there is no preset'),
        height: z.number().positive().max(100_000).optional().describe('Height in px; used when there is no preset'),
        name: z.string().trim().min(1).max(200).optional().describe('Layer name; defaults to the preset name, or "Frame"'),
        pageId: pageIdShape,
        left: z.number().min(-100_000).max(100_000).optional().describe('Left edge in px on the page'),
        top: z.number().min(-100_000).max(100_000).optional().describe('Top edge in px on the page'),
      },
    },
    tool('createFrame', async (args: {
      designId: string
      draftId?: string
      preset?: string
      width?: number
      height?: number
      name?: string
      pageId?: string
      left?: number
      top?: number
    }) => {
      const found = await readWebCanvasStore(userId, args.designId, args.draftId ?? null)
      if (found.status !== 'ready') throw new Error('Migrate this legacy design before using MCP.')
      const document = found.document
      const preset = args.preset === undefined ? null : findFramePreset(args.preset)
      if (args.preset !== undefined && !preset) {
        throw new Error(`No frame preset named "${args.preset}". Call listFramePresets for the names. Nothing was added.`)
      }
      const width = preset?.width ?? args.width ?? NEW_FRAME_SIZE.width
      const height = preset?.height ?? args.height ?? NEW_FRAME_SIZE.height
      const parentId = canvasParentId(resolvePageId(document, args.pageId ?? null))
      const spot = freeFrameSpot(document, parentId)
      const siblings = Object.values(document.nodes).filter((node) => node.parentId === parentId)
      const node = frameNode({
        parentId,
        order: siblings.reduce((max, sibling) => Math.max(max, sibling.order), 0) + 1_024,
        name: args.name ?? preset?.name ?? 'Frame',
        width,
        height,
        left: args.left ?? spot.x,
        top: args.top ?? spot.y,
      })
      const result = await applyWebCanvasTransactionToStore(
        userId,
        userId,
        args.designId,
        found.revision,
        {
          id: `frame-${crypto.randomUUID()}`,
          label: `Add ${node.attributes['data-name']} frame`,
          operations: [{ type: 'node.insert', node }],
        },
        args.draftId ?? null,
      )
      requireApplied(result)
      return { nodeId: node.id, name: node.attributes['data-name'], width, height, result: withoutDocument(result) }
    }),
  )

  server.registerTool(
    'listShaders',
    {
      description:
        'List the available Paper shaders with their params: type, range or options, and default. Use the names and params with insertShader and styleShader.',
      annotations: { readOnlyHint: true },
    },
    tool('listShaders', async (_args: unknown) =>
      SHADER_NAMES.map((name) => ({
        name,
        label: SHADERS[name].label,
        description: SHADERS[name].description,
        params: SHADERS[name].params,
      })),
    ),
  )

  server.registerTool(
    'insertShader',
    {
      description:
        'Insert a Paper shader (animated WebGL gradient or texture) as an editable box, tagged data-shader / data-shader-params. Width and height are px; params tune the shader. Restyle later with styleShader. Renders in the editor and preview only; exported HTML keeps the box and its params but does not draw the shader. With no parentId the shader is its own free-positioned object on the page, placed beside the other top-level objects, so the person can move and resize it like a frame; give left and top to place it yourself. With a parentId it goes inside that element.',
      inputSchema: {
        ...targetShape,
        shader: shaderName,
        parentId: z.string().min(1).max(200).optional().describe('Element to insert into; defaults to the page root'),
        pageId: pageIdShape,
        width: z.number().positive().max(8_192).optional().describe('Width in px, default 400'),
        height: z.number().positive().max(8_192).optional().describe('Height in px, default 300'),
        left: z.number().min(-100_000).max(100_000).optional().describe('Left edge in px, in its parent. Defaults to the next free spot beside the page\'s other top-level objects.'),
        top: z.number().min(-100_000).max(100_000).optional().describe('Top edge in px, in its parent. Defaults to level with the page\'s highest top-level object.'),
        params: shaderParamsShape,
      },
    },
    tool('insertShader', async (args: {
      designId: string
      draftId?: string
      shader: ShaderName
      parentId?: string
      pageId?: string
      width?: number
      height?: number
      left?: number
      top?: number
      params?: Record<string, number | string | string[]>
    }) => {
      const found = await readWebCanvasStore(userId, args.designId, args.draftId ?? null)
      if (found.status !== 'ready') throw new Error('Migrate this legacy design before using MCP.')
      const document = found.document
      // With no parent a shader is its own object on the page, placed like a frame,
      // so the person can pick it up, move it and resize it. With a parent it goes in
      // that element, in flow, unless a position is asked for.
      const parentId = args.parentId ?? canvasParentId(resolvePageId(document, args.pageId ?? null))
      if (parentId && document.nodes[parentId]?.kind !== 'element') {
        throw new Error(`Parent "${parentId}" is not an element in this design.`)
      }
      const spot = args.parentId === undefined ? freeFrameSpot(document, parentId) : null
      const left = args.left ?? spot?.x
      const top = args.top ?? spot?.y
      const siblings = Object.values(document.nodes).filter((node) => node.parentId === parentId)
      const node = shaderNode(args.shader, {
        parentId,
        order: siblings.reduce((max, sibling) => Math.max(max, sibling.order), 0) + 1_024,
        width: args.width,
        height: args.height,
        params: args.params,
        ...(left !== undefined && top !== undefined ? { left, top } : {}),
      })
      const result = await applyWebCanvasTransactionToStore(
        userId,
        userId,
        args.designId,
        found.revision,
        {
          id: `shader-${crypto.randomUUID()}`,
          label: `Insert ${args.shader} shader`,
          operations: [{ type: 'node.insert', node }],
        },
        args.draftId ?? null,
      )
      requireApplied(result)
      return { nodeId: node.id, result: withoutDocument(result) }
    }),
  )

  server.registerTool(
    'styleShader',
    {
      description:
        'Change a shader inserted with insertShader: params (merged over the current ones), width and height in one atomic edit. Only the fields you pass change.',
      inputSchema: {
        ...targetShape,
        nodeId: z.string().min(1).max(200).describe('The shader node id returned by insertShader'),
        width: z.number().positive().max(8_192).optional(),
        height: z.number().positive().max(8_192).optional(),
        params: shaderParamsShape,
      },
    },
    tool('styleShader', async (args: {
      designId: string
      draftId?: string
      nodeId: string
      width?: number
      height?: number
      params?: Record<string, number | string | string[]>
    }) => {
      const found = await readWebCanvasStore(userId, args.designId, args.draftId ?? null)
      if (found.status !== 'ready') throw new Error('Migrate this legacy design before using MCP.')
      const node = found.document.nodes[args.nodeId]
      if (!isShaderNode(node)) {
        throw new Error(`Node "${args.nodeId}" is not a shader. Pass the nodeId insertShader returned; nothing was changed.`)
      }
      const operation = shaderPatchOperation(node, args)
      if (!operation) throw new Error('Pass at least one of params, width or height. Nothing was changed.')
      const result = await applyWebCanvasTransactionToStore(
        userId,
        userId,
        args.designId,
        found.revision,
        { id: `shader-${crypto.randomUUID()}`, label: 'Style shader', operations: [operation] },
        args.draftId ?? null,
      )
      return withoutDocument(requireApplied(result))
    }),
  )

  server.registerTool(
    'listComments',
    {
      description:
        'Read the comments a person pinned to elements of a design. Each comment names the element it is about (nodeId, plus its current tag, text and id/class so you can find it without a second call), who wrote it, and whether it is resolved. Pass nodeId to read only the comments on one element; by default only open comments come back. Treat each comment as an instruction from the designer about that element: read the node with getWebDocument, make the change with applyWebTransaction, then call resolveComment. Comments sit beside the document and are never part of the HTML, CSS or JSON exports.',
      inputSchema: {
        designId,
        nodeId: z.string().min(1).max(128).optional().describe('Only comments on this element'),
        status: commentStatusSchema.optional().describe('open (default), resolved or all'),
        draftId: draftId.optional().describe('Read element details from this branch instead of Main'),
      },
      annotations: { readOnlyHint: true },
    },
    tool('listComments', async (args: {
      designId: string
      nodeId?: string
      status?: CommentStatus
      draftId?: string
    }) => {
      const comments = await listDesignComments(userId, args.designId, args)
      const found = await readWebCanvasStore(userId, args.designId, args.draftId ?? null)
      const document = found.status === 'ready' ? found.document : null
      return {
        count: comments.length,
        comments: comments.map((comment) => ({
          ...comment,
          element: describeCommentedNode(document, comment.nodeId),
        })),
      }
    }),
  )

  server.registerTool(
    'resolveComment',
    {
      description:
        'Mark a comment as resolved once you have acted on it, or pass resolved: false to reopen it. The designer sees the change in the editor straight away. Does not edit the design.',
      inputSchema: {
        designId,
        commentId: z.string().min(1).max(128).describe('Comment id from listComments'),
        resolved: z.boolean().optional().describe('Defaults to true'),
      },
    },
    tool('resolveComment', async (args: { designId: string; commentId: string; resolved?: boolean }) =>
      setDesignCommentResolved(userId, args.designId, args.commentId, args.resolved ?? true),
    ),
  )

  server.registerTool(
    'listAssets',
    { description: 'List the local uploaded image assets.' },
    tool('listAssets', async (_args: unknown) => listAssets(userId)),
  )

  server.server.setRequestHandler(ListToolsRequestSchema, () =>
    buildToolList(toolCatalog) as { tools: never[] },
  )

  return {
    server,
    async execute(name: string, args: unknown) {
      const registered = toolCatalog.find((tool) => tool.name === name)
      const handler = toolHandlers.get(name)
      if (!registered || !handler) throw new Error(`Unknown tool "${name}"`)
      const parsed = registered.config.inputSchema
        ? z.object(registered.config.inputSchema).parse(args)
        : {}
      return handler(parsed)
    },
  }
}

export function createSheetServer(
  userId: string,
  usage: McpUsageController,
) {
  return createSheetRuntime(userId, usage).server
}

export function createSheetToolExecutor(
  userId: string,
  usage: McpUsageController,
) {
  return createSheetRuntime(userId, usage).execute
}
