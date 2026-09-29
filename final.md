Yeah — you're right. **C4 should not become another chain of approvals.** You want the **final post-M8c/M8d task**: give the agent the whole remaining demolition target, let it execute, then verify the final architecture once.

Here is the spec I'd hand directly to the coding agent.

---

# FINAL MIGRATION TASK — FINISH SHEET WEB-NATIVE MIGRATION

## Objective

Finish the migration of Sheet from the legacy Figma-like `CanvasDocument` architecture to the WebDocument architecture.

**Do not stop at C4. Do not create another milestone after this. Execute the remaining migration and deletion work to completion.**

The final architecture must be:

```text
                         SHEET
                           │
                    ┌──────┴──────┐
                    │             │
               WebDocument    LegacyDocument
                    │             │
                    ▼             ▼
             WebCanvasEditor   Read-only viewer
                    │             │
                    ▼             │
              HTML + authored CSS │
                    │             │
                    ▼             │
                 Chromium         │
                    │             │
                    ▼             ▼
                  pixels       pixels
```

**WebDocument is the canonical editable document model.**

The browser is the layout/CSS engine.

Legacy documents are compatibility-only and must never regain an editing/write path.

---

# 1. NON-NEGOTIABLE FINAL INVARIANTS

At completion:

### New documents

```text
create
  ↓
WebDocument
```

Never create a new `CanvasDocument`.

### Editing

```text
WebDocument
  ↓
WebCanvasEditor
  ↓
WebTransaction
  ↓
WebDocument
```

### MCP

```text
Agent
  ↓
Web MCP
  ↓
WebTransaction
  ↓
WebDocument
```

No legacy MCP mutation surface.

### Versions

```text
WebDocument
  ↓
version
  ↓
WebDocument snapshot
```

### Branches

```text
WebDocument
  ↓
branch/draft
  ↓
WebDocument
```

### Merge

```text
WebDocument
WebDocument
WebDocument base
       ↓
   web-merge
       ↓
WebDocument
```

### Legacy

```text
LegacyDocument
      ↓
read-only viewer
      ↓
pixels

             OR

LegacyDocument
      ↓
explicit migration
      ↓
WebDocument
```

There must be **no path**:

```text
LegacyDocument → editor
LegacyDocument → MCP mutation
LegacyDocument → legacy branch
LegacyDocument → legacy merge
LegacyDocument → legacy version
WebDocument → CanvasDocument → WebDocument
```

---

# 2. DELETE THE LEGACY RUNTIME

Remove all remaining legacy authoring/runtime machinery whose only purpose is the old canvas model.

Target:

* `CanvasEngine`
* legacy canvas renderer authoring infrastructure
* legacy canvas procedures
* legacy canvas merge
* legacy canvas export
* remaining legacy branch mutation
* remaining legacy version mutation
* legacy draft merge helpers
* legacy document diff
* legacy node/page mutation schemas
* legacy authoring-only utilities
* legacy MCP infrastructure already disconnected in C3
* dead legacy RPC procedures
* dead legacy router entries
* dead tests

Use repo-wide caller verification before each deletion.

**Do not preserve compatibility wrappers.**

If something is genuinely required by the frozen legacy viewer, isolate the smallest possible **read-only rendering dependency**. Do not preserve the old engine as a general-purpose subsystem.

---

# 3. DELETE THE LEGACY DATA MODEL FROM ACTIVE CODE

After all runtime consumers are gone, remove active usage of:

```text
CanvasDocument
CanvasNode
CanvasPage
CanvasLayout
CanvasStyle
legacy element/page schemas
legacy documentDiff
```

from the active application architecture.

The only permitted remaining references are explicitly justified compatibility boundaries such as:

1. frozen legacy viewer;
2. legacy → WebDocument migration;
3. legacy thumbnail rendering if still required;
4. temporary persisted-storage compatibility until the storage migration is complete.

Do not leave these types in active WebDocument code merely because they're convenient.

---

# 4. REMOVE DUAL-VERSION LOGIC FROM ACTIVE FEATURES

Search for every occurrence of:

```text
canvasVersion
CanvasDocument
version === 2
version === 3
legacy
web
```

Classify every branch.

Delete dual-version branching from:

* editor;
* creation;
* MCP;
* history;
* versions;
* branches;
* merge;
* drafts;
* normal metadata updates;
* screenshots;
* handoffs;
* active design procedures.

The only remaining legacy branching may be:

```text
stored legacy document
        ↓
read-only compatibility
```

or:

```text
stored legacy document
        ↓
migration
```

No active product feature should have:

```ts
if (legacy) ...
else web ...
```

just to support two editing architectures.

---

# 5. MAKE WEB HISTORY THE ONLY ACTIVE HISTORY MODEL

The existing Web history implementation from M8b becomes canonical.

Keep:

