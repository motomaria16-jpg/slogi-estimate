'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const estimate = require('../repair-estimate.js')

function project(overrides = {}) {
  return {
    id: 'repair-estimate-1',
    address: 'Москва, Тестовая улица, 1',
    area: 180,
    ceilingHeight: 3.4,
    phase0: {
      spaceCard: {
        id: 'repair-estimate-1',
        area: 180,
        ceilingHeight: 3.4,
        work: {
          status: 'closed',
          stage: 'repair',
          pipeline: { status: 'repair' },
          approval: {
            status: 'agreed',
            decidedAt: '2026-10-30T12:00:00.000Z',
            documents: { signedLease: { name: 'ДА.pdf', signedAt: '2026-11-03' } }
          },
          repair: { schemaVersion: 1, stage: 'documents', documents: [], transitions: [] },
          ...overrides
        }
      }
    }
  }
}

function configuredSettings() {
  let settings = estimate.defaultSettings()
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'cabinet',
    kind: 'furniture',
    item: { id: 'desk', name: 'Стол администратора', price: '100 000', link: 'https://vendor.test/desk', customMade: true }
  }, { now: '2026-10-30T09:00:00.000Z' })
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'cabinet',
    kind: 'equipment',
    item: { id: 'screen', name: 'Экран', price: 25000, link: 'https://vendor.test/screen', customMade: true }
  })
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'restroom',
    kind: 'finishing',
    item: { id: 'tile', name: 'Плитка', price: 50000 }
  })
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'reception',
    kind: 'work',
    item: { id: 'assembly', name: 'Монтаж', price: 30000 }
  })
  return settings
}

test('default settings describe repeatable rooms and the four supported subsections', () => {
  const settings = estimate.defaultSettings()
  assert.deepEqual(settings.sections.map(section => section.scope), ['cabinet', 'restroom', 'fixed'])
  assert.deepEqual(settings.sections[0].subsections.map(section => section.kind), ['furniture', 'equipment', 'finishing', 'work'])
  assert.equal(settings.sections[0].name, 'Кабинет {n}')
  assert.equal(settings.sections[1].name, 'Санузел {n}')
})

test('settings signature tracks template content without depending on save metadata', () => {
  const source = configuredSettings()
  const sameContent = { ...structuredClone(source), updatedAt: '2026-10-31T08:00:00.000Z', updatedById: 'another-user' }
  const changed = estimate.addTemplateItem(source, {
    sectionId: 'reception', kind: 'equipment', item: { id: 'terminal', name: 'Терминал', price: 45000 }
  })

  assert.equal(estimate.settingsSignature(source), estimate.settingsSignature(sameContent))
  assert.notEqual(estimate.settingsSignature(source), estimate.settingsSignature(changed))
})

test('settings operations are immutable and normalize prices, links and made-to-order furniture', () => {
  const source = estimate.normalizeSettings({ sections: [] })
  const withSection = estimate.addSection(source, { id: 'studio', name: 'Кабинет звукозаписи', actorId: 'admin' }, { now: '2026-10-30T10:00:00.000Z' })
  const withFurniture = estimate.addTemplateItem(withSection, {
    sectionId: 'studio', kind: 'furniture', item: { id: 'rack', name: 'Стеллаж', price: '12 500,50', link: 'https://vendor.test/rack', customMade: true }
  })
  const withEquipment = estimate.addTemplateItem(withFurniture, {
    sectionId: 'studio', kind: 'equipment', item: { id: 'mic', name: 'Микрофон', price: 15000, link: 'javascript:alert(1)', customMade: true }
  })

  assert.equal(source.sections.length, 0)
  assert.equal(withSection.sections[0].subsections[0].items.length, 0)
  assert.equal(withFurniture.sections[0].subsections[0].items[0].price, 12500.5)
  assert.equal(withFurniture.sections[0].subsections[0].items[0].customMade, true)
  const equipmentRow = withEquipment.sections[0].subsections.find(item => item.kind === 'equipment').items[0]
  assert.equal(equipmentRow.customMade, false)
  assert.equal(equipmentRow.link, '')

  const changed = estimate.updateTemplateItem(withEquipment, { sectionId: 'studio', kind: 'furniture', itemId: 'rack', patch: { price: 13000 } })
  const removed = estimate.removeTemplateItem(changed, { sectionId: 'studio', kind: 'furniture', itemId: 'rack' })
  assert.equal(changed.sections[0].subsections[0].items[0].price, 13000)
  assert.equal(removed.sections[0].subsections[0].items.length, 0)
  assert.equal(withEquipment.sections[0].subsections[0].items[0].price, 12500.5)
})

