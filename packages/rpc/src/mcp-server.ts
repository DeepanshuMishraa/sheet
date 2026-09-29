import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { serializeWebDocument } from '@sheet/canvas/web-model'
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

const iconLibrary = z
  .enum(ICON_LIBRARIES.map((entry) => entry.id) as [IconLibrary, ...IconLibrary[]])
  .describe('Icon set: hugeicons or lucide')
const iconStyleShape = {
  color: z.string().min(1).max(64).optional().describe('Any CSS color; icons draw in currentColor'),
  size: z.number().positive().max(2_048).optional().describe('Width and height in px'),
  strokeWidth: z.number().positive().max(8).optional().describe('Outline weight in the 24px viewBox'),
}
const targetShape = {
  designId,
  draftId: draftId.optional().describe('Branch target; omit for Main'),
}

export function appUrl(
  design: string,
  branch?: string,
  extra: Record<string, string | undefined> = {},
) {
  const origin = (process.env.SHEET_APP_URL?.trim() || 'https://sheet.design').replace(/\/+$/, '')
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
        'Mutate a web-native document with one validated WebTransaction: the same operation vocabulary, validation, undo inverses, revision compare-and-swap, history, and realtime path the editor uses. Operations: node.insert/node.patch/node.move/node.delete, stylesheet.insert/stylesheet.patch/stylesheet.delete, rule.insert/rule.patch/rule.move/rule.delete, component.define/component.delete, instance.create/instance.delete/instance.setOverride/instance.clearOverride. To resize the page, node.patch the root element width and height, for example 1440px by 2400px. Rules: patching a bound instance node directly is rejected (use instance.setOverride with text, attributes, or --custom-properties); template edits propagate to instances automatically; component CSS reaches instances through the normal cascade. Stale expectedRevision returns applied:false with reason stale instead of overwriting.',
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
      },
    },
    tool('applyWebTransaction', async (args: {
      designId: string
      draftId?: string
      expectedRevision: number
      transaction: unknown
    }) =>
      applyWebCanvasTransactionToStore(
        userId,
        userId,
        args.designId,
        args.expectedRevision,
        args.transaction,
        args.draftId ?? null,
      ),
    ),
  )


  server.registerTool(
    'getWebScreenshot',
    {
      description:
        'Render a real PNG of a web-native document with the same standalone HTML/CSS serialization the editor materializes. Call this after meaningful edits to verify the visual result. Read-only: revisions, history, and the document are untouched.',
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
            openUrl: appUrl(args.designId, undefined, {
              node: screenshot.rootId ?? undefined,
            }),
          },
        }
      },
    ),
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
        'Insert a library icon as an editable svg node (tagged data-icon-library / data-icon-name). Color sets the svg color style, size sets width and height, strokeWidth sets the outline weight. Restyle later with styleIcon. Defaults to the first root as parent.',
      inputSchema: {
        ...targetShape,
        library: iconLibrary,
        name: z.string().min(1).max(80).describe('Icon name from searchIcons'),
        parentId: z.string().min(1).max(200).optional().describe('Element to insert into; defaults to the first root'),
        ...iconStyleShape,
      },
    },
    tool('insertIcon', async (args: {
      designId: string
      draftId?: string
      library: IconLibrary
      name: string
      parentId?: string
      color?: string
      size?: number
      strokeWidth?: number
    }) => {
      const found = await readWebCanvasStore(userId, args.designId, args.draftId ?? null)
      if (found.status !== 'ready') throw new Error('Migrate this legacy design before using MCP.')
      const document = found.document
      const parentId = args.parentId ?? document.roots[0] ?? null
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
      return { nodeId: nodes[0]?.id, result }
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
      return requireApplied(result)
    }),
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
