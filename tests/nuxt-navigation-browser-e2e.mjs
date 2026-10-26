import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(dirname(fileURLToPath(import.meta.url))))
const chromePath = String(process.env.SLOGI_LOCAL_CHROME || '')
const nodeModules = String(process.env.SLOGI_NODE_MODULES || '')
assert.ok(chromePath && nodeModules, 'browser_runtime_missing')
const { chromium } = await import(pathToFileURL(join(nodeModules, 'playwright', 'index.mjs')).href)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

function fixtureServer() {
  return new Promise((resolveServer, reject) => {
    const server = createServer(async (request, response) => {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname)
      const relative = pathname === '/' ? 'available-spaces.html' : pathname.slice(1)
      const target = normalize(join(root, relative))
      if (!target.startsWith(normalize(root))) {
        response.writeHead(404).end()
        return
      }
      try {
        const bytes = await readFile(target)
        response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
        response.end(bytes)
      } catch {
        response.writeHead(404).end()
      }
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveServer(server))
  })
}

const fixtureSource = (await readFile(join(root, 'tests', 'browser-fixture-mocks.js'), 'utf8'))
  .replace(
    "document.documentElement.setAttribute('data-slogi-access','granted');",
    "if(document.documentElement)document.documentElement.setAttribute('data-slogi-access','granted');",
  )
const workspaceStub = `
  document.documentElement.setAttribute('data-slogi-access', 'granted');
  window.SlogiCloud = {
    ready: true,
    user: { id: 'navigation-fixture' },
    workspaceId: 'navigation-fixture',
    getAccessToken: async () => 'navigation-fixture-token',
    sync: async () => ({}),
    schedulePush() {}
  };
  window.dispatchEvent(new CustomEvent('slogi:workspace-ready'));
`

const server = await fixtureServer()
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: chromePath })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const issues = []
page.on('pageerror', error => issues.push(`pageerror:${error.message}`))
page.on('console', entry => {
  if (entry.type() === 'error' && !/status of 401/.test(entry.text())) issues.push(`console:${entry.text()}`)
})

try {
  await context.addInitScript(fixtureSource)
  await context.route('**/legacy/shared-workspace.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: workspaceStub }))
  await context.route('https://fonts.googleapis.com/**', route => route.abort('blockedbyclient'))
  await context.route('https://fonts.gstatic.com/**', route => route.abort('blockedbyclient'))

  await page.goto(`${origin}/available-spaces.html`, { waitUntil: 'domcontentloaded' })
  await page.locator('.page').waitFor()
  await page.waitForFunction(() => window.SlogiCloud?.ready === true)
  assert.equal(await page.locator('html').getAttribute('data-slogi-access'), 'granted')
  assert.equal(await page.evaluate(() => new Promise(resolveTimer => setTimeout(() => resolveTimer('responsive'), 30))), 'responsive')

  await Promise.all([
    page.waitForURL(/\/in-work\.html/),
    page.locator('.sidebar a').filter({ hasText: 'Помещения в работе' }).click(),
  ])
  await page.getByRole('heading', { name: 'Помещения в работе' }).waitFor()
  assert.equal(await page.locator('html').getAttribute('data-slogi-access'), 'granted')
  assert.equal(await page.evaluate(() => new Promise(resolveTimer => setTimeout(() => resolveTimer('responsive'), 30))), 'responsive')

  await Promise.all([
    page.waitForURL(/\/available-spaces\.html/),
    page.locator('.sidebar a').filter({ hasText: 'Поиск помещения' }).click(),
  ])
  await page.getByRole('heading', { name: 'Поиск помещений' }).waitFor()
  assert.equal(await page.locator('html').getAttribute('data-slogi-access'), 'granted')
  assert.equal(await page.evaluate(() => new Promise(resolveTimer => setTimeout(() => resolveTimer('responsive'), 30))), 'responsive')
  assert.deepEqual(issues, [])
  console.log('nuxt navigation browser e2e: PASS')
} finally {
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  await new Promise(resolveClose => server.close(resolveClose))
}
