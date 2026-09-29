import { describe, expect, it } from 'vitest'
import {
  assertWebDocument,
  applyWebTransaction,
  createWebDocument,
  createWebStyleRule,
  createWebStyleSheet,
  parseWebDocument,
  WEB_DOCUMENT_SCHEMA_VERSION,
} from './web-model'
import {
  serializeWebStylesheets,
  validConditionQuery,
  validSelector,
} from './web-css'

function stylesheetFixture() {
  const document = createWebDocument('Cards', 'cards')
  document.stylesheets.main = createWebStyleSheet('main', { id: 'main', order: 1_024 })
  document.stylesheets.main.rules.base = createWebStyleRule(
    '.card',
    { padding: '20px', display: 'grid', 'grid-template-columns': '1fr 1fr' },
    { id: 'base', order: 1_024 },
  )
  document.stylesheets.main.rules.narrow = createWebStyleRule(
    '.card',
    { padding: '12px', 'grid-template-columns': '1fr' },
    { id: 'narrow', order: 2_048, conditions: [{ kind: 'media', query: '(max-width: 768px)' }] },
  )
  document.stylesheetOrder = ['main']
  document.stylesheets.main.ruleOrder = ['base', 'narrow']
  return assertWebDocument(document)
}

describe('authored CSS document model', () => {
  it('keeps authored rules verbatim instead of flattening them into computed values', () => {
    const document = stylesheetFixture()
    const main = document.stylesheets.main
    expect(main?.rules.base?.declarations).toEqual({
      padding: '20px',
      display: 'grid',
      'grid-template-columns': '1fr 1fr',
    })
    expect(main?.rules.narrow).toMatchObject({
      selector: '.card',
      declarations: { padding: '12px', 'grid-template-columns': '1fr' },
      conditions: [{ kind: 'media', query: '(max-width: 768px)' }],
    })
    // Authored source of truth: two rules for one selector, values unresolved.
    // A computed snapshot would hold exactly one padding value; the document
    // must never collapse to that shape.
    expect(Object.values(main?.rules ?? {}).filter((rule) => rule.selector === '.card')).toHaveLength(2)
    expect(JSON.stringify(document)).not.toContain('384px')
  })

  it('preserves stylesheet order, rule order, and declaration order through transactions', () => {
    const document = stylesheetFixture()
    const inserted = applyWebTransaction(document, {
      id: 'add-theme',
      label: 'Add theme sheet',
      operations: [
        {
          type: 'stylesheet.insert',
          stylesheet: createWebStyleSheet('theme', { id: 'theme', order: 512 }),
        },
        {
          type: 'rule.insert',
          stylesheetId: 'main',
          rule: createWebStyleRule('.card:hover', { background: '#f4f4f5' }, { id: 'hover', order: 3_072 }),
        },
      ],
    }).document
    expect(inserted.stylesheetOrder).toEqual(['theme', 'main'])
    expect(inserted.stylesheets.main?.ruleOrder).toEqual(['base', 'narrow', 'hover'])

    const moved = applyWebTransaction(inserted, {
      id: 'reorder',
      label: 'Reorder rules',
      operations: [{ type: 'rule.move', stylesheetId: 'main', id: 'hover', order: 128 }],
    }).document
    expect(moved.stylesheets.main?.ruleOrder).toEqual(['hover', 'base', 'narrow'])
    expect(serializeWebStylesheets(moved.stylesheets, moved.stylesheetOrder)).toBe(
      '.card:hover{background:#f4f4f5}.card{padding:20px;display:grid;grid-template-columns:1fr 1fr}' +
        '@media (max-width: 768px){.card{padding:12px;grid-template-columns:1fr}}',
    )
  })

  it('preserves unknown properties, custom properties, and exact selector strings', () => {
    const document = stylesheetFixture()
    const result = applyWebTransaction(document, {
      id: 'future-css',
      label: 'Future CSS',
      operations: [
        {
          type: 'rule.insert',
          stylesheetId: 'main',
          rule: createWebStyleRule(
            '.hero::before, button:focus-visible',
            {
              'some-future-property': 'value',
              '--brand': '#18181b',
              color: 'var(--brand)',
              'container-type': 'inline-size',
            },
            { id: 'future', order: 4_096 },
          ),
        },
      ],
    }).document
    const rule = result.stylesheets.main?.rules.future
    expect(rule?.selector).toBe('.hero::before, button:focus-visible')
    expect(rule?.declarations).toEqual({
      'some-future-property': 'value',
      '--brand': '#18181b',
      color: 'var(--brand)',
      'container-type': 'inline-size',
    })
    expect(serializeWebStylesheets(result.stylesheets, result.stylesheetOrder)).toContain(
      '.hero::before, button:focus-visible{some-future-property:value;--brand:#18181b;color:var(--brand);container-type:inline-size}',
    )
  })

  it('keeps container and supports conditions as authored at-rule stacks', () => {
    const document = stylesheetFixture()
    const result = applyWebTransaction(document, {
      id: 'conditions',
      label: 'Conditions',
      operations: [
        {
          type: 'rule.insert',
          stylesheetId: 'main',
          rule: createWebStyleRule('.card', { gap: '8px' }, {
            id: 'contained',
            order: 5_096,
            conditions: [
              { kind: 'container', query: '(max-width: 600px)' },
              { kind: 'supports', query: '(display: grid)' },
            ],
          }),
        },
      ],
    }).document
    expect(result.stylesheets.main?.rules.contained?.conditions).toEqual([
      { kind: 'container', query: '(max-width: 600px)' },
      { kind: 'supports', query: '(display: grid)' },
    ])
    expect(serializeWebStylesheets(result.stylesheets, result.stylesheetOrder)).toContain(
      '@container (max-width: 600px){@supports (display: grid){.card{gap:8px}}}',
    )
  })

  it('never copies stylesheet values into inline styles or vice versa', () => {
    const document = stylesheetFixture()
    const result = applyWebTransaction(document, {
      id: 'no-flatten',
      label: 'No flattening',
      operations: [
        {
          type: 'rule.patch',
          stylesheetId: 'main',
          id: 'base',
          patch: { declarations: { padding: '24px' } },
        },
      ],
    }).document
    expect(result.stylesheets.main?.rules.base?.declarations.padding).toBe('24px')
    expect(result.stylesheets.main?.rules.narrow?.declarations.padding).toBe('12px')
    expect(result.nodes).toEqual({})
  })

  it('inverts stylesheet and rule operations for undo', () => {
    const document = stylesheetFixture()
    const applied = applyWebTransaction(document, {
      id: 'edit',
      label: 'Edit',
      operations: [
        { type: 'rule.patch', stylesheetId: 'main', id: 'base', patch: { selector: '.card.featured' } },
        {
          type: 'rule.patch',
          stylesheetId: 'main',
          id: 'base',
          patch: { declarations: { padding: '24px', display: null } },
        },
        {
          type: 'rule.patch',
          stylesheetId: 'main',
          id: 'narrow',
          patch: { conditions: [{ kind: 'media', query: '(max-width: 480px)' }] },
        },
        { type: 'rule.delete', stylesheetId: 'main', id: 'narrow' },
        { type: 'stylesheet.delete', id: 'main' },
      ],
    })
    expect(applied.document.stylesheets.main).toBeUndefined()
    const undone = applyWebTransaction(applied.document, applied.inverse).document
    // updatedAt advances on every transaction by design; the inverse must
    // restore document substance, not the wall clock.
    expect(undone.stylesheets).toEqual(document.stylesheets)
    expect(undone.stylesheetOrder).toEqual(document.stylesheetOrder)
    expect(undone.nodes).toEqual(document.nodes)
    expect(undone.roots).toEqual(document.roots)
  })

  it('rejects invalid selectors, queries, declarations, and shapes', () => {
    const document = stylesheetFixture()
    expect(validSelector('.card')).toBe(true)
    expect(validSelector('button:hover')).toBe(true)
    expect(validSelector('.hero::before')).toBe(true)
    expect(validSelector('.card {')).toBe(false)
    expect(validSelector('[data-sheet-node="x"]')).toBe(false)
    expect(validSelector('div javascript:alert(1)')).toBe(false)
    expect(validConditionQuery('(max-width: 768px)')).toBe(true)
    expect(validConditionQuery('(width > 100px)')).toBe(true)
    expect(validConditionQuery('(max-width: 768px')).toBe(false)
    expect(validConditionQuery('x'.repeat(501))).toBe(false)

    expect(() =>
      applyWebTransaction(document, {
        id: 'bad-selector',
        label: 'Bad selector',
        operations: [
          {
            type: 'rule.insert',
            stylesheetId: 'main',
            rule: createWebStyleRule('.card { color: red }', {}, { id: 'bad' }),
          },
        ],
      }),
    ).toThrow('rules.bad.selector is invalid')
    expect(() =>
      applyWebTransaction(document, {
        id: 'bad-style',
        label: 'Bad style',
        operations: [
          {
            type: 'rule.patch',
            stylesheetId: 'main',
            id: 'base',
            patch: { declarations: { background: 'url(javascript:alert(1))' } },
          },
        ],
      }),
    ).toThrow('rules.base.declarations.background is invalid')
    expect(() =>
      applyWebTransaction(document, {
        id: 'bad-condition',
        label: 'Bad condition',
        operations: [
          {
            type: 'rule.patch',
            stylesheetId: 'main',
            id: 'base',
            patch: { conditions: [{ kind: 'media', query: '{evil}' }] },
          },
        ],
      }),
    ).toThrow('condition query is invalid')
    expect(() =>
      applyWebTransaction(document, {
        id: 'bad-sheet',
        label: 'Bad sheet',
        operations: [{ type: 'stylesheet.delete', id: 'missing' }],
      }),
    ).toThrow('Stylesheet missing does not exist')
  })

  it('groups adjacent identical conditions but never merges separated blocks', () => {
    const document = createWebDocument('Separated media', 'separated')
    const media = { kind: 'media', query: '(max-width: 700px)' } as const
    document.stylesheets.main = {
      id: 'main',
      name: 'main',
      order: 1_024,
      rules: {
        card: {
          id: 'card',
          selector: '.card',
          declarations: { color: 'red' },
          conditions: [],
          order: 1_024,
        },
        cardBlue: {
          id: 'cardBlue',
          selector: '.card',
          declarations: { color: 'blue' },
          conditions: [media],
          order: 2_048,
        },
        title: {
          id: 'title',
          selector: '.title',
          declarations: { 'font-size': '12px' },
          conditions: [media],
          order: 3_072,
        },
        footer: {
          id: 'footer',
          selector: '.footer',
          declarations: { color: 'gray' },
          conditions: [],
          order: 4_096,
        },
        footerBlack: {
          id: 'footerBlack',
          selector: '.footer',
          declarations: { color: 'black' },
          conditions: [media],
          order: 5_120,
        },
      },
      ruleOrder: ['card', 'cardBlue', 'title', 'footer', 'footerBlack'],
    }
    document.stylesheetOrder = ['main']
    const parsed = assertWebDocument(document)
    const css = serializeWebStylesheets(parsed.stylesheets, parsed.stylesheetOrder)
    // Adjacent cardBlue + title share one block …
    expect(css).toContain(
      '@media (max-width: 700px){.card{color:blue}.title{font-size:12px}}',
    )
    // … but the separated footerBlack block must stay after .footer gray.
    // Merging the two @media blocks would move footerBlack above footer gray
    // and change the cascade.
    const firstMedia = css.indexOf('@media (max-width: 700px)')
    const footerGray = css.indexOf('.footer{color:gray}')
    const secondMedia = css.indexOf('@media (max-width: 700px)', firstMedia + 1)
    expect(firstMedia).toBeGreaterThanOrEqual(0)
    expect(footerGray).toBeGreaterThan(firstMedia)
    expect(secondMedia).toBeGreaterThan(footerGray)
    expect(css.indexOf('@media (max-width: 700px)', secondMedia + 1)).toBe(-1)
    expect(css).toBe(
      '.card{color:red}' +
        '@media (max-width: 700px){.card{color:blue}.title{font-size:12px}}' +
        '.footer{color:gray}' +
        '@media (max-width: 700px){.footer{color:black}}',
    )
  })

  it('migrates schema v1 documents to v2 without touching nodes', () => {
    const v1 = {
      model: 'web',
      schemaVersion: 1,
      id: 'legacy-web',
      name: 'Legacy web',
      nodes: {},
      roots: [],
      metadata: { createdAt: 1, updatedAt: 1 },
    }
    expect(() => assertWebDocument(v1)).toThrow('schema version')
    const migrated = parseWebDocument(v1)
    expect(migrated.schemaVersion).toBe(WEB_DOCUMENT_SCHEMA_VERSION)
    expect(migrated.stylesheets).toEqual({})
    expect(migrated.stylesheetOrder).toEqual([])
    expect(migrated.components).toEqual({})
    expect(migrated.instances).toEqual({})
    expect(migrated.nodes).toEqual({})
    expect(parseWebDocument(migrated)).toEqual(migrated)
  })
})
