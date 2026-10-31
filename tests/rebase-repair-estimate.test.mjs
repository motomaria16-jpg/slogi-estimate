import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { rebaseRepairEstimate } from '../frontend/app/utils/rebaseRepairEstimate.js'

const require = createRequire(import.meta.url)
const estimate = require('../repair-estimate.js')

function cabinet(id, items = []) {
  return {
    id,
    templateSectionId: 'cabinet',
    scope: 'cabinet',
    index: Number(id.split('-').at(-1)),
    name: `Кабинет ${id.split('-').at(-1)}`,
    subsections: [{
      id: `${id}-furniture`,
      templateSubsectionId: 'cabinet-furniture',
      kind: 'furniture',
      name: 'Мебель',
      items
    }]
  }
}

const generatedDesk = id => ({
  id: `${id}-furniture-desk`,
  templateItemId: 'desk',
  name: 'Стол',
  price: 10000,
  quantity: 1,
  unit: 'шт.',
  link: ''
})

const generatedTemplateDesk = (id, patch = {}) => {
  const row = { ...generatedDesk(id), ...patch }
  return {
    ...row,
    templateSnapshot: {
      name: row.name,
      price: row.price,
      quantity: row.quantity,
      unit: row.unit,
      link: row.link,
      customMade: Boolean(row.customMade)
    }
  }
}

test('room-count regeneration preserves edited values and manually added estimate rows', () => {
  const current = {
    cabinetsCount: 1,
    restroomsCount: 0,
    sections: [cabinet('cabinet-1', [
      { ...generatedDesk('cabinet-1'), price: 27500, link: 'https://vendor.test/edited' },
      { id: 'manual-chair', name: 'Кресло руководителя', price: 18000, quantity: 2, link: 'https://vendor.test/chair' }
    ])]
  }
  const generated = {
    cabinetsCount: 2,
    restroomsCount: 0,
    sections: [
      cabinet('cabinet-1', [generatedDesk('cabinet-1')]),
      cabinet('cabinet-2', [generatedDesk('cabinet-2')])
    ]
  }

  const rebased = rebaseRepairEstimate(generated, current)
  const firstRows = rebased.sections[0].subsections[0].items

  assert.equal(rebased.cabinetsCount, 2)
  assert.equal(firstRows.find(row => row.templateItemId === 'desk').price, 27500)
  assert.equal(firstRows.find(row => row.templateItemId === 'desk').link, 'https://vendor.test/edited')
  assert.equal(firstRows.find(row => row.id === 'manual-chair').quantity, 2)
  assert.equal(rebased.sections[1].subsections[0].items[0].price, 10000)
  assert.equal(current.sections.length, 1)
  assert.equal(generated.sections[0].subsections[0].items.length, 1)
})

test('temporarily removed room instances are archived and restored without data loss', () => {
  const current = {
    cabinetsCount: 2,
    sections: [
      cabinet('cabinet-1', [generatedDesk('cabinet-1')]),
      cabinet('cabinet-2', [{ ...generatedDesk('cabinet-2'), price: 42000, link: 'https://vendor.test/custom' }])
    ]
  }
  const reduced = rebaseRepairEstimate({ cabinetsCount: 1, sections: [cabinet('cabinet-1', [generatedDesk('cabinet-1')])] }, current)

  assert.equal(reduced.sections.length, 1)
  assert.equal(reduced.archivedSections.length, 1)
  assert.equal(reduced.archivedSections[0].id, 'cabinet-2')

  const restored = rebaseRepairEstimate({
    cabinetsCount: 2,
    sections: [cabinet('cabinet-1', [generatedDesk('cabinet-1')]), cabinet('cabinet-2', [generatedDesk('cabinet-2')])]
  }, reduced)

  const restoredDesk = restored.sections[1].subsections[0].items[0]
  assert.equal(restoredDesk.price, 42000)
  assert.equal(restoredDesk.link, 'https://vendor.test/custom')
  assert.equal(restored.archivedSections, undefined)
})

test('template updates flow through while explicit estimate overrides remain intact', () => {
  const original = generatedTemplateDesk('cabinet-1')
  const current = {
    cabinetsCount: 1,
    sections: [cabinet('cabinet-1', [{ ...original, price: 27500 }])]
  }
  const updatedTemplate = generatedTemplateDesk('cabinet-1', {
    name: 'Стол администратора', price: 12000, link: 'https://vendor.test/new-desk'
  })
  const rebased = rebaseRepairEstimate({
    cabinetsCount: 1,
    sections: [cabinet('cabinet-1', [updatedTemplate])]
  }, current)
  const row = rebased.sections[0].subsections[0].items[0]

  assert.equal(row.name, 'Стол администратора')
  assert.equal(row.link, 'https://vendor.test/new-desk')
  assert.equal(row.price, 27500)
  assert.deepEqual(row.templateSnapshot, updatedTemplate.templateSnapshot)
})

