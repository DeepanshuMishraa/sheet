import { RPCHandler } from '@orpc/server/fetch'
import { and, eq } from 'drizzle-orm'
import { LOCAL_USER_ID, db, ensureLocalUser } from '@sheet/db'
import { asset } from '@sheet/db/schema'
import { appRouter } from '@sheet/rpc'
import { buildHandoffPayload } from '@sheet/rpc/handoff'
import { readHandoffToken } from '@sheet/rpc/handoff-token'
import {
  messageTargetsRoom,
  subscribeLocalEvents,
} from '@sheet/realtime/local-bus'
import { configFrom } from './config'
import { createAppState, handleRequest } from './handler'

/**
 * The local Sheet server. One Bun process serves everything the desktop
 * window and local MCP clients need:
 *
 * - `POST /mcp` — the MCP JSON-RPC endpoint (no auth, local user)
 * - `/api/rpc/*` — the oRPC router the editor talks to
 * - `/api/asset/:id` — image bytes from the asset table
 * - `/api/handoff/:token` (+ `/asset/:id`) — agent handoff payloads
 * - `/api/canvas-events` — live canvas/branch/agent events over SSE,
 *   backed by the in-process bus (no socket service, no Redis)
 *
 * The Tauri host spawns this on startup; `bun run dev:mcp` runs it directly.
 */

const LOCAL_SESSION_ID = 'local'

const rpc = new RPCHandler(appRouter)

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

async function serveAsset(id: string) {
  const [row] = await db
    .select({ mediaType: asset.mediaType, size: asset.size, data: asset.data })
    .from(asset)
    .where(and(eq(asset.id, id), eq(asset.userId, LOCAL_USER_ID)))
    .limit(1)
  if (!row?.data) return new Response('Not found', { status: 404 })
  const bytes = Buffer.from(row.data, 'base64')
  return new Response(bytes, {
    headers: {
      'content-type': row.mediaType,
      'content-length': String(bytes.length),
      'cache-control': 'private, max-age=86400',
    },
  })
}

async function serveHandoffAsset(token: string, id: string) {
  const claims = await readHandoffToken(token)
  if (!claims) return new Response('Not found', { status: 404 })
  const [row] = await db
    .select({ mediaType: asset.mediaType, data: asset.data })
    .from(asset)
    .where(and(eq(asset.id, id), eq(asset.userId, claims.userId)))
    .limit(1)
  if (!row?.data) return new Response('Not found', { status: 404 })
  const bytes = Buffer.from(row.data, 'base64')
  return new Response(bytes, {
    headers: {
      'content-type': row.mediaType,
      'content-length': String(bytes.length),
      'cache-control': 'private, max-age=86400',
    },
  })
}

function serveCanvasEvents(request: Request) {
  const url = new URL(request.url)
  const designId = url.searchParams.get('designId') ?? ''
  const draftId = url.searchParams.get('draftId')
  let closed = false
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(new TextEncoder().encode(chunk))
      }
      send(
        sseEvent('ready', {
          type: 'ready',
          sessionId: LOCAL_SESSION_ID,
          role: 'owner',
          peers: [],
          activity: null,
          sentAt: Date.now(),
        }),
      )
      const unsubscribe = subscribeLocalEvents((message) => {
        if (!messageTargetsRoom(message, designId, draftId)) return
        send(sseEvent('canvas', { ...message.event, sentAt: message.sentAt }))
      })
      const heartbeat = setInterval(() => send(':keepalive\n\n'), 20_000)
      request.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        controller.close()
      })
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  })
}

async function route(request: Request, state: ReturnType<typeof createAppState>) {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (path === '/mcp' || path === '/ready' || path === '/health' || path === '/') {
    return handleRequest(request, state)
  }
  if (path.startsWith('/api/rpc')) {
    const result = await rpc.handle(request, {
      prefix: '/api/rpc',
      context: { request },
    })
    if (result.matched) return result.response
    return new Response('Not found', { status: 404 })
  }
  if (path.startsWith('/api/asset/')) {
    return serveAsset(decodeURIComponent(path.slice('/api/asset/'.length)))
  }
  const handoffAsset = /^\/api\/handoff\/([^/]+)\/asset\/([^/]+)$/.exec(path)
  if (handoffAsset) {
    return serveHandoffAsset(
      decodeURIComponent(handoffAsset[1]!),
      decodeURIComponent(handoffAsset[2]!),
    )
  }
  const handoff = /^\/api\/handoff\/([^/]+)$/.exec(path)
  if (handoff && request.method === 'GET') {
    const payload = await buildHandoffPayload(
      decodeURIComponent(handoff[1]!),
      url.origin,
    )
    if (!payload) return new Response('Not found', { status: 404 })
    return Response.json(payload, { headers: { 'cache-control': 'no-store' } })
  }
  if (path === '/api/handoff' && request.method === 'GET') {
    return new Response('Not found', { status: 404 })
  }
  if (path === '/api/realtime-ticket') {
    // No socket service locally — the client falls back to the event stream.
    return Response.json(
      { error: 'No socket service here' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
  if (path === '/api/canvas-events' && request.method === 'GET') {
    return serveCanvasEvents(request)
  }
  if (path === '/api/canvas-presence' && request.method === 'POST') {
    return Response.json(
      { sessionId: LOCAL_SESSION_ID },
      { headers: { 'cache-control': 'no-store' } },
    )
  }
  return new Response('Not found', { status: 404 })
}

const config = configFrom((key) => process.env[key])
const state = createAppState(config)

await ensureLocalUser()

const server = Bun.serve({
  port: config.port,
  fetch: (request, server) => {
    // Bun closes connections idle for 10s; a quiet event stream is idle by design.
    if (new URL(request.url).pathname === '/api/canvas-events') server.timeout(request, 0)
    return route(request, state)
  },
})

console.info(`Sheet local server listening on http://localhost:${server.port}`)
console.info(`MCP endpoint: http://localhost:${server.port}/mcp`)
