import { describe, expect, it } from 'vitest'
import { serializeWebStylesheets } from './web-css'
import { importWebSnapshot, importWebStylesheet } from './web-import'
import { orderedWebChildren, serializeWebDocument } from './web-model'

const html = [
  '<section id="hero" class="card featured" data-kind="promo">',
  '<h2>Hello</h2>',
  '<p>World</p>',
  '</section>',
].join('')

const css = [
  '.card { display: grid; gap: 20px; padding: 20px; }',
  '.card { color: red; }',
  '@media (max-width: 700px) {',
  '  .card { gap: 8px; }',
  '  .title { font-size: 12px; }',
  '}',
  '.footer { color: gray; }',
  '@media (max-width: 700px) { .footer { color: black; } }',
  '@container (max-width: 500px) { .inner { padding: 8px; } }',
  '@supports (display: grid) { .grid { display: grid; } }',
  'button:hover, .card::before { background: blue; content: "x"; }',
  ':root { --brand: #18181b; }',
  '.uses-var { color: var(--brand); }',
].join('\n')

function ruleSummary(document: ReturnType<typeof importWebSnapshot>['document']) {
  const sheet = document.stylesheets[document.stylesheetOrder[0] as string]
  if (!sheet) throw new Error('Imported stylesheet is missing')
  return sheet.ruleOrder.map((id) => {
    const rule = sheet.rules[id]
    if (!rule) throw new Error(`Rule ${id} is missing`)
    return {
      selector: rule.selector,
      declarations: rule.declarations,
      conditions: rule.conditions,
    }
  })
}