* `history.commitWeb`
* `history.compareWeb`
* `history.restoreWeb`
* WebDocument snapshots
* CAS
* history/realtime/audit infrastructure

Delete legacy history procedures once their last compatibility consumer is gone.

Restoring a WebDocument must restore a complete WebDocument snapshot and publish the existing Web change event.

Do not convert a WebDocument to a legacy snapshot to use history.

---

# 6. MAKE WEB BRANCHES/DRAFTS THE ONLY ACTIVE BRANCH MODEL

Keep the Web branch/draft implementation from M8b.

Delete:

* legacy branch fork logic;
* legacy branch save logic;
* legacy branch merge logic;
* legacy CanvasDocument draft snapshots;
* legacy draft comparison;
* legacy draft merge.

A branch/draft must contain a WebDocument snapshot.

Test:

```text
main WebDocument
      ↓
branch
      ↓
apply WebTransaction
```

and verify:

```text
main != branch
```

Then merge using `web-merge`.

No legacy intermediate representation.

---

# 7. MAKE WEB VERSIONING THE ONLY ACTIVE VERSION MODEL

Existing stored legacy versions may remain temporarily **only if required for compatibility**.

But active version creation must be:

```text
WebDocument → WebDocument version
```

Delete legacy version creation/commit/compare/import code.

Do not delete old database columns blindly if they are still needed to read old rows.

Instead:

```text
old persisted data
      ↓
compatibility reader
      ↓
WebDocument
```

The compatibility reader is allowed to exist temporarily.

It must not be an editing architecture.

---

# 8. DATABASE / STORAGE CLEANUP

Now perform the final storage cleanup required to make the WebDocument architecture canonical.

Identify legacy columns such as:

* legacy canvas document payloads;
* legacy page/node storage;
* legacy version payloads;
* legacy draft payloads;
* legacy branch payloads.

For every column determine:

### A — Still needed to read old documents

Keep temporarily and mark as compatibility-only.

### B — No longer needed anywhere

Remove it with a proper migration.

### C — Replaced by WebDocument storage

Migrate active data where necessary, then remove the old representation.

**Do not keep two canonical representations.**

The desired endpoint is:

```text
active document
      ↓
WebDocument
```

Legacy persisted data may exist only as historical compatibility data if required.

---

# 9. MIGRATE EXISTING LEGACY DOCUMENTS

Do not silently destroy existing legacy documents.

For every stored legacy document, support:

```text
LegacyDocument
      ↓
migration
      ↓
WebDocument
```

Migration must preserve the existing migration semantics already established.

After migration:

* document is a WebDocument;
* editing uses WebCanvasEditor;
* history uses Web history;
* branches use Web branches;
* MCP uses Web MCP;
* screenshots use Web rendering;
* handoff uses Web representation.

The old legacy representation must not become the new editable source of truth.

---

# 10. REMOVE MIGRATION MACHINERY THAT IS NO LONGER NECESSARY

Once the storage/application graph proves that active documents are WebDocuments:

Remove obsolete:

* dual-version readers;
* legacy `readWebCanvasStore` fallback;
* legacy guards in Web procedures;
* legacy handoff branches;
* migration-only routing that is no longer needed;
* legacy backup rows if they were only transitional;
* old conversion helpers whose only consumer has disappeared.

**But keep the explicit legacy-document migration operation if existing legacy documents still need to be converted.**

Do not delete the migration path before existing legacy data has a safe route into WebDocument.

---

# 11. HANDOFF MUST BE WEB-NATIVE

The final handoff system should operate on:

```text
WebDocument
HTML
CSS
assets
```

Legacy handoff formats may remain only as a compatibility reader for genuinely existing historical handoffs.

New handoffs must never serialize through CanvasDocument.

---

# 12. SCREENSHOTS MUST BE WEB-NATIVE

The canonical screenshot path is:

```text
WebDocument
   ↓
compileWebStandaloneHtml
   ↓
Chromium
   ↓
PNG
```

Keep the shared Chromium infrastructure.

Delete the old canvas-specific screenshot implementation.

Legacy documents may use the frozen viewer/render path only if absolutely necessary for compatibility.

Do not build a second screenshot renderer.

---

# 13. THUMBNAILS / PREVIEWS

Resolve `canvas-preview.tsx` and dashboard thumbnails.

Preferred final architecture:

```text
WebDocument
   ↓
Web HTML/CSS
   ↓
Chromium
   ↓
thumbnail
```

If an old legacy document still requires the legacy renderer for a thumbnail, that path must be explicitly marked compatibility-only.

Do not retain the entire legacy editor engine merely to support thumbnails.

If necessary, convert legacy documents to WebDocument before thumbnail generation.

---

# 14. DELETE DEAD CODE

After the architectural migration, run a complete dependency audit and delete:

* unused schemas;
* unused types;
* unused RPC functions;
* unused router keys;
* unused helpers;
* unused test fixtures;
* legacy test suites;
* dead imports;
* dead compatibility branches;
* dead UI;
* dead renderer code;
* dead migration code whose consumers disappeared.