test('generated settings identifiers are not reused after entries are removed', () => {
  let sections = estimate.normalizeSettings({ sections: [] })
  sections = estimate.addSection(sections, { name: 'Первый раздел', subsections: [] })
  const removedSectionId = sections.sections[0].id
  sections = estimate.removeSection(sections, { sectionId: removedSectionId })
  sections = estimate.addSection(sections, { name: 'Новый раздел', subsections: [] })
  assert.notEqual(sections.sections[0].id, removedSectionId)

  let settings = estimate.defaultSettings()
  const originalSubsectionId = settings.sections[0].subsections[0].id
  settings = estimate.removeSubsection(settings, { sectionId: 'cabinet', subsectionId: originalSubsectionId })
  settings = estimate.addSubsection(settings, { sectionId: 'cabinet', kind: 'furniture' })
  const replacementSubsection = settings.sections[0].subsections.find(item => item.kind === 'furniture')
  assert.notEqual(replacementSubsection.id, originalSubsectionId)

  settings = estimate.addTemplateItem(settings, {
    sectionId: 'cabinet', subsectionId: replacementSubsection.id, item: { name: 'Старая позиция', price: 100 }
  })
  const removedItemId = settings.sections[0].subsections.find(item => item.kind === 'furniture').items[0].id
  settings = estimate.removeTemplateItem(settings, {
    sectionId: 'cabinet', subsectionId: replacementSubsection.id, itemId: removedItemId
  })
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'cabinet', subsectionId: replacementSubsection.id, item: { name: 'Новая позиция', price: 200 }
  })
  const newItemId = settings.sections[0].subsections.find(item => item.kind === 'furniture').items[0].id
  assert.notEqual(newItemId, removedItemId)
})

test('estimate generation expands cabinet and restroom templates and takes property metrics automatically', () => {
  const source = project()
  const generated = estimate.generateEstimate(source, configuredSettings(), { cabinetsCount: 2, restroomsCount: 1, actorId: 'estimator' }, { now: '2026-10-30T11:00:00.000Z' })
  const value = estimate.estimateOf(generated)
  const totals = estimate.calculateEstimate(value)

  assert.deepEqual(value.sections.map(section => section.name), ['Кабинет 1', 'Кабинет 2', 'Санузел 1', 'Ресепшен'])
  assert.equal(value.area, 180)
  assert.equal(value.ceilingHeight, 3.4)
  assert.equal(value.cabinetsCount, 2)
  assert.equal(value.restroomsCount, 1)
  assert.equal(value.templateSignature, estimate.settingsSignature(configuredSettings()))
  assert.deepEqual(value.sections[0].subsections[0].items[0].templateSnapshot, {
    name: 'Стол администратора', price: 100000, quantity: 1, unit: 'шт.', link: 'https://vendor.test/desk', customMade: true
  })
  assert.equal(totals.subsections.furniture, 200000)
  assert.equal(totals.subsections.equipment, 50000)
  assert.equal(totals.subsections.finishing, 50000)
  assert.equal(totals.subsections.work, 30000)
  assert.equal(totals.total, 330000)
  assert.equal(source.phase0.spaceCard.work.repair.estimate, undefined)
})

test('every estimate metric and row can be changed without mutating the previous version', () => {
  const generated = estimate.generateEstimate(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 }, { now: '2026-10-30T11:00:00.000Z' })
  const cabinet = estimate.estimateOf(generated).sections[0]
  const furniture = cabinet.subsections.find(item => item.kind === 'furniture')
  const added = estimate.addEstimateRow(generated, {
    sectionId: cabinet.id, subsectionId: furniture.id,
    row: { id: 'chair', name: 'Кресло', price: 20000, quantity: 2, link: 'https://vendor.test/chair' }
  })
  const updated = estimate.updateEstimateRow(added, {
    sectionId: cabinet.id, subsectionId: furniture.id, itemId: 'chair', patch: { price: 22000, customMade: true }
  })
  const metrics = estimate.updateEstimate(updated, { patch: { area: 195, ceilingHeight: 3.7, cabinetsCount: 3, restroomsCount: 2 } })
  const removed = estimate.removeEstimateRow(metrics, { sectionId: cabinet.id, subsectionId: furniture.id, itemId: 'chair' })

  assert.equal(estimate.calculateEstimate(added).total, 195000)
  assert.equal(estimate.calculateEstimate(updated).total, 199000)
  assert.equal(estimate.estimateOf(metrics).area, 195)
  assert.equal(estimate.estimateOf(metrics).ceilingHeight, 3.7)
  assert.equal(estimate.estimateOf(metrics).cabinetsCount, 3)
  assert.equal(estimate.estimateOf(removed).sections[0].subsections[0].items.some(item => item.id === 'chair'), false)
  assert.equal(estimate.estimateOf(generated).sections[0].subsections[0].items.some(item => item.id === 'chair'), false)
})

