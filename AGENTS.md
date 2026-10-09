# Repository Guidelines

Sheet is an infinite-canvas design tool. Users arrange structured UI nodes on a
canvas; local MCP clients (and agent handoff consumers) mutate the same
document through typed transactions. Designs have version history, isolated
drafts/branches, and one-way exports.
Bringing your own agent over MCP or handoff is the first-class path.

It ships as a desktop app with its own local server — the interface from
the shared packages, over a native window, and the same document through
typed agent tools. No accounts, no hosted services: one SQLite file, one
loopback server.

**Stack:** Bun workspaces monorepo · React 19 · Vite + Tauri
(desktop) · Drizzle + SQLite (bun:sqlite) · oRPC · Docker (local server).

---

## Project Structure

```
apps/desktop      Tauri host + Vite interface for the desktop app
apps/mcp          Local server: MCP endpoint, oRPC API, assets, handoffs, SSE — all on SQLite
packages/ui       Shared design-system primitives, tokens, icon barrel, `cn` (`@sheet/ui`)
packages/shell    Design browser, settings, integrations, mounted by the desktop app (`@sheet/shell`)
packages/platform Which client this is, and where its API and links point (`@sheet/platform`)
packages/editor   Canvas editor shell, panels, client sync (`@sheet/editor`)
packages/canvas   Canvas model, engine, merge, React surface, import, export
packages/db       Drizzle schema, bun:sqlite client, migrations (`@sheet/db`)
packages/rpc      oRPC `appRouter`, storage, history, handoff (`@sheet/rpc`)
packages/agent    Shared canvas tools + layout repair for MCP (`@sheet/agent`)
packages/realtime Realtime wire protocol plus the in-process local event bus (`@sheet/realtime`)
```

### Local server (`apps/mcp`)

One Bun process is the whole backend, and the only backend there is. With
`SHEET_SQLITE_PATH` set (default `./data/sheet.db`) it serves MCP
(`POST /mcp`, all 32 tools, no auth), the oRPC API the editor talks to
(`/api/rpc/*`), assets (`/api/asset/:id`), handoffs (`/api/handoff/*`), and
the live event stream (`/api/canvas-events`, SSE over the in-process bus).
`GET /ready` is the health check. `bun run build:server` compiles it to a
self-contained sidecar binary the desktop app spawns on startup.

### `packages/ui` (`@sheet/ui`)

Presentational design-system layer. **Must never** import db, RPC, canvas, or anything from an app — it holds no product state and runs no data fetching.

| Export | Role |
|--------|------|
| `@sheet/ui/<name>` | One primitive per file, e.g. `@sheet/ui/button`, `@sheet/ui/dialog` (`src/components/<name>.tsx`) |
| `@sheet/ui/utils` | `cn` (clsx + tailwind-merge) |
| `@sheet/ui/icons` | The hugeicons barrel — the only place `@hugeicons/*` is imported |
| `@sheet/ui/hooks/*` | Presentational hooks, e.g. `@sheet/ui/hooks/use-media-query` |

Design tokens live in `packages/ui/src/styles.css`, which the desktop app
imports — it also carries the `@source` lines for every package outside an
app that ships classes. Each app's own entry stylesheet keeps only what is
its own: the Tailwind import, its fonts, its sources.

The shadcn CLI is pointed here, so generated primitives land in the package
rather than an app.

### `packages/editor` (`@sheet/editor`)

The `/design` surface: the editor shell and every panel that hangs off it, plus
the client half of canvas sync.

| Export | Role |
|--------|------|
| `@sheet/editor/app` | `CanvasApp` — the whole editor, mounted by the design routes |
| `@sheet/editor/<name>` | Panels and dialogs: `editor`, `branches`, `history`, `export-panel`, `layers-panel`, `properties-panel`, `share-dialog`, `assets-panel`, `canvas-preview`, … |
| `@sheet/editor/lib/canvas-client` | `CanvasSyncController` — optimistic apply, batching, rebase, realtime |
| `@sheet/editor/lib/*` | Clipboard, HTML paste/import, code copy, capture, shortcuts, design list helpers |

