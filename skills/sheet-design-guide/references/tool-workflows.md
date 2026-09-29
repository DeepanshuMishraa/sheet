# Sheet MCP tool workflows

Select tools, preserve the target, and finish safely. Grounded in
`packages/rpc/src/mcp-server.ts` and `apps/mcp/src/tools.json`.

## Contents

- [Target model](#target-model)
- [Tool map](#tool-map)
- [Create a new design](#create-a-new-design)
- [Edit an existing design](#edit-an-existing-design)
- [Use branches safely](#use-branches-safely)
- [Validate the visual result](#validate-the-visual-result)
- [Export](#export)
- [Failure guide](#failure-guide)

## Target model

Design tools take `designId`. Write tools also take an optional `draftId`: omit
it for Main, include it for a branch. Carry both explicitly on every call; do not
infer the target from an editor URL mid-run.

An active branch is writable. Proposed, applied, and closed branches are
read-only.

Every edit is guarded by `expectedRevision`. The revision advances on every
successful write, including `insertIcon`, `styleIcon`, `insertShader`, and
`styleShader`. After any of those, re-read (or use the returned revision) before
your next `applyWebTransaction`.

## Tool map

### Orientation and reading

| Tool | Use |
|---|---|
| `getUsage` | Usage status; local-first, never consumes anything |
| `listDesigns` | Discover designs and editor URLs. Start here |
| `getWebDocument` | Full document plus `revision`; the authored source of truth |
| `getWebHTML` | Serialized DOM only; cheap for reviewing markup |
| `getWebCSS` | Serialized stylesheets in cascade order |
| `listAssets` | Uploaded image assets (use as `/api/asset/<id>`) |
| `listPages` | Pages: `pageId`, name, size |
| `listVersions` | History for Main or a branch |

### Authoring

| Tool | Use |
|---|---|
| `createPage` | New isolated page (its own canvas, size and layers) |
| `applyWebTransaction` | All structural edits: nodes, stylesheets, rules, components, instances |
| `searchIcons` / `insertIcon` / `styleIcon` | Find, place, and restyle library icons |
| `listShaders` / `insertShader` / `styleShader` | Discover, place, and tune Paper shaders |

### Visual and delivery

| Tool | Use |
|---|---|
| `getWebScreenshot` | Real PNG of the document, or one page via `rootId = pageId`, at a width and pixel ratio |
| `exportDesign` | `html`, `png`, `jpg`, or `json` file payload |

### Design and branch lifecycle

| Tool | Use |
|---|---|
| `createDesign` / `renameDesign` | Manage design identity |
| `deleteDesign` | Archive after explicit confirmation (`confirmed: true`) |
| `listBranches` / `createBranch` | Inspect or fork Main into an isolated branch |
| `compareBranch` | Field-level semantic comparison against Main |
| `proposeBranch` / `reopenBranch` | Freeze for review / make editable again |
| `applyBranch` | Merge with exact revisions and conflict choices |
| `closeBranch` | Discard without applying (`confirmed: true`) |

## Create a new design

1. Pass the capability gate.
2. `createDesign` with a concise product-oriented name. Note the `designId`.
3. `getWebDocument` to get the starting `revision` (an empty document).
4. `createPage` (name, width, height, background). Keep the returned `pageId`.
   Then one transaction with the theme stylesheet (custom properties on `:root`,
   base typography, reusable classes) and the page's first content, inserted
   with `parentId: pageId`. Each additional screen or variant is another
   `createPage`; never build two screens inside one page.
5. Add sections with one transaction each: nodes first, then the rules that
   style them.
6. Define components (`component.define`) for genuinely repeated structures, then
   place them with `instance.create`.
7. Add icons with `insertIcon` and any shader backdrops with `insertShader`.
8. `getWebScreenshot`; inspect it with the vision or non-vision path below.
9. Patch the largest verified issues, then render again.
10. Return the design's editor URL from `listDesigns`.

Prefer one transaction per section over dozens of one-node calls, but split
large pages so any rejection stays local.

## Edit an existing design

1. `getWebDocument` and locate the affected nodes by id, tag, or class.
2. Preserve the established stylesheets, classes, and components unless the user
   asked for a redesign.
3. Use `node.patch` for one element and `rule.patch` for a class shared by many.
   A rule patch restyles every element with that class; check the blast radius
   first.
4. `getWebScreenshot` for the affected result.
5. Re-read and report the new revision.

Do not rebuild a section to change one value. Do not patch a component template
when only one instance should differ; use `instance.setOverride`.

## Use branches safely

Prefer a branch when the user asked for alternatives, the change is broad or
experimental, or the result needs review before Main changes.

1. `createBranch`
2. Keep `draftId` on every read and write
3. Build and verify
4. `compareBranch`
5. Optionally `proposeBranch`
6. Present the branch and comparison
7. Apply only when authorized

`compareBranch` returns Main and branch revisions, a summary, and conflicts.
Pass those exact revisions to `applyBranch` as `expectedMainRevision` and
`expectedDraftRevision`, and map every conflict to `"main"` or `"draft"` in
`resolutions`. If either side moved, compare again.

Never propose just to mark work done: proposing freezes the branch. Never apply
merely because it looks good unless the request authorizes changing Main.

## Validate the visual result

`getWebScreenshot { designId, rootId?, width?, pixelRatio? }` renders the same
serialized HTML/CSS the editor materializes. It is read-only.

Render after the first complete composition, each material style or layout
pass, responsive rules, component changes, and the final refinement.

Limits to keep in mind:

- It renders the default state. Hover, focus, and active states, and media or
  container rules that do not match the chosen `width`, are not visible; check
  them structurally in `getWebCSS`.
- Paper shaders do not draw in screenshots or exports. Their box is present but
  empty.
- Use `width` to test the desktop and a narrow layout.

### With image vision

Inspect the PNG using the rubric in `design-craft.md`. Fix the largest visible
issue and render again.

### Without image vision

Do not pretend to inspect pixels.

1. Call `getWebScreenshot` at desktop and narrow widths to prove the document
   renders without error.
2. `getWebHTML`: confirm reading order, headings, landmarks, alt text, and that
   the elements you expect exist.
3. `getWebCSS`: confirm each class you used has a rule, responsive rules use
   the intended breakpoints, and custom properties resolve (every `var(--x)` has
   a definition).
4. `getWebDocument`: confirm ids, component bindings, and the target revision.
5. Report verification as **structural/render-only**. Say hierarchy, contrast,
   clipping, and aesthetics were not judged, and return the editor URL for human
   review.

## Export

`exportDesign { designId, format, rootId?, width?, pixelRatio? }`:

- `html`: one self-contained page (all DOM and CSS), returned as text
- `png` / `jpg`: base64 image
- `json`: the authored web document

The result carries `filename`, `mimeType`, `encoding` (`utf8` or `base64`), and
`data`. Exports are one-way: they never round-trip into the editor. Shader nodes
export as empty boxes.

## Failure guide

| Signal | Response |
|---|---|
| `applied: false`, reason `stale` | Re-read, rebase your edit, send a new transaction with the new revision |
| Validation error naming a node, rule, or key | Fix that field in one coherent payload |
| "already exists" / "does not exist" | Re-read the document and use real ids |
| Bound-node edit rejected | Edit the component template or use `instance.setOverride` |
| Cannot delete component | `instance.delete` its instances first |
| Branch is read-only | Reopen only if the user wants to keep editing |
| Main or branch changed before apply | `compareBranch` again and use fresh revisions |
| Legacy design, migration required | Stop; the design is unsupported over MCP |
| Screenshot fails | Keep the edit; state visual verification is incomplete |
