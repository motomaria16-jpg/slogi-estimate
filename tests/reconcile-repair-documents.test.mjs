import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileRepairDocumentPack } from '../frontend/app/utils/reconcileRepairDocuments.js'

const row = (id, price, extra = {}) => ({
  id, name: `Позиция ${id}`, price, quantity: 1, amount: price, unit: 'шт.',
  sourceSnapshot: { name: `Позиция ${id}`, price, quantity: 1, amount: price, unit: 'шт.' },
  ...extra
})

test('document refresh keeps titles, manual rows and explicit overrides while syncing estimate values', () => {
  const previous = {
    documents: {
      purchaseSpecification: {
        kind: 'purchaseSpecification', title: 'Моя спецификация',
        rows: [
          { ...row('spec-1', 100), name: 'Согласованное название', manualOverrides: ['name'] },
          row('spec-2', 200),
          { id: 'purchaseSpecification-row-3', name: 'Ручная строка', price: 50, quantity: 2, amount: 100, unit: 'шт.' }
        ],
        meta: { removedGeneratedRowIds: ['spec-2'] }
      }
    }
  }
  const generated = {
    status: 'draft',
    documents: {
      purchaseSpecification: {
        kind: 'purchaseSpecification', title: 'Полная спецификация',
        rows: [row('spec-1', 120), row('spec-2', 220), row('spec-3', 300)], meta: { total: 640 }
      }
    }
  }

  const result = reconcileRepairDocumentPack(generated, previous)
  const document = result.documents.purchaseSpecification
  assert.equal(document.title, 'Моя спецификация')
  assert.equal(document.rows.find(item => item.id === 'spec-1').name, 'Согласованное название')
  assert.equal(document.rows.find(item => item.id === 'spec-1').price, 120)
  assert.equal(document.rows.some(item => item.id === 'spec-2'), false)
  assert.equal(document.rows.some(item => item.id === 'spec-3'), true)
  assert.equal(document.rows.some(item => item.id === 'purchaseSpecification-row-3'), true)
  assert.deepEqual(document.meta.removedGeneratedRowIds, ['spec-2'])
})

test('legacy generated document rows use new estimate values deterministically', () => {
  const previous = {
    documents: {
      customOrders: { kind: 'customOrders', title: 'Заказная мебель', rows: [{ id: 'spec-1', name: 'Старое значение', price: 999 }] }
    }
  }
  const generated = {
    documents: {
      customOrders: { kind: 'customOrders', title: 'Список заказных позиций', rows: [row('spec-1', 150)] }
    }
  }
  const result = reconcileRepairDocumentPack(generated, previous)

  assert.equal(result.documents.customOrders.title, 'Заказная мебель')
  assert.equal(result.documents.customOrders.rows[0].name, 'Позиция spec-1')
  assert.equal(result.documents.customOrders.rows[0].price, 150)
})

test('stable source keys keep overrides and deletion tombstones attached when generated ids shift', () => {
  const deskKey = 'template:cabinet:cabinet-furniture:desk'
  const screenKey = 'template:cabinet:cabinet-equipment:screen'
  const previous = {
    documents: {
      purchaseSpecification: {
        kind: 'purchaseSpecification', title: 'Спецификация',
        rows: [
          { ...row('spec-old-desk', 100, { sourceKey: deskKey }), name: 'Согласованный стол', manualOverrides: ['name'] }
        ],
        meta: { removedGeneratedRowIds: ['spec-old-screen'], removedGeneratedRowKeys: [screenKey] }
      }
    }
  }
  const generated = {
    documents: {
      purchaseSpecification: {
        kind: 'purchaseSpecification', title: 'Полная спецификация',
        rows: [
          row('spec-new-first', 50, { sourceKey: 'template:cabinet:cabinet-equipment:lamp' }),
          row('spec-new-desk', 120, { sourceKey: deskKey }),
          row('spec-new-screen', 220, { sourceKey: screenKey })
        ],
        meta: { total: 390 }
      }
    }
  }

  const document = reconcileRepairDocumentPack(generated, previous).documents.purchaseSpecification
  const desk = document.rows.find(item => item.sourceKey === deskKey)
  assert.equal(desk.id, 'spec-new-desk')
  assert.equal(desk.name, 'Согласованный стол')
  assert.equal(desk.price, 120)
  assert.equal(document.rows.some(item => item.sourceKey === screenKey), false)
  assert.equal(document.rows.some(item => item.sourceKey.endsWith(':lamp')), true)
  assert.deepEqual(document.meta.removedGeneratedRowKeys, [screenKey])
})