It depends on `@sheet/canvas`, `@sheet/ui`, `@sheet/rpc` (client), and
**must never** import from an app. Where the editor needs
a product surface it does not own, the app passes it in: `CanvasApp` takes
`renderSettings` so the settings dialog body (appearance, shortcuts)
stays in the shell. Add a slot rather than an import back into the app.

### `packages/shell` (`@sheet/shell`)

Every product surface that is not the canvas: the design browser, settings,
and integrations. The desktop app mounts these, so a route file in it is
a few lines that pick a surface.

| Export | Role |
|--------|------|
| `@sheet/shell/<name>` | A surface, e.g. `@sheet/shell/designs-dashboard` |
| `@sheet/shell/lib/*` | Theme, interface scale, custom themes, URL state |

It depends on `@sheet/editor`, `@sheet/ui`, `@sheet/rpc`, and
`@sheet/platform`, and **must never** import from an app.

There are no marketing pages in this repo: the desktop window never renders
them.

### `packages/platform` (`@sheet/platform`)

Four questions, one answer each, for code that runs in more than one client:
which platform this is, which origin serves `/api`, which origin a link handed
to a browser should name, and how to follow a link that leaves the app. It
imports **nothing** — `@sheet/rpc/client` and the editor
depend on it, so it can depend on none of them.

The defaults assume the API lives on the same origin and links open in the
same tab — correct for a browser client, wrong for desktop, so the desktop
app calls `configureRuntime` once, before anything renders.

### `packages/canvas` (`@sheet/canvas`)

Dependency-light canvas core. **Must never** import db, RPC, auth, web, drafts, or branch concepts. Branches are product targets owned by RPC/MCP.

| Export | Role |
|--------|------|
| `@sheet/canvas/model` | `CanvasDocument`, node types, IDs, validation |
| `@sheet/canvas/engine` | Typed transactions, indexes, undo/redo, preconditions, rebase, subscriptions |
| `@sheet/canvas/merge` | Neutral left/right semantic merge |
| `@sheet/canvas/react` | DOM/SVG renderer, surface, overlays, hooks |
| `@sheet/canvas/motion` | Transitions, keyframe animations, easings, and the CSS they generate |
| `@sheet/canvas/export` | One-way HTML, JSX, Tailwind, React/TSX, JSON, PNG compile |
| `@sheet/canvas/import` | HTML/CSS snapshot conversion into validated structured nodes |

Editor UI lives in `packages/editor` (branch panel, sync target, history, export, layers, properties). Keep branch/sync controllers outside the canvas package. The canvas package knows nothing about agents.

### `packages/agent` (`@sheet/agent`)

Shared canvas mutation vocabulary for MCP (and handoff consumers), not models or chat:

- `canvas-tools` — typed tool handlers over the same transaction path as the editor/RPC
- `repair-layout` — layout repair utility used by `bun run canvas:repair-layout`

### `packages/rpc` (`appRouter` namespaces)

`preferences` · `design` · `canvas` · `draft` · `handoff` · `history` · `asset`

Every product mutation goes through oRPC. External agents use MCP or handoff.
There are no sessions and no gates: each procedure runs as the single local
user (`localProcedure` in `procedures.ts`).

The client is `@sheet/rpc/client` (`orpc`). It imports `appRouter` as a
type only, so no server implementation follows it into the bundle.

### Local server (`apps/mcp` — the `/mcp` half is in `handler.ts`)

The same Bun process from the section above. `handler.ts` owns MCP transport
concerns only — rate limiting and stateless Streamable HTTP (`stdio.ts` is
the local stdio adapter) — and executes every tool call in-process through
`src/executor.ts`, i.e. the same `createSheetToolExecutor` from
`@sheet/rpc/mcp-server` the editor path uses: CanvasEngine validation,
persistence, exports, screenshots, and asset handling, with realtime
publishing onto the local bus so the open editor updates live.