test('removing a template estimate row records a project-level tombstone', () => {
  const generated = estimate.generateEstimate(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const cabinet = estimate.estimateOf(generated).sections[0]
  const furniture = cabinet.subsections.find(item => item.kind === 'furniture')
  const removed = estimate.removeEstimateRow(generated, {
    sectionId: cabinet.id, subsectionId: furniture.id, itemId: furniture.items[0].id
  })
  const removedFurniture = estimate.estimateOf(removed).sections[0].subsections.find(item => item.kind === 'furniture')

  assert.deepEqual(removedFurniture.removedTemplateItemIds, ['desk'])
})

test('all five documents are generated from the estimate and lease signing date', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), {
    cabinetsCount: 2,
    restroomsCount: 1,
    repairDurationDays: 40,
    paymentForm: 'Безналичный расчёт',
    actorId: 'estimator'
  }, { now: '2026-10-30T12:00:00.000Z' })
  const pack = estimate.documentsOf(generated)

  assert.equal(pack.startDate, '2026-11-03')
  assert.deepEqual(Object.keys(pack.documents), estimate.DOCUMENT_KINDS)
  assert.equal(pack.documents.customOrders.rows.length, 1)
  assert.equal(pack.documents.customOrders.rows[0].name, 'Стол администратора')
  assert.equal(pack.documents.customOrders.rows[0].quantity, 2)
  assert.equal(pack.documents.customOrders.rows[0].amount, 200000)
  assert.match(pack.documents.customOrders.rows[0].sourceKey, /^template:/)
  assert.equal(pack.documents.purchaseSpecification.rows.find(row => row.name === 'Экран').quantity, 2)
  assert.equal(pack.documents.fullEstimate.meta.area, 180)
  assert.equal(pack.documents.fullEstimate.meta.ceilingHeight, 3.4)
  assert.equal(pack.documents.fullEstimate.meta.total, 330000)
  assert.equal(pack.documents.repairRoadmap.rows[0].date, '2026-11-03')
  assert.equal(pack.documents.repairRoadmap.rows.at(-1).date, '2026-12-13')
  assert.equal(pack.documents.paymentSchedule.rows.reduce((sum, row) => sum + row.percent, 0), 100)
  assert.equal(pack.documents.paymentSchedule.rows.reduce((sum, row) => sum + row.amount, 0), 330000)
})

test('generated documents remain fully editable row by row', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const added = estimate.addDocumentRow(generated, {
    kind: 'repairRoadmap',
    row: { id: 'inspection', name: 'Промежуточная проверка', date: '2026-11-20', controlPoint: true }
  })
  const updated = estimate.updateDocumentRow(added, {
    kind: 'repairRoadmap', rowId: 'inspection', patch: { name: 'Проверка заказчика', date: '2026-11-21' }
  })
  const titled = estimate.updateDocument(updated, { kind: 'repairRoadmap', patch: { title: 'Дорожная карта ремонта' } })
  const removed = estimate.removeDocumentRow(titled, { kind: 'repairRoadmap', rowId: 'inspection' })

  assert.equal(estimate.documentsOf(added).documents.repairRoadmap.rows.find(row => row.id === 'inspection').name, 'Промежуточная проверка')
  assert.equal(estimate.documentsOf(updated).documents.repairRoadmap.rows.find(row => row.id === 'inspection').date, '2026-11-21')
  assert.equal(estimate.documentsOf(titled).documents.repairRoadmap.title, 'Дорожная карта ремонта')
  assert.equal(estimate.documentsOf(removed).documents.repairRoadmap.rows.some(row => row.id === 'inspection'), false)
  assert.equal(estimate.documentsOf(generated).documents.repairRoadmap.rows.some(row => row.id === 'inspection'), false)
})

