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

test('repair documents are generated, editable, exportable and responsive', () => {
  const tab = read('frontend/app/components/PropertyRepairStageTab.vue')
  const css = read('frontend/app/assets/css/main.css')

  for (const kind of ['customOrders', 'repairRoadmap', 'purchaseSpecification', 'paymentSchedule', 'fullEstimate']) {
    assert.match(tab, new RegExp(`kind: '${kind}'`))
  }
  assert.match(tab, /repairEstimate\.generateDocuments/)
  assert.match(tab, /repairEstimate\.addEstimateRow/)
  assert.match(tab, /repairEstimate\.updateEstimateRow/)
  assert.match(tab, /repairEstimate\.removeEstimateRow/)
  assert.match(tab, /exportDocument/)
  assert.match(tab, /exportFullEstimate/)
  assert.match(tab, /exportCustomFurniture/)
  assert.match(tab, /workflow\.download\(/)
  assert.match(tab, /rebaseRepairEstimate\(generatedEstimate, currentEstimate\)/)
  assert.match(tab, /defineExpose\(\{ agreeDocuments, saveDocuments, canAgree \}\)/)
  const modal = read('frontend/app/components/PropertyCardModal.vue')
  assert.match(modal, /activeTab\.value === 'repair-documents'/)
  assert.match(modal, /await repairDocumentsTab\.value\.saveDocuments\(\)/)
  assert.match(modal, /modalError\.value = propertyErrorMessage\(reason, 'Не удалось сохранить документы ремонта\.'\)/)
  assert.match(css, /\.repair-document-workspace \{[^}]*overflow: hidden/)
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.repair-document-setup \{ grid-template-columns: 1fr 1fr/)
  assert.match(css, /\.repair-estimate-row, \.repair-estimate-new-row \{ grid-template-columns: 1fr;/)
})

test('repair documents use the full card width without the current stage sidebar', () => {
  const tab = read('frontend/app/components/PropertyRepairStageTab.vue')
  const css = read('frontend/app/assets/css/main.css')

  assert.doesNotMatch(tab, /<aside class="form-card repair-stage-next">/)
  assert.doesNotMatch(tab, /<h3>Текущий этап<\/h3>/)
  assert.doesNotMatch(css, /repair-stage-next|repair-stage-summary/)
  assert.match(css, /\.repair-stage-tab \{[^}]*grid-template-columns: minmax\(0, 1fr\)/)
  assert.doesNotMatch(css, /\.repair-stage-tab--documents \{ grid-template-columns: minmax\(0, 1fr\) 220px;/)
})

test('repair document typography matches the rest of the property card', () => {
  const css = read('frontend/app/assets/css/main.css')

  assert.match(css, /\.repair-document-setup label > span,[^}]*font-size: 12px/)
  assert.match(css, /\.repair-document-setup input,[^}]*font-size: 13px/)
  assert.match(css, /\.repair-document-tab span \{ font-size: 13px;/)
  assert.match(css, /\.repair-document-tab small \{ font-size: 11px;/)
  assert.match(css, /\.repair-document-empty \{[^}]*font-size: 14px/)
})
