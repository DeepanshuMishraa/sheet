---
name: sheet-design-guide
description: Build, edit, refine, troubleshoot, and review polished responsive product interfaces through the Sheet MCP server and its web-native document model (real DOM nodes plus authored CSS). Use when an agent must create or modify a Sheet design, recover from applyWebTransaction errors, turn a brief or reference into editable HTML/CSS nodes, add icons or Paper shaders, define reusable components, work safely on a Sheet branch, verify with or without image vision, or export the page as HTML, PNG, JPG, or JSON.
---

# Sheet Design Guide

Create real, editable Sheet designs through the MCP tools. The source of truth is
a **web-native document**: a tree of real HTML/SVG elements plus authored
stylesheets, components, and instances. The browser is the layout engine, so
layout is ordinary CSS (flex, grid, media and container queries). Computed
styles are never stored. Work like a designer: understand the product, establish
a system, build coherent sections, inspect the render, and refine.

## Gate the MCP surface first

Inspect the callable Sheet tools before creating or mutating anything. Require:

- `getWebDocument` and `applyWebTransaction` for every read and edit
- `getWebScreenshot` for visual verification
- `createDesign` for a new design
- `insertIcon` / `styleIcon` for icons, `listShaders` / `insertShader` /
  `styleShader` for shaders
- `createBranch`, `compareBranch`, `proposeBranch`, `applyBranch` for branch work

If `applyWebTransaction` is absent, stop. `createDesign` makes only an empty
document; do not create one and hope mutation tools appear later. Report the
missing tools and do not substitute exported code or browser clicks.

If a callable tool shows `transaction.operations` items as `unknown`, that is a
schema-display limitation, not permission to guess. Use `references/web-schema.md`.

## Load references by action

| Before this action | Read first | Read as well when applicable |
|---|---|---|
| Pick a design, target Main or a branch, compare, propose, or apply | [tool-workflows.md](references/tool-workflows.md) | |
| Write any `applyWebTransaction` payload | [web-schema.md](references/web-schema.md) | [worked-examples.md](references/worked-examples.md) for known-good payloads |
| Compose layout, styles, responsive rules, components, icons, or shaders | [web-authoring.md](references/web-authoring.md) | [design-craft.md](references/design-craft.md) for new or materially restyled work |
| Review pixels with image vision | [design-craft.md](references/design-craft.md) | [tool-workflows.md](references/tool-workflows.md) for screenshot limits |
| Verify without image vision | [tool-workflows.md](references/tool-workflows.md) | [web-schema.md](references/web-schema.md) |

For a one-field text or spacing tweak, read `web-schema.md` and the target node;
do not load every reference.

## Follow the core loop

1. **Check capability and orient.** Confirm the required tools are callable.
   Call `listDesigns`, select the target explicitly, then `getWebDocument`.
   Keep the returned `revision`.
2. **Protect the target.** Confirm Main or a branch. Carry the same `designId`
   and optional `draftId` through every call. For a broad or speculative
   redesign, prefer a new branch. Never silently switch targets.
3. **Form a visual direction.** Extract audience, job, hierarchy, mood,
   constraints, and required states. If the prompt is underspecified, choose a
   coherent direction and state it briefly; do not default to a generic
   dashboard.
4. **Establish the system.** Reuse existing stylesheets, custom properties
   (`--color-*`, `--space-*`), classes, and components. For a new design, create
   a `theme` stylesheet with custom properties on `:root` and reusable class
   rules before repeating values.
5. **Build in meaningful batches.** One `applyWebTransaction` per coherent
   section: insert nodes, then stylesheet rules. Use `page.resize` to set the
   page size. Prefer flex/grid; reserve absolute positioning for deliberate
   overlays.
6. **Inspect after meaningful edits.** Call `getWebScreenshot`. With image
   vision, compare pixels against the brief and `design-craft.md`. Without it,
   use `getWebHTML`, `getWebCSS`, and `getWebDocument` as described in
   `tool-workflows.md` and say pixel quality was not judged. A successful
   transaction alone is not proof.