### `apps/desktop`

A real application, not a wrapper around a website: a Tauri window over the
shared interface, built by Vite from the same packages.

- **The host** (`src-tauri/`) runs under Rust. It serves a loopback HTTP
  server, opens the window on it, and spawns the compiled local server on
  startup. `/api/*` is proxied to `SHEET_API_ORIGIN` (the sidecar) — so
  the window needs no cookie, no CORS, and no credential of its own, and
  images, the event stream, and oRPC behave as they do over the network.
- **The interface** (`src/`) is Vite + React on TanStack Router and Query,
  mounting `@sheet/shell`. Vite serves it in development (proxying `/api`,
  `/desktop`, `/callback`, `/realtime` back to the host) and the host serves
  the built files in a packaged app.
- **Data** lives in one SQLite file in the OS app-data dir
  (`SHEET_DATA_DIR` overrides). Back it up by copying the file.
- Anything that leaves the app — a hand-off URL opened elsewhere — opens
  in a browser.

- **Settings** is a window of its own, opened from the application menu
  (Sheet › Settings…, ⌘,) and from nowhere inside the interface. The host builds
  the menu in `build_menu` and opens the window at `/settings` in
  `open_settings` (`src-tauri/src/main.rs`); the route is
  `apps/desktop/src/routes/settings.tsx` and the screen is
  `@sheet/shell/settings-window` (Appearance, Sound, Shortcuts, Agents). The
  window is its own webview on the same loopback origin, so its choices reach
  the main window through `localStorage` and the `storage` event: theme
  (`sheet:theme`), accent (`sheet:accent`), interface size (`sheet:ui-scale`),
  sound (`sheet:sound`, `sheet:sound-volume`). Both windows are listed in
  `capabilities/*.json`; a new window needs its label added there.
- **Theme and accent.** Two palettes only, light and dark, plus a System pick
  (`@sheet/shell/lib/theme`). One accent hue is spent on selection, focus and
  whatever is live; the person picks orange (default), blue, violet, green, pink
  or teal (`@sheet/shell/lib/accent`, applied as `data-accent` on `<html>`, with
  matching blocks at the end of `packages/ui/src/tokens.css`). Palette tokens
  live in `tokens.css`; every focus ring and `--chart-1` follows `--cx-accent`.

See `apps/desktop/README.md`.

### `packages/db`

- Schema: `packages/db/src/schema.ts`
- Migrations: `packages/db/drizzle/` (commit SQL **and** `meta/` snapshots)
- Tables: `user` (one `local` row), `design`, `designDraft`, `designVersion`,
  `canvasTransaction`, `asset`, `userPreferences`. Nothing else — no sharing,
  no billing, no publishing.

Legacy helpers remain in `@sheet/db/canvas` and `@sheet/db/drafts` for rollback and expiring-link compatibility.

---

## Build, Test, and Development Commands

Root scripts (from repo root; env loaded from `.env` where needed):

| Command | Purpose |
|---------|---------|
| `bun install` | Install pinned Bun workspace deps |
| `bun run dev` | Local server on `:4100` (oRPC + MCP + SSE) |
| `bun run dev:desktop` | Desktop app: Vite on `:1421`, host on `:4300`, window opens |
| `bun run dev:stdio` | MCP stdio adapter |
| `bun run build:server` | Compile the local server to a sidecar binary |
| `bun run build:desktop` | Desktop interface → `apps/desktop/dist/app`, then the app bundle |
| `bun run check:desktop` | `cargo check` on the desktop host + `tsc` on its interface |
| `bun run test` | All Vitest suites with the shared JSDOM setup |
| `bun run generate-routes` | Regenerate the desktop TanStack route tree after route file changes |
| `bun run db:generate` | Create migration from `schema.ts` changes |
| `bun run db:migrate` | Apply pending migrations |
| `bun run db:studio` | Drizzle Studio |
| `bunx tsc --noEmit` | Strict TypeScript check |
| `bun run canvas:repair-layout` | Layout repair utility (`packages/rpc`) |
| `bun run assets:backfill-urls` | Rewrite `/api/asset/…` references to the public bucket URL (dry run without `--apply`) |

