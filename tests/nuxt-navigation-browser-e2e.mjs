import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(dirname(fileURLToPath(import.meta.url))))
const chromePath = String(process.env.SLOGI_LOCAL_CHROME || '')
const nodeModules = String(process.env.SLOGI_NODE_MODULES || '')
const screenshotDir = String(process.env.SLOGI_SCREENSHOT_DIR || '')
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

async function capture(name) {
  if (!screenshotDir) return
  await mkdir(screenshotDir, { recursive: true })
  await page.screenshot({ path: join(screenshotDir, name), fullPage: false })
}

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
  assert.equal(await page.locator('.sidebar-assistant img').count(), 1)
  await capture('desktop-assistant-owl.png')
  await page.getByRole('button', { name: 'Открыть ИИ-помощника' }).click()
  await page.getByRole('heading', { name: 'ИИ-помощник' }).waitFor()
  await page.getByRole('button', { name: 'Как подготовить КП?' }).click()
  await page.getByText('Вкладка «КП» становится доступна после завершения просмотра и добавления фото и видео.').waitFor()
  await capture('desktop-assistant-open.png')
  await page.locator('.ai-assistant-header').getByRole('button', { name: 'Закрыть' }).click()
  await page.locator('.ai-assistant-panel').waitFor({ state: 'detached' })
  await page.setViewportSize({ width: 375, height: 760 })
  const mobileSearch = await page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    actionOverflow: Math.max(0, ...Array.from(document.querySelectorAll('.page-actions .button')).map(node => node.getBoundingClientRect().right - innerWidth)),
    mapHeight: document.querySelector('.map-stage')?.getBoundingClientRect().height || 0
  }))
  assert.ok(mobileSearch.documentOverflow <= 1)
  assert.ok(mobileSearch.actionOverflow <= 1)
  assert.ok(mobileSearch.mapHeight <= 300)
  await capture('mobile-search.png')
  await page.setViewportSize({ width: 1440, height: 900 })

  await Promise.all([
    page.waitForURL(/\/in-work\.html/),
    page.locator('.sidebar a').filter({ hasText: 'Помещения в работе' }).click(),
  ])
  await page.getByRole('heading', { name: 'Помещения в работе' }).waitFor()
  assert.equal(await page.locator('html').getAttribute('data-slogi-access'), 'granted')
  assert.equal(await page.evaluate(() => new Promise(resolveTimer => setTimeout(() => resolveTimer('responsive'), 30))), 'responsive')

  await page.evaluate(() => {
    const project = {
      id: 'navigation-card-fixture',
      address: 'Москва, тестовое помещение',
      phase0: {
        revision: 1,
        source: 'manual',
        spaceCard: {
          id: 'navigation-card-fixture',
          source: 'manual',
          address: 'Москва, тестовое помещение',
          work: {
            status: 'in_work',
            takenAt: new Date().toISOString(),
            pipeline: { status: 'viewing_scheduled' },
            viewings: [{ id: 'viewing-fixture', status: 'scheduled', startsAt: new Date(Date.now() + 3600000).toISOString(), attachments: [] }]
          }
        }
      }
    }
    localStorage.setItem('slogi_locations_v1', JSON.stringify([project]))
    window.dispatchEvent(new CustomEvent('slogi:locations-updated'))
  })
  await page.getByText('Москва, тестовое помещение', { exact: true }).click()
  await page.getByRole('heading', { name: 'Карточка помещения' }).waitFor()
  assert.deepEqual(await page.locator('.property-tabs button').allTextContents(), ['Объект', 'Сопровождение', 'КП·'])
  assert.equal(await page.getByRole('button', { name: 'Сопровождение' }).isEnabled(), true)
  assert.equal(await page.locator('.property-tabs button').filter({ hasText: 'КП' }).isEnabled(), false)
  assert.equal(await page.locator('.pipeline-steps').count(), 0)
  await page.setViewportSize({ width: 375, height: 760 })
  const mobileObject = await page.locator('.property-card').evaluate(card => ({
    overflow: card.scrollWidth - card.clientWidth,
    tabOverflow: card.querySelector('.property-tabs').scrollWidth - card.querySelector('.property-tabs').clientWidth,
    formColumnCounts: Array.from(card.querySelectorAll('.form-row')).map(row => getComputedStyle(row).gridTemplateColumns.trim().split(/\s+/).length),
    headerHeight: card.querySelector('.property-header').getBoundingClientRect().height
  }))
  assert.ok(mobileObject.overflow <= 1)
  assert.ok(mobileObject.tabOverflow <= 1)
  assert.ok(mobileObject.formColumnCounts.every(count => count === 2))
  assert.ok(mobileObject.headerHeight <= 72)
  await capture('mobile-property-object.png')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Сопровождение' }).click()
  await page.getByRole('heading', { name: 'Контакт арендодателя' }).waitFor()
  const workflowGeometry = await page.locator('.property-card').evaluate(card => ({
    overflow: card.scrollWidth - card.clientWidth,
    columns: getComputedStyle(card.querySelector('.workflow-grid')).gridTemplateColumns.trim().split(/\s+/).map(parseFloat),
    heavyWeights: Array.from(card.querySelectorAll('h2,h3,b,strong,button'))
      .map(node => Number(getComputedStyle(node).fontWeight))
      .filter(weight => weight > 500)
  }))
  assert.ok(workflowGeometry.overflow <= 1)
  assert.equal(workflowGeometry.columns.length, 2)
  assert.ok(Math.abs(workflowGeometry.columns[0] - workflowGeometry.columns[1]) <= 1)
  assert.deepEqual(workflowGeometry.heavyWeights, [])
  await page.setViewportSize({ width: 375, height: 760 })
  const mobileWorkflow = await page.locator('.property-card').evaluate(card => ({
    overflow: card.scrollWidth - card.clientWidth,
    workflowColumns: getComputedStyle(card.querySelector('.workflow-grid')).gridTemplateColumns.trim().split(/\s+/).length,
    formColumnCounts: Array.from(card.querySelectorAll('.form-row')).map(row => getComputedStyle(row).gridTemplateColumns.trim().split(/\s+/).length)
  }))
  assert.ok(mobileWorkflow.overflow <= 1)
  assert.equal(mobileWorkflow.workflowColumns, 1)
  assert.ok(mobileWorkflow.formColumnCounts.every(count => count === 2))
  await capture('mobile-property-workflow.png')
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.evaluate(() => {
    const [project] = JSON.parse(localStorage.getItem('slogi_locations_v1') || '[]')
    project.phase0.revision += 1
    project.phase0.spaceCard.work.pipeline.status = 'viewing_completed'
    project.phase0.spaceCard.work.viewings[0] = {
      ...project.phase0.spaceCard.work.viewings[0],
      status: 'completed',
      completedAt: new Date().toISOString(),
      attachments: [
        { id: 'photo-fixture', kind: 'photo', status: 'uploaded', name: 'photo.jpg' },
        { id: 'video-fixture', kind: 'video', status: 'uploaded', name: 'video.mp4' }
      ]
    }
    localStorage.setItem('slogi_locations_v1', JSON.stringify([project]))
    window.dispatchEvent(new CustomEvent('slogi:locations-updated'))
  })
  const proposalTab = page.locator('.property-tabs button').filter({ hasText: 'КП' })
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('.property-tabs button')).find(button => button.textContent?.includes('КП'))?.disabled)
  assert.equal(await proposalTab.isEnabled(), true)
  await proposalTab.click()
  await page.getByRole('heading', { name: 'Коммерческие условия' }).waitFor()
  await page.setViewportSize({ width: 375, height: 760 })
  const mobileCard = await page.locator('.property-card').evaluate(card => ({
    overflow: card.scrollWidth - card.clientWidth,
    tabs: Array.from(card.querySelectorAll('.property-tabs button')).map(button => button.textContent?.trim()),
    proposalColumns: getComputedStyle(card.querySelector('.proposal-workflow')).gridTemplateColumns.trim().split(/\s+/).length,
    documentColumns: getComputedStyle(card.querySelector('.document-buttons')).gridTemplateColumns.trim().split(/\s+/).length
  }))
  assert.ok(mobileCard.overflow <= 1)
  assert.deepEqual(mobileCard.tabs, ['Объект', 'Сопровождение', 'КП'])
  assert.equal(mobileCard.proposalColumns, 1)
  assert.equal(mobileCard.documentColumns, 2)
  await capture('mobile-property-proposal.png')
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 760 })
    const responsiveCard = await page.locator('.property-card').evaluate(card => ({
      overflow: card.scrollWidth - card.clientWidth,
      tabOverflow: card.querySelector('.property-tabs').scrollWidth - card.querySelector('.property-tabs').clientWidth
    }))
    assert.ok(responsiveCard.overflow <= 1, `property card overflows at ${width}px`)
    assert.ok(responsiveCard.tabOverflow <= 1, `property tabs overflow at ${width}px`)
  }
  await page.setViewportSize({ width: 375, height: 760 })
  await page.getByRole('button', { name: 'Закрыть' }).click()
  const mobileWorkPage = await page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    mapHeight: document.querySelector('.map-stage')?.getBoundingClientRect().height || 0,
    headingLeft: document.querySelector('.page-header h1')?.getBoundingClientRect().left || 0,
    scrollX
  }))
  assert.ok(mobileWorkPage.documentOverflow <= 1)
  assert.ok(mobileWorkPage.mapHeight <= 300)
  assert.equal(mobileWorkPage.scrollX, 0)
  assert.ok(mobileWorkPage.headingLeft >= 7)
  await capture('mobile-in-work.png')
  await page.getByRole('button', { name: 'Календарь' }).click()
  await page.locator('.calendar-shell').waitFor()
  const mobileCalendar = await page.locator('.calendar-shell').evaluate(calendar => ({
    overflow: calendar.scrollWidth - calendar.clientWidth,
    columns: getComputedStyle(calendar.querySelector('.calendar-days')).gridTemplateColumns.trim().split(/\s+/).length,
    toolbarWidth: calendar.querySelector('.calendar-toolbar').getBoundingClientRect().width
  }))
  assert.ok(mobileCalendar.overflow <= 1)
  assert.equal(mobileCalendar.columns, 1)
  assert.ok(mobileCalendar.toolbarWidth <= 357)
  await capture('mobile-calendar.png')
  await page.setViewportSize({ width: 1440, height: 900 })

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
