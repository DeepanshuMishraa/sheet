# Sheet → Paper-Class Architecture Migration Plan

## Mission

Transform Sheet from a Figma-style design editor whose source of truth is a proprietary scene graph into a web-native design environment whose source of truth is structurally compatible with HTML/CSS.

The goal is **not** to clone Paper's UI or blindly copy its implementation.

The goal is to reproduce the architectural property that makes Paper powerful:

> The design representation, browser representation, agent representation, import representation, and code representation should be as close to one another as practical.

After this migration, Sheet should be able to:

- visually edit designs on a spatial canvas;
- represent layouts using real web concepts;
- render through the browser's layout engine rather than a proprietary layout engine;
- accept HTML/CSS and turn it into editable design nodes;
- export designs to HTML/CSS/JSX with minimal semantic translation;
- expose structure, styles, computed styles, geometry, screenshots, HTML, and JSX to agents;
- let agents create and modify designs using HTML/CSS or structured mutations;
- import real websites/DOM structures into editable Sheet designs;
- preserve components, tokens, assets, responsive rules, and interactions as higher-level Sheet metadata while compiling them to web primitives.

---

# 0. Non-negotiable architectural principles

These principles govern every implementation decision in this migration.

### 0.1 The browser is the layout engine

Do not build a second implementation of:

- flexbox;
- CSS grid;
- intrinsic sizing;
- text wrapping;
- font metrics;
- min-content/max-content sizing;
- percentage resolution;
- CSS inheritance;
- CSS transforms;
- CSS overflow;
- CSS positioning.

Use the browser wherever possible.

### 0.2 The persistent model remains structured

Do NOT replace the document database with arbitrary HTML strings.

Keep a normalized document:

```text
CanvasDocument
  ├── nodesById
  ├── roots
  ├── stylesheets
  ├── tokens
  ├── components
  ├── assets
  ├── interactions
  └── metadata
```

But change the node vocabulary from proprietary design primitives toward web-native primitives.

### 0.3 HTML strings are an interchange/agent language, not the canonical database format

The canonical representation should be a structured web-native AST.

HTML is used for:

- agent input;
- paste/import;
- website snapshots;
- serialization;
- interoperability;
- code export.

### 0.4 Design abstractions are allowed above the web model

Sheet can still have:

- components;
- variants;
- tokens;
- themes;
- assets;
- breakpoints;
- animations;
- interactions;
- design metadata.

These should compile to or decorate the web-native representation rather than replacing it.

### 0.5 Existing good infrastructure should survive

Do not rewrite working infrastructure merely for conceptual purity.

Preserve where practical:

- `CanvasDocument`;
- normalized `nodesById`;
- stable node IDs;
- `CanvasTransaction`;
- validation;
- SQLite persistence;
- revision numbers;
- undo/redo;
- incremental subscriptions;
- camera state;
- selection state;
- existing MCP transport;
- existing asset storage.

---

# 1. Current architecture

The current architecture is approximately:

```text
Agent / Editor / MCP
        |
        v
CanvasTransaction
        |
        v
CanvasDocument
        |
        v
SQLite
        |
        v
React renderer
        |
        v
DOM / SVG
```

The current model is Figma-like:

```text
Page
Frame
Group
Text
Shape
Vector
Image
Instance
```

with proprietary concepts for:

```text
layout
style
tokens
breakpoints
overrides
interactions
```

The current renderer resolves the proprietary model into DOM/SVG.

The current export path translates:

```text
Sheet model -> HTML/CSS/JSX
```

and the current import path translates:

```text
HTML snapshot -> Sheet model
```

This means the system currently has a semantic translation boundary between "design" and "web".

The migration removes that boundary as much as possible.

---

# 2. Target architecture

Target:

```text
                         SHEET
                           |
            +--------------+--------------+
            |              |              |
          Human          Agent           Code
            |              |              |
            +--------------+--------------+
                           |
                           v
                 Web-native document
                           |
             +-------------+-------------+
             |                           |
             v                           v
      Persistent model             DOM materializer
                                         |
                                         v
                                  Browser engine
                                         |
                         +---------------+---------------+
                         |               |               |
                       Layout          Paint        Computed style
                         |               |               |
                         +---------------+---------------+
                                         |
                                         v
                                      Canvas
```

And:

