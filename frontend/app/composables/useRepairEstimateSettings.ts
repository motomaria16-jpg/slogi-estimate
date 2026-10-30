type RepairEstimateScope = 'fixed' | 'cabinet' | 'restroom'
type RepairEstimateExportKind = 'estimate' | 'customFurniture'

const cloneValue = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function useRepairEstimateSettings() {
  const { ready, api } = useSlogiRuntime()
  const { show } = useToast()
  const draft = ref<any>(null)
  const loaded = ref(false)
  const saving = ref(false)
  const exporting = ref<RepairEstimateExportKind | ''>('')
  const conflict = ref('')
  const validationError = ref('')
  const baseSignature = ref('')
  const baseDraftSignature = ref('')

  function runtime() {
    const value = api()
    if (!value?.pro || !value?.repairEstimate) throw new Error('Настройки сметы ещё загружаются.')
    return value
  }

  function normalize(value: any) {
    return runtime().repairEstimate.normalizeSettings(value)
  }

  function contentSignature(value: any) {
    const normalized = normalize(value)
    return JSON.stringify({ schemaVersion: normalized.schemaVersion, sections: normalized.sections })
  }

  function draftSignature(value: any) {
    return JSON.stringify({ schemaVersion: value?.schemaVersion, sections: value?.sections || [] })
  }

  function isValidHttpUrl(value: unknown) {
    const link = String(value || '').trim()
    if (!link) return true
    try {
      const url = new URL(link)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch (_error) {
      return false
    }
  }

  function validateDraftRows() {
    for (const section of draft.value?.sections || []) {
      for (const subsection of section.subsections || []) {
        for (const [itemIndex, item] of (subsection.items || []).entries()) {
          const location = `Раздел «${section.name || 'Без названия'}», подраздел «${subsection.name || 'Без названия'}», строка ${itemIndex + 1}`
          if (!String(item.name || '').trim()) return `${location}: укажите название траты.`
          if (!isValidHttpUrl(item.link)) return `${location}: ссылка должна начинаться с http:// или https://.`
        }
      }
    }
    return ''
  }

  function load() {
    if (!ready.value) return
    const value = runtime()
    const state = value.pro.read()
    const source = state?.settings?.repairEstimateTemplate ?? value.repairEstimate.defaultSettings()
    draft.value = cloneValue(value.repairEstimate.normalizeSettings(source))
    baseSignature.value = contentSignature(source)
    baseDraftSignature.value = draftSignature(draft.value)
    conflict.value = ''
    validationError.value = ''
    loaded.value = true
  }

  const dirty = computed(() => {
    if (!loaded.value || !draft.value || !ready.value) return false
    try { return draftSignature(draft.value) !== baseDraftSignature.value } catch (_error) { return false }
  })

  const exporterAvailable = computed(() => {
    const exporter = api()?.repairDocumentsXlsx
    const fullEstimate = exporter?.exportFullEstimate || exporter?.makeFullEstimate
    const customFurniture = exporter?.exportCustomFurniture || exporter?.makeCustomFurniture
    return Boolean(fullEstimate && customFurniture && api()?.workflow?.download)
  })

  const exportHint = computed(() => {
    if (!ready.value) return 'Модули страницы ещё загружаются.'
    if (!exporterAvailable.value) return 'Модуль выгрузки Excel недоступен.'
    if (dirty.value) return 'Сначала сохраните изменения шаблона.'
    return ''
  })

  function applyMutation(name: string, command: Record<string, any>) {
    const value = runtime()
    const actorId = String(value.pro.actor?.()?.id || '')
    draft.value = value.repairEstimate[name](draft.value, { ...command, actorId })
    conflict.value = ''
    validationError.value = ''
  }

  function addSection(name: string, scope: RepairEstimateScope) {
    applyMutation('addSection', { name, scope, subsections: [] })
  }

  function removeSection(sectionId: string) {
    applyMutation('removeSection', { sectionId })
  }

  function addSubsection(sectionId: string, kind: string) {
    applyMutation('addSubsection', { sectionId, kind })
  }

  function removeSubsection(sectionId: string, subsectionId: string) {
    applyMutation('removeSubsection', { sectionId, subsectionId })
  }

  function addItem(sectionId: string, subsectionId: string, item: Record<string, any>) {
    applyMutation('addTemplateItem', { sectionId, subsectionId, item })
  }

  function removeItem(sectionId: string, subsectionId: string, itemId: string) {
    applyMutation('removeTemplateItem', { sectionId, subsectionId, itemId })
  }

  function reset() {
    load()
    show('Изменения отменены.')
  }

  function save() {
    if (saving.value || !draft.value) return false
    saving.value = true
    conflict.value = ''
    validationError.value = ''
    try {
      validationError.value = validateDraftRows()
      if (validationError.value) {
        show(validationError.value, 'error')
        return false
      }
      const value = runtime()
      const latest = value.pro.read()
      const latestSource = latest?.settings?.repairEstimateTemplate ?? value.repairEstimate.defaultSettings()
      const latestSignature = contentSignature(latestSource)
      if (latestSignature !== baseSignature.value) {
        conflict.value = 'Шаблон был изменён другим пользователем. Обновите страницу и повторите изменения.'
        show(conflict.value, 'error')
        return false
      }
      const actorId = String(value.pro.actor?.()?.id || '') || null
      const prepared = value.repairEstimate.normalizeSettings(draft.value)
      prepared.updatedAt = new Date().toISOString()
      prepared.updatedById = actorId
      const next = {
        ...latest,
        settings: { ...(latest.settings || {}), repairEstimateTemplate: prepared }
      }
      const saved = value.pro.write(next, 'repair-estimate-template-update')
      const persisted = saved?.settings?.repairEstimateTemplate ?? prepared
      draft.value = cloneValue(value.repairEstimate.normalizeSettings(persisted))
      baseSignature.value = contentSignature(persisted)
      baseDraftSignature.value = draftSignature(draft.value)
      show('Шаблон сметы сохранён.')
      return true
    } catch (reason) {
      show(reason instanceof Error ? reason.message : 'Не удалось сохранить шаблон сметы.', 'error')
      return false
    } finally {
      saving.value = false
    }
  }

  function materializedEstimate() {
    const value = runtime()
    const template = value.repairEstimate.normalizeSettings(draft.value)
    const sections = template.sections.map((section: any) => {
      const suffix = section.scope === 'fixed' ? '' : '-1'
      const name = String(section.name || 'Раздел').replace(/\{n\}/g, '1')
      return {
        ...cloneValue(section),
        id: `${section.id}${suffix}`,
        name,
        index: section.scope === 'fixed' ? null : 1,
        templateSectionId: section.id,
        subsections: section.subsections.map((subsection: any) => ({
          ...cloneValue(subsection),
          id: `${section.id}${suffix}-${subsection.kind}`,
          templateSubsectionId: subsection.id,
          items: subsection.items.map((item: any, index: number) => ({
            ...cloneValue(item),
            id: `${section.id}${suffix}-${subsection.kind}-${item.id || index + 1}`,
            templateItemId: item.id,
            quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1
          }))
        }))
      }
    })
    return value.repairEstimate.normalizeEstimate({
      status: 'draft',
      cabinetsCount: 1,
      restroomsCount: 1,
      area: null,
      ceilingHeight: null,
      sections
    })
  }

  async function exportExcel(kind: RepairEstimateExportKind) {
    if (exporting.value || dirty.value || !exporterAvailable.value) return
    exporting.value = kind
    try {
      const value = runtime()
      const estimate = materializedEstimate()
      const fullEstimate = value.repairDocumentsXlsx.exportFullEstimate || value.repairDocumentsXlsx.makeFullEstimate
      const customFurniture = value.repairDocumentsXlsx.exportCustomFurniture || value.repairDocumentsXlsx.makeCustomFurniture
      const result = kind === 'estimate'
        ? await fullEstimate(estimate, { source: 'settings' })
        : await customFurniture(estimate, { source: 'settings' })
      if (!result?.blob) throw new Error('Файл Excel не был сформирован.')
      value.workflow.download(result.blob, result.fileName || result.name || (kind === 'estimate' ? 'Шаблон сметы.xlsx' : 'Заказная мебель.xlsx'))
      show(kind === 'estimate' ? 'Смета выгружена в Excel.' : 'Список заказной мебели выгружен в Excel.')
    } catch (reason) {
      show(reason instanceof Error ? reason.message : 'Не удалось сформировать Excel.', 'error')
    } finally {
      exporting.value = ''
    }
  }

  watch(ready, value => { if (value && !loaded.value) load() }, { immediate: true })
  watch(draft, () => { if (validationError.value) validationError.value = '' }, { deep: true })

  return {
    draft,
    loaded,
    dirty,
    saving,
    exporting,
    conflict,
    validationError,
    exporterAvailable,
    exportHint,
    load,
    save,
    reset,
    addSection,
    removeSection,
    addSubsection,
    removeSubsection,
    addItem,
    removeItem,
    exportExcel
  }
}
