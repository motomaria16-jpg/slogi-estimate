function list(value) {
  return Array.isArray(value) ? value : []
}

function uniqueSections(sections) {
  const result = []
  const seen = new Set()
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue
    const key = String(section.id || `${section.templateSectionId || ''}:${section.index ?? ''}`)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(section)
  }
  return result
}

function matchingIndex(items, generated, matchers) {
  return items.findIndex(current => matchers.some(matcher => matcher(current, generated)))
}

const templateFields = ['name', 'price', 'quantity', 'unit', 'link', 'customMade']

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function mergeMatchedItem(generated, current) {
  const previousTemplate = current?.templateSnapshot
  if (!previousTemplate || typeof previousTemplate !== 'object') {
    // Legacy estimates have no baseline that lets us distinguish a historical
    // template value from a manual project override. The deterministic safe
    // migration policy treats existing legacy values as project overrides:
    // additions from Settings still arrive, while no stored value is lost.
    // The new snapshot makes all newly generated rows field-reconcilable.
    return {
      ...generated,
      ...current,
      id: generated.id,
      ...(generated.templateItemId ? { templateItemId: generated.templateItemId } : {}),
      ...(generated.templateSnapshot ? { templateSnapshot: { ...generated.templateSnapshot } } : {})
    }
  }

  const merged = { ...current, ...generated }
  for (const field of templateFields) {
    if (!sameValue(current?.[field], previousTemplate[field])) merged[field] = current[field]
  }
  merged.id = generated.id
  if (generated.templateItemId) merged.templateItemId = generated.templateItemId
  if (generated.templateSnapshot) merged.templateSnapshot = { ...generated.templateSnapshot }
  return merged
}

function mergeItems(generatedItems, currentItems, archivedItems, removedTemplateItemIds) {
  const remaining = [...list(currentItems), ...list(archivedItems)]
  const removed = new Set(list(removedTemplateItemIds).map(value => String(value)))
  const items = list(generatedItems).filter(generated => !removed.has(String(generated?.templateItemId || ''))).map(generated => {
    const index = matchingIndex(remaining, generated, [
      (current, next) => Boolean(current?.templateItemId && next?.templateItemId && current.templateItemId === next.templateItemId),
      (current, next) => Boolean(current?.id && next?.id && current.id === next.id && Boolean(current?.templateItemId) === Boolean(next?.templateItemId))
    ])
    if (index < 0) return { ...generated }
    const [current] = remaining.splice(index, 1)
    return mergeMatchedItem(generated, current)
  })

  // Manually added rows remain active. Template rows removed in Settings are
  // archived, so they neither disappear irreversibly nor duplicate documents.
  const manualItems = remaining.filter(item => !item?.templateItemId).map(item => ({ ...item }))
  const nextArchivedItems = remaining.filter(item => item?.templateItemId).map(item => ({ ...item }))
  return nextArchivedItems.length
    ? { items: [...items, ...manualItems], archivedItems: nextArchivedItems }
    : { items: [...items, ...manualItems] }
}

function mergeSubsections(generatedSection, currentSection) {
  const candidates = [
    ...list(currentSection?.subsections),
    ...list(currentSection?.archivedSubsections)
  ]
  const used = new Set()
  const subsections = list(generatedSection?.subsections).map(generated => {
    const index = matchingIndex(candidates, generated, [
      (current, next) => Boolean(current?.id && next?.id && current.id === next.id),
      (current, next) => Boolean(current?.templateSubsectionId && next?.templateSubsectionId && current.templateSubsectionId === next.templateSubsectionId),
      (current, next) => Boolean(current?.kind && next?.kind && current.kind === next.kind)
    ])
    const current = index >= 0 ? candidates[index] : null
    if (index >= 0) used.add(index)
    const mergedItems = mergeItems(generated.items, current?.items, current?.archivedItems, current?.removedTemplateItemIds)
    const merged = {
      ...(current || {}),
      ...generated,
      ...mergedItems
    }
    if (!Object.prototype.hasOwnProperty.call(mergedItems, 'archivedItems')) delete merged.archivedItems
    return merged
  })

  const archivedSubsections = candidates
    .filter((_, index) => !used.has(index))
    .map(subsection => ({ ...subsection }))

  return archivedSubsections.length ? { subsections, archivedSubsections } : { subsections }
}

function sectionMatches(current, generated) {
  if (current?.id && generated?.id && current.id === generated.id) return true
  return Boolean(
    current?.templateSectionId
    && generated?.templateSectionId
    && current.templateSectionId === generated.templateSectionId
    && String(current.index ?? '') === String(generated.index ?? '')
  )
}

/**
 * Rebase an edited estimate onto a newly generated room structure.
 *
 * Generated sections remain authoritative for the requested cabinet/restroom
 * count, while existing row values and manually added rows are retained.
 * Removed room instances are archived in the estimate so decreasing and later
 * increasing a count does not silently discard the user's work.
 */
export function rebaseRepairEstimate(generatedEstimate, currentEstimate) {
  if (!generatedEstimate || !currentEstimate) return generatedEstimate

  const candidates = uniqueSections([
    ...list(currentEstimate.sections),
    ...list(currentEstimate.archivedSections)
  ])
  const used = new Set()
  const sections = list(generatedEstimate.sections).map(generated => {
    const index = candidates.findIndex(current => sectionMatches(current, generated))
    const current = index >= 0 ? candidates[index] : null
    if (index >= 0) used.add(index)
    const merged = mergeSubsections(generated, current)
    return {
      ...(current || {}),
      ...generated,
      ...merged
    }
  })

  const archivedSections = candidates
    .filter((_, index) => !used.has(index))
    .map(section => ({ ...section }))

  const result = {
    ...currentEstimate,
    ...generatedEstimate,
    sections
  }
  if (archivedSections.length) result.archivedSections = archivedSections
  else delete result.archivedSections
  return result
}