test('generated procurement rows track manual overrides and deletion tombstones', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const specification = estimate.documentsOf(generated).documents.purchaseSpecification
  const sourceRow = specification.rows[0]
  assert.ok(sourceRow.sourceSnapshot)

  const updated = estimate.updateDocumentRow(generated, {
    kind: 'purchaseSpecification', rowId: sourceRow.id, patch: { name: 'Согласованная позиция' }
  })
  const updatedRow = estimate.documentsOf(updated).documents.purchaseSpecification.rows.find(row => row.id === sourceRow.id)
  assert.deepEqual(updatedRow.manualOverrides, ['name'])

  const removed = estimate.removeDocumentRow(updated, { kind: 'purchaseSpecification', rowId: sourceRow.id })
  assert.deepEqual(estimate.documentsOf(removed).documents.purchaseSpecification.meta.removedGeneratedRowIds, [sourceRow.id])
  assert.deepEqual(estimate.documentsOf(removed).documents.purchaseSpecification.meta.removedGeneratedRowKeys, [sourceRow.sourceKey])
})

test('generated procurement ids stay attached to template identity when settings order changes', () => {
  const settings = configuredSettings()
  const first = estimate.generateAll(project(), settings, { cabinetsCount: 2, restroomsCount: 1 })
  const firstRows = estimate.documentsOf(first).documents.purchaseSpecification.rows
  const desk = firstRows.find(row => row.name === 'Стол администратора')
  const screen = firstRows.find(row => row.name === 'Экран')

  const reordered = structuredClone(settings)
  const cabinet = reordered.sections.find(section => section.id === 'cabinet')
  const equipment = cabinet.subsections.find(subsection => subsection.kind === 'equipment')
  equipment.items.unshift({ id: 'lamp', name: 'Светильник', price: 5000, quantity: 1, unit: 'шт.' })
  const second = estimate.generateAll(project(), reordered, { cabinetsCount: 2, restroomsCount: 1 })
  const secondRows = estimate.documentsOf(second).documents.purchaseSpecification.rows
  const nextDesk = secondRows.find(row => row.name === 'Стол администратора')
  const nextScreen = secondRows.find(row => row.name === 'Экран')

  assert.equal(nextDesk.id, desk.id)
  assert.equal(nextDesk.sourceKey, desk.sourceKey)
  assert.equal(nextDesk.quantity, 2)
  assert.equal(nextScreen.id, screen.id)
  assert.equal(nextScreen.sourceKey, screen.sourceKey)
  assert.equal(nextScreen.quantity, 2)
})

test('estimate changes mark generated documents outdated until automatic regeneration', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const cabinet = estimate.estimateOf(generated).sections[0]
  const furniture = cabinet.subsections.find(item => item.kind === 'furniture')
  const changed = estimate.updateEstimateRow(generated, {
    sectionId: cabinet.id, subsectionId: furniture.id, itemId: furniture.items[0].id, patch: { price: 125000 }
  })
  assert.equal(estimate.documentsOf(changed).status, 'outdated')
  assert.equal(estimate.canAgreeDocuments(changed), false)
  const regenerated = estimate.generateDocuments(changed, {})
  assert.equal(estimate.documentsOf(regenerated).status, 'draft')
  assert.equal(estimate.documentsOf(regenerated).documents.fullEstimate.meta.total, 180000)
})

test('document agreement advances the repair and creates calendar control points immutably', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0, repairDurationDays: 30 })
  assert.equal(estimate.canAgreeDocuments(generated), true)
  const agreed = estimate.agreeDocuments(generated, { actorId: 'manager', responsible: 'Прораб', reminderMinutesBefore: 60 }, { now: '2026-11-01T09:00:00.000Z' })
  const repair = agreed.phase0.spaceCard.work.repair

  assert.equal(repair.stage, 'repair')
  assert.equal(repair.documentPack.status, 'agreed')
  assert.equal(repair.estimate.status, 'agreed')
  assert.equal(agreed.phase0.spaceCard.work.pipeline.status, 'repair_process')
  assert.equal(repair.transitions.at(-1).reason, 'documents_agreed')
  assert.equal(repair.calendarEvents.length, repair.documentPack.documents.repairRoadmap.rows.length)
  assert.equal(repair.calendarEvents[0].source, 'repair-control-point')
  assert.equal(repair.calendarEvents[0].startsAt, '2026-11-03T09:00:00+03:00')
  assert.equal(repair.calendarEvents[0].responsible, 'Прораб')
  assert.equal(generated.phase0.spaceCard.work.repair.stage, 'documents')
  assert.throws(() => estimate.updateDocumentRow(agreed, { kind: 'repairRoadmap', rowId: 'milestone-1', patch: { name: 'Изменение' } }), /уже согласованы/)
})

