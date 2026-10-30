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
  assert.match(source, /event\.source === 'repair-control-point'/)
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
  assert.match(source, /target\.status = 'deleted'/)
  assert.match(source, /calendar-repair-control-hide/)
})

test('repair control points join the shared calendar event stream', () => {
  assert.match(source, /repair\.calendarEvents \|\| \[\]/)
  assert.match(source, /item\?\.source === 'repair-control-point'/)
  assert.match(source, /item\.status !== 'deleted' && !item\.calendarDeletedAt/)
  assert.match(source, /projectId: String\(item\.projectId \|\| project\.id\)/)
  assert.match(source, /at: item\.startsAt \|\| item\.at/)
  assert.match(source, /responsible: item\.responsible/)
  assert.match(source, /description: item\.description/)
  assert.match(source, /reminderMinutesBefore: Number\(item\.reminderMinutesBefore \?\? 1440\)/)
})

test('secondary calendar tools have dedicated compact styling hooks', () => {
  assert.match(source, /calendar-add-button/)
  assert.match(source, /calendar-tool-secondary--notifications/)
  assert.match(source, /calendar-tool-secondary--export/)
})
