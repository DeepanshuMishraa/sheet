# M7 — Figma-era migration audit

Status: audit-only. No production code was modified or deleted for this report.
Baseline at audit time: 79 files / 560 tests green.

Objective: determine exactly which Figma-era concepts are still load-bearing,
which are transitional compatibility code, and which can be deleted because
the WebDocument path replaced them.

## 1. Scope and categories

Searched `apps/` and `packages/` (excluding `node_modules` and vendored
third-party bundles) for node types (`Frame`, `Shape`, `Group`, legacy `Text`,
`ImageNode`, `VectorNode`, `ComponentNode`, `InstanceNode`), style/layout
bridges (`CanvasLayout`, `CanvasStyle`, `layoutDeclarations`,
`stylePatchDeclarations`, paint/color/font/length helpers), engine types
(`CanvasEngine`, `CanvasTransaction`, `NodeMutationPatch`), responsive systems
(breakpoints, responsive/variant overrides, visual states), token internals,
and every computed-geometry/style read (`getComputedStyle`,
`getBoundingClientRect`, `element.style` read-back, observers).

Category meanings used below:

| Category                  | Meaning                            |
| ------------------------- | ---------------------------------- |
| A — Active Web path       | Must be removed/reworked           |
| B — Legacy compatibility  | Still required for old documents   |
| C — Infrastructure        | Safe to retain                     |
| D — Dead                  | Candidate for deletion             |
| E — Test/fixture          | Keep while its subject lives       |
| F — Transitional boundary | Required temporarily for migration |

Web-path file set for leak classification: `packages/canvas/src/web-model.ts`,
`web-css.ts`, `web-import.ts`, `web-components.ts`, `web-react.tsx`,
`packages/editor/src/components/web-editor.tsx`,
`packages/rpc/src/web-canvas-procedures.ts`, and the web tools in
`packages/rpc/src/mcp-server.ts`.

## 2. Inventory

### 2.1 Node types

All legacy node definitions live in `packages/canvas/src/model.ts`
(`CanvasNodeType` at :282; `ComponentNode` :324; `FrameNode` :332;
`GroupNode` :337; `TextNode` :341; `ShapeNode` :347; `VectorNode` :352;
`ImageNode` :363; `InstanceNode` :370; union `CanvasNode` :377). Consumers are
legacy-only (engine, legacy renderer/exporter/importer/merge, agent
canvas-tools, legacy editor panels, legacy RPC/MCP) with one source-file
exception: `web-model.ts:1` imports `CanvasDocument`/`CanvasNode` types plus
`canvasId`, used exclusively inside `migrateLegacyNodes` (`:1965-2051`) —
category F. (`WebNode.kind: 'element' | 'text'` is the web-native
discriminated union, not legacy `TextNode`; `createTextNode` hits in web files
are DOM API.)

### 2.2 Style and layout bridges

`CanvasLayout` (`model.ts:61`), `CanvasStyle` (`:144`), `CanvasStylePatch`
(`:212`), and the `style-css.ts` helpers (`fontFamilyValue`,
`colorValue`, `paintValue`, `lengthValue`, `layoutDeclarations`,
`layoutParent`, `stylePatchDeclarations`) are referenced by legacy canvas,
agent, and editor paths only — except `web-model.ts:2-8`, which calls five of
them solely inside `migrateLegacyNodes` (category F). `stylePatchDeclarations`
and `lengthValue` have no web-path references at all.

### 2.3 Engine and transactions

`CanvasEngine` (`engine.ts:1107`), `CanvasTransaction` (`engine.ts:57`), and
`NodeMutationPatch` (`model.ts:250`) are referenced by legacy canvas, agent,
editor, RPC, and DB schema files only. The only web-path near-misses are
name collisions (`applyWebCanvasTransaction[ToStore]` operate on
`WebTransaction`). No web-path file imports the legacy engine.

### 2.4 Responsive, variants, visual states