test('automatic documents require an estimate, a lease date and a 100 percent payment schedule', () => {
  assert.throws(() => estimate.generateDocuments(project(), {}), /смету ремонта/)
  assert.equal(estimate.canAgreeDocuments(project({ repair: { stage: 'documents', documentPack: { status: 'draft', documents: {} } } })), false)

  const withoutLease = project({ approval: { status: 'agreed', documents: { signedLease: { name: 'ДА.pdf' } } } })
  const generated = estimate.generateEstimate(withoutLease, configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  assert.throws(() => estimate.generateDocuments(generated, {}), /дату подписания/)
  assert.throws(() => estimate.generateDocuments(generated, { signedLeaseDate: '2026-11-03', paymentTerms: [{ name: 'Аванс', percent: 50 }] }), /100%/)
})

test('short repair durations keep all control points in chronological order', () => {
  for (const repairDurationDays of [1, 2, 3, 4]) {
    const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0, repairDurationDays })
    const dates = estimate.documentsOf(generated).documents.repairRoadmap.rows.map(row => row.date)
    assert.deepEqual([...dates].sort(), dates)
    assert.equal(dates[0], '2026-11-03')
  }
})

test('changing a roadmap control point updates its linked payment date', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const updated = estimate.updateDocumentRow(generated, {
    kind: 'repairRoadmap', rowId: 'milestone-3', patch: { date: '2026-11-28' }
  })
  const pack = estimate.documentsOf(updated)
  assert.equal(pack.documents.paymentSchedule.rows.find(row => row.milestoneId === 'milestone-3').date, '2026-11-28')
  assert.equal(pack.documents.repairRoadmap.rows.find(row => row.id === 'milestone-3').offsetDays, 25)
  const last = estimate.updateDocumentRow(updated, {
    kind: 'repairRoadmap', rowId: 'milestone-6', patch: { date: '2027-01-03' }
  })
  assert.equal(estimate.documentsOf(last).documents.repairRoadmap.meta.endDate, '2027-01-03')
})

test('agreement is blocked when edited payment shares or amounts no longer match the estimate', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const invalidPercent = estimate.updateDocumentRow(generated, {
    kind: 'paymentSchedule', rowId: 'payment-1', patch: { percent: 99 }
  })
  assert.equal(estimate.canAgreeDocuments(invalidPercent), false)

  const invalidAmount = estimate.updateDocumentRow(generated, {
    kind: 'paymentSchedule', rowId: 'payment-1', patch: { amount: 1 }
  })
  assert.equal(estimate.canAgreeDocuments(invalidAmount), false)
})

test('agreement is blocked for an empty zero-value estimate', () => {
  const generated = estimate.generateAll(project(), estimate.defaultSettings(), { cabinetsCount: 1, restroomsCount: 1 })
  assert.equal(estimate.documentsOf(generated).documents.fullEstimate.rows.length, 0)
  assert.equal(estimate.canAgreeDocuments(generated), false)
})

test('agreement requires the first roadmap point to match the signed lease date', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const invalid = estimate.updateDocumentRow(generated, {
    kind: 'repairRoadmap', rowId: 'milestone-1', patch: { date: '2026-11-04' }
  })
  assert.equal(estimate.canAgreeDocuments(invalid), false)
})

test('editable procurement rows keep amount and payment metadata consistent', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const specificationRow = estimate.documentsOf(generated).documents.purchaseSpecification.rows[0]
  const changedPrice = estimate.updateDocumentRow(generated, {
    kind: 'purchaseSpecification', rowId: specificationRow.id, patch: { price: 500, quantity: 3 }
  })
  assert.equal(estimate.documentsOf(changedPrice).documents.purchaseSpecification.rows[0].amount, 1500)
  const paymentRow = estimate.documentsOf(generated).documents.paymentSchedule.rows[0]
  const changedForm = estimate.updateDocumentRow(generated, {
    kind: 'paymentSchedule', rowId: paymentRow.id, patch: { paymentForm: 'Аккредитив' }
  })
  assert.equal(estimate.documentsOf(changedForm).documents.paymentSchedule.meta.paymentForm, 'Аккредитив')
})