test('legacy estimates migrate conservatively while still receiving new settings rows', () => {
  const legacyDesk = generatedDesk('cabinet-1')
  const newChair = generatedTemplateDesk('cabinet-1', {
    id: 'cabinet-1-furniture-chair', templateItemId: 'chair', name: 'Кресло', price: 8000
  })
  const firstTemplate = generatedTemplateDesk('cabinet-1', { price: 12000 })
  const firstSync = rebaseRepairEstimate({
    sections: [cabinet('cabinet-1', [firstTemplate, newChair])]
  }, { sections: [cabinet('cabinet-1', [legacyDesk])] })
  const firstRows = firstSync.sections[0].subsections[0].items

  assert.equal(firstRows.find(item => item.templateItemId === 'desk').price, 10000)
  assert.equal(firstRows.find(item => item.templateItemId === 'chair').price, 8000)

  const secondTemplate = generatedTemplateDesk('cabinet-1', { price: 14000 })
  const secondSync = rebaseRepairEstimate({
    sections: [cabinet('cabinet-1', [secondTemplate, newChair])]
  }, firstSync)

  assert.equal(secondSync.sections[0].subsections[0].items.find(item => item.templateItemId === 'desk').price, 10000)
})

test('removed template rows are archived and restored without duplicating active documents', () => {
  const desk = generatedTemplateDesk('cabinet-1')
  const lamp = generatedTemplateDesk('cabinet-1', { id: 'cabinet-1-furniture-lamp', templateItemId: 'lamp', name: 'Лампа', price: 3000 })
  const manual = { id: 'manual-chair', name: 'Кресло', price: 18000, quantity: 1, unit: 'шт.', link: '' }
  const current = { cabinetsCount: 1, sections: [cabinet('cabinet-1', [desk, { ...lamp, price: 4500 }, manual])] }

  const withoutLamp = rebaseRepairEstimate({
    cabinetsCount: 1,
    sections: [cabinet('cabinet-1', [desk])]
  }, current)
  const subsection = withoutLamp.sections[0].subsections[0]
  assert.deepEqual(subsection.items.map(item => item.id), ['cabinet-1-furniture-desk', 'manual-chair'])
  assert.deepEqual(subsection.archivedItems.map(item => item.id), ['cabinet-1-furniture-lamp'])

  const restored = rebaseRepairEstimate({
    cabinetsCount: 1,
    sections: [cabinet('cabinet-1', [desk, lamp])]
  }, withoutLamp)
  const restoredSubsection = restored.sections[0].subsections[0]
  assert.equal(restoredSubsection.items.filter(item => item.templateItemId === 'lamp').length, 1)
  assert.equal(restoredSubsection.items.find(item => item.templateItemId === 'lamp').price, 4500)
  assert.equal(restoredSubsection.archivedItems, undefined)
})

test('a user-deleted template row stays deleted after template synchronization', () => {
  const desk = generatedTemplateDesk('cabinet-1')
  const current = {
    cabinetsCount: 1,
    sections: [cabinet('cabinet-1', [])]
  }
  current.sections[0].subsections[0].removedTemplateItemIds = ['desk']

  const rebased = rebaseRepairEstimate({
    cabinetsCount: 1,
    sections: [cabinet('cabinet-1', [desk])]
  }, current)

  assert.equal(rebased.sections[0].subsections[0].items.some(item => item.templateItemId === 'desk'), false)
  assert.deepEqual(rebased.sections[0].subsections[0].removedTemplateItemIds, ['desk'])
})

test('a newly added settings row is not hidden by a removed row tombstone', () => {
  let settings = estimate.defaultSettings()
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'cabinet', kind: 'furniture', item: { name: 'Старая позиция', price: 10000 }
  })
  const oldItemId = settings.sections[0].subsections.find(item => item.kind === 'furniture').items[0].id
  settings = estimate.removeTemplateItem(settings, { sectionId: 'cabinet', kind: 'furniture', itemId: oldItemId })
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'cabinet', kind: 'furniture', item: { name: 'Новая позиция', price: 12000 }
  })
  const newItem = settings.sections[0].subsections.find(item => item.kind === 'furniture').items[0]
  assert.notEqual(newItem.id, oldItemId)

  const generated = generatedTemplateDesk('cabinet-1', {
    id: `cabinet-1-furniture-${newItem.id}`,
    templateItemId: newItem.id,
    name: newItem.name,
    price: newItem.price
  })
  const current = { sections: [cabinet('cabinet-1', [])] }
  current.sections[0].subsections[0].removedTemplateItemIds = [oldItemId]
  const rebased = rebaseRepairEstimate({ sections: [cabinet('cabinet-1', [generated])] }, current)

  assert.equal(rebased.sections[0].subsections[0].items[0].templateItemId, newItem.id)
  assert.equal(rebased.sections[0].subsections[0].items[0].name, 'Новая позиция')
})
