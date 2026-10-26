const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('the shared property card always exposes all three tabs and gates their actions', () => {
  const modal = read('frontend/app/components/PropertyCardModal.vue')
  for (const tab of ['Объект', 'Сопровождение', 'КП']) {
    assert.match(modal, new RegExp(`label: '${tab}'`))
  }
  assert.doesNotMatch(modal, /\.filter\(item => item\.visible\)/)
  assert.match(modal, /:disabled="!tab\.enabled"/)
  assert.match(modal, /proposalTabReady\(project\.value\)/)
  assert.match(modal, /Доступно после завершения просмотра и добавления фото и видео/)
})

test('proposal availability requires a completed viewing with uploaded photo and video', () => {
  const format = read('frontend/app/utils/format.ts')
  assert.match(format, /status === 'completed'/)
  assert.match(format, /item\?\.status === 'uploaded'/)
  assert.match(format, /item\.kind === 'photo'/)
  assert.match(format, /item\.kind === 'video'/)
})

test('workflow progress strip is removed and the shared layout stays compact and regular weight', () => {
  const workflow = read('frontend/app/components/PropertyWorkflowTab.vue')
  const css = read('frontend/app/assets/css/main.css')
  assert.doesNotMatch(workflow, /pipeline-steps|<ol/)
  assert.doesNotMatch(css, /\.pipeline-steps/)
  assert.match(css, /strong, b \{ font-weight: 400; \}/)
  assert.match(css, /\.workflow-card \{ min-height: 0; \}/)
  assert.match(css, /\.form-row \{[^}]*min-height: 46px/)
  assert.match(css, /\.property-body \{[^}]*padding: 10px 12px/)
})
