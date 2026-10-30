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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
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
  for (const tabName of ['Объект', 'Сопровождение', 'КП', 'Согласование']) {
    await page.getByRole('button', { name: tabName, exact: true }).click()
    assert.equal(await page.getByRole('link', { name: 'Открыть объявление' }).getAttribute('href'), 'https://example.test/listing/approval-browser-fixture')
  }
  assert.equal(await page.getByRole('button', { name: 'Ремонт помещения', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Согласовано', exact: true }).isDisabled(), true)
  const desktop = await page.locator('.property-card').evaluate(card => ({
    overflow: card.scrollWidth - card.clientWidth,
    bodyOverflow: card.querySelector('.property-body').scrollHeight - card.querySelector('.property-body').clientHeight,
    columns: getComputedStyle(card.querySelector('.approval-workflow')).gridTemplateColumns.trim().split(/\s+/).length
  }))
  assert.ok(desktop.overflow <= 1)
  assert.ok(desktop.bodyOverflow <= 1)
  assert.equal(desktop.columns, 2)

  await page.setViewportSize({ width: 920, height: 900 })
  const tablet = await page.locator('.property-card').evaluate(card => ({
    overflow: card.scrollWidth - card.clientWidth,
    documentOverflow: card.querySelector('.approval-documents').scrollWidth - card.querySelector('.approval-documents').clientWidth,
    actionOverflow: Math.max(...Array.from(card.querySelectorAll('.approval-document-actions')).map(group => group.scrollWidth - group.clientWidth))
  }))
  assert.ok(tablet.overflow <= 1)
  assert.ok(tablet.documentOverflow <= 1)
  assert.ok(tablet.actionOverflow <= 1)
  await page.setViewportSize({ width: 1440, height: 900 })

  const actionGeometry = () => page.locator('.approval-document-actions').evaluateAll(groups => groups.map(group => ({
    x: group.getBoundingClientRect().x,
    y: group.getBoundingClientRect().y,
    width: group.getBoundingClientRect().width,
    labels: Array.from(group.querySelectorAll('button')).map(button => button.textContent?.trim()),
    disabled: Array.from(group.querySelectorAll('button')).map(button => button.disabled)
  })))
  const actionsBeforeUpload = await actionGeometry()
  assert.equal(actionsBeforeUpload.length, 3)
  for (const group of actionsBeforeUpload) {
    assert.deepEqual(group.labels, ['Добавить', 'Скачать', 'Удалить'])
    assert.deepEqual(group.disabled, [false, true, true])
  }

  const inputs = page.locator('.approval-documents input[type="file"]')
  await inputs.nth(1).setInputFiles({ name: 'Подписанный ДА.pdf', mimeType: 'application/pdf', buffer: Buffer.from('signed lease') })
  await page.getByText('Подписанный ДА.pdf').waitFor()
  await inputs.nth(2).setInputFiles([
    { name: 'Выписка.pdf', mimeType: 'application/pdf', buffer: Buffer.from('ownership') },
    { name: 'Доверенность.pdf', mimeType: 'application/pdf', buffer: Buffer.from('authority') }
  ])
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.approval-file-select option')).some(option => option.textContent === 'Доверенность.pdf'))
  assert.equal(await page.getByRole('button', { name: 'Согласовано', exact: true }).isEnabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Удалить', exact: true }).count(), 3)
  const actionsAfterUpload = await actionGeometry()
  assert.deepEqual(actionsAfterUpload.map(group => group.labels), actionsBeforeUpload.map(group => group.labels))
  actionsAfterUpload.forEach((group, index) => {
    assert.ok(Math.abs(group.x - actionsBeforeUpload[index].x) <= 1)
    assert.ok(Math.abs(group.y - actionsBeforeUpload[index].y) <= 1)
    assert.ok(Math.abs(group.width - actionsBeforeUpload[index].width) <= 1)
  })

  const leaseRow = page.locator('.approval-document-row').filter({ hasText: 'Подписанный договор аренды' })
  const leaseDownloadPromise = page.waitForEvent('download')
  await leaseRow.getByRole('button', { name: 'Скачать', exact: true }).click()
  assert.equal((await leaseDownloadPromise).suggestedFilename(), 'Подписанный ДА.pdf')

  const ownershipRow = page.locator('.approval-document-row').filter({ hasText: 'Документы о праве сдачи помещения' })
  const ownershipSelect = ownershipRow.getByRole('combobox', { name: 'Документ о праве сдачи' })
  await ownershipSelect.selectOption({ label: 'Выписка.pdf' })
  const ownershipDownloadPromise = page.waitForEvent('download')
  await ownershipRow.getByRole('button', { name: 'Скачать', exact: true }).click()
  assert.equal((await ownershipDownloadPromise).suggestedFilename(), 'Выписка.pdf')

  page.once('dialog', dialog => dialog.accept())
  await leaseRow.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByText('Подписанный ДА.pdf').waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('button', { name: 'Согласовано', exact: true }).isDisabled(), true)
  await inputs.nth(1).setInputFiles({ name: 'Подписанный ДА.pdf', mimeType: 'application/pdf', buffer: Buffer.from('signed lease again') })
  await page.getByText('Подписанный ДА.pdf').waitFor()

  await ownershipSelect.selectOption({ label: 'Выписка.pdf' })
  page.once('dialog', dialog => dialog.accept())
  await ownershipRow.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('.approval-file-select option')).some(option => option.textContent === 'Выписка.pdf'))
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
  await page.waitForURL(url => url.pathname.endsWith('/repair.html') && url.searchParams.get('section') === 'documents')
  await page.getByRole('heading', { name: 'Документы для ремонта', exact: true }).waitFor()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('slogi_locations_v1') || '[]')[0])
  assert.equal(stored.phase0.spaceCard.work.pipeline.status, 'repair')
  assert.equal(stored.phase0.spaceCard.work.approval.status, 'agreed')
  assert.equal(stored.phase0.spaceCard.work.repair.stage, 'documents')
  assert.equal(stored.phase0.spaceCard.listingUrl, 'https://example.test/listing/approval-browser-fixture', JSON.stringify({ phase: stored.phase0, card: stored.phase0.spaceCard }))

  await page.getByRole('button', { name: 'Открыть документы', exact: true }).click()
  const repairCard = page.locator('.property-card')
  await repairCard.getByRole('heading', { name: 'Ремонт помещения', exact: true }).waitFor()
  const sectionButtons = repairCard.locator('.property-section-switch button')
  assert.equal(await sectionButtons.count(), 2)
  const sectionStyles = await sectionButtons.evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button)
    return { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, height: button.getBoundingClientRect().height, pressed: button.getAttribute('aria-pressed'), background: style.backgroundColor }
  }))
  assert.deepEqual(
    [sectionStyles[0].fontFamily, sectionStyles[0].fontSize, sectionStyles[0].fontWeight, sectionStyles[0].lineHeight],
    [sectionStyles[1].fontFamily, sectionStyles[1].fontSize, sectionStyles[1].fontWeight, sectionStyles[1].lineHeight]
  )
  assert.ok(Math.abs(sectionStyles[0].height - sectionStyles[1].height) <= 1)
  assert.deepEqual(sectionStyles.map(style => style.pressed), ['false', 'true'])
  assert.notEqual(sectionStyles[0].background, sectionStyles[1].background)
  const repairTabLabels = () => repairCard.locator('.property-tabs button').evaluateAll(buttons => buttons.map(button => (button.textContent || '').replace(/·/g, '').trim()))
  assert.deepEqual(await repairTabLabels(), ['Документы', 'Ремонт', 'Выход из ремонта'])
  assert.deepEqual(await repairCard.locator('.property-tabs button').evaluateAll(buttons => buttons.map(button => button.disabled)), [false, true, true])
  const repairActionGeometry = () => repairCard.locator('.repair-document-actions').evaluateAll(groups => groups.map(group => ({
    x: group.getBoundingClientRect().x,
    y: group.getBoundingClientRect().y,
    width: group.getBoundingClientRect().width,
    labels: Array.from(group.querySelectorAll('button')).map(button => button.textContent?.trim()),
    disabled: Array.from(group.querySelectorAll('button')).map(button => button.disabled)
  })))
  const repairActionsBeforeUpload = await repairActionGeometry()
  assert.equal(repairActionsBeforeUpload.length, 3)
  for (const group of repairActionsBeforeUpload) {
    assert.deepEqual(group.labels, ['Добавить', 'Скачать', 'Удалить'])
    assert.deepEqual(group.disabled, [false, true, true])
  }
  const technicalTaskRow = repairCard.locator('.repair-document-row').filter({ hasText: 'Техническое задание' })
  await technicalTaskRow.locator('input[type="file"]').setInputFiles({ name: 'Техническое задание.pdf', mimeType: 'application/pdf', buffer: Buffer.from('technical task') })
  await technicalTaskRow.getByText('Техническое задание.pdf', { exact: true }).waitFor()
  assert.equal(await technicalTaskRow.getByRole('button', { name: 'Скачать', exact: true }).isEnabled(), true)
  assert.equal(await technicalTaskRow.getByRole('button', { name: 'Удалить', exact: true }).isEnabled(), true)
  const repairActionsAfterUpload = await repairActionGeometry()
  repairActionsAfterUpload.forEach((group, index) => {
    assert.deepEqual(group.labels, repairActionsBeforeUpload[index].labels)
    assert.ok(Math.abs(group.x - repairActionsBeforeUpload[index].x) <= 1)
    assert.ok(Math.abs(group.y - repairActionsBeforeUpload[index].y) <= 1)
    assert.ok(Math.abs(group.width - repairActionsBeforeUpload[index].width) <= 1)
  })
  const repairDownloadPromise = page.waitForEvent('download')
  await technicalTaskRow.getByRole('button', { name: 'Скачать', exact: true }).click()
  assert.equal((await repairDownloadPromise).suggestedFilename(), 'Техническое задание.pdf')
  page.once('dialog', dialog => dialog.accept())
  await technicalTaskRow.getByRole('button', { name: 'Удалить', exact: true }).click()
  await technicalTaskRow.getByText('Техническое задание.pdf', { exact: true }).waitFor({ state: 'detached' })
  assert.equal(await technicalTaskRow.getByRole('button', { name: 'Скачать', exact: true }).isDisabled(), true)
  assert.equal(await technicalTaskRow.getByRole('button', { name: 'Удалить', exact: true }).isDisabled(), true)
  const repairActionsAfterDelete = await repairActionGeometry()
  repairActionsAfterDelete.forEach((group, index) => {
    assert.deepEqual(group.labels, repairActionsBeforeUpload[index].labels)
    assert.ok(Math.abs(group.x - repairActionsBeforeUpload[index].x) <= 1)
    assert.ok(Math.abs(group.y - repairActionsBeforeUpload[index].y) <= 1)
    assert.ok(Math.abs(group.width - repairActionsBeforeUpload[index].width) <= 1)
  })
  const repairLayout = await repairCard.evaluate(card => ({
    overflow: card.scrollWidth - card.clientWidth,
    bodyOverflow: card.querySelector('.property-body').scrollHeight - card.querySelector('.property-body').clientHeight
  }))
  assert.ok(repairLayout.overflow <= 1)
  assert.ok(repairLayout.bodyOverflow <= 1)
  await repairCard.getByRole('button', { name: 'Карточка помещения', exact: true }).click()
  assert.deepEqual(await repairCard.locator('.property-tabs button').allTextContents(), ['Объект', 'Сопровождение', 'КП', 'Согласование'])
  assert.deepEqual(await sectionButtons.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-pressed'))), ['true', 'false'])
  const repairedListingAction = await repairCard.locator('.property-listing-link').evaluate(node => ({ tag: node.tagName, href: node.getAttribute('href'), disabled: node.hasAttribute('disabled') }))
  assert.deepEqual(repairedListingAction, { tag: 'A', href: 'https://example.test/listing/approval-browser-fixture', disabled: false })
  await repairCard.getByRole('button', { name: 'Согласование', exact: true }).click()
  const completedOwnershipRow = repairCard.locator('.approval-document-row').filter({ hasText: 'Документы о праве сдачи помещения' })
  assert.equal(await completedOwnershipRow.getByRole('button', { name: 'Добавить', exact: true }).isDisabled(), true)
  assert.equal(await completedOwnershipRow.getByRole('button', { name: 'Удалить', exact: true }).isDisabled(), true)
  assert.equal(await completedOwnershipRow.getByRole('button', { name: 'Скачать', exact: true }).isEnabled(), true)
  const completedDownloadPromise = page.waitForEvent('download')
  await completedOwnershipRow.getByRole('button', { name: 'Скачать', exact: true }).click()
  assert.equal((await completedDownloadPromise).suggestedFilename(), 'Доверенность.pdf')
  await repairCard.getByRole('button', { name: 'Ремонт помещения', exact: true }).click()
  assert.deepEqual(await repairTabLabels(), ['Документы', 'Ремонт', 'Выход из ремонта'])
  await page.setViewportSize({ width: 375, height: 760 })
  const mobileSectionSwitch = await repairCard.locator('.property-section-switch').evaluate(nav => ({
    overflow: nav.scrollWidth - nav.clientWidth,
    buttons: Array.from(nav.querySelectorAll('button')).map(button => {
      const style = getComputedStyle(button)
      return { fontSize: style.fontSize, fontWeight: style.fontWeight, height: button.getBoundingClientRect().height }
    })
  }))
  assert.ok(mobileSectionSwitch.overflow <= 1)
  assert.deepEqual(
    [mobileSectionSwitch.buttons[0].fontSize, mobileSectionSwitch.buttons[0].fontWeight],
    [mobileSectionSwitch.buttons[1].fontSize, mobileSectionSwitch.buttons[1].fontWeight]
  )
  assert.ok(Math.abs(mobileSectionSwitch.buttons[0].height - mobileSectionSwitch.buttons[1].height) <= 1)
  assert.deepEqual(issues, [])
  console.log('nuxt approval browser: PASS')
} finally {
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  await new Promise(resolveClose => server.close(resolveClose))
}
})
