const syncedEstimateKinds = new Set(['customOrders', 'purchaseSpecification'])
const snapshotFields = ['name', 'price', 'quantity', 'unit', 'amount', 'link', 'customMade', 'sectionId', 'sectionName', 'subsectionId', 'subsectionKind', 'subsectionName', 'sections']

function list(value) {
  return Array.isArray(value) ? value : []
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function rowOverrides(current) {
  const explicit = new Set(list(current?.manualOverrides).map(String))
  const baseline = current?.sourceSnapshot
  if (baseline && typeof baseline === 'object') {
    for (const field of snapshotFields) {
      if (Object.prototype.hasOwnProperty.call(baseline, field) && !sameValue(current?.[field], baseline[field])) explicit.add(field)
    }
  }
  if (explicit.has('price') || explicit.has('quantity')) explicit.add('amount')
  return explicit
}

function mergeGeneratedRow(generated, current) {
  if (!current) return clone(generated)
  const merged = { ...clone(current), ...clone(generated) }
  for (const field of rowOverrides(current)) {
    if (Object.prototype.hasOwnProperty.call(current, field)) merged[field] = clone(current[field])
  }
  merged.id = generated.id
  if (generated.sourceKey) merged.sourceKey = generated.sourceKey
  if (generated.sourceSnapshot) merged.sourceSnapshot = clone(generated.sourceSnapshot)
  const overrides = Array.from(rowOverrides(current))
  if (overrides.length) merged.manualOverrides = overrides
  else delete merged.manualOverrides
  return merged
}

function looksLikeLegacyGeneratedRow(row) {
  return /^spec-\d+$/.test(String(row?.id || ''))
}

function sourceKey(row) {
  return String(row?.sourceKey || '').trim()
}

function reconcileEstimateDocument(generated, previous) {
  const previousRows = list(previous?.rows)
  const previousById = new Map(previousRows.map(row => [String(row?.id || ''), row]))
  const previousBySourceKey = new Map(previousRows.filter(row => sourceKey(row)).map(row => [sourceKey(row), row]))
  const removedIds = new Set(list(previous?.meta?.removedGeneratedRowIds).map(String))
  const removedSourceKeys = new Set(list(previous?.meta?.removedGeneratedRowKeys).map(String))
  const matchedRows = new Set()
  const rows = list(generated?.rows)
    .filter(row => !removedIds.has(String(row?.id || '')) && !removedSourceKeys.has(sourceKey(row)))
    .map(row => {
      const id = String(row?.id || '')
      const key = sourceKey(row)
      const current = (key && previousBySourceKey.get(key)) || previousById.get(id)
      if (current) matchedRows.add(current)
      return mergeGeneratedRow(row, current)
    })

  // A row added directly inside a document has no source snapshot and uses a
  // document-specific id. Old generated `spec-N` rows are intentionally not
  // appended because they cannot be distinguished from obsolete source rows.
  for (const row of previousRows) {
    if (matchedRows.has(row) || row?.sourceSnapshot || looksLikeLegacyGeneratedRow(row)) continue
    rows.push(clone(row))
  }

  const tombstoneMeta = {}
  if (removedIds.size) tombstoneMeta.removedGeneratedRowIds = Array.from(removedIds)
  if (removedSourceKeys.size) tombstoneMeta.removedGeneratedRowKeys = Array.from(removedSourceKeys)

  return {
    ...clone(generated),
    title: String(previous?.title || '').trim() || generated.title,
    rows,
    meta: { ...(clone(generated?.meta) || {}), ...tombstoneMeta }
  }
}

/**
 * Keeps user-authored document details while refreshing estimate-derived rows.
 * Roadmap and payment rows are already passed back into the generator by the
 * caller; this layer preserves titles, manual procurement rows and overrides.
 */
export function reconcileRepairDocumentPack(generatedPack, previousPack) {
  if (!generatedPack || !previousPack) return generatedPack
  const result = clone(generatedPack)
  for (const [kind, generated] of Object.entries(result.documents || {})) {
    const previous = previousPack?.documents?.[kind]
    if (!previous) continue
    result.documents[kind] = syncedEstimateKinds.has(kind)
      ? reconcileEstimateDocument(generated, previous)
      : { ...generated, title: String(previous.title || '').trim() || generated.title }
  }
  return result
}
