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
