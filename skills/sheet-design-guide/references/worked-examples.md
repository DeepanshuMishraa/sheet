# Worked examples

Known-good payloads. Ids are chosen by you; keep them stable for later patches.
Every `node` needs `kind`, `namespace`, `tag`, `parentId`, `order`, `attributes`,
and `styles`. Text is its own node.

## Contents

- [Start a new design](#start-a-new-design)
- [Add a section](#add-a-section)
- [Define and place a component](#define-and-place-a-component)
- [Add a shader backdrop](#add-a-shader-backdrop)
- [Refine with a rule patch](#refine-with-a-rule-patch)
- [Branch, compare, apply](#branch-compare-apply)

## Start a new design

```json
// createDesign
{ "name": "Acme landing" }
// -> { "id": "design_abc", "revision": 0 }

// createPage { "designId": "design_abc", "name": "Landing", "width": 1440, "height": 2400 }
// -> { "pageId": "element_...", "result": { "applied": true, "revision": 1 } }
```

Next transaction: theme stylesheet and the page's main element.

```json
{
  "designId": "design_abc",
  "expectedRevision": 1,
  "transaction": {
    "id": "setup-1",
    "label": "Page, theme and root",
    "operations": [
      {
        "type": "stylesheet.insert",
        "stylesheet": {
          "id": "theme",
          "name": "theme",
          "order": 1024,
          "ruleOrder": ["r-root", "r-body", "r-container", "r-btn", "r-btn-hover", "r-btn-motion"],
          "rules": {
            "r-root": {
              "id": "r-root", "order": 1024, "conditions": [], "selector": ":root",
              "declarations": {
                "--bg": "#0b0d10", "--text": "#f4f5f7", "--muted": "#9aa1ab",
                "--accent": "#7cf5c4", "--radius": "12px"
              }
            },
            "r-body": {
              "id": "r-body", "order": 2048, "conditions": [], "selector": ":root",
              "declarations": {
                "background-color": "var(--bg)", "color": "var(--text)",
                "font-family": "Inter, system-ui, sans-serif"
              }
            },
            "r-container": {
              "id": "r-container", "order": 3072, "conditions": [], "selector": ".container",
              "declarations": { "max-width": "1120px", "margin": "0 auto", "padding": "0 32px" }
            },
            "r-btn": {
              "id": "r-btn", "order": 4096, "conditions": [], "selector": ".btn",
              "declarations": {
                "display": "inline-flex", "padding": "12px 20px", "border-radius": "var(--radius)",
                "background-color": "var(--accent)", "color": "#04110b", "font-weight": "600",
                "transition": "transform .2s ease"
              }
            },
            "r-btn-hover": {
              "id": "r-btn-hover", "order": 5120, "conditions": [], "selector": ".btn:hover",
              "declarations": { "transform": "translateY(-2px)" }
            },
            "r-btn-motion": {
              "id": "r-btn-motion", "order": 6144, "selector": ".btn",
              "conditions": [{ "kind": "media", "query": "(prefers-reduced-motion: reduce)" }],
              "declarations": { "transition": "none" }
            }
          }
        }
      },
      {
        "type": "node.insert",
        "node": {
          "id": "page-main", "kind": "element", "namespace": "html", "tag": "main",
          "parentId": "<pageId>", "order": 1024, "attributes": { "data-name": "Landing" },
          "styles": { "display": "flex", "flex-direction": "column", "min-height": "100%" }
        }
      }
    ]
  }
}
// -> { "applied": true, "revision": 2, "document": { ... } }
```

## Add a section

Parents before children; the response revision is the next `expectedRevision`.

```json
{
  "designId": "design_abc",
  "expectedRevision": 2,
  "transaction": {
    "id": "hero-1",
    "label": "Hero section",
    "operations": [
      { "type": "node.insert", "node": {
        "id": "hero", "kind": "element", "namespace": "html", "tag": "section",
        "parentId": "page-main", "order": 1024, "attributes": { "class": "hero", "data-name": "Hero" },
        "styles": { "padding": "120px 0" } } },
      { "type": "node.insert", "node": {
        "id": "hero-inner", "kind": "element", "namespace": "html", "tag": "div",
        "parentId": "hero", "order": 1024, "attributes": { "class": "container" },
        "styles": { "display": "flex", "flex-direction": "column", "gap": "24px", "align-items": "flex-start" } } },
      { "type": "node.insert", "node": {
        "id": "hero-title", "kind": "element", "namespace": "html", "tag": "h1",
        "parentId": "hero-inner", "order": 1024, "attributes": {},
        "styles": { "font-size": "64px", "line-height": "1.05", "margin": "0", "max-width": "16ch" } } },
      { "type": "node.insert", "node": {
        "id": "hero-title-text", "kind": "text", "parentId": "hero-title", "order": 1024,
        "text": "Ship the invoice, not the spreadsheet" } },
      { "type": "node.insert", "node": {
        "id": "hero-cta", "kind": "element", "namespace": "html", "tag": "a",
        "parentId": "hero-inner", "order": 2048, "attributes": { "class": "btn", "href": "#pricing" },
        "styles": {} } },
      { "type": "node.insert", "node": {
        "id": "hero-cta-text", "kind": "text", "parentId": "hero-cta", "order": 1024,
        "text": "Start free" } }
    ]
  }
}
```

## Define and place a component

```json
{
  "designId": "design_abc",
  "expectedRevision": 3,
  "transaction": {
    "id": "card-component-1",
    "label": "Feature card component",
    "operations": [
      {
        "type": "component.define",
        "component": { "id": "feature-card", "name": "Feature card", "templateRootIds": ["fc-root"], "stylesheetId": "feature-card-css" },
        "template": [
          { "id": "fc-root", "kind": "element", "namespace": "html", "tag": "article",
            "parentId": null, "order": 1024, "attributes": { "class": "fc" }, "styles": {} },
          { "id": "fc-title", "kind": "element", "namespace": "html", "tag": "h3",
            "parentId": "fc-root", "order": 1024, "attributes": {}, "styles": { "margin": "0" } },
          { "id": "fc-title-text", "kind": "text", "parentId": "fc-title", "order": 1024, "text": "Feature" }
        ],
        "stylesheet": {
          "id": "feature-card-css", "name": "feature-card", "order": 2048, "ruleOrder": ["fc-rule"],
          "rules": { "fc-rule": { "id": "fc-rule", "order": 1024, "conditions": [], "selector": ".fc",
            "declarations": { "padding": "24px", "border": "1px solid #262b33", "border-radius": "var(--radius)" } } }
        }
      },
      { "type": "instance.create", "id": "fc-1", "componentId": "feature-card", "parentId": "hero-inner", "order": 3072 }
    ]
  }
}
```

Re-read the document to find the live id bound to `fc-title-text`, then:

```json
{ "type": "instance.setOverride", "instanceId": "fc-1", "id": "<live text node id>",
  "override": { "kind": "text", "text": "Auto-reminders" } }
```

## Add a shader backdrop

```json
// listShaders -> names, params, ranges, defaults

// insertShader
{
  "designId": "design_abc",
  "shader": "mesh-gradient",
  "parentId": "hero",
  "params": { "colors": ["#0b0d10", "#123d33", "#7cf5c4"], "speed": 0.3, "distortion": 0.7 }
}
// -> { "nodeId": "element_...", "result": { "applied": true, "revision": 5, ... } }
```

Make it a backdrop, using the returned `nodeId` and the new revision:

```json
{
  "designId": "design_abc",
  "expectedRevision": 5,
  "transaction": {
    "id": "hero-backdrop-1",
    "label": "Shader as hero backdrop",
    "operations": [
      { "type": "node.patch", "id": "hero", "patch": { "kind": "element",
        "styles": { "position": "relative", "overflow": "hidden", "background-color": "#0b0d10" } } },
      { "type": "node.patch", "id": "<shader nodeId>", "patch": { "kind": "element",
        "styles": { "position": "absolute", "inset": "0", "width": "100%", "height": "100%", "z-index": "0" } } },
      { "type": "node.patch", "id": "hero-inner", "patch": { "kind": "element",
        "styles": { "position": "relative", "z-index": "1" } } }
    ]
  }
}
```

The parent keeps a solid `background-color` because screenshots and exports show
the shader box empty.

## Refine with a rule patch

Restyle every `.btn` at once, and collapse the layout on narrow screens:

```json
{ "type": "rule.patch", "stylesheetId": "theme", "id": "r-btn",
  "patch": { "declarations": { "padding": "14px 24px", "font-weight": null } } }

{ "type": "rule.insert", "stylesheetId": "theme", "rule": {
  "id": "r-hero-narrow", "order": 7168, "selector": ".hero .container",
  "conditions": [{ "kind": "media", "query": "(max-width: 720px)" }],
  "declarations": { "padding": "0 20px" } } }
```

A `null` declaration removes that property.

## Branch, compare, apply

```json
// createBranch { designId, name: "Bolder hero" } -> { id: "draft_1" }
// Every following call carries "draftId": "draft_1"
// ... edits and screenshots on the branch ...
// compareBranch { designId, draftId } -> { mainRevision: 4, draftRevision: 7, conflicts: [...] }
// applyBranch (only when the user authorizes changing Main)
{
  "designId": "design_abc",
  "draftId": "draft_1",
  "expectedMainRevision": 4,
  "expectedDraftRevision": 7,
  "resolutions": { "<conflict id>": "draft" }
}
```
