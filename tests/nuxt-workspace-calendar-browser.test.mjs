import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(dirname(fileURLToPath(import.meta.url))))
const publicRoot = root
const chromePath = String(process.env.SLOGI_LOCAL_CHROME || '')
const nodeModules = String(process.env.SLOGI_NODE_MODULES || '')

function staticServer() {
  return new Promise((resolveServer, reject) => {
    const server = createServer(async (request, response) => {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname)
      const relative = pathname === '/' ? 'in-work.html' : pathname.slice(1)
      const target = normalize(join(publicRoot, relative))
      if (!target.startsWith(normalize(publicRoot))) return response.writeHead(404).end()
      try {
        const bytes = await readFile(target)
        const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
        response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
        response.end(bytes)
      } catch { response.writeHead(404).end() }
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveServer(server))
  })
}

test('shared workspace actions, fixed property card and full calendar work in the generated site', { skip: !chromePath || !nodeModules }, async () => {
  const { chromium } = await import(pathToFileURL(join(nodeModules, 'playwright', 'index.mjs')).href)
  const fixture = (await readFile(join(root, 'tests', 'browser-fixture-mocks.js'), 'utf8')).replace("document.documentElement.setAttribute('data-slogi-access','granted');", "if(document.documentElement)document.documentElement.setAttribute('data-slogi-access','granted');")
  const server = await staticServer()
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ headless: true, executablePath: chromePath })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  const issues = []
  page.on('pageerror', error => issues.push(error.message))
  await context.addInitScript(fixture)
  await context.route('**/legacy/shared-workspace.js', route => route.fulfill({ contentType: 'application/javascript', body: "document.documentElement.setAttribute('data-slogi-access','granted');window.SlogiCloud={ready:true,user:{id:'test'},workspaceId:'test',sync:async()=>({}),schedulePush(){}};window.dispatchEvent(new CustomEvent('slogi:workspace-ready'));" }))
  await context.route('https://fonts.googleapis.com/**', route => route.abort())
  await context.route('https://fonts.gstatic.com/**', route => route.abort())
  try {
    await page.goto(`${origin}/in-work.html`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Помещения в работе' }).waitFor()
    for (const label of ['Конкурентный анализ', 'Добавить помещение', 'Список и карта', 'Календарь']) await page.getByRole('button', { name: label }).waitFor()

    await page.getByRole('button', { name: 'Календарь' }).click()
    for (const label of ['День', 'Неделя', 'Месяц', 'Добавить', 'Уведомления', 'В календарь (.ics)']) await page.getByRole('button', { name: label, exact: true }).waitFor()
    assert.equal(await page.locator('.calendar-days.is-month .calendar-day').count(), 42)
    assert.equal(await page.locator('.calendar-days.is-month').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 7)
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await page.getByLabel('Название').fill('Проверить документы')
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('Проверить документы').waitFor()

    await page.goto(`${origin}/proposal.html`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Коммерческое предложение' }).waitFor()
    for (const label of ['Конкурентный анализ', 'Добавить помещение', 'Список и карта', 'Календарь']) await page.getByRole('button', { name: label }).waitFor()

    await page.getByRole('button', { name: 'Добавить помещение' }).click()
    await page.getByRole('heading', { name: 'Карточка помещения' }).waitFor()
    const objectHeight = (await page.locator('.property-dialog').boundingBox()).height
    assert.ok(objectHeight >= 620 && objectHeight <= 661)
    assert.deepEqual(await page.locator('.property-footer .button').allTextContents(), ['Отменить', 'Сохранить'])
    await page.getByRole('button', { name: 'Отменить', exact: true }).click()

    await page.goto(`${origin}/in-work.html`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      const id = 'fixed-card-test'
      localStorage.setItem('slogi_locations_v1', JSON.stringify([{ id, address: 'Москва, тестовая улица, 1', phase0: { revision: 1, source: 'manual', spaceCard: { id, source: 'manual', address: 'Москва, тестовая улица, 1', work: { status: 'in_work', takenAt: new Date().toISOString(), pipeline: { status: 'contact_pending' }, viewings: [] } } } }]))
      window.dispatchEvent(new CustomEvent('slogi:locations-updated'))
    })
    await page.getByText('Москва, тестовая улица, 1', { exact: true }).click()
    const firstTabHeight = (await page.locator('.property-dialog').boundingBox()).height
    await page.getByRole('button', { name: 'Сопровождение', exact: true }).click()
    await page.getByRole('heading', { name: 'Контакт арендодателя' }).waitFor()
    const secondTabHeight = (await page.locator('.property-dialog').boundingBox()).height
    const workflowCardHeights = await page.locator('.workflow-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().height))
    assert.equal(firstTabHeight, secondTabHeight)
    assert.ok(workflowCardHeights.length >= 4)
    assert.ok(Math.max(...workflowCardHeights) - Math.min(...workflowCardHeights) <= 1)
    assert.deepEqual(await page.locator('.property-footer .button').allTextContents(), ['Отменить', 'Сохранить'])
    assert.deepEqual(issues, [])
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    await new Promise(resolveClose => server.close(resolveClose))
  }
})
