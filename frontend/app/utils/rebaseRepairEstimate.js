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

function mergeItems(generatedItems, currentItems) {
  const remaining = [...list(currentItems)]
  const items = list(generatedItems).map(generated => {
    const index = matchingIndex(remaining, generated, [
      (current, next) => Boolean(current?.id && next?.id && current.id === next.id),
      (current, next) => Boolean(current?.templateItemId && next?.templateItemId && current.templateItemId === next.templateItemId)
    ])
    if (index < 0) return { ...generated }
    const [current] = remaining.splice(index, 1)
    return {
      ...generated,
      ...current,
      id: generated.id,
      ...(generated.templateItemId ? { templateItemId: generated.templateItemId } : {})
    }
  })

  // Rows without a templateItemId were added manually. Template rows can also
  // remain unmatched after settings changed; keeping them makes regeneration
  // lossless and lets the user remove them explicitly from this estimate.
  return [...items, ...remaining.map(item => ({ ...item }))]
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
    return {
      ...(current || {}),
      ...generated,
      items: mergeItems(generated.items, current?.items)
    }
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