7. **Refine surgically.** Fix the largest verified problem first with
   `node.patch` or `rule.patch`; do not rebuild a section to change one value.
8. **Verify structure.** Re-read the document. Confirm ids, class names that
   rules target, component bindings, and the new revision.
9. **Finish deliberately.** On a branch, `compareBranch` before proposing or
   applying. Do not apply, close, or delete anything without the user's
   authority. Use `exportDesign` only when the user needs a file.

## Preserve document semantics

- Send structured operations, never raw HTML strings. There is no "insert HTML"
  operation; build `WebNode` objects. `script`, `style`, `iframe`, `link`,
  `meta`, `object`, `embed`, `base`, and `template` tags are rejected, as are
  `on*` attributes, `srcdoc`, and an inline `style` attribute (use the node's
  `styles` map).
- Every node needs a unique id (`[A-Za-z0-9:_-]`, up to 200 chars) that you
  choose. Reuse those ids in later `node.patch`, `node.move`, and rule
  selectors. Ids are permanent once applied.
- Keep the three layers separate: the tool envelope (`designId`, `draftId`,
  `expectedRevision`, `transaction`), the transaction (`id`, `label`,
  `operations`), and each operation's payload. Never move fields between them.
- Put per-element values in `styles`. Put shared, responsive, stateful, and
  themable rules in a stylesheet: media/container conditions and pseudo-classes
  (`:hover`, `:focus-visible`) belong in rules, not inline styles.
- Edit a component template to change every instance. Use
  `instance.setOverride` (text, attributes, or `--custom-properties`) for a
  deliberate per-instance difference. Patching a bound instance node directly is
  rejected.
- Use `insertIcon` and `insertShader` instead of hand-writing icon svg paths or
  shader markup; they produce validated, restylable nodes.
- Pass a fresh transaction `id` per logical edit and reuse it only when retrying
  the identical transaction. Send the revision you last read as
  `expectedRevision`.
- Treat `deleteDesign` and `closeBranch` as destructive. Obtain explicit
  confirmation, then pass `confirmed: true`. `deleteDesign` archives.
- Keep motion restrained. The model has no `@keyframes` or `@font-face`, so
  motion means CSS `transition` between states (`:hover`, `:focus-visible`,
  `:active`) with a `prefers-reduced-motion` guard. Shaders are the only
  continuously animated element. Judge the static composition first.

## Work efficiently

- Start with `getWebDocument` once, not a chain of reads. Use `getWebHTML` or
  `getWebCSS` when you only need markup or styles.
- Create a whole coherent section in one transaction (up to 2000 operations),
  but split very large pages by section so errors stay local.
- Batch independent patches into one transaction; it applies fully or not at all.
- Use `getWebScreenshot` at milestones, not after every field. Check the intended
  desktop width and at least one narrow width when responsiveness matters.
- Report what changed, which target and revision, whether verification was
  visual or structural, and any remaining uncertainty.

## Handle failure without thrashing

- On a rejected transaction, read the error message: it names the failing node,
  rule, or field. Correct one coherent payload; do not retry variants at random.
- On `applied: false` with reason `stale`, re-read with `getWebDocument`, rebase
  your edit onto the new document, and send a new transaction with the new
  revision. Never resend the old one blindly.
- On "Node ... already exists" or "does not exist", re-read and use real ids.
- On a read-only branch, inspect its status. Reopen a proposed branch only when
  the user wants further edits.
- On merge revision drift, call `compareBranch` again. Never reuse stale
  revisions or guess conflict resolutions.
- On a legacy design that reports it must be migrated, stop and tell the user;
  do not attempt to reconstruct or overwrite it.
- On screenshot failure, keep the successful edit and be explicit that visual
  verification is incomplete.
- Shaders draw in the editor and preview only. A screenshot or exported file
  shows an empty box where a shader sits; do not treat that as a bug in the edit.