```text
HTML/DOM
   |
   v
Web-native document
   |
   +----> Canvas
   |
   +----> HTML/CSS
   |
   +----> JSX
   |
   +----> Agent context
```

The desired property is:

```text
Design ≈ DOM/CSS ≈ Exported code
```

rather than:

```text
Design -> proprietary representation -> translated code
```

---

# 3. Phase 1 — Audit before changing architecture

## Objective

Fully understand the existing implementation before touching the document model.

## Tasks

Inspect:

```text
packages/canvas/src/model.ts
packages/canvas/src/engine.ts
packages/canvas/src/react.tsx
packages/canvas/src/export.ts
packages/canvas/src/import.ts
```

and every dependent package.

Produce an internal architecture map covering:

1. all node types;
2. all layout properties;
3. all style properties;
4. all transaction types;
5. persistence schema;
6. undo/redo implementation;
7. renderer lifecycle;
8. selection lifecycle;
9. camera lifecycle;
10. asset handling;
11. tokens/themes;
12. breakpoints;
13. components/instances;
14. MCP operations;
15. HTML import/export;
16. tests.

## Required output

Create:

```text
docs/architecture/current-state.md
```

with:

- current architecture diagram;
- dependency graph;
- node type inventory;
- migration risk inventory;
- list of code that must remain;
- list of code that will eventually be removed.

## Rule

Do not start deleting the existing renderer or model during this phase.

---

# 4. Phase 2 — Introduce the web-native node model

## Objective

Introduce a structured model that represents web concepts without immediately deleting the old model.

Create:

```text
packages/canvas/src/web-model/
```

Suggested types:

```ts
type NodeId = string;

interface ElementNode {
  id: NodeId;
  kind: "element";

  tag: string;

  attributes: Record<string, string>;

  styles: Record<string, CSSValue>;

  children: NodeId[];
}

interface TextNode {
  id: NodeId;
  kind: "text";

  text: string;
}

interface CommentNode {
  id: NodeId;
  kind: "comment";

  value: string;
}
```

Also support:

```text
SVG
images/assets
document roots
stylesheets
CSS variables
pseudo-state metadata
```

Do not create dozens of special-purpose design node types.

Prefer:

```text
element + tag + attributes + styles + children
```

over:

```text
RectangleNode
CircleNode
CardNode
ButtonNode
HeadingNode
...
```

---

# 5. Phase 3 — Define the Sheet web AST

The web AST must be explicit and stable.

It should support at minimum:

### HTML semantics

```text
div
span
p
h1-h6
button
a
img
input
textarea
label
ul
ol
li
section
article
header
footer
nav
main
form
```

Do not hard-code an exhaustive tag list. Unknown/custom tags must remain representable.

### SVG

Support:

```text
svg
g
path
rect
circle
ellipse
line
polyline
polygon
text
defs
clipPath
mask
```

### CSS

The style representation must support arbitrary CSS properties rather than a closed enum wherever possible.

At minimum:

```text
display
position
inset
width
height
min-width
max-width
min-height
max-height

margin
padding
gap

flex
flex-direction
flex-wrap
align-items
align-content
justify-content

grid
grid-template-columns
grid-template-rows
grid-column
grid-row

font-family
font-size
font-weight
font-style
line-height
letter-spacing
text-align
text-transform
white-space

color
background
background-color
background-image

border
border-width
border-style
border-color
border-radius

box-shadow
opacity
overflow
visibility

transform
transform-origin
filter
backdrop-filter

z-index
cursor
pointer-events
object-fit
object-position
```

Do not make the model dependent on only this list. The representation must be extensible.

---

# 6. Phase 4 — Add a CSS value system

Do not represent every CSS value as an untyped string.

Introduce a lightweight CSS value AST where useful:

```ts
type CSSValue =
  | { kind: "literal"; value: string }
  | { kind: "number"; value: number; unit: CSSUnit }
  | { kind: "color"; value: string }
  | { kind: "token"; name: string }
  | { kind: "function"; name: string; args: CSSValue[] }
  | { kind: "raw"; value: string };
```

The `raw` escape hatch is mandatory.

Never make the model incapable of representing valid CSS simply because Sheet has not implemented a first-class editor control for that property yet.

This is critical for future compatibility.

---

# 7. Phase 5 — Build the DOM materializer

