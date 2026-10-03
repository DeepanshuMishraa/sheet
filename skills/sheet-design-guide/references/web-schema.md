# Web document and transaction schema

Exact shapes for `getWebDocument` and `applyWebTransaction`. Grounded in
`packages/canvas/src/web-model.ts`, `web-css.ts`, and `web-components.ts`.

## Contents

- [Envelope](#envelope)
- [Document shape](#document-shape)
- [Nodes](#nodes)
- [Stylesheets and rules](#stylesheets-and-rules)
- [Components and instances](#components-and-instances)
- [Operations](#operations)
- [Validation limits](#validation-limits)
- [Pages and layer names](#pages-and-layer-names)
- [Icons and shaders](#icons-and-shaders)

## Envelope

```json
{
  "designId": "design_...",
  "draftId": "optional branch id",
  "expectedRevision": 3,
  "transaction": {
    "id": "landing-hero-1",
    "label": "Add hero section",
    "operations": []
  }
}
```

- `expectedRevision` is the `revision` from your last `getWebDocument` (or the
  previous transaction's result). A stale value returns `applied: false` with
  reason `stale`; nothing is written.
- `transaction.id` is an idempotency key: reuse it only to retry the identical
  transaction. `label` appears in history.
- Operations run in order; the whole transaction applies or none of it does.
  1–2000 operations.
- Omit `draftId` for Main. A branch write needs an active branch.

Success returns `{ applied: true, revision, document }`.

## Document shape

`getWebDocument` returns `{ status: "ready", revision, document }`.

```ts
document = {
  model: 'web', schemaVersion: 3, id, name,
  nodes: Record<id, WebNode>,      // flat, keyed by id
  roots: id[],                     // top-level nodes
  stylesheets: Record<id, WebStyleSheet>,
  stylesheetOrder: id[],           // cascade order
  components: Record<id, WebComponent>,
  instances: Record<id, WebInstance>,
  metadata: { page?: { width, height }, ... }
}
```

A new design is empty: no roots, no stylesheets. Its first node must have
`parentId: null`.

## Nodes

```ts
type WebNode =
  | { id, kind: 'element', namespace: 'html' | 'svg', tag, parentId, order,
      attributes: Record<string, string>, styles: Record<string, string> }
  | { id, kind: 'text', text, parentId, order }
```

- `parentId: null` makes a root. Otherwise the parent must be an element.
- `order` is a sortable number among siblings. Space siblings by 1024 so later
  inserts can use midpoints or `node.move`.
- `styles` are inline declarations by property name: kebab-case
  (`background-color`) or custom (`--accent`). Values must not contain
  `</style`, `<script`, `<!--`, `expression(`, `-moz-binding`, or a
  `javascript:` url.
- `attributes`: any name matching `[a-z_:][a-z0-9:._-]*` except `style`,
  `srcdoc`, `data-sheet-node`, and anything starting with `on`. Attributes
  `src`, `href`, `action`, `formaction`, `poster`, `xlink:href` must be `#…`,
  `/…`, `http(s)://`, `mailto:`, `tel:`, or a base64 `data:image/(avif|gif|jpeg|png|webp)`.
- Use `class` to attach stylesheet rules. Uploaded assets are `/api/asset/<id>`
  urls (ids from `listAssets`).
- Void tags (`img`, `input`, `br`, `hr`, …) take no children.
- SVG elements use `namespace: 'svg'`, including the children of an `svg`.
- Text is its own node: a `p` with copy is an element plus a child text node.
- `kind` is only `"element"` or `"text"`. The tag name goes in `tag`
  (`{ "kind": "element", "tag": "span", ... }`), never in `kind`.

## Stylesheets and rules

```ts
stylesheet = { id, name, order, rules: Record<id, Rule>, ruleOrder: id[] }
rule = { id, selector, declarations: Record<string,string>,
         conditions: Array<{ kind: 'media' | 'container' | 'supports', query: string }>,
         order }
```

- `ruleOrder` is optional. When omitted it is derived from each rule's `order`
  (then id). When given, it must list every rule id in `rules` exactly once; a
  missing or unknown id is rejected with the ids named.
- Declaration names are lowercase CSS properties (`font-size`), vendor-prefixed
  properties (`-webkit-font-smoothing`), or `--custom-properties`. Values are
  strings under 10,000 characters with no `<style>`, `<script>`, comments,
  `expression()` or `javascript:` URLs.
- Conditions hold the prelude without `@` or braces:
  `{ "kind": "media", "query": "(max-width: 720px)" }`.
- Selectors are ordinary CSS. Rejected: empty or padded selectors, `{ } ; \``,
  `<`, `javascript:`, `expression(`, and `data-sheet-node`. `:root`, `html`, and
  `body` are re-scoped to the design root, so put custom properties on `:root`.
- Later stylesheets in `stylesheetOrder` (then higher rule `order`) win ties,
  like a normal cascade.
- Insert a stylesheet with its rules in one op, or insert an empty one and add
  rules with `rule.insert`.

## Components and instances

```ts
component = { id, name, templateRootIds: id[], stylesheetId: id | null, description? }
```

`component.define` carries the component, its `template` nodes (flat list, root
has `parentId: null`, every other node's parent is inside the template), and an
optional scoped `stylesheet`. Template node ids must be new and unique. Exactly
one template root.

`instance.create` places a live copy: `{ componentId, parentId, order, id? }`.
The server clones the template into live nodes and records `bindings`
(live id → template id).

Overrides diverge one bound node from its template:

```json
{ "type": "instance.setOverride", "instanceId": "inst_1", "id": "<live node id>",
  "override": { "kind": "text", "text": "Buy now" } }
```

`override.kind` is `text` (`text`), `attributes` (`attributes`, `null` removes
one), or `custom-properties` (`properties`, `null` removes one).

## Operations

| Operation | Payload |
|---|---|
| `page.resize` | `width`, `height` (1–100000 px) |
| `page.reset` | none |
| `node.insert` | `node` (full `WebNode`; id must be new) |
| `node.patch` | `id`, `patch`: element `{ kind:'element', tag?, attributes?, styles? }` or text `{ kind:'text', text }`. A `null` value deletes that key |
| `node.move` | `id`, `parentId`, `order` |
| `node.delete` | `id` (removes the subtree) |
| `stylesheet.insert` | `stylesheet` |
| `stylesheet.patch` | `id`, `patch: { name?, order? }` |
| `stylesheet.delete` | `id` |
| `rule.insert` | `stylesheetId`, `rule` |
| `rule.patch` | `stylesheetId`, `id`, `patch: { selector?, declarations?, conditions? }`; `null` declaration deletes it |
| `rule.move` | `stylesheetId`, `id`, `order` |
| `rule.delete` | `stylesheetId`, `id` |
| `component.define` | `component`, `template`, `stylesheet?` |
| `component.delete` | `id`. Rejected while any instance exists; `instance.delete` them first |
| `instance.create` | `componentId`, `parentId`, `order`, `id?` |
| `instance.delete` | `id` |
| `instance.setOverride` / `instance.clearOverride` | `instanceId`, `id` (+ `override`) |

Each operation also has an undo inverse recorded in history.

Ordering matters inside one transaction: insert a parent before its children,
and a stylesheet before its rules.

## Validation limits

- Up to 25,000 nodes per document.
- Patching a node that is bound to a component instance is rejected: edit the
  template or use `instance.setOverride`.
- Inserting under a bound node is rejected; insert into the template instead
  and the change propagates to every instance.
- Ids: `[A-Za-z0-9:_-]`, 1–200 chars, unique per kind.
- Rule selector, condition query, and style value length are capped; long
  values are rejected with the offending key in the message.

## Pages and layer names

A design holds any number of pages. A page is a root element with a
`data-sheet-page` attribute (its value is the page name) whose own `width`,
`height` and `background` styles are the canvas. Its descendants are that page's
layers; no page can see or select another's content. Page 1 is the original
unnamed page: roots without the attribute. It is listed only while it has
content or no other page exists.

- `createPage { designId, draftId?, name?, width?, height?, background? }`
  returns `pageId`, the page root node id.
- `listPages { designId, draftId? }` returns `[{ pageId, name, width, height }]`;
  `pageId: null` is the original page.
- Use `pageId` as `parentId` for `node.insert`, or pass it as `pageId` to
  `insertIcon` / `insertShader`, and as `rootId` to `getWebScreenshot` and
  `exportDesign` to capture one page.
- Rename: `node.patch` the root's `data-sheet-page`. Resize: `node.patch` its
  `width`/`height` styles (`page.resize` is only for the original page). Resize to correct one design's size, never to fit several variants side by side; variants each get their own `createPage`.
  Delete: `node.delete` the `pageId`.

Layer names come from `data-name`. Without it the editor shows: the icon or
shader label, a text element's own text, otherwise the kind: Frame, Image, SVG,
Path, Link, Button, Input. Set it with `node.patch`
`{ "kind": "element", "attributes": { "data-name": "Hero" } }` or at insert time.

## Icons and shaders

Prefer dedicated tools over hand-built nodes.

- `searchIcons { query, library?, limit? }` then
  `insertIcon { designId, draftId?, library, name, parentId?, color?, size?, strokeWidth? }`
  inserts a validated `svg` node tagged `data-icon-library` / `data-icon-name`.
  Restyle with `styleIcon { designId, nodeId, color?, size?, strokeWidth? }`.
- `listShaders` returns every Paper shader with each param's type, range or
  options, and default. `insertShader { designId, draftId?, shader, parentId?,
  width?, height?, params? }` inserts a `div` tagged `data-shader` /
  `data-shader-params`. `styleShader { designId, nodeId, width?, height?, params? }`
  merges params over the current ones. Out-of-range numbers are clamped and
  unknown keys dropped. Params: numbers (`speed`, `distortion`, …), a `colors`
  list of up to 10 CSS colors, single `colorBack`, and enums such as
  `grain-gradient`'s `shape`.
- Both tools default `parentId` to the first root, return the new `nodeId`, and
  write through the same transaction path as `applyWebTransaction`, so they bump
  the revision. Re-read before your next `applyWebTransaction`.
