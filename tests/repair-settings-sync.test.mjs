import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { rebaseRepairEstimate } from '../frontend/app/utils/rebaseRepairEstimate.js'
import { reconcileRepairDocumentPack } from '../frontend/app/utils/reconcileRepairDocuments.js'

const require = createRequire(import.meta.url)
const estimate = require('../repair-estimate.js')

function project() {
  return {
    id: 'settings-sync-project', address: 'Москва, Тестовая улица, 1', area: 120, ceilingHeight: 3,
    phase0: { spaceCard: { id: 'settings-sync-project', area: 120, ceilingHeight: 3, work: {
      status: 'closed', stage: 'repair', pipeline: { status: 'repair' },
      approval: { status: 'agreed', documents: { signedLease: { name: 'ДА.pdf', signedAt: '2026-11-03' } } },
      repair: { schemaVersion: 1, stage: 'documents', documents: [], transitions: [] }
    } } }
  }
}

function settingsWithDesk() {
  return estimate.addTemplateItem(estimate.defaultSettings(), {
    sectionId: 'cabinet', kind: 'furniture',
    item: { id: 'desk', name: 'Стол', price: 10000, quantity: 1, customMade: true }
  })
}

test('settings sync preserves manually edited schedules, titles and document rows', () => {
  let current = estimate.generateAll(project(), settingsWithDesk(), { cabinetsCount: 1, restroomsCount: 0, repairDurationDays: 30 })
  current = estimate.updateDocument(current, { kind: 'repairRoadmap', patch: { title: 'Мой график ремонта' } })
  current = estimate.updateDocumentRow(current, {
    kind: 'repairRoadmap', rowId: 'milestone-2', patch: { name: 'Авторская контрольная точка', date: '2026-11-09' }
  })
  current = estimate.updateDocumentRow(current, {
    kind: 'paymentSchedule', rowId: 'payment-1', patch: { name: 'Согласованный аванс', paymentForm: 'По счёту' }
  })
  current = estimate.addDocumentRow(current, {
    kind: 'purchaseSpecification', row: { id: 'purchaseSpecification-row-manual', name: 'Ручная закупка', price: 7000, quantity: 1, unit: 'шт.' }
  })

  const previousEstimate = estimate.estimateOf(current)
  const previousPack = estimate.documentsOf(current)
  const updatedSettings = estimate.addTemplateItem(settingsWithDesk(), {
    sectionId: 'cabinet', kind: 'equipment', item: { id: 'screen', name: 'Экран', price: 25000, quantity: 1 }
  })
  let refreshed = estimate.generateEstimate(current, updatedSettings, { cabinetsCount: 1, restroomsCount: 0 })
  refreshed.phase0.spaceCard.work.repair.estimate = rebaseRepairEstimate(estimate.estimateOf(refreshed), previousEstimate)
  refreshed = estimate.generateDocuments(refreshed, {
    cabinetsCount: 1,
    restroomsCount: 0,
    startDate: previousPack.startDate,
    repairDurationDays: previousPack.documents.repairRoadmap.meta.durationDays,
    paymentForm: previousPack.documents.paymentSchedule.meta.paymentForm,
    milestones: previousPack.documents.repairRoadmap.rows,
    paymentTerms: previousPack.documents.paymentSchedule.rows
  })
  const generatedPack = estimate.documentsOf(refreshed)
  refreshed.phase0.spaceCard.work.repair.documentPack = estimate.normalizeDocumentPack(
    reconcileRepairDocumentPack(generatedPack, previousPack)
  )

  const result = estimate.documentsOf(refreshed)
  assert.equal(result.documents.repairRoadmap.title, 'Мой график ремонта')
  assert.equal(result.documents.repairRoadmap.rows.find(row => row.id === 'milestone-2').name, 'Авторская контрольная точка')
  assert.equal(result.documents.repairRoadmap.rows.find(row => row.id === 'milestone-2').date, '2026-11-09')
  assert.equal(result.documents.paymentSchedule.rows.find(row => row.id === 'payment-1').name, 'Согласованный аванс')
  assert.equal(result.documents.paymentSchedule.rows.find(row => row.id === 'payment-1').paymentForm, 'По счёту')
  assert.equal(result.documents.purchaseSpecification.rows.some(row => row.id === 'purchaseSpecification-row-manual'), true)
  assert.equal(result.documents.purchaseSpecification.rows.some(row => row.name === 'Экран'), true)
  assert.equal(result.documents.fullEstimate.meta.total, 35000)
})

test('settings insertion does not move procurement overrides or resurrect deleted source rows', () => {
  let settings = settingsWithDesk()
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'cabinet', kind: 'equipment', item: { id: 'screen', name: 'Экран', price: 25000, quantity: 1 }
  })
  let current = estimate.generateAll(project(), settings, { cabinetsCount: 1, restroomsCount: 0, repairDurationDays: 30 })
  const originalPack = estimate.documentsOf(current)
  const desk = originalPack.documents.purchaseSpecification.rows.find(row => row.name === 'Стол')
  const screen = originalPack.documents.purchaseSpecification.rows.find(row => row.name === 'Экран')
  current = estimate.updateDocumentRow(current, {
    kind: 'purchaseSpecification', rowId: desk.id, patch: { name: 'Стол по согласованной спецификации' }
  })
  current = estimate.removeDocumentRow(current, { kind: 'purchaseSpecification', rowId: screen.id })

  const reordered = structuredClone(settings)
  const cabinet = reordered.sections.find(section => section.id === 'cabinet')
  const furniture = cabinet.subsections.find(subsection => subsection.kind === 'furniture')
  const equipment = cabinet.subsections.find(subsection => subsection.kind === 'equipment')
  furniture.items.unshift({ id: 'chair', name: 'Кресло', price: 15000, quantity: 1, unit: 'шт.' })
  equipment.items.unshift({ id: 'lamp', name: 'Светильник', price: 5000, quantity: 1, unit: 'шт.' })

  const previousEstimate = estimate.estimateOf(current)
  const previousPack = estimate.documentsOf(current)
  let refreshed = estimate.generateEstimate(current, reordered, { cabinetsCount: 1, restroomsCount: 0 })
  refreshed.phase0.spaceCard.work.repair.estimate = rebaseRepairEstimate(estimate.estimateOf(refreshed), previousEstimate)
  refreshed = estimate.generateDocuments(refreshed, {
    cabinetsCount: 1,
    restroomsCount: 0,
    startDate: previousPack.startDate,
    repairDurationDays: previousPack.documents.repairRoadmap.meta.durationDays,
    paymentForm: previousPack.documents.paymentSchedule.meta.paymentForm,
    milestones: previousPack.documents.repairRoadmap.rows,
    paymentTerms: previousPack.documents.paymentSchedule.rows
  })
  const generatedPack = estimate.documentsOf(refreshed)
  refreshed.phase0.spaceCard.work.repair.documentPack = estimate.normalizeDocumentPack(
    reconcileRepairDocumentPack(generatedPack, previousPack)
  )

  const specification = estimate.documentsOf(refreshed).documents.purchaseSpecification
  assert.equal(specification.rows.find(row => row.sourceKey === desk.sourceKey).name, 'Стол по согласованной спецификации')
  assert.equal(specification.rows.some(row => row.sourceKey === screen.sourceKey), false)
  assert.equal(specification.rows.some(row => row.name === 'Кресло'), true)
  assert.equal(specification.rows.some(row => row.name === 'Светильник'), true)
  assert.deepEqual(specification.meta.removedGeneratedRowKeys, [screen.sourceKey])
})