MCP local: `bun run dev` (or `bun run dev:stdio`).

**Always** use `bun run test` so Vitest loads `vitest.setup.ts` for DOM globals
(plus an in-memory SQLite database).

Copy `.env.example` → `.env` before dev. Required pieces typically include `SHEET_SQLITE_PATH`; optional storage keys as needed.

Deploy: Railway via root `Dockerfile` / `railway.json` for the MCP server.

A **new workspace package** has to be added to the root `Dockerfile` in all
three places it lists members: the manifest copies before `bun install
--frozen-lockfile`, the `node_modules` copies into the runtime stage, and the
source/manifest copies after them. A member the image never copies cannot
resolve — the build fails at install, before any app code compiles. Local
installs succeed either way, so this only ever shows up on Railway.

---

## Pages, frames and the canvas

The editor's document is the web model (`@sheet/canvas/web-model`), and what a
person sees as a page is described in `@sheet/canvas/web-pages`.

- Every design has **Page 1**, always listed first, **empty** until something is
  made on it, with no edge and no page-sized box. Nothing is drawn on it by
  default; the editor overrides the document view's white default so an empty
  page is empty.
- Content on a page is one or more **top-level frames**: white, free-positioned
  (`position:absolute`, `left`, `top`, `width`, `height`) boxes that can be
  moved, resized from eight handles, and renamed by double-clicking the label
  above them. They come from the Frame tool's size list (right panel, groups
  start folded, the tool stays on so several can be placed) and are built by
  `frameNode` / `freeFrameSpot` in `@sheet/canvas/web-frames`, the same code the
  `createFrame` agent tool uses. The size list is `FRAME_PRESET_GROUPS` there.
- **Pages the person adds are open** like Page 1 (`pageNode(..., { open: true })`:
  `overflow: visible`, transparent). Pages made by the `createPage` tool are
  **bounded** painted artboards. `isBoundedPage` tells them apart; only a
  bounded page shows an edge, a size and a background on its root.
- Two document fields stand in for what Page 1 has no node to carry:
  `metadata.pageOneName` (operation `page.setName`) and `metadata.stageColors`
  (operation `page.setStage`), the colour behind a page's frames. Both go
  through transactions, so undo, history and agents see them. A bounded page's
  colour is still the root's own `background`. `web-export.ts` (`stageCss`)
  writes the colour into exports and captures: Page 1's as the body (HTML) or
  export-root (capture) background, an open named page's on its root in a
  capture. A capture of a single frame shows the frame alone.
- The **Shaders** tool opens a gallery of every shader running live
  (`ShaderGallery`); choosing one places it like a frame, top level and
  free-positioned. `insertShader` with no `parentId` does the same for agents.
- Agent defaults follow from this: `insertIcon` with no `parentId` goes in
  Page 1's only frame and is refused when there are several; `createFrame` and
  `listFramePresets` give agents the same size list the editor has.

## Canvas Invariants

These are easy to break and expensive to fix. Treat them as hard rules.