`CanvasBreakpoint`, `ResponsiveOverrides`, `variantOverrides`,
`CanvasVisualState(s)` (`model.ts:30-37, 224-267, 304-329`) are referenced by
legacy canvas/agent/editor/RPC/DB only. Zero matches across all web-path
files: the web model has no breakpoint/responsive/variant/visual-state
concepts. `web-css.ts` conditions are `media | container | supports` at-rule
stacks — authored CSS, not legacy responsive overrides.

### 2.5 Tokens

`DesignToken`, `CanvasDocument.tokens`, token-bearing `CanvasColor` live in
the legacy path only. No web-path file imports token structures.
`migrateLegacyNodes` routes token colors opaquely through `colorValue` into
`var(--sheet-token-…)` CSS strings — values flow, structures do not.

### 2.6 `packages/canvas/src` by import edges

Legacy-only (never import `web-*`): `model.ts`, `engine.ts`, `react.tsx`,
`export.ts`, `import.ts`, `merge.ts`, `style-css.ts`, `motion-css.ts`,
`motion.ts`, `vector.ts`, `export-fonts.ts`, `tailwind-preflight.ts`,
`index.ts` (re-exports legacy only — no `web-*` export).

Web-native: `web-css.ts` (pure, zero legacy imports), `web-react.tsx`
(`./web-model` + react only), `web-components.ts` (type-only `NodeId`
import, erased at compile), `web-import.ts` (`canvasId` only),
`web-model.ts` (bridge file — see §2.1/2.2).

## 3. Production boundary trace

Both routes mount `CanvasApp`; the fork lives in
`packages/editor/src/components/app.tsx:183-236` (`openTarget()`): drafts
skip web entirely (`:189-191`); `webCanvas.get → status 'ready'` tears down
the legacy controller and mounts `WebCanvasEditor` (`:192-203, 366-378`);
otherwise the legacy `CanvasEditor` mounts with a Main-only migrate button
(`:416-444, 503-506`). After the fork the subtrees share no state. The store
discriminator is `readWebCanvasStore` (`web-canvas-procedures.ts:30-62`).

| Stage | Web path | Legacy reachable? |
|---|---|---|
| Load | `webCanvas.get`, lazy v1/v2 parse | No — version-discriminates, parses v3 strictly |
| Editor state | Local doc state + `WebTransaction[]` history | No engine, sync controller, or IndexedDB queue |
| Materialization | `materializeWebStylesheets` + `materializeWebNode` | No — native DOM/CSS only |
| Mutation | `applyWebTransaction` + inverse history | No — bound/template rules enforced internally |
| Persistence | CAS update + `canvasTransaction` row | No — `designDraft` untouched |
| History | Client inverses + audit rows (`versions.ts` is legacy-gated) | No |
| Realtime | `canvas.changed` on main | Wire-shape sharing only |

Legacy-only (load-bearing for old documents, not leaks): legacy sync client,
`CanvasEngine`, legacy renderer, `canvas/export/import/merge` procedures,
branches/versions, legacy MCP tools, screenshots, handoff documents.
Crossings are one-way (`migrateLegacyNodes`, now with a `designVersion`
backup) or parallel (dual MCP vocabularies on shared store helpers). Nothing
converts `WebDocument` back into legacy concepts.

Migration debt (missing web capability, not leakage): drafts/branches,
versions commit/compare/restore, screenshots, and handoff documents are all
legacy-only. Branching a migrated Main yields an empty legacy draft.

## 4. Schema

Canonical: `WebDocument v3 { nodes, roots, stylesheets, stylesheetOrder,
components, instances, metadata }`. Overlaps are contained: `CanvasStyle` vs
`styles`/`declarations` meets only inside `migrateLegacyNodes`;
`designDraft`/`designVersion` remain `CanvasDocument`-only columns (debt, §3).
No legacy layout object is consulted for `WebNode` geometry — geometry comes
from the browser at measure time and does not persist (except §5).

## 5. Computed → authored audit

