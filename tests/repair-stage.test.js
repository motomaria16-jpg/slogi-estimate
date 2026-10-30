'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const repair = require('../repair-stage.js')

function project(overrides = {}) {
  return {
    id: 'space-repair-1',
    phase0: { spaceCard: { work: {
      status: 'closed',
      stage: 'repair',
      pipeline: { status: 'repair' },
      approval: { status: 'agreed' },
      ...overrides
    } } }
  }
}

test('agreed and legacy repair records open at documents', () => {
  assert.equal(repair.stageOf(project()), 'documents')
  assert.equal(repair.isRepairProject(project()), true)
  assert.equal(repair.canOpenStage(project(), 'documents'), true)
  assert.equal(repair.canOpenStage(project(), 'repair'), false)
  assert.equal(repair.canOpenStage(project(), 'handover'), false)
})

test('startDocuments stores an immutable initial repair stage', () => {
  const source = project({ pipeline: { status: 'approval_pending' }, repair: { documents: [{ kind: 'technicalTask' }] } })
  const entered = repair.startDocuments(source, { actorId: 'user-1' }, { now: '2026-10-29T10:00:00.000Z' })
  assert.equal(entered.phase0.spaceCard.work.repair.stage, 'documents')
  assert.equal(entered.phase0.spaceCard.work.repair.enteredById, 'user-1')
  assert.equal(entered.phase0.spaceCard.work.repair.documents[0].kind, 'technicalTask')
  assert.equal(entered.phase0.spaceCard.work.pipeline.status, 'repair')
  assert.equal(source.phase0.spaceCard.work.repair.stage, undefined)
})

test('later stages unlock only their completed predecessors', () => {
  const repairing = project({ repair: { stage: 'repair' } })
  assert.equal(repair.canOpenStage(repairing, 'documents'), true)
  assert.equal(repair.canOpenStage(repairing, 'repair'), true)
  assert.equal(repair.canOpenStage(repairing, 'handover'), false)
  const handover = project({ repair: { stage: 'handover' } })
  assert.equal(repair.canOpenStage(handover, 'handover'), true)
})

test('repair cannot start before agreement', () => {
  assert.throws(() => repair.startDocuments(project({ approval: { status: 'pending' } })), /согласуйте/)
})

test('repair documents are attached and replaced immutably', () => {
  const source = project({ repair: { stage: 'documents', documents: [{ kind: 'technicalTask' }] } })
  const attached = repair.attachDocument(source, {
    kind: 'technicalTask',
    name: 'Техническое задание.docx',
    attachmentType: 'repair-technical-1',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 123,
    actorId: 'user-1'
  }, { now: '2026-10-30T08:00:00.000Z' })
  assert.equal(repair.documentOf(attached, 'technicalTask').name, 'Техническое задание.docx')
  assert.equal(repair.documentOf(attached, 'technicalTask').uploadedById, 'user-1')
  assert.equal(repair.documentOf(source, 'technicalTask').name, '')

  const replaced = repair.attachDocument(attached, {
    kind: 'technicalTask',
    name: 'Техническое задание v2.pdf',
    attachmentType: 'repair-technical-2'
  }, { now: '2026-10-30T09:00:00.000Z' })
  assert.equal(replaced.phase0.spaceCard.work.repair.documents.length, 1)
  assert.equal(repair.documentOf(replaced, 'technicalTask').attachmentType, 'repair-technical-2')
  assert.equal(repair.documentOf(attached, 'technicalTask').attachmentType, 'repair-technical-1')
})

test('repair document removal targets the exact kind and attachment', () => {
  let source = project({ repair: { stage: 'documents', documents: [] } })
  source = repair.attachDocument(source, { kind: 'technicalTask', name: 'ТЗ.docx', attachmentType: 'repair-technical-1' })
  source = repair.attachDocument(source, { kind: 'estimate', name: 'Смета.xlsx', attachmentType: 'repair-estimate-1' })

  const unchanged = repair.removeDocument(source, { kind: 'technicalTask', attachmentType: 'another-file' })
  assert.equal(unchanged.phase0.spaceCard.work.repair.documents.length, 2)

  const removed = repair.removeDocument(source, { kind: 'technicalTask', attachmentType: 'repair-technical-1' })
  assert.equal(repair.documentOf(removed, 'technicalTask'), null)
  assert.equal(repair.documentOf(removed, 'estimate').name, 'Смета.xlsx')
  assert.equal(repair.documentOf(source, 'technicalTask').name, 'ТЗ.docx')
})