Create:

```text
packages/canvas/src/dom/
```

with:

```text
materialize.ts
reconcile.ts
geometry.ts
computed-style.ts
```

The materializer converts:

```text
WebNode tree
```

into:

```text
actual browser DOM
```

Example:

```text
ElementNode {
  tag: "div",
  styles: {
    display: "flex",
    gap: "16px"
  }
}
```

becomes an actual:

```html
<div data-sheet-node="..."></div>
```

with actual CSS.

## Critical rule

Do not manually calculate layout.

Use the browser.

Use:

```text
getBoundingClientRect()
getComputedStyle()
ResizeObserver
MutationObserver
IntersectionObserver
```

where appropriate.

---

# 8. Phase 6 — Separate canvas UI from design DOM

This distinction is mandatory.

There are two worlds:

```text
DESIGN DOM
```

and:

```text
EDITOR OVERLAY
```

The design DOM contains the actual user design.

The editor overlay contains:

```text
selection boxes
handles
guides
hover outlines
measurement labels
drag previews
cursor indicators
interaction controls
```

Never mix these into the persisted design model.

Use attributes such as:

```html
data-sheet-node="node-id"
```

to map browser elements back to document nodes.

---

# 9. Phase 7 — Make the browser the layout engine

Remove proprietary layout calculations incrementally.

For every existing property:

```text
old Sheet abstraction
```

find its CSS equivalent.

Examples:

```text
vertical layout
    -> display:flex; flex-direction:column

horizontal layout
    -> display:flex; flex-direction:row

gap
    -> gap

padding
    -> padding

alignment
    -> align-items / justify-content

absolute position
    -> position:absolute + inset/left/top

fill width
    -> width:100% / flex behavior

auto height
    -> height:auto

grid
    -> CSS Grid
```

Create a migration matrix:

```text
docs/architecture/layout-migration.md
```

Every old layout primitive must have one of:

```text
CSS equivalent
CSS approximation
not yet supported
intentionally retained as editor metadata
```

Nothing should silently disappear.

---

# 10. Phase 8 — Convert responsive behavior to CSS

Replace proprietary breakpoint evaluation with CSS wherever possible.

Support:

```text
@media
@container
CSS custom properties
```

The document model may store:

```text
responsive rule metadata
```

but the browser should resolve the actual layout.

Example:

```css
width: 400px;

@media (max-width: 768px) {
  width: 100%;
}
```

The editor should allow users to manipulate this visually, but the resulting semantics should remain CSS.

---

# 11. Phase 9 — Convert tokens to CSS custom properties

Keep the Sheet token system.

Change its output representation to:

```css
:root {
  --color-primary: ...;
  --spacing-md: ...;
  --radius-lg: ...;
}
```

Nodes should be able to use:

```css
color: var(--color-primary);
padding: var(--spacing-md);
border-radius: var(--radius-lg);
```

Token metadata should retain:

```text
name
type
value
description
mode/theme
```

but CSS custom properties become the runtime representation.

---

# 12. Phase 10 — Preserve components as a higher-level abstraction

Do not remove components.

Redesign them so that:

```text
Component
    |
    +-- template = web-native node tree
    |
    +-- props
    |
    +-- variants
    |
    +-- tokens
```

Instances reference the component definition.

The component system must eventually be serializable to:

```text
React components
Web Components
HTML/CSS
```

without requiring a proprietary runtime to understand basic layout.

---

# 13. Phase 11 — Rewrite HTML import as a first-class capability

Create:

```text
packages/canvas/src/import/html/
```

Pipeline:

```text
HTML
  |
  v
DOM parser
  |
  v
DOM tree
  |
  v
WebNode tree
```

Then separately process:

```text
CSS
stylesheets
inline styles
CSS variables
assets
computed styles
```

Do not rasterize an unsupported node simply because the editor doesn't have a UI control for it.

Preserve unknown HTML/CSS whenever possible.

Example:

```html
<div style="some-future-css-property: value">
```

must remain representable.

---

# 14. Phase 12 — Build a real Website Snapshot pipeline

The desired workflow:

```text
Website
   |
   v
browser
   |
   v
DOM
   |
   +--> CSSOM
   |
   +--> computed styles
   |
   +--> assets
   |
   v
Sheet web AST
   |
   v
editable canvas
```

