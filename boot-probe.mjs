import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://127.0.0.1:1421/'
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const t0 = Date.now()
const events = []
page.on('console', (m) => {
  if (m.type() === 'error') events.push([Date.now() - t0, 'console-error', m.text().slice(0, 120)])
})

await page.addInitScript(() => {
  window.__marks = []
  const record = () => {
    const splash = document.getElementById('boot-splash')
    const root = document.getElementById('root')
    const hasContent = !!root && root.childElementCount > 0
    const what = splash
      ? 'splash-only'
      : hasContent
        ? 'app-visible'
        : 'BLANK-no-splash-no-content'
    const last = window.__marks[window.__marks.length - 1]
    if (!last || last[0] !== what) window.__marks.push([what, performance.now() | 0])
  }
  window.__iv = setInterval(record, 8)
  document.addEventListener('DOMContentLoaded', record)
})

await page.goto(url, { waitUntil: 'commit' })
await page.waitForTimeout(6000)
const marks = await page.evaluate(() => {
  clearInterval(window.__iv)
  return window.__marks
})
console.log('marks (ms since navigation start):')
for (const [what, at] of marks) console.log('  ', String(at).padStart(6), what)
console.log('\nother events:')
for (const e of events) console.log('  ', e.join(' '))

const timing = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const paint = performance.getEntriesByType('paint')
  return {
    domContentLoaded: nav?.domContentLoadedEventEnd,
    loadEvent: nav?.loadEventEnd,
    fcp: paint.find((p) => p.name === 'first-contentful-paint')?.startTime,
    requests: performance
      .getEntriesByType('resource')
      .filter((r) => r.name.includes('/src/') || r.name.includes('.vite/deps'))
      .length,
    transferred: performance
      .getEntriesByType('resource')
      .reduce((a, r) => a + (r.transferSize || 0), 0),
  }
})
console.log('\nperf:', timing)

await page.screenshot({ path: '/tmp/boot-final.png' })
await browser.close()