1. **`CanvasDocument` is the only writable source of truth.** Normalized by node ID. Roots are Pages and Components; children are frames, groups, text, shapes, vectors, images, instances. Layout, styles, breakpoints, tokens, themes, instance overrides, and interactions are structured values.
2. **No code-node escape hatch.** Never add arbitrary code nodes, freeform CSS/class strings as the authoring model, or two-way source sync with exported code.
3. **All mutations are validated `CanvasTransaction`s.** Same ops and engine for React UI, oRPC, MCP tools, and handoff consumers. Transactions need stable idempotency IDs and touched-field preconditions.
4. **Do not full-document replace on every move.** Pointer previews may use temporary DOM transforms; commit one transaction on pointer-up.
5. **Render is real DOM/SVG** with `data-sheet-node` and instance-path metadata. One camera transform + viewport-space SVG overlay. Document state lives in the engine; camera, selection, hover, tool, and isolation are ephemeral. Subscribe nodes to their own revision/parent order — avoid full-tree rerenders.
6. **Agent input is structured node descriptors**, not source code. Temporary client refs must resolve to permanent IDs. Destructive actions require confirmation in product UX: `deleteNodes` takes `confirmed: true` over MCP.
7. **Exports are one-way** (HTML/CSS/JS, React/TSX, JSON, PNG, preview). They never round-trip into the editor.
8. **Pull requests are not a Sheet feature.** Drafts are the branch/merge model (`active` → `proposed` → `applied` | `closed`).
9. **Deleting a design file means archiving it.** `design.archivedAt` takes it out of every list. `design.delete` is the only hard delete, it refuses a file that is not archived, and the Archived tab at `/app` is the only place that reaches it. The MCP `deleteDesign` tool archives.

### Shared MCP / handoff tool vocabulary

Keep MCP tools and handoff consumers aligned on the shared `@sheet/agent` vocabulary:

`createPage` · `insertNodes` · `insertIcon` · `patchNodes` · `moveNodes` · `deleteNodes` · `readNode` · `readTree` · `searchNodes` · `searchIcons` · `createComponent` · `createInstance` · `setTokens` · `setAnimations` · `animateNodes` · `viewNode` · `viewPage` · `viewCanvas`

Implementation: `packages/agent/src/canvas-tools.ts`, canonical MCP execution in `packages/rpc/src/mcp-server.ts`, and local transport in `apps/mcp/src/`.

### Realtime

One process, one bus, no gate.

- `@sheet/realtime` holds the wire protocol (`canvas.changed`, `agent.activity`,
  `presence.peer`, `presence.state`) and the in-process local event bus
  (`local-bus`). It imports nothing from db or canvas.
- The editor opens `/api/canvas-events` (SSE). The local server answers
  `503` on `/api/realtime-ticket` (no socket service), so the client takes
  the stream immediately: a `ready` frame, then `canvas` frames for
  invalidations, branch changes, and agent activity, filtered by design and
  branch. Presence posts to `/api/canvas-presence` are accepted and ignored —
  one user has no peers.
- Server-side publishers (oRPC, MCP tools) call the same
  `@sheet/db/canvas-realtime` functions as before. Those emit onto the local
  bus first, then try the ingest URL and Redis exactly as before; either may
  be unconfigured, in which case the bus is the whole transport.

Env: `REDIS_URL` for the local server's rate-limit counters (in-memory
fallback when unset). Keys are prefixed `ratelimit:`.

### Rate limiting

`apps/mcp/src/rate-limit` counts the `mcp` / `mcp-address` / `mcp-anonymous`
buckets in Redis (`EVAL`) or in this process's memory when Redis is unset or
unreachable — with a cooldown, so an outage never adds a connect timeout to
a request.

Count callers by address (`callerIdentity`). **Never key a limit on the
left-most `x-forwarded-for` entry.** Proxies append to that header rather
than replace it, so the front of the chain is whatever the caller sent, and
a caller who varies it gets a fresh bucket per request.

Check before the expensive work — design access, bucket
reads — not after.
Limits are sized from what the editor actually sends at its busiest; a limit
that trips during ordinary work is worse than none.

### Persistence & legacy compatibility

- Designs, drafts, draft bases, and versions keep legacy payload columns for rollback and expiring-link compatibility alongside nullable Canvas documents and `canvasVersion`.
- Element comments live in `design_comment`, beside the document and outside every `WebTransaction`: no undo, no export. The editor reads and writes them over oRPC (`comment.*`); agents use the MCP tools `listComments` and `resolveComment`.
- `canvasTransaction` provides idempotency, stale-revision recovery, and audit. Server writes use compare-and-swap revisions; apply + log a batch atomically.
- Browser: optimistic apply, queue unacked batches in IndexedDB, flush after ~250ms or before target change. Rebase independent fields; surface only same-field, move-vs-move, or edit-vs-delete conflicts.
- Legacy designs without a Canvas document are unsupported in the editor; there is no automatic first-open conversion flow.
- The old public-link renderer (`element-frame.tsx`, an iframe/Babel/Tailwind
  per-element React-root pipeline) is gone. Do not bring that shape back.

