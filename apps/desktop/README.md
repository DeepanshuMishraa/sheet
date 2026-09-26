# Sheet for desktop

A real [Tauri](https://v2.tauri.app/) application over the shared interface,
built by Vite from the same packages (`@sheet/shell`,
`@sheet/editor`, `@sheet/ui`, `@sheet/canvas`).

Local-first: no accounts, no sign-in, no billing. One user, one SQLite file,
and the app starts its own server on loopback for both the editor API and
MCP.

Requires Rust, the platform prerequisites for Tauri, and Bun.

```bash
bun run dev              # local server on :4100 (run first, or the app starts its own)
bun run dev:desktop      # Tauri starts Vite and opens the native window
bun run check:desktop    # tsc on the interface + cargo check on the host
bun run build:desktop    # Vite interface + compiled server sidecar + native Tauri bundle
```

## Two halves

**The host** (`src-tauri/`) runs under Rust. It serves a loopback HTTP
server, opens the window on it, and on startup spawns the compiled local
server (`src-tauri/binaries/sheet-server`, built by `build:server`) with the
app-data SQLite path. Everything the window asks for under `/api/*` is
forwarded to that server — `/api/asset/…` images, the event stream, and oRPC
all behave exactly as they do over the network, except nothing leaves the
machine. In development (`tauri dev`) no sidecar is bundled, so run
`bun run dev` alongside for the API.

**The interface** (`src/`, `index.html`, `vite.config.ts`) is a Vite + React
single-page app on TanStack Router and Query, mounting the shared shell. In
development Tauri starts Vite on `:1421` and the Rust host on `:4300`; the
window stays on the host, which reverse-proxies the interface from Vite. In a
packaged app the interface is built into `dist/app`, embedded in the bundle,
and served by the host.

## MCP

The sidecar also serves `POST /mcp` on the same port (`4100` by default).
Point Claude, Codex, Cursor, or opencode at
`http://127.0.0.1:4100/mcp` — the Integrations page shows the exact snippets.
Edits an agent makes appear live in the open editor through the local event
stream.

## Data

Designs, branches, versions, the transaction log, assets, and preferences
live in one SQLite file: the OS app-data dir (`Sheet/sheet.db`, `sheet/sheet.db`
on Linux), overridable with `SHEET_DATA_DIR`. Back it up by copying the file.
Handoff links are HMAC-signed with a key in `handoff.key` beside it.

## What is not here

Billing, admin, sharing, publishing, and the in-app agent are gone with
accounts: a plan is nothing to buy, moderation has no one to moderate, and
anything that leaves the app — a hand-off URL opened elsewhere — is opened in
a browser rather than followed in the window.

## Title bar

On macOS, the native title bar overlays the app toolbar. macOS keeps ownership
of the traffic lights, rounded window frame, shadows, and standard window
behavior. The app toolbar reserves their space and marks its empty areas as
native drag regions.

## Configuration

| Variable | Meaning |
|----------|---------|
| `SHEET_API_ORIGIN` | Local server to talk to (default `http://127.0.0.1:4100`) |
| `SHEET_MCP_PORT` | Port the sidecar listens on (default `4100`) |
| `SHEET_DATA_DIR` | Where `sheet.db` + `handoff.key` live (default OS app-data dir) |
| `SHEET_SERVER_BIN` | Local server binary override (default the bundled sidecar) |
| `SHEET_DESKTOP_PORT` | Loopback port for the host (default: one the OS picks; `4300` in development) |
| `SHEET_DESKTOP_DEV_SERVER` | Vite dev server the window is handed to |
| `SHEET_DESKTOP_APP_PORT` | Port for that dev server (default `1421`) |
| `VITE_SHEET_APP_ORIGIN` | Origin for links meant for a browser (default `http://127.0.0.1:4100`) |