Safe (ephemeral only): all overlays, hit-testing, presence/tour/panel
geometry, inspector display and placeholders, `element.matches()` rule
grouping, export/screenshot read-only paths, and web import (CSSOM authored
values only — `getComputedStyle` never read). Legacy HTML import bakes
computed styles deliberately (old-architecture behavior, not web-path
contamination).

**Category A bridges in `web-editor.tsx`:** drag seeds from
`getBoundingClientRect` (`:1060-1077`, notably `width/height = rect/zoom`)
and commits by reading back the preview-mutated
`element.style.left/top/width/height` into `node.patch` (`:1091-1167`).
Reorder commits `order` derived from sibling rects + pointer (`:1115-1147`) —
topology only, lowest risk.

**M7 correction (locked rule): persist the authored value derived from the
user's gesture, not an incidental browser measurement.** If authored `left`
is `100px` and the pointer moves +17px, the result is `117px` — not
`getBoundingClientRect() → 143.67291 → / zoom → round`. Measurements may
establish the initial geometry needed to interpret the gesture, but they
must not become the source of truth for the resulting authored CSS. Same for
resize: `authored width + pointer delta`, not preview-rect read-back.
Rounding is a defensive final normalization, not the architectural fix.

## 6. Deletion candidates

No large safe deletions were demonstrated. Candidates:

- **D1**: `stylePatchDeclarations` (`style-css.ts:267`) and `lengthValue`
  (`style-css.ts:92`) — verify zero non-legacy callers, then delete. Risk:
  low. Proof: full suite + `style-css.test.ts` update.
- **D2 (gated M8+ batches)**: whole-subsystem excisions in dependency order,
  each gated on replacing its live duty — legacy renderer + panels (editor
  parity), legacy MCP tools (web-tool parity incl. screenshot),
  branches/versions legacy assumptions (web drafts/versions),
  `migrateLegacyNodes` + dual-version procedures (last, with rollback
  resolved). Each batch needs its own green-suite proof.
- **Not candidates**: anything §2-B (serves legacy docs), the F-boundary
  (serves migration), `canvasId` sharing (harmless), `web-model.test.tsx`
  legacy fixtures (needed while migration lives).

## 7. ComponentNode/InstanceNode isolation verdict

Fully isolated to the legacy path: definitions, engine ops
(`instance.patchOverride`), renderer threading (`instancePath`,
`data-sheet-instance-path`), exporter codegen, `NodeRef`/`resolveNodeRef`/
`readCanvasNodeRef`, `set-variant`, and the legacy MCP surface never cross
into web files. The web component system (`components`/`instances` maps,
`bindings`, `templateRootIds`) shares only English words — no file imports
both systems. Envelope-sharing only: union JSON columns, the version
discriminator, migrator read-and-drop (legacy components become warning
strings by design; migration asserts empty `components`/`instances`), and
manifest schema names.

## 8. M7 conclusions / M8 prerequisites

M7 conclusion:
- WebDocument v3 is isolated from the legacy scene-graph engine.
- ComponentNode/InstanceNode are legacy-only.
- No safe large-scale deletion has yet been demonstrated.
- B1/B2 are the only identified computed→authored bridge in the active web editor.
- Legacy systems remain load-bearing for legacy documents.

M8 prerequisites:
1. Fix B1/B2 so authored gesture deltas, not browser read-back, determine persisted CSS.
2. Preserve the legacy migration boundary.
3. Address web drafts/versions/screenshot/handoff capability before deleting their legacy implementations.
4. Excise legacy subsystems in independently tested batches.
5. Remove migrate/dual-version infrastructure only after legacy compatibility and rollback requirements are explicitly resolved.

Locked M8 sequence: M7 audit ✅ → M8a authored-gesture bridge fix →
M8b web drafts/versions/screenshot/handoff decision → M8c legacy subsystem
excision in independent batches → M8d migration boundary removal last.
`migrateLegacyNodes` and dual-version procedures stay until legacy
documents, rollback, and old branches/versions are explicitly resolved.
