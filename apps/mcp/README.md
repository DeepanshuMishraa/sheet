# `@sheet/mcp`

The Sheet local server. One Bun process serves everything over SQLite:

| Route | Purpose |
|-------|---------|
| `POST` `/mcp` | MCP JSON-RPC (Streamable HTTP), all 35 tools, no auth |
| `/api/rpc/*` | oRPC router for the desktop editor |
| `/api/asset/:id` | Image bytes from the asset table |
| `/api/handoff/:token` | Agent handoff payloads (+ `/asset/:id`) |
| `/api/canvas-events` | Live canvas/branch/agent events over SSE |
| `GET` `/ready`, `/health` | Liveness |

Tools execute in-process through the canonical `createSheetToolExecutor`
from `@sheet/rpc/mcp-server` — the same Canvas engine, branch/history
persistence, exporter, screenshot renderer, and asset handling the editor
uses. There is exactly one implementation of Sheet's document semantics,
one user (`local`), no accounts, no meters.

## Run

```sh
bun run dev              # server on :4100 (SHEET_MCP_PORT)
```

Point any MCP client at `http://127.0.0.1:4100/mcp`:

```sh
claude mcp add --transport http sheet http://127.0.0.1:4100/mcp
```

Stdio mode for clients that spawn a process:

```sh
bun run dev:stdio
```

Environment: `SHEET_SQLITE_PATH` (default `./data/sheet.db`,
`:memory:` for tests), `SHEET_HANDOFF_SECRET` (handoffs only),
`REDIS_URL` (optional rate-limit counters, else in-memory).

Compile a self-contained sidecar binary for the desktop app:

```sh
bun run build:server   # apps/mcp/dist/sheet-server
```

## Validate

```sh
bun run test apps/mcp
bunx tsc --noEmit
```