describe('website snapshot import', () => {
  it('preserves HTML structure without proprietary node conversion', () => {
    const { document, warnings } = importWebSnapshot(html)
    expect(warnings).toEqual([])
    const section = document.nodes[document.roots[0] as string]
    expect(section).toMatchObject({
      kind: 'element',
      tag: 'section',
      attributes: { id: 'hero', class: 'card featured', 'data-kind': 'promo' },
      styles: {},
    })
    const children = orderedWebChildren(document, (section as { id: string }).id)
    expect(children.map((child) =>
      child.kind === 'element' ? child.tag : child.kind,
    )).toEqual(['h2', 'p'])
    expect(serializeWebDocument(document)).toBe(
      '<section id="hero" class="card featured" data-kind="promo"><h2>Hello</h2><p>World</p></section>',
    )
  })

  it('preserves authored CSS: selectors, declarations, order, and conditions', () => {
    const { document, warnings } = importWebSnapshot(html, css)
    expect(warnings).toEqual([])
    expect(ruleSummary(document)).toEqual([
      {
        selector: '.card',
        declarations: {
          // Parser-canonicalized expansion of `padding: 20px`: authored
          // specified values, kept verbatim rather than collapsed by a
          // hand-rolled shorthand database.
          'padding-top': '20px',
          'padding-right': '20px',
          'padding-bottom': '20px',
          'padding-left': '20px',
          padding: '20px',
          display: 'grid',
          gap: '20px',
        },
        conditions: [],
      },
      { selector: '.card', declarations: { color: 'red' }, conditions: [] },
      {
        selector: '.card',
        declarations: { gap: '8px' },
        conditions: [{ kind: 'media', query: '(max-width: 700px)' }],
      },
      {
        selector: '.title',
        declarations: { 'font-size': '12px' },
        conditions: [{ kind: 'media', query: '(max-width: 700px)' }],
      },
      { selector: '.footer', declarations: { color: 'gray' }, conditions: [] },
      {
        selector: '.footer',
        declarations: { color: 'black' },
        conditions: [{ kind: 'media', query: '(max-width: 700px)' }],
      },
      {
        selector: '.inner',
        declarations: {
          padding: '8px',
          'padding-top': '8px',
          'padding-right': '8px',
          'padding-bottom': '8px',
          'padding-left': '8px',
        },
        conditions: [{ kind: 'container', query: '(max-width: 500px)' }],
      },
      {
        selector: '.grid',
        declarations: { display: 'grid' },
        conditions: [{ kind: 'supports', query: '(display: grid)' }],
      },
      {
        selector: 'button:hover, .card::before',
        declarations: {
          'background-attachment': 'scroll',
          'background-clip': 'border-box',
          'background-color': 'blue',
          'background-image': 'none',
          'background-origin': 'padding-box',
          'background-position': '0% 0%',
          'background-repeat': 'repeat',
          'background-size': 'auto',
          background: 'blue',
          content: '"x"',
        },
        conditions: [],
      },
      { selector: ':root', declarations: { '--brand': '#18181b' }, conditions: [] },
      { selector: '.uses-var', declarations: { color: 'var(--brand)' }, conditions: [] },
    ])
  })

  it('never bakes computed styles into nodes or rules', () => {
    const { document } = importWebSnapshot(html, css)
    for (const node of Object.values(document.nodes)) {
      if (node.kind === 'element') expect(node.styles).toEqual({})
    }
    const serialized = serializeWebStylesheets(document.stylesheets, document.stylesheetOrder)
    expect(serialized).toContain('padding-top:20px')
    expect(serialized).toContain('display:grid')
    expect(serialized).toContain('@media (max-width: 700px){.card{gap:8px}.title{font-size:12px}}')
    expect(serialized).toContain('.footer{color:gray}@media (max-width: 700px){.footer{color:black}}')
  })

  it('merges embedded <style> sources in document order before provided CSS', () => {
    const withStyle = `<style>.early { color: red; }</style>${html}<style>.late { color: blue; }</style>`
    const { document, warnings } = importWebSnapshot(withStyle, '.last { color: black; }')
    expect(warnings).toEqual([])
    expect(ruleSummary(document).map((rule) => rule.selector)).toEqual([
      '.early',
      '.late',
      '.last',
    ])
  })

  it('reports unsupported at-rules explicitly instead of inventing semantics', () => {
    const { document, warnings } = importWebSnapshot(
      html,
      [
        '.kept { color: red; }',
        '@keyframes spin { to { transform: rotate(360deg); } }',
        "@font-face { font-family: 'F'; src: url(https://example.com/f.woff2); }",
        '@layer base { .layered { color: green; } }',
      ].join('\n'),
    )
    expect(ruleSummary(document).map((rule) => rule.selector)).toEqual(['.kept'])
    expect(warnings).toHaveLength(3)
    expect(warnings.join('\n')).toContain('@keyframes')
    expect(warnings.join('\n')).toContain('@font-face')
    expect(warnings.join('\n')).toContain('@layer')
    // No mysterious escape hatch: the document holds only DOM + v1 rules.
    expect(JSON.stringify(document)).not.toContain('rawCss')
    expect(JSON.stringify(document)).not.toContain('keyframes')
  })

  it('skips !important and unsafe declarations with warnings but keeps their rules', () => {
    const { stylesheet, warnings } = importWebStylesheet(
      '.box { color: red !important; width: 10px; background: url(javascript:alert(1)); }',
    )
    const rule = stylesheet.rules[stylesheet.ruleOrder[0] as string]
    expect(rule?.declarations).toEqual({ width: '10px' })
    // The CSS parser itself drops `url(javascript:…)` before Sheet's
    // validators run; defense in depth stays, but only `!important` reaches
    // the warning list here.
    expect(warnings).toHaveLength(1)
    expect(warnings.join('\n')).toContain('!important')
  })

  it('round-trips structurally: import, serialize, import again', () => {
    const first = importWebSnapshot(html, css).document
    const second = importWebSnapshot(
      serializeWebDocument(first),
      serializeWebStylesheets(first.stylesheets, first.stylesheetOrder),
    ).document
    const summarize = (document: typeof first) => {
      const sheet = document.stylesheets[document.stylesheetOrder[0] as string]
      if (!sheet) throw new Error('Missing sheet')
      return {
        nodes: serializeWebDocument(document),
        // Rule IDs are fresh per import; identity is selector + values + order.
        rules: sheet.ruleOrder.map((id) => {
          const rule = sheet.rules[id]
          if (!rule) throw new Error(`Rule ${id} is missing`)
          const { id: _ignored, ...rest } = rule
          return rest
        }),
      }
    }
    expect(summarize(second)).toEqual(summarize(first))
  })
})