test('zero quantity is preserved instead of silently returning to one', () => {
  const generated = estimate.generateEstimate(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const cabinet = estimate.estimateOf(generated).sections[0]
  const furniture = cabinet.subsections.find(item => item.kind === 'furniture')
  const changed = estimate.updateEstimateRow(generated, {
    sectionId: cabinet.id, subsectionId: furniture.id, itemId: furniture.items[0].id, patch: { quantity: 0 }
  })
  assert.equal(estimate.estimateOf(changed).sections[0].subsections[0].items[0].quantity, 0)
  assert.equal(estimate.calculateEstimate(changed).total, 55000)
})

test('repair documents cannot bypass approval or be regenerated after agreement', () => {
  const unsafe = project()
  delete unsafe.phase0.spaceCard.work.approval
  delete unsafe.phase0.spaceCard.work.repair
  assert.throws(() => estimate.generateAll(unsafe, configuredSettings(), { cabinetsCount: 1, restroomsCount: 0, startDate: '2026-11-03' }), /завершите согласование/)

  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const agreed = estimate.agreeDocuments(generated)
  assert.throws(() => estimate.generateDocuments(agreed, { startDate: '2026-11-03' }), /уже согласованы|уже завершена/)
  assert.throws(() => estimate.generateEstimate(agreed, configuredSettings(), { cabinetsCount: 2, restroomsCount: 0 }), /уже согласованы|уже завершена/)
})

test('agreement readiness requires an agreed approval even for a complete document pack', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const unsafe = structuredClone(generated)
  delete unsafe.phase0.spaceCard.work.approval

  assert.equal(estimate.canAgreeDocuments(generated), true)
  assert.equal(estimate.canAgreeDocuments(unsafe), false)
  assert.throws(() => estimate.agreeDocuments(unsafe), /актуальный комплект документов/)
})

test('roadmap add, update and removal keep order, metadata and linked payments consistent', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const added = estimate.addDocumentRow(generated, {
    kind: 'repairRoadmap',
    row: { id: 'extra-control', name: 'Дополнительная проверка', date: '2027-01-15', controlPoint: true }
  })
  const addedPack = estimate.documentsOf(added)
  const addedRoadmap = addedPack.documents.repairRoadmap
  assert.deepEqual(addedRoadmap.rows.map(row => row.date), [...addedRoadmap.rows.map(row => row.date)].sort())
  assert.equal(addedRoadmap.rows.at(-1).id, 'extra-control')
  assert.equal(addedRoadmap.meta.endDate, '2027-01-15')
  assert.equal(addedRoadmap.meta.durationDays, 73)
  assert.equal(estimate.canAgreeDocuments(added), true)

  const moved = estimate.updateDocumentRow(added, {
    kind: 'repairRoadmap', rowId: 'milestone-3', patch: { date: '2027-01-20' }
  })
  const movedPack = estimate.documentsOf(moved)
  assert.equal(movedPack.documents.repairRoadmap.rows.at(-1).id, 'milestone-3')
  assert.equal(movedPack.documents.repairRoadmap.meta.endDate, '2027-01-20')
  assert.equal(movedPack.documents.repairRoadmap.meta.durationDays, 78)
  assert.equal(movedPack.documents.paymentSchedule.rows.find(row => row.id === 'payment-2').date, '2027-01-20')
  assert.equal(estimate.canAgreeDocuments(moved), true)

  const removed = estimate.removeDocumentRow(moved, { kind: 'repairRoadmap', rowId: 'milestone-3' })
  const removedPack = estimate.documentsOf(removed)
  const detachedPayment = removedPack.documents.paymentSchedule.rows.find(row => row.id === 'payment-2')
  assert.equal(removedPack.documents.repairRoadmap.rows.at(-1).id, 'extra-control')
  assert.equal(removedPack.documents.repairRoadmap.meta.endDate, '2027-01-15')
  assert.equal(removedPack.documents.repairRoadmap.meta.durationDays, 73)
  assert.equal(detachedPayment.milestoneId, '')
  assert.equal(detachedPayment.date, '2027-01-20')
  assert.equal(estimate.canAgreeDocuments(removed), true)
})

test('manually changing a payment date detaches it from the automatic roadmap link', () => {
  const generated = estimate.generateAll(project(), configuredSettings(), { cabinetsCount: 1, restroomsCount: 0 })
  const changed = estimate.updateDocumentRow(generated, {
    kind: 'paymentSchedule', rowId: 'payment-2', patch: { date: '2026-12-01' }
  })
  const payment = estimate.documentsOf(changed).documents.paymentSchedule.rows.find(row => row.id === 'payment-2')

  assert.equal(payment.date, '2026-12-01')
  assert.equal(payment.milestoneId, '')
  assert.equal(estimate.canAgreeDocuments(changed), true)
})
