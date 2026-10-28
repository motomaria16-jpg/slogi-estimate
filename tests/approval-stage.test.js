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
  assert.equal(approval.isApprovalProject(agreed), false)
})

test('ownership documents can contain several files', () => {
  let entered = approval.start(project())
  entered = approval.attachDocument(entered, { kind: 'ownershipProof', name: 'Выписка.pdf', attachmentType: 'ownership-1' })
  entered = approval.attachDocument(entered, { kind: 'ownershipProof', name: 'Доверенность.pdf', attachmentType: 'ownership-2' })
  assert.deepEqual(approval.approvalOf(entered).documents.ownershipProofs.map(item => item.name), ['Выписка.pdf', 'Доверенность.pdf'])
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
