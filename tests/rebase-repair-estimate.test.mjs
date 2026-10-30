import test from 'node:test'
import assert from 'node:assert/strict'
import { rebaseRepairEstimate } from '../frontend/app/utils/rebaseRepairEstimate.js'

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