### Motion

Two ideas, kept apart.

- A **transition** is how a node travels between looks. It lives on the node
  (`transition`), and it applies to whatever its **visual states**
  (`visualStates`: `hover`, `press`, `focus`) change. A visual state carries a
  style patch and a transform — narrower than a node patch on purpose: a hover
  may restyle and move a node, it may not rewrite its text.
- An **animation** is a named keyframe sequence held once on the document
  (`document.animations`), like a token, and referenced by any number of nodes
  (`animations: [{ animationId, trigger }]`). Triggers are `load`, `in-view`,
  `always`, `hover`, `press`.

Keyframes move opacity and transform only. Both composite without touching
layout, which is what keeps an animated canvas smooth and the exported CSS
honest about what a browser can run.

`@sheet/canvas/motion-css` generates the CSS, and both the editor renderer and
the exporter read from it — a hover that lifts a card on the canvas is the same
rule in the download. Every motion stylesheet ends with a
`prefers-reduced-motion` block that turns it all off. The canvas surface takes a
`motion` prop so the editor can stop motion while somebody is working, without
the document knowing.

Presets carry the common asks: `@sheet/canvas/motion` has `fade-in`,
`fade-in-up`, `fade-in-down`, `slide-in-left`, `slide-in-right`, `scale-in`,
`pulse`, `float`, `spin`; `@sheet/canvas/motion-presets` has hover looks —
`lift`, `grow`, `shrink`, `fade`, `nudge-right` — each bringing its own
transition. Agents reach them through `setAnimations` (define, by preset name or
full keyframes) and `animateNodes` (apply, with an optional `stagger` so a list
arrives one item at a time).

### HTML/CSS import

HTML/CSS import computes a sandboxed DOM snapshot and converts supported layout and visual properties to structured nodes. Rasterize unsupported visual blocks entirely rather than inventing half-editable approximations.

---

## Coding Style & Naming

