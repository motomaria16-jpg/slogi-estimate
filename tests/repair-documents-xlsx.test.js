'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const estimate = require('../repair-estimate.js')
const xlsx = require('../repair-documents-xlsx.js')

function project() {
  return {
    id: 'xlsx-project',
    address: 'Москва, Тестовая/улица, 1',
    phase0: {
      spaceCard: {
        id: 'xlsx-project',
        address: 'Москва, Тестовая/улица, 1',
        area: 123.5,
        ceilingHeight: 3.25,
        work: {
          status: 'closed',
          stage: 'repair',
          pipeline: { status: 'repair' },
          approval: { status: 'agreed', documents: { signedLease: { name: 'ДА.pdf', signedAt: '2026-11-03' } } },
          repair: { schemaVersion: 1, stage: 'documents', documents: [], transitions: [] }
        }
      }
    }
  }
}

function generatedProject() {
  let settings = estimate.defaultSettings()
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'cabinet', kind: 'furniture',
    item: { id: 'desk', name: 'Стол & стойка <ресепшен>', price: 100000.5, quantity: 2, unit: 'шт.', link: 'https://vendor.test/a?x=1&y=2', customMade: true }
  })
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'cabinet', kind: 'equipment',
    item: { id: 'screen', name: 'Экран', price: 25000, quantity: 1, link: 'https://vendor.test/screen' }
  })
  settings = estimate.addTemplateItem(settings, {
    sectionId: 'reception', kind: 'work', item: { id: 'work', name: 'Монтаж', price: 30000 }
  })
  return estimate.generateAll(project(), settings, {
    cabinetsCount: 2,
    restroomsCount: 1,
    repairDurationDays: 30,
    paymentForm: 'Безналичный расчёт'
  }, { now: '2026-10-30T12:00:00.000Z' })
}

async function unzipStore(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { eocd = index; break }
  }
  assert.ok(eocd >= 0, 'ZIP end-of-central-directory signature is present')
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const entries = new Map()
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50)
    const method = view.getUint16(offset + 10, true)
    const size = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength))
    assert.equal(method, 0, 'XLSX entries use dependency-free ZIP store')
    assert.equal(view.getUint32(localOffset, true), 0x04034b50)
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    entries.set(name, decoder.decode(bytes.slice(start, start + size)))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function assertWorkbook(result) {
  assert.ok(result.blob instanceof Blob)
  assert.equal(result.blob.type, xlsx.MIME_TYPE)
  assert.match(result.fileName, /\.xlsx$/)
  assert.doesNotMatch(result.fileName, /[<>:"/\\|?*]/)
  const entries = await unzipStore(result.blob)
  assert.ok(entries.has('[Content_Types].xml'))
  assert.ok(entries.has('_rels/.rels'))
  assert.ok(entries.has('xl/workbook.xml'))
  assert.ok(entries.has('xl/worksheets/sheet1.xml'))
  assert.ok(entries.has('xl/styles.xml'))
  assert.match(entries.get('[Content_Types].xml'), /spreadsheetml\.sheet\.main\+xml/)
  return entries
}

test('full estimate exports requested columns, escaped XML and numeric typed cells', async () => {
  const source = generatedProject()
  const result = xlsx.exportFullEstimate(source, { address: source.address })
  const entries = await assertWorkbook(result)
  const sheet = entries.get('xl/worksheets/sheet1.xml')

  for (const heading of ['Раздел', 'Подраздел', 'Название', 'Цена', 'Количество', 'Ед.', 'Стоимость', 'Ссылка', 'На заказ']) {
    assert.match(sheet, new RegExp(heading.replace('.', '\\.')))
  }
  assert.match(sheet, /Стол &amp; стойка &lt;ресепшен&gt;/)
  assert.match(sheet, /https:\/\/vendor\.test\/a\?x=1&amp;y=2/)
  assert.match(sheet, /<c r="D\d+" s="2"><v>100000\.5<\/v><\/c>/)
  assert.match(sheet, /<c r="E\d+" s="2"><v>2<\/v><\/c>/)
  assert.doesNotMatch(result.fileName, /\//)
})
test('custom furniture export contains only made-to-order furniture and aggregated quantities', async () => {
  const source = generatedProject()
  const result = xlsx.exportCustomFurniture(source)
  const entries = await assertWorkbook(result)
  const sheet = entries.get('xl/worksheets/sheet1.xml')

  assert.match(sheet, /Список заказных позиций/)
  assert.match(sheet, /Стол &amp; стойка/)
  assert.match(sheet, /<c r="E\d+" s="2"><v>4<\/v><\/c>/)
  assert.doesNotMatch(sheet, />Экран</)
  assert.match(sheet, />Да</)
})

test('every automatic repair document exports as a readable XLSX workbook', async () => {
  const source = generatedProject()
  const expected = {
    customOrders: 'Стол &amp; стойка',
    repairRoadmap: 'Начало ремонта',
    purchaseSpecification: 'Экран',
    paymentSchedule: 'Аванс',
    fullEstimate: 'Монтаж'
  }

  for (const kind of xlsx.DOCUMENT_KINDS) {
    const result = xlsx.exportDocument(source, kind, { fileName: `Документ:${kind}?` })
    const entries = await assertWorkbook(result)
    assert.match(entries.get('xl/worksheets/sheet1.xml'), new RegExp(expected[kind]))
    assert.doesNotMatch(result.fileName, /[:?]/)
  }
})

test('payment schedule keeps money and percentages as numbers', async () => {
  const result = xlsx.exportDocument(generatedProject(), 'paymentSchedule')
  const entries = await assertWorkbook(result)
  const sheet = entries.get('xl/worksheets/sheet1.xml')

  assert.match(sheet, /Доля, %/)
  assert.match(sheet, /<c r="C\d+" s="2"><v>30<\/v><\/c>/)
  assert.match(sheet, /<c r="D\d+" s="2"><v>[^<]+<\/v><\/c>/)
})

test('a generated document can be exported directly without the project wrapper', async () => {
  const document = estimate.documentsOf(generatedProject()).documents.repairRoadmap
  const result = xlsx.exportDocument(document, { address: 'Объект/1' })
  const entries = await assertWorkbook(result)

  assert.match(entries.get('xl/workbook.xml'), /ДК ремонта/)
  assert.match(entries.get('xl/worksheets/sheet1.xml'), /Приёмка помещения/)
})

test('document export preserves manual edits instead of recalculating project rows', async () => {
  const source = generatedProject()
  const row = estimate.documentsOf(source).documents.customOrders.rows[0]
  const edited = estimate.updateDocumentRow(source, {
    kind: 'customOrders', rowId: row.id, patch: { name: 'Стойка по индивидуальному проекту' }
  })
  const result = xlsx.exportDocument(edited, 'customOrders')
  const entries = await assertWorkbook(result)
  const sheet = entries.get('xl/worksheets/sheet1.xml')

  assert.match(sheet, /Стойка по индивидуальному проекту/)
  assert.doesNotMatch(sheet, /Стол &amp; стойка/)
})
