import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(dirname(fileURLToPath(import.meta.url))))
const publicRoot = join(root, 'frontend', '.output', 'public')
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
  await context.route('**/legacy/shared-workspace.js', route => route.fulfill({ contentType: 'application/javascript', body: "document.documentElement.setAttribute('data-slogi-access','granted');window.SlogiCloud={ready:true,user:{id:'test'},workspaceId:'test',sync:async()=>({}),schedulePush(){},saveAttachment:async(_id,_type,_blob,_name,options)=>{options?.onProgress?.(12);await new Promise(resolve=>setTimeout(resolve,180));options?.onProgress?.(78);await new Promise(resolve=>setTimeout(resolve,80));options?.onProgress?.(100)}};window.dispatchEvent(new CustomEvent('slogi:workspace-ready'));" }))
  await context.route('https://fonts.googleapis.com/**', route => route.abort())
  await context.route('https://fonts.gstatic.com/**', route => route.abort())
  try {
    await page.goto(`${origin}/in-work.html`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Помещения в работе' }).waitFor()
    for (const label of ['Конкурентный анализ', 'Добавить помещение', 'Список и карта', 'Календарь']) await page.getByRole('button', { name: label }).waitFor()
    await page.getByRole('button', { name: 'Открыть ИИ-помощника' }).click()
    const assistantHeight = (await page.locator('.ai-assistant-panel').boundingBox()).height
    assert.ok(assistantHeight >= 875 && assistantHeight <= 877)
    await page.locator('.ai-assistant-header').getByRole('button', { name: 'Закрыть' }).click()

    await page.setViewportSize({ width: 375, height: 760 })
    const menuButton = page.locator('.sidebar-menu-toggle')
    await menuButton.waitFor()
    assert.equal(await menuButton.getAttribute('aria-label'), 'Открыть меню')
    const closedSidebar = await page.locator('.sidebar').evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), transform: getComputedStyle(node).transform, classes: node.className }))
    assert.ok(closedSidebar.rect.x < 0, `closed_sidebar:${JSON.stringify(closedSidebar)}`)
    await menuButton.click()
    await page.getByRole('navigation').waitFor()
    assert.equal(await menuButton.getAttribute('aria-expanded'), 'true')
    await page.waitForFunction(() => document.querySelector('.sidebar')?.getBoundingClientRect().x >= 0)
    assert.ok((await page.locator('.sidebar').boundingBox()).x >= 0)
    await page.keyboard.press('Escape')
    assert.equal(await menuButton.getAttribute('aria-expanded'), 'false')
    assert.equal(await menuButton.getAttribute('aria-label'), 'Открыть меню')
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.getByRole('button', { name: 'Календарь' }).click()
    for (const label of ['День', 'Неделя', 'Месяц', 'Добавить', 'Уведомления', 'В календарь (.ics)']) await page.getByRole('button', { name: label, exact: true }).waitFor()
    const toolHeights = await page.locator('.calendar-add-button, .calendar-tool-secondary').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height))
    assert.ok(toolHeights[0] > toolHeights[1] && toolHeights[0] > toolHeights[2])
    const calendarAdd = page.getByRole('button', { name: 'Добавить', exact: true })
    await calendarAdd.hover()
    const hoverColours = await calendarAdd.evaluate(button => ({ color: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor }))
    assert.notEqual(hoverColours.background, 'rgb(255, 255, 255)')
    assert.notEqual(hoverColours.background, hoverColours.color)
    assert.equal(await page.locator('.calendar-days.is-month .calendar-day').count(), 42)
    assert.equal(await page.locator('.calendar-days.is-month').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 7)
    assert.ok((await page.locator('.calendar-shell').boundingBox()).height >= 729)
    await calendarAdd.click()
    await page.getByLabel('Название').fill('Проверить документы')
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('Проверить документы').waitFor()
    await page.getByText('Проверить документы').click()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click()
    await page.getByText('Проверить документы').waitFor({ state: 'detached' })

    await page.goto(`${origin}/proposal.html`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Коммерческое предложение' }).waitFor()
    for (const label of ['Конкурентный анализ', 'Добавить помещение', 'Список и карта', 'Календарь']) await page.getByRole('button', { name: label }).waitFor()

    await page.getByRole('button', { name: 'Добавить помещение' }).click()
    await page.getByRole('heading', { name: 'Карточка помещения' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Открыть объявление', exact: true }).isDisabled(), true)
    assert.equal(await page.getByText('Широта', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Долгота', { exact: true }).count(), 0)
    const objectBox = await page.locator('.property-dialog').boundingBox()
    const objectHeight = objectBox.height
    assert.ok(objectBox.width >= 1039 && objectBox.width <= 1041)
    assert.ok(objectHeight >= 679 && objectHeight <= 681)
    const objectBodyOverflow = await page.locator('.property-body').evaluate(body => body.scrollHeight - body.clientHeight)
    assert.ok(objectBodyOverflow <= 1, `object_body_overflow:${objectBodyOverflow}`)
    assert.deepEqual(await page.locator('.property-footer .button').allTextContents(), ['Отменить', 'Сохранить'])
    await page.getByRole('button', { name: 'Отменить', exact: true }).click()

    await page.goto(`${origin}/in-work.html`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      const id = 'fixed-card-test'
      localStorage.setItem('slogi_locations_v1', JSON.stringify([{ id, address: 'Москва, тестовая улица, 1', phase0: { revision: 1, source: 'manual', spaceCard: { id, source: 'manual', address: 'Москва, тестовая улица, 1', work: { status: 'in_work', takenAt: new Date().toISOString(), pipeline: { status: 'viewing_scheduled' }, activeViewingId: 'viewing-test', viewings: [{ id: 'viewing-test', status: 'scheduled', startsAt: new Date(Date.now() - 3600000).toISOString(), attachments: [{ id: 'photo-test', kind: 'photo', status: 'uploaded' }, { id: 'video-test', kind: 'video', status: 'uploaded' }] }] } } } }]))
      window.dispatchEvent(new CustomEvent('slogi:locations-updated'))
    })
    await page.getByText('Москва, тестовая улица, 1', { exact: true }).click()
    const firstTabHeight = (await page.locator('.property-dialog').boundingBox()).height
    await page.getByRole('button', { name: 'Сопровождение', exact: true }).click()
    await page.getByRole('heading', { name: 'Контакт арендодателя' }).waitFor()
    const secondTabHeight = (await page.locator('.property-dialog').boundingBox()).height
    const workflowCardHeights = await page.locator('.workflow-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().height))
    assert.equal(firstTabHeight, secondTabHeight)
    const workflowBodyOverflow = await page.locator('.property-body').evaluate(body => body.scrollHeight - body.clientHeight)
    assert.ok(workflowBodyOverflow <= 1, `workflow_body_overflow:${workflowBodyOverflow}`)
    assert.ok(workflowCardHeights.length >= 4)
    assert.ok(Math.max(...workflowCardHeights) - Math.min(...workflowCardHeights) <= 1)
    await page.getByRole('heading', { name: 'Фото и видео помещения' }).waitFor()
    assert.equal(await page.getByText('Материалы остаются доступны после завершения: их можно добавлять и удалять.').count(), 0)
    const completeButton = page.getByRole('button', { name: 'Завершить просмотр' })
    assert.equal(await completeButton.isEnabled(), true)
    await completeButton.click()
    await page.getByText('Просмотр завершён', { exact: true }).last().waitFor()
    assert.equal(await page.getByRole('button', { name: 'Завершить просмотр' }).count(), 0)
    const progressVisible = page.locator('.media-progress').waitFor({ state: 'visible' })
    await page.locator('input[accept="image/*"]').setInputFiles({ name: 'progress-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('photo') })
    await progressVisible
    assert.ok(Number(await page.locator('.media-progress progress').getAttribute('value')) > 0)
    assert.ok(await page.locator('.property-body').evaluate(body => body.scrollHeight - body.clientHeight <= 1))
    const progressCardHeights = await page.locator('.workflow-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().height))
    assert.ok(Math.max(...progressCardHeights) - Math.min(...progressCardHeights) <= 1)
    await page.locator('.media-progress').waitFor({ state: 'hidden' })
    const uploadedPhoto = page.locator('.attachment-list li').filter({ hasText: 'progress-photo.jpg' })
    await uploadedPhoto.waitFor()
    const photoDownloadPromise = page.waitForEvent('download')
    await uploadedPhoto.getByRole('button', { name: 'Скачать', exact: true }).click()
    assert.equal((await photoDownloadPromise).suggestedFilename(), 'progress-photo.jpg')
    await page.getByRole('button', { name: 'КП', exact: true }).click()
    await page.getByRole('heading', { name: 'Коммерческие условия' }).waitFor()
    const proposalBoxes = await page.locator('.proposal-terms, .proposal-package').evaluateAll(cards => cards.map(card => ({ width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height })))
    assert.equal(proposalBoxes.length, 2)
    assert.ok(proposalBoxes[1].width > proposalBoxes[0].width * 1.8)
    assert.ok(Math.abs(proposalBoxes[1].height - proposalBoxes[0].height) <= 1)
    assert.ok(await page.locator('.property-body').evaluate(body => body.scrollHeight - body.clientHeight <= 1))
    assert.ok(await page.locator('.proposal-package textarea').evaluate(textarea => textarea.scrollHeight - textarea.clientHeight <= 1))
    assert.equal((await page.locator('.property-dialog').boundingBox()).height, firstTabHeight)
    assert.deepEqual(await page.locator('.property-footer .button').allTextContents(), ['Отменить', 'Сохранить'])
    assert.deepEqual(issues, [])
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    await new Promise(resolveClose => server.close(resolveClose))
  }
})
