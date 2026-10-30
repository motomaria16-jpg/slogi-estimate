import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('repair menu uses one canonical workspace with three stage sections', () => {
  const sidebar = read('frontend/app/components/AppSidebar.vue')
  const config = read('frontend/nuxt.config.ts')

  for (const section of ['documents', 'repair', 'handover']) {
    assert.match(sidebar, new RegExp(`/repair\\.html\\?section=${section}`))
  }
  assert.doesNotMatch(sidebar, /under-development\.html\?section=(?:documents|repair|handover)/)
  assert.match(config, /'\/repair\.html'/)
})

test('repair workspace filters by domain stage and opens the matching modal tab', () => {
  const page = read('frontend/app/pages/repair.html.vue')

  assert.match(page, /repairProjects/)
  assert.match(page, /api\(\)\?\.repair\?\.stageOf\?\.\(project\) === section\.value/)
  assert.match(page, /openProject\(project\.id, 'repair', meta\.value\.modalTab\)/)
  assert.match(page, /modalTab: 'repair-documents'/)
  assert.match(page, /modalTab: 'repair-process'/)
  assert.match(page, /modalTab: 'repair-handover'/)
  assert.match(page, /<PremisesMap[\s\S]*@open="openFromMap"/)
  assert.match(page, /<WorkCalendarPanel v-else :projects="projects" \/>/)
})

test('legacy repair placeholders redirect to the canonical repair workspace', () => {
  const placeholder = read('frontend/app/pages/under-development.html.vue')

  assert.match(placeholder, /'repair-documents': 'documents'/)
  assert.match(placeholder, /'repair-process': 'repair'/)
  assert.match(placeholder, /'repair-exit': 'handover'/)
  assert.match(placeholder, /navigateTo\(`\/repair\.html\?section=\$\{repairRedirects\[legacySection\]\}`/)
})

test('repair list cards have stage-specific status and action labels', () => {
  const card = read('frontend/app/components/PremisesCard.vue')

  for (const context of ['repair-documents', 'repair-process', 'repair-handover']) {
    assert.match(card, new RegExp(`'${context}'`))
  }
  assert.match(card, /return 'Открыть документы'/)
  assert.match(card, /return 'Открыть ремонт'/)
  assert.match(card, /return 'Открыть выход'/)
})

test('repair document rows keep fixed add, download and delete controls', () => {
  const tab = read('frontend/app/components/PropertyRepairStageTab.vue')
  const css = read('frontend/app/assets/css/main.css')

  assert.match(tab, /class="[^"]*repair-document-row[^"]*"/)
  assert.match(tab, /class="approval-document-slot"/)
  assert.match(tab, /class="[^"]*repair-document-actions[^"]*"/)
  for (const label of ['Добавить', 'Скачать', 'Удалить']) {
    assert.match(tab, new RegExp(`>${label}<\\/button>`))
  }
  assert.match(tab, /workflow\.saveAttachment\(/)
  assert.match(tab, /workflow\.getAttachment\(/)
  assert.match(tab, /workflow\.deleteAttachment\(/)
  assert.match(tab, /workflow\.download\(/)
  assert.match(tab, /:disabled="[^"]*!row\.ready[^"]*"[^>]*>Скачать<\/button>/)
  assert.match(tab, /:disabled="[^"]*!row\.ready[^"]*"[^>]*>Удалить<\/button>/)
  assert.match(css, /\.repair-document-row \{[^}]*min-height:/)
  assert.match(css, /\.approval-document-actions \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
})
