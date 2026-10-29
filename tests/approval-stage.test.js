'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const approval = require('../approval-stage.js')

function project() {
  return {
    id: 'space-1',
    address: 'Москва, Тверская улица, 1',
    phase0: { spaceCard: { id: 'space-1', work: {
      status: 'closed',
      stage: 'proposal_handoff',
      pipeline: { status: 'proposal_started' },
      proposal: { status: 'sent', sentAt: '2026-10-28T09:00:00.000Z' }
    } } }
  }
}

test('sent proposal enters approval without copying the property card', () => {
  const source = project()
  assert.equal(approval.isApprovalProject(source), true)
  const entered = approval.start(source, { actorId: 'user-1' }, { now: '2026-10-28T10:00:00.000Z' })
  assert.equal(approval.isApprovalProject(entered), true)
  assert.equal(entered.phase0.spaceCard.work.pipeline.status, 'approval_pending')
  assert.equal(entered.phase0.spaceCard.work.stage, 'approval')
  assert.equal(source.phase0.spaceCard.work.approval, undefined)
})

test('agreement requires signed lease and ownership proof and then enters repair', () => {
  let entered = approval.start(project(), {}, { now: '2026-10-28T10:00:00.000Z' })
  assert.throws(() => approval.agree(entered), /подписанный договор/)
  entered = approval.attachDocument(entered, { kind: 'signedLease', name: 'ДА.pdf', attachmentType: 'lease' })
  assert.throws(() => approval.agree(entered), /собственности/)
  entered = approval.attachDocument(entered, { kind: 'ownershipProof', name: 'Выписка.pdf', attachmentType: 'ownership-1' })
  const agreed = approval.agree(entered, { actorId: 'user-1' }, { now: '2026-10-28T11:00:00.000Z' })
  assert.equal(approval.approvalOf(agreed).status, 'agreed')
  assert.equal(agreed.phase0.spaceCard.work.pipeline.status, 'repair')
  assert.equal(agreed.phase0.spaceCard.work.repair.stage, 'documents')
  assert.equal(agreed.phase0.spaceCard.work.repair.enteredById, 'user-1')
  assert.equal(approval.isApprovalProject(agreed), false)
})

test('ownership documents can contain several files', () => {
  let entered = approval.start(project())
  entered = approval.attachDocument(entered, { kind: 'ownershipProof', name: 'Выписка.pdf', attachmentType: 'ownership-1' })
  entered = approval.attachDocument(entered, { kind: 'ownershipProof', name: 'Доверенность.pdf', attachmentType: 'ownership-2' })
  assert.deepEqual(approval.approvalOf(entered).documents.ownershipProofs.map(item => item.name), ['Выписка.pdf', 'Доверенность.pdf'])
})

test('documents can be removed by exact attachment type and agreement readiness is recalculated', () => {
  let entered = approval.start(project())
  entered = approval.attachDocument(entered, { kind: 'protocol', name: 'Протокол.pdf', attachmentType: 'protocol-1' })
  entered = approval.attachDocument(entered, { kind: 'signedLease', name: 'ДА.pdf', attachmentType: 'lease-1' })
  entered = approval.attachDocument(entered, { kind: 'ownershipProof', name: 'Выписка.pdf', attachmentType: 'ownership-1' })
  entered = approval.attachDocument(entered, { kind: 'ownershipProof', name: 'Доверенность.pdf', attachmentType: 'ownership-2' })
  assert.equal(approval.canAgree(entered), true)

  const withoutProtocol = approval.removeDocument(entered, { kind: 'protocol', attachmentType: 'protocol-1' })
  assert.equal(approval.approvalOf(withoutProtocol).documents.protocol.name, '')
  assert.equal(approval.canAgree(withoutProtocol), true)
  assert.equal(approval.approvalOf(entered).documents.protocol.name, 'Протокол.pdf')

  const ownershipStillReady = approval.removeDocument(withoutProtocol, { kind: 'ownershipProof', attachmentType: 'ownership-1' })
  assert.deepEqual(approval.approvalOf(ownershipStillReady).documents.ownershipProofs.map(item => item.name), ['Доверенность.pdf'])
  assert.equal(approval.canAgree(ownershipStillReady), true)

  const ownershipMissing = approval.removeDocument(ownershipStillReady, { kind: 'ownershipProof', attachmentType: 'ownership-2' })
  assert.equal(approval.canAgree(ownershipMissing), false)
  const leaseMissing = approval.removeDocument(entered, { kind: 'signedLease', attachmentType: 'lease-1' })
  assert.equal(approval.canAgree(leaseMissing), false)
})

test('document removal validates the document kind and pending approval state', () => {
  const entered = approval.start(project())
  assert.throws(() => approval.removeDocument(entered, { kind: 'unknown', attachmentType: 'file-1' }), /тип документа/)
  assert.throws(() => approval.removeDocument(entered, { kind: 'ownershipProof' }), /Не указан документ/)

  let ready = approval.attachDocument(entered, { kind: 'signedLease', name: 'ДА.pdf', attachmentType: 'lease-1' })
  ready = approval.attachDocument(ready, { kind: 'ownershipProof', name: 'Выписка.pdf', attachmentType: 'ownership-1' })
  const agreed = approval.agree(ready)
  assert.throws(() => approval.removeDocument(agreed, { kind: 'signedLease', attachmentType: 'lease-1' }), /уже завершено/)
})

test('rejection requires a reason, requires comment for other, and archives the project', () => {
  const entered = approval.start(project())
  assert.throws(() => approval.reject(entered, {}), /причину/)
  assert.throws(() => approval.reject(entered, { reason: 'other' }), /комментарий/)
  const rejected = approval.reject(entered, { reason: 'rent_rate', comment: 'Ставка выше бюджета' }, { now: '2026-10-28T12:00:00.000Z' })
  assert.equal(approval.approvalOf(rejected).status, 'rejected')
  assert.equal(rejected.phase0.spaceCard.work.pipeline.status, 'archived')
  assert.equal(rejected.phase0.spaceCard.work.approval.rejectionComment, 'Ставка выше бюджета')
})
