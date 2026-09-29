# Web-native document tracer

## Decision

Sheet's target document model is a persistent editable DOM, not the current scene graph with more HTML metadata.

The canonical visual nodes become:

```text
element { tag, namespace, attributes, styles }
text { text }
```

Stable IDs, normalized storage, parent/order relationships, transactions, history, subscriptions, persistence, selection, and camera state remain useful infrastructure. `Frame`, `Group`, `Shape`, `Vector`, `Image`, proprietary layout values, and proprietary style values are migration inputs, not permanent peers.

## What the tracer proves

`packages/canvas/src/web-model.ts` demonstrates one representation flowing through:

```text
HTML import
  -> WebDocument
  -> transaction
  -> native DOM/CSS
  -> direct HTML serialization
```

The same node ID appears in persistence, transactions, rendered `data-sheet-node` attributes, selection lookup, and export. HTML import does not convert elements into frames or shapes. CSS declarations remain CSS declarations.

`WebDocumentView` now runs inside a production editor route after an explicit Main-document migration. It is intentionally a full-subtree materializer. Incremental reconciliation should replace that implementation only after the canonical model and migration boundary settle.

## Production vertical slice

A Main document can now cross the persistence boundary:

```text
CanvasDocument
  -> explicit migration
  -> WebDocument in the existing SQLite canvas_document column
  -> WebCanvasEditor
  -> web transaction
  -> server validation and compare-and-swap save
  -> reload as WebDocument
```

`WebCanvasEditor` keeps Sheet's three-part editor shape while replacing its document assumptions. The left panel is a DOM tree, the center mounts native DOM under the camera, and the right panel edits attributes and CSS declarations. Selection, hover, move, resize, and text editing resolve `data-sheet-node` back to WebNode IDs. Overlay geometry comes from `getBoundingClientRect`; inspector placeholders come from `getComputedStyle`.

The `webCanvas` RPC namespace is deliberately small: read the current Main representation, explicitly migrate a legacy Main document, and apply one validated web transaction with revision compare-and-swap. Migration writes the previous scene graph to version history before replacing Main. Drafts stay on the legacy path during this slice.

## Findings

### Existing transaction infrastructure

The current `CanvasEngine` still cannot accept the target nodes unchanged. Its reusable mechanics are mixed with scene-graph assumptions:

- transaction parsing validates `CanvasNode` and `NodeMutationPatch`;
- bounds indexing reads proprietary `layout` fields;
- domain invalidation reads proprietary motion and token fields;
- preconditions enumerate the current patch shape.

The migration should extract the generic engine mechanics, then make the web document its concrete model. Those mechanics are idempotency, inverse history, preconditions, revision tracking, per-node subscriptions, child indexes, and coalescing. A second production engine must not remain after migration.

### Existing React renderer

React can continue owning the editor mount, providers, subscriptions, camera, and overlays. The design subtree can materialize directly from web nodes. Selection still resolves through `data-sheet-node`.

The current node renderer and `style-css.ts` become legacy adapters. The target renderer must apply authored declarations directly and ask the browser for computed styles and geometry.

### Editor controls

Inspector controls should read and write CSS declarations. Friendly controls may parse values they understand, but an unsupported valid declaration remains in the document. Controls must not create a second layout or style representation.

### Import and export

HTML import and export can share the canonical tree. Import still requires security validation and asset handling. Website capture also needs stylesheet, cascade, pseudo-element, font, and asset policies; this tracer only proves inline authored declarations.

### Components

The tracer does not migrate components or instances. Flattening them would lose their identity. Before document migration ships, the web model needs Sheet-owned component definitions whose templates contain web nodes and instances reference those definitions.

## Legacy deletion path

1. Add stylesheet rules, tokens as CSS variables, assets, and component templates to `WebDocument`.
2. Extract generic history, idempotency, precondition, subscription, and child-index code from `CanvasEngine`.
3. Make editor creation, movement, text editing, and CSS controls issue web transactions.
4. Replace the vertical slice's snapshot materializer and local history with extracted generic engine mechanics.
5. Make MCP use those same transactions without renaming transport tools prematurely.
6. Make HTML import produce only `WebDocument`.
7. Replace the legacy exporter with direct serialization.
8. Migrate stored documents once, retaining rollback data at the persistence boundary.
9. Delete legacy rendering and mutation paths.
10. Delete `FrameNode`, `GroupNode`, `ShapeNode`, `VectorNode`, `ImageNode`, `CanvasLayout`, and `CanvasStyle` after all stored documents and component definitions migrate.

## Unsupported in this tracer

- stylesheets, selectors, media queries, and container queries;
- pseudo-elements and pseudo-classes;
- component and instance semantics;
- SVG child migration;
- computed website snapshot capture;
- incremental DOM reconciliation;
- branch, version-history, and batch persistence migration.

These are required before the target model can replace the current schema. They are omitted here so the first slice tests the representation rather than building another framework around it.
