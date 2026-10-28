import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(dirname(fileURLToPath(import.meta.url))))
const publicRoot = join(root, 'frontend', '.output', 'public')
const chromePath = String(process.env.SLOGI_LOCAL_CHROME || '')
const nodeModules = String(process.env.SLOGI_NODE_MODULES || '')
const hasBrowserRuntime = Boolean(chromePath && nodeModules)

test('approval stage works in the generated Nuxt application', { skip: !hasBrowserRuntime }, async () => {
const { chromium } = await import(pathToFileURL(join(nodeModules, 'playwright', 'index.mjs')).href)
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }

const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname)
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
  const target = normalize(join(publicRoot, relative))
  if (!target.startsWith(normalize(publicRoot))) return response.writeHead(404).end()
  try {
    const bytes = await readFile(target)
    response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(bytes)
  } catch { response.writeHead(404).end() }
})
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: chromePath })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const project = {
  id: 'approval-browser-fixture',
  address: 'Москва, улица Согласования, 1',
  clusterName: 'Тестовый кластер',
  phase0: { revision: 7, source: 'manual', spaceCard: { id: 'approval-browser-fixture', address: 'Москва, улица Согласования, 1', canonicalUrl: 'https://example.test/listing/approval-browser-fixture', work: {
    status: 'closed', stage: 'approval', pipeline: { status: 'approval_pending' },
    landlordContact: { name: 'Арендодатель' },
    viewings: [{ id: 'viewing-1', status: 'completed', attachments: [{ id: 'p', kind: 'photo', status: 'uploaded' }, { id: 'v', kind: 'video', status: 'uploaded' }] }],
    proposal: { status: 'sent', sentAt: '2026-10-28T09:00:00.000Z' },
    approval: { status: 'pending', enteredAt: '2026-10-28T09:00:00.000Z', documents: {} }
  } } }
}
await context.addInitScript(value => {
  localStorage.setItem('slogi_locations_v1', JSON.stringify([value]))
  if (document.documentElement) document.documentElement.setAttribute('data-slogi-access', 'granted')
}, project)
await context.route('**/legacy/shared-workspace.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: `
  document.documentElement.setAttribute('data-slogi-access','granted');
  window.SlogiCloud={ready:true,user:{id:'approval-test',user_metadata:{role:'Администратор'}},workspaceId:'approval-test',sync:async()=>({}),schedulePush(){}};
  window.dispatchEvent(new CustomEvent('slogi:workspace-ready'));
` }))
const page = await context.newPage()
const issues = []
page.on('pageerror', error => issues.push(error.message))
page.on('console', message => { if (message.type() === 'error') issues.push(message.text()) })

try {
  await page.goto(`${origin}/approvals.html`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Согласование', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Отказ', exact: true }).click()
  await page.getByRole('heading', { name: 'Документы согласования' }).waitFor()
  await page.getByRole('link', { name: 'Открыть объявление' }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Открыть объявление' }).getAttribute('href'), 'https://example.test/listing/approval-browser-fixture')
  assert.deepEqual(await page.locator('.property-tabs button').allTextContents(), ['Объект', 'Сопровождение', 'КП', 'Согласование'])
  assert.equal(await page.getByRole('button', { name: 'Согласовано', exact: true }).isDisabled(), true)
  const desktop = await page.locator('.property-card').evaluate(card => ({
    overflow: card.scrollWidth - card.clientWidth,
    bodyOverflow: card.querySelector('.property-body').scrollHeight - card.querySelector('.property-body').clientHeight,
    columns: getComputedStyle(card.querySelector('.approval-workflow')).gridTemplateColumns.trim().split(/\s+/).length
  }))
  assert.ok(desktop.overflow <= 1)
  assert.ok(desktop.bodyOverflow <= 1)
  assert.equal(desktop.columns, 2)

  const inputs = page.locator('.approval-documents input[type="file"]')
  await inputs.nth(1).setInputFiles({ name: 'Подписанный ДА.pdf', mimeType: 'application/pdf', buffer: Buffer.from('signed lease') })
  await page.getByText('Подписанный ДА.pdf').waitFor()
  await inputs.nth(2).setInputFiles([
    { name: 'Выписка.pdf', mimeType: 'application/pdf', buffer: Buffer.from('ownership') },
    { name: 'Доверенность.pdf', mimeType: 'application/pdf', buffer: Buffer.from('authority') }
  ])
  await page.getByText('Доверенность.pdf').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Согласовано', exact: true }).isEnabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Удалить', exact: true }).count(), 3)

  const leaseRow = page.locator('.approval-document-row').filter({ hasText: 'Подписанный договор аренды' })
  page.once('dialog', dialog => dialog.accept())
  await leaseRow.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByText('Подписанный ДА.pdf').waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('button', { name: 'Согласовано', exact: true }).isDisabled(), true)
  await inputs.nth(1).setInputFiles({ name: 'Подписанный ДА.pdf', mimeType: 'application/pdf', buffer: Buffer.from('signed lease again') })
  await page.getByText('Подписанный ДА.pdf').waitFor()

  const firstOwnership = page.locator('.approval-file-item').filter({ hasText: 'Выписка.pdf' })
  page.once('dialog', dialog => dialog.accept())
  await firstOwnership.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByText('Выписка.pdf').waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('button', { name: 'Согласовано', exact: true }).isEnabled(), true)

  await page.setViewportSize({ width: 375, height: 760 })
  const mobile = await page.locator('.property-card').evaluate(card => ({
    overflow: card.scrollWidth - card.clientWidth,
    tabOverflow: card.querySelector('.property-tabs').scrollWidth - card.querySelector('.property-tabs').clientWidth,
    columns: getComputedStyle(card.querySelector('.approval-workflow')).gridTemplateColumns.trim().split(/\s+/).length
  }))
  assert.ok(mobile.overflow <= 1)
  assert.ok(mobile.tabOverflow <= 1)
  assert.equal(mobile.columns, 1)
  await page.setViewportSize({ width: 1440, height: 900 })

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Согласовано', exact: true }).click()
  await page.waitForURL(/under-development\.html/)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('slogi_locations_v1') || '[]')[0])
  assert.equal(stored.phase0.spaceCard.work.pipeline.status, 'repair')
  assert.equal(stored.phase0.spaceCard.work.approval.status, 'agreed')
  assert.deepEqual(issues, [])
  console.log('nuxt approval browser: PASS')
} finally {
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  await new Promise(resolveClose => server.close(resolveClose))
}
})
