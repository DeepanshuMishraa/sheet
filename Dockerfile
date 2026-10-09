# syntax=docker/dockerfile:1

# Sheet local server image: the same Bun process the desktop app spawns,
# serving the editor API and the MCP endpoint over SQLite. No accounts,
# no external services — mount a volume at /data to keep the database.

FROM oven/bun:1.4.0 AS deps
WORKDIR /app

# Workspace manifests only, so dependency layers cache until a package.json,
# the lockfile, or bunfig (isolated linker config) changes.
COPY package.json bun.lock bunfig.toml ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/mcp/package.json apps/mcp/
COPY apps/site/package.json apps/site/
COPY packages/db/package.json packages/db/
COPY packages/canvas/package.json packages/canvas/
COPY packages/platform/package.json packages/platform/
COPY packages/shell/package.json packages/shell/
COPY packages/realtime/package.json packages/realtime/
COPY packages/rpc/package.json packages/rpc/
COPY packages/editor/package.json packages/editor/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile

FROM oven/bun:1.4.0-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV SHEET_MCP_PORT=4100
ENV SHEET_SQLITE_PATH=/data/sheet.db

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

# The isolated linker stores real packages in node_modules/.bun and symlinks
# into it from each workspace's node_modules, so the runtime stage must mirror
# the full workspace topology (root store + every per-package node_modules).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/mcp/node_modules ./apps/mcp/node_modules
COPY --from=deps /app/apps/desktop/node_modules ./apps/desktop/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/canvas/node_modules ./packages/canvas/node_modules
COPY --from=deps /app/packages/platform/node_modules ./packages/platform/node_modules
COPY --from=deps /app/packages/shell/node_modules ./packages/shell/node_modules
COPY --from=deps /app/packages/realtime/node_modules ./packages/realtime/node_modules
COPY --from=deps /app/packages/rpc/node_modules ./packages/rpc/node_modules
COPY --from=deps /app/packages/editor/node_modules ./packages/editor/node_modules
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules
COPY package.json bun.lock bunfig.toml ./
COPY apps/mcp ./apps/mcp
# The skill folder is embedded into the server (apps/mcp/src/skill-files.ts).
COPY skills ./skills
# Full sources: the server executes @sheet/rpc + @sheet/db TypeScript
# directly on Bun (no bundling step), so the whole backend import chain ships.
COPY packages/db ./packages/db
COPY packages/rpc ./packages/rpc
COPY packages/canvas ./packages/canvas
COPY packages/platform ./packages/platform
COPY packages/realtime ./packages/realtime
COPY packages/editor/package.json packages/editor/
COPY packages/shell/package.json packages/shell/
COPY packages/ui/package.json packages/ui/

VOLUME /data
USER bun
EXPOSE 4100

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "apps/mcp/src/local.ts"]