- TypeScript/TSX, strict types, **two-space indent**, **single quotes**, **no semicolons** (match handwritten code).
- `PascalCase` components · `camelCase` functions/vars · **kebab-case** filenames (`designs-dashboard.tsx`).
- Prefer **named exports**.
- Imports: `#app/` for `apps/desktop/src/*`; `@sheet/ui|canvas|db|rpc|agent` (and subpath exports) across packages.
- Keep server credentials, DB access, and provider secrets out of client components.
- No repo-wide formatter/linter — match neighbors; run `bunx tsc --noEmit` before submitting.
- Do not hand-edit generated files (the desktop `routeTree.gen.ts`, Drizzle snapshots you didn't intend to regenerate).

---

## Testing Guidelines

- Import from `vitest`. Colocate as `*.test.ts` / `*.test.tsx`.
- Use Testing Library for DOM behavior.
- Cover important success **and** failure paths for new behavior and bug fixes.
- Prefer package-local or file-adjacent tests when changing engine/model/merge/RPC.
- Run `bun run test` (shared setup required). Narrow with path args when iterating:
  `bun run test path/to/file.test.ts`

---

## Commit & Pull Request Guidelines

History uses Conventional Commits with scopes when useful:

`feat(canvas): ...` · `fix(railway): ...` · `chore(...): ...`

- Imperative, concise subjects.
- PRs: user-visible change, schema/env callouts, linked issues, screenshots/recordings for UI.
- Report commands run and any validation skipped.
- Do not commit secrets or `.env`.
- After `db:generate`, commit both SQL and `packages/db/drizzle/meta/`.

---

## Security & Configuration

- Copy `.env.example` → `.env`; never commit secrets.
- Server-only: `SHEET_HANDOFF_SECRET`, storage credentials. The SQLite file
  and `handoff.key` live in the data dir — they never leave the machine.
- Validate image/interaction URLs, SVG paths, CSS-like values, metadata, geometry, overrides, and document size at the **canvas model** boundary.
- Capability URLs must not leak into analytics. Handoff payloads use token-scoped asset routes.
- The loopback host is the trust boundary: it only binds `127.0.0.1`, only
  serves the bridged webview (host + origin + cookie checks), and only the
  window it opened ever gets the bridge cookie.
- Review generated SQL before migrating shared environments.

---

## Where to Change What

| Goal | Start here |
|------|------------|
| Node types, validation, document shape | `packages/canvas/src/model.ts` |
| Transitions, animations, hover states | `packages/canvas/src/motion.ts` (+ `motion-css.ts`, `motion-presets.ts`) |
| Transactions, undo, conflict preconditions | `packages/canvas/src/engine.ts` |
| Draft merge semantics | `packages/canvas/src/merge.ts` (+ RPC draft procedures) |
| Editor chrome / tools / panels | `packages/editor/src/components/` |
| Dashboard, settings, integrations | `packages/shell/src/components/` |
| Which client this is, API and link origins | `packages/platform/src/runtime.ts` |
| Desktop window, sidecar, API proxy | `apps/desktop/src-tauri/` |
| Desktop routes | `apps/desktop/src/` |
| Shared primitives, icons, `cn` | `packages/ui/src/` |
| Client sync / runtime | `packages/editor/src/lib/canvas-*.ts` |
| API procedures | One module per namespace in `packages/rpc/src/` (`canvas-procedures.ts`, `branches.ts`, `versions.ts`, …); `router.ts` only assembles them, and the local user lives in `procedures.ts` |
| Shared MCP canvas tools / layout repair | `packages/agent/src/` |
| MCP tools / transport | `packages/rpc/src/mcp-server.ts` / `apps/mcp/src/` |
| Direct MCP execution backend | `apps/mcp/src/executor.ts` (local server in `local.ts`) |
| Realtime transport, rooms, presence | Local event bus (`packages/realtime/src/local-bus.ts`, served as SSE by the local server) |
| Schema / migrations | `packages/db/src/schema.ts` → `db:generate` |
| Pages, Page 1, open versus bounded pages, page name and colour | `packages/canvas/src/web-pages.ts` (+ `page.setName` / `page.setStage` in `web-model.ts`) |
| Frames, frame size list, where the next frame goes | `packages/canvas/src/web-frames.ts`; panel in `packages/editor/src/components/frame-presets-panel.tsx` |
| Shaders and the Shaders gallery | `packages/canvas/src/web-shaders.ts`; gallery in `packages/editor/src/components/shader-panel.tsx` |
| Settings window, menu bar, accent colours | `packages/shell/src/components/settings-window.tsx`, `packages/shell/src/lib/accent.ts`, `apps/desktop/src-tauri/src/main.rs` |
| MCP tool manifest | `bun run mcp:tools` regenerates `apps/mcp/src/tools.json` from `mcp-server.ts`; run it after changing any tool |
| Agent skill (`sheet-design-guide`) | `skills/sheet-design-guide/`; copy changes to `~/.agents/skills` and `~/.claude/skills` |

---

## Agent Working Rules

- Prefer the smallest change that solves the request; do not drive-by refactor.
- Preserve unrelated dirty work in the tree.
- After behavior changes: focused tests + `bunx tsc --noEmit` when types are involved; `bun run test` before claiming done on non-trivial work.
- Route file add/rename/delete → `bun run generate-routes`.
- Schema change → `db:generate`, read the SQL, then migrate locally.
- When touching canvas mutations, keep UI, RPC, MCP tools, and handoff on the **same** transaction vocabulary.