The first implementation can be local/browser-based.

Do not make this AI-dependent.

If the browser already has the structure, extract the structure directly.

AI can later be used for semantic cleanup, componentization, or approximation of unsupported visual effects.

---

# 15. Phase 13 — Rewrite HTML export

Export should become almost direct serialization.

Target:

```text
Sheet web AST
      |
      +----> HTML
      |
      +----> CSS
      |
      +----> JSX
```

The exporter should not need to infer layout semantics.

For example:

```text
display:flex
```

must export as:

```css
display: flex;
```

not as a custom Sheet layout object translated by a complex compiler.

---

# 16. Phase 14 — Build JSX export

Implement:

```text
get_jsx
```

with at least:

```text
inline styles
Tailwind
CSS classes
```

The first version can generate:

```jsx
<div className="...">
  ...
</div>
```

but must preserve the underlying structure exactly.

Avoid a lossy design-to-code compiler.

---

# 17. Phase 15 — Redesign the MCP around the web model

MCP is a core product surface, not an adapter.

Organize tools into:

## Inspection

```text
get_document
get_selection
get_node
get_children
get_tree
get_text
get_styles
get_computed_styles
get_geometry
get_screenshot
```

## Mutation

```text
create_element
write_html
update_styles
set_text
set_attribute
move_node
duplicate_node
delete_node
```

## Code

```text
get_html
get_css
get_jsx
```

## Design system

```text
get_tokens
upsert_token
get_components
create_component
```

## Canvas

```text
create_artboard
resize_artboard
set_viewport
```

Every MCP mutation must eventually become a normal `CanvasTransaction`.

Do not create a second mutation system exclusively for agents.

---

# 18. `write_html` is a priority tool

Implement:

```text
write_html(parentNodeId, html)
```

with behavior:

```text
HTML
  |
  v
parse
  |
  v
WebNode tree
  |
  v
validate
  |
  v
CanvasTransaction
  |
  v
document
  |
  v
DOM
```

The agent should be able to say:

```html
<div style="display:flex; gap:16px">
  <h1>Hello</h1>
  <button>Continue</button>
</div>
```

and get editable Sheet nodes.

This is one of the most important differences between the current architecture and the target architecture.

---

# 19. Add visual agent feedback

Implement:

```text
get_screenshot(nodeId?)
```

with:

```text
scale
viewport
background
```

support.

Agent workflow:

```text
write
  |
  v
render
  |
  v
screenshot
  |
  v
agent inspection
  |
  v
patch
  |
  v
render
```

This must be reliable enough for iterative visual generation.

---

# 20. Expose computed browser state

The MCP should distinguish:

### Authored state

```text
width: 50%
display: flex
gap: 16px
```

from:

### Computed state

```text
width: 384px
display: flex
gap: 16px
```

and:

### Geometry

```text
x
y
width
height
```

This gives agents enough information to reason about the rendered design rather than only the source representation.

---

# 21. Fix the transaction architecture for web-native nodes

Keep:

```text
CanvasTransaction
```

but make mutations web-native.

Examples:

```ts
node.insert
node.patch
node.move
node.delete

style.set
attribute.set
text.set

token.upsert
component.upsert
asset.upsert
```

A style patch should be able to express:

```ts
{
  "styles": {
    "display": "flex",
    "gap": "16px",
    "padding": "24px"
  }
}
```

Do not create separate transaction operations for every CSS property.

---

# 22. Persistence strategy

Keep SQLite initially.

Do not introduce a distributed database merely because Paper uses one.

The architecture should be:

```text
Document
   |
Transaction
   |
Validate
   |
Persist
   |
Revision++
   |
Notify subscribers
   |
DOM reconciliation
```

Persistence should store the web-native AST, not rendered HTML snapshots as the only source of truth.

---

# 23. Undo/redo

Undo/redo must operate at the transaction layer.

Example:

```text
T1 create div
T2 set styles
T3 insert text
T4 move node
```

Undo:

```text
inverse(T4)
inverse(T3)
...
```

Do not implement undo by serializing the entire DOM.

---

# 24. Rendering performance

This migration must not sacrifice the current incremental rendering architecture.

Requirements:

