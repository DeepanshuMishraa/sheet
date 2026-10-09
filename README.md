<p align="center">
  <img src="./readme-banner.png" alt="Sheet" />
</p>

<h1 align="center">Sheet</h1>

<p align="center">
  A local-first infinite canvas for UI design — one your agent can edit.
</p>

Arrange structured UI nodes on a canvas. Connect Claude, Codex, Cursor, or
opencode over MCP and they mutate the same document through typed transactions.

- **Agent-native** — 35 MCP tools over the same engine the editor uses
- **Local-first** — one SQLite file, one loopback server, no accounts
- **Versioned** — history, plus isolated drafts you can merge back
- **One-way export** — HTML, React/TSX, JSON, PNG

## Quick start

```bash
bun install
bun run dev              # local server on :4100
bun run dev:desktop      # native window (needs Rust + Tauri prerequisites)
```

Point an MCP client at `http://127.0.0.1:4100/mcp`. The Integrations page in
the app shows ready-made snippets.

`bun run build:desktop` produces the packaged app with the server compiled in.

## Design guide skill

Teaches an agent to use the canvas tools well. Add `-g` to install globally.

```bash
npx skills add https://github.com/DeepanshuMishraa/sheet/tree/main/skills/sheet-design-guide
```

## Layout

| Path | Role |
|------|------|
| `apps/desktop` | Tauri host + Vite interface |
| `apps/mcp` | Local server: MCP, oRPC, assets, handoffs, SSE |
| `packages/canvas` | Document model, engine, merge, renderer, import, export |
| `packages/editor` | Editor shell, panels, client sync |
| `packages/shell` | Design browser, settings, integrations |
| `packages/agent` | Shared canvas tool vocabulary for MCP and handoff |
| `packages/rpc` | oRPC router, storage, history, handoff |
| `packages/db` | Drizzle schema, `bun:sqlite` client, migrations |
| `packages/realtime` | Wire protocol and in-process event bus |
| `packages/platform` | Client runtime: API and link origins |
| `packages/ui` | Design-system primitives and tokens |

See [AGENTS.md](./AGENTS.md) for architecture and contribution rules.

**Stack:** Bun · React 19 · Tauri · Drizzle + SQLite · oRPC

## License

[AGPL-3.0-or-later](./LICENSE) © 2026 Deepanshu Mishra. Fork, modify, and
self-host freely; if you offer a modified version over a network, you must share
its source under the same license.
