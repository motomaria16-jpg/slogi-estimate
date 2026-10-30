import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('settings page is available from the menu and prerendered', () => {
  const sidebar = read('frontend/app/components/AppSidebar.vue')
  const config = read('frontend/nuxt.config.ts')
  const page = read('frontend/app/pages/settings.html.vue')

  assert.match(sidebar, /to: '\/settings\.html', label: 'Настройки'/)
  assert.match(config, /'\/settings\.html'/)
  assert.match(page, /<SettingsEstimateEditor \/>/)
})

test('repair estimate domain and Excel exporter are wired into the runtime', () => {
  const plugin = read('frontend/app/plugins/legacy.client.ts')
  const sync = read('frontend/scripts/sync-legacy-assets.mjs')
  const runtime = read('frontend/app/composables/useSlogiRuntime.ts')
  const types = read('frontend/app/types/slogi.d.ts')

  for (const asset of ['repair-estimate.js', 'repair-documents-xlsx.js']) {
    assert.ok(plugin.includes(`'${asset}'`))
    assert.ok(sync.includes(`'${asset}'`))
  }
  assert.match(runtime, /repairEstimate: window\.SlogiRepairEstimate/)
  assert.match(runtime, /repairDocumentsXlsx: window\.SlogiRepairDocumentsXlsx/)
  assert.match(types, /SlogiRepairEstimate: any/)
  assert.match(types, /SlogiRepairDocumentsXlsx\?: any/)
})

test('settings persist under professional settings and reject stale overwrites', () => {
  const composable = read('frontend/app/composables/useRepairEstimateSettings.ts')

  assert.match(composable, /state\?\.settings\?\.repairEstimateTemplate/)
  assert.match(composable, /const latest = value\.pro\.read\(\)/)
  assert.match(composable, /latestSignature !== baseSignature\.value/)
  assert.match(composable, /изменён другим пользователем/)
  assert.match(composable, /repairEstimateTemplate: prepared/)
  assert.match(composable, /value\.pro\.write\(next, 'repair-estimate-template-update'\)/)
})

test('settings reject empty expense names and invalid links before normalization', () => {
  const composable = read('frontend/app/composables/useRepairEstimateSettings.ts')
  const editor = read('frontend/app/components/SettingsEstimateEditor.vue')

  assert.match(composable, /function validateDraftRows\(\)/)
  assert.match(composable, /if \(!String\(item\.name \|\| ''\)\.trim\(\)\)/)
  assert.match(composable, /url\.protocol === 'http:' \|\| url\.protocol === 'https:'/)
  assert.match(composable, /validationError\.value = validateDraftRows\(\)/)
  assert.match(composable, /if \(validationError\.value\) \{[\s\S]*return false/)
  assert.match(composable, /draftSignature\(draft\.value\) !== baseDraftSignature\.value/)
  assert.match(editor, /v-if="validationError"[\s\S]*role="alert"/)
  assert.match(editor, /Ссылка должна начинаться с http:\/\/ или https:\/\//)
})

test('estimate template supports sections, subsections, expenses and made-to-order furniture', () => {
  const editor = read('frontend/app/components/SettingsEstimateEditor.vue')

  for (const label of ['Мебель', 'Оснащение', 'Отделка', 'Работа']) assert.match(editor, new RegExp(label))
  for (const scope of ['fixed', 'cabinet', 'restroom']) assert.match(editor, new RegExp(`value: '${scope}'`))
  assert.match(editor, /addSection\(name, newSection\.scope\)/)
  assert.match(editor, /addSubsection\(section\.id, kind\)/)
  assert.match(editor, /addItem\(section\.id, subsection\.id/)
  assert.match(editor, /removeItem\(section\.id, subsection\.id, item\.id\)/)
  assert.match(editor, /subsection\.kind === 'furniture'/)
  assert.match(editor, />На заказ</)
  assert.match(editor, /v-model="item\.name"/)
  assert.match(editor, /v-model\.number="item\.price"/)
  assert.match(editor, /v-model="item\.link"/)
})

test('Excel exports use the runtime exporter and explain disabled state', () => {
  const editor = read('frontend/app/components/SettingsEstimateEditor.vue')
  const composable = read('frontend/app/composables/useRepairEstimateSettings.ts')

  assert.match(editor, /Выгрузить смету в Excel/)
  assert.match(editor, /Скачать заказную мебель/)
  assert.match(editor, /:title="exportHint"/)
  assert.match(composable, /exportFullEstimate \|\| exporter\?\.makeFullEstimate/)
  assert.match(composable, /exportCustomFurniture \|\| exporter\?\.makeCustomFurniture/)
  assert.match(composable, /Модуль выгрузки Excel недоступен/)
  assert.match(composable, /value\.workflow\.download\(result\.blob/)
})

test('settings editor collapses to one column without horizontal overflow', () => {
  const editor = read('frontend/app/components/SettingsEstimateEditor.vue')

  assert.match(editor, /min-width: 0/)
  assert.match(editor, /@media \(max-width: 680px\)/)
  assert.match(editor, /\.estimate-item-grid, \.estimate-new-item \{ grid-template-columns: 1fr; \}/)
  assert.match(editor, /\.settings-save-bar \{ right: 8px; bottom: 8px; left: 8px;/)
})

test('settings editor uses compact spacing and a clear section hierarchy', () => {
  const editor = read('frontend/app/components/SettingsEstimateEditor.vue')

  assert.match(editor, /\.estimate-settings \{[^}]*gap: 8px/)
  assert.match(editor, /input, select \{[^}]*min-height: 38px/)
  assert.match(editor, /\.estimate-section \{[^}]*border-top: 3px solid #4e8079/)
  assert.match(editor, /\.estimate-section-header \{[^}]*linear-gradient/)
  assert.match(editor, /\.estimate-section-name input \{[^}]*font-size: 17px/)
  assert.match(editor, /\.estimate-subsection > header \{[^}]*background: #f0f5f3/)
})