- stable node IDs;
- per-node subscriptions;
- minimal DOM reconciliation;
- no full-tree React rerender for a single style edit;
- avoid forced synchronous layout;
- batch DOM writes;
- batch reads;
- use `requestAnimationFrame` for visual updates;
- use `ResizeObserver` where appropriate;
- avoid unnecessary `getComputedStyle`;
- avoid unnecessary `getBoundingClientRect`;
- virtualize extremely large canvas regions if necessary.

Target:

```text
60 FPS minimum
120 FPS target for common editor interactions
```

Measure before optimizing.

Create performance benchmarks for:

```text
100 nodes
500 nodes
1,000 nodes
5,000 nodes
10,000 nodes
```

---

# 25. Canvas and design DOM must remain separate

The infinite canvas itself is not the document.

The camera is ephemeral:

```text
zoom
pan
viewport
```

Selection is ephemeral:

```text
selected node IDs
hovered node ID
active tool
```

The design DOM is persistent.

Keep:

```text
Document state
```

separate from:

```text
Editor UI state
```

This part of the current architecture should remain.

---

# 26. Migration strategy

Do NOT do a big-bang rewrite.

Use a compatibility layer.

## Stage A

Current model:

```text
OldNode
```

Target model:

```text
WebNode
```

Add conversion:

```text
OldNode -> WebNode
```

and:

```text
WebNode -> OldNode
```

temporarily.

## Stage B

Render WebNode through the new DOM materializer.

## Stage C

Move editor operations to WebNode.

## Stage D

Move MCP to WebNode.

## Stage E

Move persistence to WebNode.

## Stage F

Delete OldNode.

The old architecture must not remain permanently as a second source of truth.

---

# 27. Compatibility rules

During migration:

```text
ONE source of truth
```

at every stage.

Do not allow:

```text
Old document
+
New document
```

to independently mutate.

If both must exist temporarily:

```text
Old -> New
```

or:

```text
New -> Old
```

must be deterministic.

Never:

```text
Old <-> New <-> Old <-> New
```

as an ongoing synchronization loop.

---

# 28. Testing strategy

Create tests at every layer.

## Model tests

Verify:

```text
node creation
node deletion
parent/child relationships
style patches
attributes
text
components
tokens
```

## DOM tests

Verify:

```text
WebNode -> DOM
DOM geometry
computed styles
CSS inheritance
responsive rules
```

## Import tests

Input:

```html
<div>
  <h1>Hello</h1>
</div>
```

Expected:

```text
element(div)
  -> element(h1)
      -> text
```

## Export tests

Round trip:

```text
WebNode
 -> HTML
 -> WebNode
```

must preserve structure and semantics as closely as possible.

## Screenshot tests

Use deterministic fixtures.

## MCP tests

Agent operations must result in the same transactions as editor operations.

---

# 29. Round-trip invariants

These are critical.

### HTML round trip

```text
HTML
 -> Sheet
 -> HTML
```

should preserve:

```text
structure
text
styles
attributes
assets
```

where supported.

### Design round trip

```text
Sheet
 -> HTML
 -> Sheet
```

should preserve:

```text
node hierarchy
styles
text
geometry semantics
```

### Agent/editor equivalence

These should produce the same document state:

```text
Editor action
```

and:

```text
MCP mutation
```

if they represent the same operation.

---

# 30. What should NOT be implemented yet

Do not prematurely build:

- distributed collaboration;
- CRDT;
- multiplayer cursors;
- remote MCP;
- AI-generated component inference;
- advanced animation timeline;
- full Figma compatibility;
- every CSS property editor;
- custom rendering engine;
- WebGL replacement for normal DOM;
- complex plugin marketplace.

First get the representation right.

---

# 31. Milestone order

## Milestone 1 — Web AST

Deliver:

```text
ElementNode
TextNode
SVG support
attributes
styles
children
```

No visual feature expansion.

---

## Milestone 2 — DOM materializer

Deliver:

```text
WebNode -> real DOM
```

with:

```text
data-sheet-node
geometry
computed styles
selection mapping
```

---

## Milestone 3 — CSS layout

Move:

```text
flex
grid
spacing
sizing
positioning
typography
```

to real CSS.

---

## Milestone 4 — Editor compatibility

Make existing editor tools operate on WebNodes.

---

## Milestone 5 — Import

Implement:

```text
HTML -> WebNode
```

with styles and assets.

---

## Milestone 6 — Export

