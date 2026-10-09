# Authoring in the web-native model

How to compose designs as real DOM and CSS. Pair with `web-schema.md` for exact
payload shapes and `design-craft.md` for visual judgment.

## Contents

- [The mental model](#the-mental-model)
- [Pages and naming](#pages-and-naming)
- [Set up the system first](#set-up-the-system-first)
- [Layout with flex and grid](#layout-with-flex-and-grid)
- [Responsive rules](#responsive-rules)
- [States and motion](#states-and-motion)
- [Components](#components)
- [Icons](#icons)
- [Shaders](#shaders)
- [Images and assets](#images-and-assets)
- [Semantics and accessibility](#semantics-and-accessibility)

## The mental model

A design is a page-sized DOM. Use real tags: `header`, `nav`, `main`, `section`,
`h1`–`h3`, `p`, `a`, `button`, `ul`, `img`, `form`, `input`. The browser lays it
out, so anything CSS can do, a design can do. Nothing about layout is stored:
there is no fill/hug/absolute-frame model, only CSS.

Split styling between two places:

| Put it in | When |
|---|---|
| Node `styles` (inline) | A one-off value on one element |
| A stylesheet rule | Anything shared, themed, responsive, or stateful: classes, media/container queries, `:hover`, `:focus-visible`, `@supports`, keyframes |

Default to classes for repeated things. Inline `styles` cannot express pseudo
classes or conditions.

## Pages and naming

Page 1 is empty when a design is created and has no edge. Put each screen or
variant on it as its own top-level frame (`parentId: null`, `position: absolute`,
`left`, `top`, `width`, `height`), side by side. Build a mobile design as several
frames, not one long one. Extra pages (`createPage`) are for when the user asks
for separate pages; each is isolated, with its own layers. Reuse a theme
stylesheet across frames and pages; rules are global, content is not.

Name layers you will want to find again with `data-name` (`"Nav"`, `"Hero"`,
`"Pricing card"`). Unnamed frames show as "Frame" and text shows its own copy.

## Set up the system first

For a new design, insert one `theme` stylesheet before the content:

- a `:root` rule with custom properties: `--bg`, `--surface`, `--text`,
  `--muted`, `--border`, `--accent`, `--radius`, `--space-1`…`--space-8`,
  `--font-body`, `--font-display`
- a base rule for `body`/`:root` typography and color (these are re-scoped to
  the design root)
- reusable class rules: `.btn`, `.btn-primary`, `.card`, `.container`, `.stack`

Then reference tokens with `var(--accent)` everywhere. Changing one custom
property restyles the whole design, which is the token workflow.

Themes are just alternate custom-property sets: a second rule such as
`[data-theme="dark"] { --bg: … }` with the attribute set on a root element.
Screenshots only show the default state, so verify a theme structurally.

Fonts: use system stacks or fonts already in the editor's font list. There is no
`@font-face` and `link` tags are rejected.

## Layout with flex and grid

- Page shell: a root `div` or `main` with `display: flex; flex-direction: column`
  and the page width set by `page.resize`.
- Full-bleed background plus centered content: section (full width, padding) →
  `.container` (`max-width`, `margin: 0 auto`).
- Rows: `display: flex; gap`. Card grids: `display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap`.
- Avoid fixed heights; let content size itself. Use `min-height` for heroes.
- Reserve `position: absolute` for badges, overlays, and decorative layers; give
  the parent `position: relative`.

## Responsive rules

Prefer content-driven rules over device names.

- Desktop first: write the wide layout, then add `media` conditions such as
  `(max-width: 900px)` and `(max-width: 600px)` on the specific classes that
  change (collapse `grid-template-columns`, reduce padding, stack rows).
- Use `container` conditions for a component that must adapt to its own width;
  give the ancestor `container-type: inline-size`.
- One rule per class per breakpoint. Use `rule.patch` to adjust, not a new
  duplicate rule.
- Verify with `getWebScreenshot` at a narrow `width`. A media query only applies
  when the render width matches it.

## States and motion

The document model holds style rules with a selector, declarations, and
media/container/supports conditions. It does **not** hold `@keyframes` or
`@font-face`, and HTML/CSS import drops them. So:

- Hover, press, focus: rules with `:hover`, `:active`, `:focus-visible`, plus a
  `transition` on the base rule (for example `transition: transform .2s ease,
  background-color .2s ease`).
- There are no entrance or looping keyframe animations. For continuous motion
  use a shader; for everything else use state transitions.
- Add a `prefers-reduced-motion: reduce` media condition on a rule that sets
  `transition: none` for the same selectors.
- Judge the static composition before adding motion, and keep it to a few
  meaningful moments.

## Components

Make a component when a structure repeats with shared identity: a nav item, a
pricing card, a button with variants. Not because two rectangles look alike.

- `component.define` with a single template root, its template nodes, and
  (optionally) a scoped stylesheet. Component CSS reaches instances through the
  normal cascade.
- `instance.create` to place copies. Use `instance.setOverride` for per-instance
  text, attributes, or custom properties (`--accent` is a good variant switch).
- Edit the template to change all instances at once. Do not patch bound nodes
  directly.
- To pass different content per instance, override the text of the specific
  bound node id. Read the instance's `bindings` from `getWebDocument` to find it.

## Icons

Do not hand-write svg paths.

1. `searchIcons { query, library? }` (libraries: `hugeicons`, `lucide`).
2. `insertIcon` with the returned `library` and `name`, plus `parentId`, `size`,
   `color`, `strokeWidth`.
3. Restyle with `styleIcon`. Icons draw with `currentColor`, so `color` (or the
   parent's text color) tints them.

The result is an `svg` node with child shape nodes; treat it as one unit and
move or delete the `svg` node id returned as `nodeId`.

Icons, images and shaders are objects of their own. In the editor the person can
drag any of them out of the layout they sit in and place or resize it freely; the
first drag pins it with `position: absolute`. So decide on purpose. An icon that
is part of a row or a button belongs in flow (inside that element, no position).
One that is a free-standing element of the design belongs on its frame with
`position: absolute`, `left`, `top`, `width` and `height`, since a frame is
positioned and its children measure from it. Without a `parentId`, `insertIcon`
and `insertShader` already place the object free-positioned at the top level.

## Shaders

Paper shaders give animated WebGL gradients and textures for backdrops and
accents.

1. `listShaders` to see names, params, ranges, and defaults.
2. `insertShader { shader, parentId?, left?, top?, width?, height?, params? }`.
   It inserts a `div` with `data-shader` and `data-shader-params`. With no
   `parentId` it is its own free-positioned object on the page, set beside the
   other top-level objects, so the person can move and resize it like a frame;
   pass `left` and `top` to place it yourself. With a `parentId` it goes inside
   that element, in flow. People pick shaders in the editor from the Shaders
   tool, which shows each one running live; the names there are the names
   `listShaders` returns.
3. Tune later with `styleShader`; params merge over the current ones.

Guidance:

- A shader is a box. To use it as a full-bleed background, set the parent to
  `position: relative; overflow: hidden`, then patch the shader node with
  `position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0`, and
  give foreground content `position: relative; z-index: 1`.
- Keep foreground text contrast high over moving color; prefer muted palettes
  and a low `speed` for backdrops behind copy.
- `speed: 0` (or the `static-mesh-gradient` shader) gives a still image with no
  animation cost.
- Shaders render live in the editor and preview. `getWebScreenshot` and PNG/JPG
  `exportDesign` show one still frame, so a screenshot is a fair check of the
  colors and shape but not of the motion. HTML and JSON export show an empty
  box, so do not rely on the shader for legibility (give the parent a matching
  fallback `background`).
- Only the shaders `listShaders` returns are available; do not invent names.

## Images and assets

- Uploaded assets: `listAssets`, then an `img` with `src: "/api/asset/<id>"`, an
  `alt`, and explicit `width`/`height` or `aspect-ratio` plus `object-fit`.
- External images must be `https://` urls. `data:` urls only for base64
  avif/gif/jpeg/png/webp.
- No `script`, `iframe`, `object`, `embed`, or `link`.
- Give an image a pixel `width` and `height` (not `auto`) when it is a freely
  placed piece of the design. The editor can resize one with `auto` sizing, but
  it then writes pixels, so state them yourself. A free-standing image sits on
  its frame with `position: absolute`, `left` and `top`; one that is part of a
  card or a row stays in flow. A frame that clips (`overflow: hidden`) hides any
  part of the image that sticks out of it.

## Semantics and accessibility

- One `h1`; headings descend in order. Landmarks for `header`, `nav`, `main`,
  `footer`.
- Buttons are `button`, links are `a` with `href`. Do not style a `div` as a
  control.
- Provide `alt` on images and `aria-label` on icon-only controls.
- Keep body text at a readable size and contrast, and visible `:focus-visible`
  styles.