Do not preserve code because it is "small."

The goal is a clean dependency graph.

---

# 15. DO NOT REIMPLEMENT CSS

During this entire cleanup:

**Do not introduce:**

* layout engines;
* custom flexbox;
* custom grid;
* custom text measurement;
* custom cascade;
* computed-style persistence;
* layout/style abstraction layers;
* Figma-style frame geometry;
* x/y/width/height model bags;
* breakpoint override systems;
* proprietary component variants.

The canonical model remains:

```text
HTML DOM
+
authored CSS
```

The browser computes:

```text
layout
cascade
computed styles
intrinsic sizing
flex
grid
text
media queries
container queries
pseudo states
```

---

# 16. FINAL REFERENCE GRAPH

The final production graph should look approximately like:

```text
                         SHEET
                           │
              ┌────────────┴────────────┐
              │                         │
         WebDocument              LegacyDocument
              │                         │
      ┌───────┼────────┐                │
      │       │        │                │
   Editor   History  Branches       Read-only
      │       │        │              viewer
      │       │        │                │
      └───────┼────────┘                │
              │                         │
         WebTransaction                 │
              │                         │
              ▼                         ▼
         HTML + CSS                  pixels
              │
              ▼
          Chromium
              │
              ▼
            pixels
```

Surrounding infrastructure:

```text
              ┌─────────────────────────┐
              │                         │
           Assets                    MCP
              │                         │
           Tokens                 Web tools
              │                         │
           SQLite                WebTransaction
              │                         │
           History                      │
              │                         │
           Realtime                     │
              │                         │
           CAS / Auth                   │
              └──────────┬──────────────┘
                         │
                    WebDocument
```

There should **not** be a second box beside this containing:

```text
CanvasEngine
CanvasDocument
CanvasNode
CanvasRenderer
CanvasProcedures
CanvasMerge
CanvasHistory
CanvasBranches
CanvasMCP
```

That architecture is what we're deleting.

---

# 17. FINAL VERIFICATION — DO NOT CLAIM DONE WITHOUT THIS

Run the full suite and TypeScript.

Then run repository-wide searches for:

```bash
rg "CanvasEngine|CanvasDocument|CanvasNode|CanvasLayout|CanvasStyle"
rg "canvas-procedures|canvas/merge|canvas/export|canvas/import"
rg "compareCanvasVersion|compareVersion|commitVersion|importVersions"
rg "saveDraft|getDraft|saveDesign|getDesign"
rg "canvasVersion"
rg "CanvasPage|CanvasElement|documentDiff"
```

Every remaining hit must be classified.

Final report must contain:

```text
FINAL MIGRATION REPORT

Files:
Tests:
TypeScript:

Legacy editor:
Legacy MCP:
Legacy engine:
Legacy procedures:
Legacy branches:
Legacy versions:
Legacy merge:
Legacy schemas:
Legacy storage:

Remaining Canvas* references:
Remaining dual-version branches:
Remaining migration code:
Remaining legacy viewer code:
Remaining thumbnail dependencies:

New document creation:
Web history:
Web branches:
Web merge:
Web MCP:
Web screenshots:
Web handoff:

Database migration:
Existing legacy document migration:

Compatibility impact:
```

Then verify these end-to-end scenarios:

### Scenario 1 — New document

```text
create
→ WebDocument
→ edit
→ save
→ reload
```

### Scenario 2 — Web history

```text
edit
→ version
→ modify
→ restore
→ reload
```

### Scenario 3 — Web branch

```text
main
→ branch
→ edit branch
→ merge
→ WebDocument
```

### Scenario 4 — MCP

```text
MCP
→ getWebDocument
→ applyWebTransaction
→ getWebHTML/CSS
→ screenshot
```

### Scenario 5 — Legacy document

```text
legacy document
→ open
→ read-only viewer
→ migrate
→ WebDocument
→ edit normally
```

### Scenario 6 — Reload

For both migrated and newly-created documents:

```text
write
→ process restart
→ reload
→ WebDocument
→ render
```

### Scenario 7 — No regression

Verify:

```text
assets
components
instances
CSS stylesheets
history
drafts
branches
MCP
screenshots
handoffs
realtime
CAS
```

still work.

---

# FINAL DONE CONDITION

Do not report success merely because tests are green.

The migration is complete only when this statement is true:

> **WebDocument is the only active document architecture in Sheet. HTML and authored CSS are the canonical visual representation. Chromium is the layout/rendering engine. Legacy documents exist only as frozen read-only compatibility data and an explicit migration source.**

And there is **no active code path that converts WebDocument into the legacy canvas model.**

Run the entire thing now. **No C5, no C6, no more milestone negotiation.** Once this task is executed, give me the final migration report and I'll do the single final architectural verification.