Implement:

```text
WebNode -> HTML/CSS/JSX
```

with minimal transformation.

---

## Milestone 7 — Agent MCP

Implement:

```text
read
write
screenshot
computed styles
HTML
JSX
```

---

## Milestone 8 — Website Snapshot

Implement:

```text
website DOM -> Sheet
```

---

## Milestone 9 — Components/tokens

Move these to higher-level abstractions over the web-native model.

---

## Milestone 10 — Performance

Benchmark and optimize:

```text
large documents
large canvas
rapid style edits
dragging
zooming
text editing
agent generation
```

---

# 32. Definition of "Paper-class architecture achieved"

The migration is considered architecturally complete when all of the following are true:

### Representation

- [ ] The canonical design representation is web-native.
- [ ] HTML/CSS semantics are first-class.
- [ ] No proprietary rectangle/text/frame abstraction is required for basic web layouts.
- [ ] Arbitrary/unknown CSS can be preserved.

### Rendering

- [ ] Browser layout resolves flex/grid/intrinsic sizing.
- [ ] DOM is materialized from the document model.
- [ ] Editor overlays remain separate from the design DOM.
- [ ] Computed styles and geometry can be queried.

### Import

- [ ] HTML can become editable nodes.
- [ ] CSS is preserved.
- [ ] Assets are imported.
- [ ] Unknown HTML/CSS is preserved where possible.
- [ ] Website DOM can be captured into Sheet.

### Export

- [ ] Sheet can export HTML.
- [ ] Sheet can export CSS.
- [ ] Sheet can export JSX.
- [ ] Export does not require a proprietary runtime for ordinary layouts.

### Agents

- [ ] MCP can inspect structure.
- [ ] MCP can inspect computed styles.
- [ ] MCP can take screenshots.
- [ ] MCP can write HTML.
- [ ] MCP can patch CSS.
- [ ] MCP can manipulate nodes.
- [ ] MCP mutations use the same transaction engine as the editor.

### Design system

- [ ] Tokens map to CSS variables.
- [ ] Components use web-native templates.
- [ ] Responsive behavior maps to CSS.
- [ ] Assets are first-class.

### Performance

- [ ] Editing does not trigger unnecessary full-tree rerenders.
- [ ] Common interactions remain smooth.
- [ ] Large-document benchmarks are established.
- [ ] Browser layout is not repeatedly forced in hot paths.

---

# 33. The most important migration rule

When deciding whether a feature belongs in Sheet's core model, ask:

> "Does the browser already know how to do this?"

If yes:

```text
Use the browser.
```

Examples:

```text
flexbox       -> CSS
grid          -> CSS
text wrapping -> browser
font metrics  -> browser
responsive    -> CSS
inheritance   -> CSS
transforms    -> CSS
filters       -> CSS
positioning   -> CSS
```

If the browser does not provide the concept, then Sheet may own it:

```text
selection
components
tokens
design metadata
canvas camera
agent operations
document history
assets
collaboration
```

---

# 34. Final target

The final Sheet architecture should make this possible:

```text
Prompt:
"Build me a settings page."

Agent
  |
  | write_html
  v
Sheet
  |
  v
Web AST
  |
  v
DOM
  |
  v
Browser layout
  |
  v
Canvas
  |
  | screenshot
  v
Agent
  |
  | inspect
  v
Patch CSS
  |
  v
Final design
```

Then:

```text
Final design
    |
    +----> HTML
    |
    +----> CSS
    |
    +----> JSX
    |
    +----> production code
```

And the reverse:

```text
Production website
       |
       v
DOM
       |
       v
Sheet
       |
       v
editable design
```

That is the architecture to build toward.

---

# 35. Implementation priority

If there is any conflict between features, use this priority:

```text
1. Web-native document model
2. Browser-backed layout/rendering
3. DOM materialization/reconciliation
4. HTML/CSS import
5. HTML/CSS/JSX export
6. Agent MCP
7. Screenshot/computed-style feedback
8. Website Snapshot
9. Components
10. Tokens/themes
11. Advanced interactions
12. Collaboration/distributed infrastructure
```

Do not reverse this order.

The representation is the foundation.

If the representation remains Figma-like, every later Paper-like feature will require another translation layer.

If the representation becomes web-native, many later features become straightforward consequences of the architecture.
