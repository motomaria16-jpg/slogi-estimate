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

test('settings stay concise and update an open repair document immediately', { skip: !hasBrowserRuntime }, async () => {
  const { chromium } = await import(pathToFileURL(join(nodeModules, 'playwright', 'index.mjs')).href)
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2'
  }

  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname)
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
    const target = normalize(join(publicRoot, relative))
    if (!target.startsWith(normalize(publicRoot))) return response.writeHead(404).end()
    try {
      const bytes = await readFile(target)
      response.writeHead(200, {
        'Content-Type': mime[extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      })
      response.end(bytes)
    } catch {
      response.writeHead(404).end()
    }
  })

  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ headless: true, executablePath: chromePath })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

  await context.addInitScript(() => {
    if (document.documentElement) document.documentElement.setAttribute('data-slogi-access', 'granted')
  })
  await context.route('**/legacy/shared-workspace.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      document.documentElement.setAttribute('data-slogi-access','granted');
      window.SlogiCloud={ready:true,user:{id:'settings-repair-browser',user_metadata:{role:'Администратор'}},workspaceId:'settings-repair-browser',sync:async()=>({}),schedulePush(){}};
      window.dispatchEvent(new CustomEvent('slogi:workspace-ready'));
    `
  }))

  const page = await context.newPage()
  const issues = []
  page.on('pageerror', error => issues.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') issues.push(message.text())
  })

  try {
    await page.goto(`${origin}/settings.html`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Настройки', exact: true }).waitFor()
    await page.locator('.estimate-settings').waitFor()
    await page.getByRole('heading', { name: 'Шаблон сметы ремонта', exact: true }).waitFor()

    const saveButton = page.getByRole('button', { name: 'Сохранить', exact: true })
    assert.equal(await saveButton.isEnabled(), true, 'Save must stay enabled when the form is unchanged')
    assert.equal(await page.getByRole('button', { name: 'Отменить изменения', exact: true }).isDisabled(), true)
    assert.ok(await page.locator('.estimate-section').count() >= 3)
    assert.ok(await page.getByRole('heading', { name: 'Мебель', exact: true }).count() >= 1)
    assert.equal(
      await page.locator('.settings-intro p, .estimate-section-header > p, .estimate-no-items, .settings-save-bar > span').count(),
      0,
      'Removed explanatory copy must not return'
    )
    const settingsCopy = await page.locator('.estimate-settings').innerText()
    for (const removedText of [
      'Этот шаблон используется для автоматического формирования документов ремонта',
      'Раздел будет повторён',
      'Раздел будет добавлен в смету один раз',
      'В подразделе пока нет трат',
      'Все изменения сохранены',
      'Есть несохранённые изменения'
    ]) assert.equal(settingsCopy.includes(removedText), false, `Unexpected copy: ${removedText}`)

    const layoutOverflow = () => page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      page: document.querySelector('.settings-page').scrollWidth - document.querySelector('.settings-page').clientWidth,
      editor: document.querySelector('.estimate-settings').scrollWidth - document.querySelector('.estimate-settings').clientWidth,
      sections: Math.max(0, ...Array.from(document.querySelectorAll('.estimate-section')).map(node => node.scrollWidth - node.clientWidth))
    }))
    const desktop = await layoutOverflow()
    for (const [area, overflow] of Object.entries(desktop)) assert.ok(overflow <= 1, `${area} overflows by ${overflow}px on desktop`)

    await page.setViewportSize({ width: 390, height: 844 })
    const mobile = await layoutOverflow()
    for (const [area, overflow] of Object.entries(mobile)) assert.ok(overflow <= 1, `${area} overflows by ${overflow}px on mobile`)
    assert.equal(await saveButton.isEnabled(), true)
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.evaluate(() => {
      const estimate = window.SlogiRepairEstimate
      const pro = window.SlogiPro
      const settings = estimate.defaultSettings()
      const project = {
        id: 'settings-repair-browser-fixture',
        address: 'Москва, улица Автосинхронизации, 1',
        area: 120,
        ceilingHeight: 3.2,
        phase0: {
          revision: 3,
          source: 'manual',
          listingUrl: 'https://example.test/listing/settings-repair-browser-fixture',
          spaceCard: {
            id: 'settings-repair-browser-fixture',
            address: 'Москва, улица Автосинхронизации, 1',
            listingUrl: 'https://example.test/listing/settings-repair-browser-fixture',
            area: 120,
            ceilingHeight: 3.2,
            work: {
              status: 'closed',
              stage: 'repair',
              pipeline: { status: 'repair' },
              approval: { status: 'agreed', signedLeaseDate: '2026-10-01', documents: {} },
              repair: { stage: 'documents', enteredAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z' }
            }
          }
        }
      }
      const generated = estimate.generateAll(project, settings, {
        actorId: 'settings-repair-browser',
        cabinetsCount: 1,
        restroomsCount: 1,
        startDate: '2026-10-01',
        repairDurationDays: 30,
        paymentForm: 'Безналичный расчёт'
      }, { now: '2026-10-01T09:00:00.000Z' })
      const state = pro.read()
      state.settings = { ...(state.settings || {}), repairEstimateTemplate: settings }
      pro.write(state, 'browser-fixture-settings')
      pro.writeLocations([generated], 'browser-fixture-locations')
    })

    await page.goto(`${origin}/repair.html?section=documents`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Документы для ремонта', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Открыть документы', exact: true }).click()
    const card = page.locator('.property-card')
    await card.getByRole('heading', { name: 'Ремонт помещения', exact: true }).waitFor()
    await card.getByRole('button', { name: 'Заказные позиции' }).waitFor()
    assert.equal(await card.locator('.repair-document-tab.active span').innerText(), 'Заказные позиции')

    const cardMarker = `same-card-${Date.now()}`
    await card.evaluate((node, marker) => { node.dataset.browserSyncMarker = marker }, cardMarker)
    const urlBeforeTemplateUpdate = page.url()
    const customPosition = 'Стойка ресепшен на заказ — browser sync'

    await page.evaluate(({ customPosition }) => {
      const estimate = window.SlogiRepairEstimate
      const pro = window.SlogiPro
      const state = pro.read()
      const current = state.settings?.repairEstimateTemplate || estimate.defaultSettings()
      const section = current.sections.find(item => item.scope === 'cabinet')
      const subsection = section.subsections.find(item => item.kind === 'furniture')
      const updated = estimate.addTemplateItem(current, {
        actorId: 'settings-repair-browser',
        sectionId: section.id,
        subsectionId: subsection.id,
        name: customPosition,
        price: 125000,
        quantity: 1,
        unit: 'шт.',
        link: 'https://example.test/custom-desk',
        customMade: true
      }, { now: '2026-10-31T09:00:00.000Z' })
      state.settings = { ...(state.settings || {}), repairEstimateTemplate: updated }
      pro.write(state, 'repair-estimate-template-update')
    }, { customPosition })

    await page.waitForFunction(value => Array.from(document.querySelectorAll('.property-card .repair-document-row-editor input[type="text"]'))
      .some(input => input.value === value), customPosition)
    assert.equal(page.url(), urlBeforeTemplateUpdate, 'Template sync must not navigate or remount the page')
    assert.equal(await card.getAttribute('data-browser-sync-marker'), cardMarker, 'The open property card must not remount')
    assert.equal(await card.locator('.repair-document-tab.active span').innerText(), 'Заказные позиции')

    const synchronizedState = await page.evaluate(({ customPosition }) => {
      const project = JSON.parse(localStorage.getItem('slogi_locations_v1') || '[]')[0]
      const repair = project.phase0.spaceCard.work.repair
      const estimateRows = repair.estimate.sections.flatMap(section => section.subsections.flatMap(subsection => subsection.items))
      return {
        estimateRow: estimateRows.find(row => row.name === customPosition),
        documentRow: repair.documentPack.documents.customOrders.rows.find(row => row.name === customPosition),
        templateSignature: repair.estimate.templateSignature,
        currentSignature: window.SlogiRepairEstimate.settingsSignature(window.SlogiPro.read().settings.repairEstimateTemplate)
      }
    }, { customPosition })
    assert.equal(synchronizedState.estimateRow?.customMade, true)
    assert.equal(synchronizedState.documentRow?.customMade, true)
    assert.equal(synchronizedState.documentRow?.price, 125000)
    assert.equal(synchronizedState.templateSignature, synchronizedState.currentSignature)
    assert.deepEqual(issues, [])
    console.log('nuxt settings/repair browser: PASS')
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    await new Promise(resolveClose => server.close(resolveClose))
  }
})
