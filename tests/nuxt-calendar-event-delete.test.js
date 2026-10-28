const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(ROOT, 'frontend/app/components/WorkCalendarPanel.vue'), 'utf8')

test('calendar exposes deletion for every event source with a clear confirmation', () => {
  assert.match(source, /@click="removeSelectedEvent">Удалить</)
  assert.match(source, /confirm\(removalConfirmation\(event\)\)/)
  assert.match(source, /event\.source === 'viewing'/)
  assert.match(source, /event\.source === 'follow-up'/)
  assert.match(source, /removeManualEvent\(event\)/)
})

test('event deletion is persisted in the owning domain store', () => {
  assert.match(source, /service\.cancel\(project\.id/)
  assert.match(source, /target\.calendarDeletedAt = at/)
  assert.match(source, /proposal\.followUpDueAt = null/)
  assert.match(source, /proposal\.followUpTaskId = null/)
  assert.match(source, /runtime\.pro\.remove\('tasks', taskId\)/)
  assert.match(source, /runtime\.pro\.remove\('tasks', event\.id\)/)
  assert.match(source, /item\.status !== 'cancelled' && !item\.calendarDeletedAt/)
})

test('secondary calendar tools have dedicated compact styling hooks', () => {
  assert.match(source, /calendar-add-button/)
  assert.match(source, /calendar-tool-secondary--notifications/)
  assert.match(source, /calendar-tool-secondary--export/)
})
