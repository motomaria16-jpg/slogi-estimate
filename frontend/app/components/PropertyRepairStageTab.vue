<script setup lang="ts">
import { formatDate, projectCard, projectWork } from '~/utils/format'
import { rebaseRepairEstimate } from '~/utils/rebaseRepairEstimate.js'

const props = defineProps<{ project: any; section: 'documents' | 'repair' | 'handover' }>()
const emit = defineEmits<{ changed: [project: any]; ready: [ready: boolean]; agreed: [project: any] }>()
const { ready: runtimeReady, api } = useSlogiRuntime()
const { show } = useToast()

const currentProject = ref<any>(props.project)
const busy = ref(false)
const exporting = ref('')
const activeDocumentKind = ref('customOrders')
const autoGeneratingFor = ref('')
const actor = computed(() => api()?.pro?.actor?.() || { id: 'workspace-member', name: 'Специалист' })
const setup = reactive({
  cabinetsCount: 1,
  restroomsCount: 1,
  area: '' as number | string,
  ceilingHeight: '' as number | string,
  startDate: '',
  repairDurationDays: 60,
  paymentForm: 'Безналичный расчёт'
})
const newEstimateRows = reactive<Record<string, any>>({})

const documentDefinitions = [
  { kind: 'customOrders', label: 'Заказные позиции', fullLabel: 'Список заказных позиций' },
  { kind: 'repairRoadmap', label: 'ДК ремонта', fullLabel: 'ДК ремонта' },
  { kind: 'purchaseSpecification', label: 'Спецификация', fullLabel: 'Полная спецификация для закупок' },
  { kind: 'paymentSchedule', label: 'Платежи', fullLabel: 'График и форма платежей' },
  { kind: 'fullEstimate', label: 'Полная смета', fullLabel: 'Полная смета с ремонтом и всеми тратами' }
] as const

const work = computed(() => projectWork(currentProject.value))
const repair = computed(() => work.value?.repair || {})
const repairEstimateApi = computed(() => api()?.repairEstimate || null)
const estimate = computed(() => repairEstimateApi.value?.estimateOf?.(currentProject.value) || null)
const documentPack = computed(() => repairEstimateApi.value?.documentsOf?.(currentProject.value) || null)
const selectedDocument = computed(() => documentPack.value?.documents?.[activeDocumentKind.value] || null)
const completedDocuments = computed(() => documentDefinitions.filter(item => documentPack.value?.documents?.[item.kind]).length)
const documentsAgreed = computed(() => documentPack.value?.status === 'agreed')
const canEditDocuments = computed(() => !documentsAgreed.value && repair.value?.stage === 'documents')
const canAgree = computed(() => Boolean(repairEstimateApi.value?.canAgreeDocuments?.(currentProject.value)))
const estimateSummary = computed(() => estimate.value && repairEstimateApi.value?.calculateEstimate
  ? repairEstimateApi.value.calculateEstimate(estimate.value)
  : { total: 0, sections: [], subsections: {} })

const sectionMeta = computed(() => ({
  documents: {
    title: 'Документы для ремонта',
    badge: completedDocuments.value ? `${completedDocuments.value} из ${documentDefinitions.length} сформировано` : 'Формирование',
    note: documentsAgreed.value
      ? 'Комплект согласован. Контрольные точки добавлены в календарь.'
      : 'Комплект формируется автоматически из шаблона сметы и данных помещения.'
  },
  repair: {
    title: 'Процесс ремонта',
    badge: repair.value.status === 'in_progress' ? 'В работе' : 'Не начат',
    note: 'Здесь отображаются сроки, ответственные и текущий статус ремонтных работ.'
  },
  handover: {
    title: 'Выход из ремонта',
    badge: repair.value.handover?.status === 'completed' ? 'Завершён' : 'Ожидает ремонта',
    note: 'Раздел предназначен для приёмки помещения и фиксации завершения ремонта.'
  }
}[props.section]))

const selectedDocumentFields = computed(() => {
  const common = [
    { key: 'name', label: 'Название', type: 'text' },
    { key: 'price', label: 'Цена, ₽', type: 'number' },
    { key: 'quantity', label: 'Количество', type: 'number' },
    { key: 'unit', label: 'Ед.', type: 'text' },
    { key: 'amount', label: 'Сумма, ₽', type: 'number' },
    { key: 'link', label: 'Ссылка', type: 'url' }
  ]
  if (activeDocumentKind.value === 'repairRoadmap') return [
    { key: 'name', label: 'Контрольная точка', type: 'text' },
    { key: 'date', label: 'Дата', type: 'date' },
    { key: 'offsetDays', label: 'День от начала', type: 'number' },
    { key: 'status', label: 'Статус', type: 'text' },
    { key: 'controlPoint', label: 'В календарь', type: 'checkbox' }
  ]
  if (activeDocumentKind.value === 'paymentSchedule') return [
    { key: 'name', label: 'Платёж', type: 'text' },
    { key: 'percent', label: 'Доля, %', type: 'number' },
    { key: 'amount', label: 'Сумма, ₽', type: 'number' },
    { key: 'date', label: 'Дата', type: 'date' },
    { key: 'paymentForm', label: 'Форма оплаты', type: 'text' },
    { key: 'status', label: 'Статус', type: 'text' }
  ]
  if (activeDocumentKind.value === 'customOrders') return [...common, { key: 'customMade', label: 'На заказ', type: 'checkbox' }]
  return common
})

function runtime() {
  const value = api()
  if (!value?.phase0?.projectRepository || !value?.repairEstimate) throw new Error('Модуль документов ремонта ещё загружается.')
  return value
}

function fail(reason: unknown) {
  show(reason instanceof Error ? reason.message : 'Не удалось выполнить действие.', 'error')
}

function today() { return new Date().toISOString().slice(0, 10) }
function numeric(value: unknown, fallback = 0) {
  const result = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(result) ? result : fallback
}
function dateValue(value: unknown) {
  const raw = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function sourceSettings(value = runtime()) {
  const state = value.pro?.read?.() || {}
  return state?.settings?.repairEstimateTemplate ?? value.repairEstimate.defaultSettings()
}

function mutateProject(reason: string, transform: (project: any, value: any) => any) {
  const value = runtime()
  const latest = value.phase0.projectRepository.get(props.project.id)
  const saved = value.phase0.projectRepository.mutate(props.project.id, (project: any) => transform(project, value), latest.phase0.revision, reason)
  currentProject.value = saved
  emit('changed', saved)
  return saved
}

function syncSetup(project: any) {
  const value = api()
  if (!value?.repairEstimate || !project) return
  const currentEstimate = value.repairEstimate.estimateOf(project)
  const pack = value.repairEstimate.documentsOf(project)
  const card = projectCard(project)
  const technical = card?.technical || {}
  setup.cabinetsCount = Number(currentEstimate?.cabinetsCount ?? 1)
  setup.restroomsCount = Number(currentEstimate?.restroomsCount ?? 1)
  setup.area = currentEstimate?.area ?? card?.area ?? project?.area ?? ''
  setup.ceilingHeight = currentEstimate?.ceilingHeight ?? card?.ceilingHeight ?? technical?.ceilingHeight ?? project?.ceilingHeight ?? ''
  setup.startDate = pack?.startDate || value.repairEstimate.deriveLeaseStartDate(project, {}) || ''
  setup.repairDurationDays = Number(pack?.documents?.repairRoadmap?.meta?.durationDays ?? 60)
  setup.paymentForm = String(pack?.documents?.paymentSchedule?.meta?.paymentForm || 'Безналичный расчёт')
}

function generationCommand() {
  return {
    actorId: actor.value.id,
    cabinetsCount: Math.max(0, Math.trunc(numeric(setup.cabinetsCount))),
    restroomsCount: Math.max(0, Math.trunc(numeric(setup.restroomsCount))),
    startDate: setup.startDate,
    repairDurationDays: Math.max(1, Math.trunc(numeric(setup.repairDurationDays, 60))),
    paymentForm: String(setup.paymentForm || '').trim() || 'Безналичный расчёт'
  }
}

function regenerateDocuments(silent = false, bubbleError = false) {
  if (busy.value) return null
  busy.value = true
  try {
    const command = generationCommand()
    const saved = mutateProject('repair-documents-generate', (project, value) => {
      const currentEstimate = value.repairEstimate.estimateOf(project)
      const countsChanged = !currentEstimate
        || Number(currentEstimate.cabinetsCount) !== command.cabinetsCount
        || Number(currentEstimate.restroomsCount) !== command.restroomsCount
      let next = project
      if (countsChanged) {
        next = value.repairEstimate.generateEstimate(project, sourceSettings(value), command)
        const generatedEstimate = value.repairEstimate.estimateOf(next)
        const rebasedEstimate = rebaseRepairEstimate(generatedEstimate, currentEstimate)
        const repairState = next?.phase0?.spaceCard?.work?.repair
        if (!repairState) throw new Error('Этап ремонта ещё не начат.')
        repairState.estimate = rebasedEstimate
      }
      const resultingEstimate = value.repairEstimate.estimateOf(next)
      if (resultingEstimate) {
        next = value.repairEstimate.updateEstimate(next, {
          actorId: actor.value.id,
          patch: {
            cabinetsCount: command.cabinetsCount,
            restroomsCount: command.restroomsCount,
            area: setup.area === '' ? null : numeric(setup.area),
            ceilingHeight: setup.ceilingHeight === '' ? null : numeric(setup.ceilingHeight)
          }
        })
      }
      return value.repairEstimate.generateDocuments(next, command)
    })
    syncSetup(saved)
    if (!silent) show('Комплект документов обновлён.')
    return saved
  } catch (reason) {
    fail(reason)
    if (bubbleError) throw reason instanceof Error ? reason : new Error(String(reason || 'Не удалось сохранить документы ремонта.'))
    return null
  } finally { busy.value = false }
}

function saveDocuments() {
  return regenerateDocuments(false, true)
}

function ensureDocuments() {
  if (!runtimeReady.value || props.section !== 'documents' || busy.value) return
  const value = api()
  if (!value?.repairEstimate || !props.project?.id) return
  let latest: any
  try { latest = value.phase0.projectRepository.get(props.project.id) } catch { latest = currentProject.value }
  currentProject.value = latest || currentProject.value
  syncSetup(currentProject.value)
  const existingEstimate = value.repairEstimate.estimateOf(currentProject.value)
  const pack = value.repairEstimate.documentsOf(currentProject.value)
  if (existingEstimate && documentDefinitions.every(item => pack?.documents?.[item.kind])) return
  if (autoGeneratingFor.value === props.project.id) return
  autoGeneratingFor.value = props.project.id
  regenerateDocuments(true)
}

function refreshDocumentsAfterEstimate(next: any, value: any) {
  const pack = value.repairEstimate.documentsOf(next)
  let refreshed = value.repairEstimate.generateDocuments(next, {
    ...generationCommand(),
    startDate: pack?.startDate || setup.startDate,
    repairDurationDays: Number(pack?.documents?.repairRoadmap?.meta?.durationDays ?? setup.repairDurationDays ?? 60),
    paymentForm: String(pack?.documents?.paymentSchedule?.meta?.paymentForm || setup.paymentForm || 'Безналичный расчёт'),
    milestones: pack?.documents?.repairRoadmap?.rows || undefined,
    paymentTerms: pack?.documents?.paymentSchedule?.rows || undefined
  })
  for (const item of documentDefinitions) {
    const title = String(pack?.documents?.[item.kind]?.title || '').trim()
    if (title && title !== refreshed?.phase0?.spaceCard?.work?.repair?.documentPack?.documents?.[item.kind]?.title) {
      refreshed = value.repairEstimate.updateDocument(refreshed, { actorId: actor.value.id, kind: item.kind, patch: { title } })
    }
  }
  return refreshed
}

function updateEstimateRow(section: any, subsection: any, row: any, patch: Record<string, any>) {
  if (!canEditDocuments.value || busy.value) return
  busy.value = true
  try {
    mutateProject('repair-estimate-row-update', (project, value) => refreshDocumentsAfterEstimate(value.repairEstimate.updateEstimateRow(project, {
      actorId: actor.value.id, sectionId: section.id, subsectionId: subsection.id, itemId: row.id, patch
    }), value))
  } catch (reason) { fail(reason) } finally { busy.value = false }
}

function addEstimateRow(section: any, subsection: any) {
  if (!canEditDocuments.value || busy.value) return
  const draft = newEstimateRows[subsection.id] || {}
  if (!String(draft.name || '').trim()) return show('Укажите название траты.', 'error')
  busy.value = true
  try {
    mutateProject('repair-estimate-row-add', (project, value) => refreshDocumentsAfterEstimate(value.repairEstimate.addEstimateRow(project, {
      actorId: actor.value.id, sectionId: section.id, subsectionId: subsection.id,
      row: { name: draft.name, price: numeric(draft.price), quantity: Math.max(0, numeric(draft.quantity, 1)), unit: String(draft.unit || 'шт.'), link: draft.link || '', customMade: subsection.kind === 'furniture' && Boolean(draft.customMade) }
    }), value))
    newEstimateRows[subsection.id] = { name: '', price: '', quantity: 1, unit: 'шт.', link: '', customMade: false }
  } catch (reason) { fail(reason) } finally { busy.value = false }
}

function removeEstimateRow(section: any, subsection: any, row: any) {
  if (!canEditDocuments.value || busy.value || !confirm(`Удалить строку «${row.name || 'Без названия'}»?`)) return
  busy.value = true
  try {
    mutateProject('repair-estimate-row-remove', (project, value) => refreshDocumentsAfterEstimate(value.repairEstimate.removeEstimateRow(project, {
      actorId: actor.value.id, sectionId: section.id, subsectionId: subsection.id, itemId: row.id
    }), value))
  } catch (reason) { fail(reason) } finally { busy.value = false }
}

function defaultDocumentRow(kind: string) {
  if (kind === 'repairRoadmap') return { name: 'Новая контрольная точка', date: setup.startDate || today(), status: 'planned', controlPoint: true }
  if (kind === 'paymentSchedule') return { name: 'Новый платёж', percent: 0, amount: 0, date: setup.startDate || today(), paymentForm: setup.paymentForm, status: 'planned' }
  return { name: 'Новая позиция', price: 0, quantity: 1, unit: 'шт.', amount: 0, link: '', customMade: kind === 'customOrders' }
}

function addDocumentRow() {
  if (!canEditDocuments.value || busy.value || activeDocumentKind.value === 'fullEstimate') return
  busy.value = true
  try {
    mutateProject(`repair-${activeDocumentKind.value}-row-add`, (project, value) => value.repairEstimate.addDocumentRow(project, {
      actorId: actor.value.id, kind: activeDocumentKind.value, row: defaultDocumentRow(activeDocumentKind.value)
    }))
  } catch (reason) { fail(reason) } finally { busy.value = false }
}

function updateDocumentRow(row: any, patch: Record<string, any>) {
  if (!canEditDocuments.value || busy.value || activeDocumentKind.value === 'fullEstimate') return
  busy.value = true
  try {
    mutateProject(`repair-${activeDocumentKind.value}-row-update`, (project, value) => value.repairEstimate.updateDocumentRow(project, {
      actorId: actor.value.id, kind: activeDocumentKind.value, rowId: row.id, patch
    }))
  } catch (reason) { fail(reason) } finally { busy.value = false }
}

function removeDocumentRow(row: any) {
  if (!canEditDocuments.value || busy.value || activeDocumentKind.value === 'fullEstimate' || !confirm(`Удалить строку «${row.name || 'Без названия'}»?`)) return
  busy.value = true
  try {
    mutateProject(`repair-${activeDocumentKind.value}-row-remove`, (project, value) => value.repairEstimate.removeDocumentRow(project, {
      actorId: actor.value.id, kind: activeDocumentKind.value, rowId: row.id
    }))
  } catch (reason) { fail(reason) } finally { busy.value = false }
}

function updateDocumentTitle(event: Event) {
  if (!canEditDocuments.value || busy.value) return
  const title = (event.target as HTMLInputElement).value.trim()
  if (!title || title === selectedDocument.value?.title) return
  busy.value = true
  try {
    mutateProject(`repair-${activeDocumentKind.value}-title-update`, (project, value) => value.repairEstimate.updateDocument(project, {
      actorId: actor.value.id, kind: activeDocumentKind.value, patch: { title }
    }))
  } catch (reason) { fail(reason) } finally { busy.value = false }
}

function inputPatch(field: any, event: Event) {
  const input = event.target as HTMLInputElement
  if (field.type === 'checkbox') return { [field.key]: input.checked }
  if (field.type === 'number') return { [field.key]: numeric(input.value) }
  return { [field.key]: input.value }
}
function estimateInputPatch(field: string, event: Event) {
  const input = event.target as HTMLInputElement
  if (field === 'customMade') return { customMade: input.checked }
  if (['price', 'quantity'].includes(field)) return { [field]: numeric(input.value) }
  return { [field]: input.value }
}
function rowAmount(row: any) { return numeric(row?.price) * numeric(row?.quantity, 1) }
function money(value: unknown) { return `${numeric(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽` }
function projectAddress() { return String(currentProject.value?.address || projectCard(currentProject.value)?.address || 'Помещение') }
function estimateDraft(subsectionId: string) {
  return newEstimateRows[subsectionId] || { name: '', price: '', quantity: 1, unit: 'шт.', link: '', customMade: false }
}

async function exportExcel(kind: 'selected' | 'fullEstimate' | 'customFurniture') {
  if (exporting.value) return
  exporting.value = kind
  try {
    const value = runtime()
    const exporter = value.repairDocumentsXlsx
    if (!exporter) throw new Error('Модуль выгрузки Excel недоступен.')
    const options = { address: projectAddress() }
    const result = kind === 'selected'
      ? await exporter.exportDocument(currentProject.value, activeDocumentKind.value, options)
      : kind === 'fullEstimate'
        ? await exporter.exportFullEstimate(currentProject.value, options)
        : await exporter.exportCustomFurniture(currentProject.value, options)
    if (!result?.blob) throw new Error('Файл Excel не был сформирован.')
    value.workflow.download(result.blob, result.fileName || result.name || 'Документ ремонта.xlsx')
    show('Файл Excel сформирован.')
  } catch (reason) { fail(reason) } finally { exporting.value = '' }
}

async function agreeDocuments() {
  if (busy.value) return null
  busy.value = true
  try {
    const saved = mutateProject('repair-documents-agreed', (project, value) => value.repairEstimate.agreeDocuments(project, { actorId: actor.value.id }))
    show('Документы согласованы. Контрольные точки добавлены в календарь.')
    emit('agreed', saved)
    return saved
  } catch (reason) { fail(reason); return null } finally { busy.value = false }
}

watch(() => props.project, project => { currentProject.value = project; syncSetup(project) }, { immediate: true })
watch([runtimeReady, () => props.section, () => props.project?.id], ensureDocuments, { immediate: true, flush: 'post' })
watch(estimate, value => {
  for (const section of value?.sections || []) {
    for (const subsection of section?.subsections || []) {
      if (!newEstimateRows[subsection.id]) newEstimateRows[subsection.id] = { name: '', price: '', quantity: 1, unit: 'шт.', link: '', customMade: false }
    }
  }
}, { immediate: true })
watch(canAgree, value => emit('ready', value), { immediate: true })

defineExpose({ agreeDocuments, saveDocuments, canAgree })
</script>

<template>
  <div class="repair-stage-tab" :class="{ 'repair-stage-tab--documents': section === 'documents' }">
    <section class="form-card repair-stage-main">
      <div class="card-heading">
        <h3>{{ sectionMeta.title }}</h3>
        <span class="badge status">{{ sectionMeta.badge }}</span>
      </div>

      <div v-if="section === 'documents'" class="repair-document-workspace">
        <form class="repair-document-setup" @submit.prevent="regenerateDocuments(false)">
          <label><span>Кабинетов</span><input v-model.number="setup.cabinetsCount" type="number" min="0" step="1" inputmode="numeric" :disabled="!canEditDocuments || busy" /></label>
          <label><span>Санузлов</span><input v-model.number="setup.restroomsCount" type="number" min="0" step="1" inputmode="numeric" :disabled="!canEditDocuments || busy" /></label>
          <label><span>Площадь, м²</span><input v-model.number="setup.area" type="number" min="0" step="0.1" inputmode="decimal" :disabled="!canEditDocuments || busy" /></label>
          <label><span>Высота потолков, м</span><input v-model.number="setup.ceilingHeight" type="number" min="0" step="0.1" inputmode="decimal" :disabled="!canEditDocuments || busy" /></label>
          <label><span>Дата подписания ДА</span><input v-model="setup.startDate" type="date" :disabled="!canEditDocuments || busy" /></label>
          <label><span>Срок ремонта, дней</span><input v-model.number="setup.repairDurationDays" type="number" min="1" step="1" inputmode="numeric" :disabled="!canEditDocuments || busy" /></label>
          <label class="repair-document-setup__payment"><span>Форма оплаты</span><input v-model="setup.paymentForm" type="text" :disabled="!canEditDocuments || busy" /></label>
          <button class="button primary compact" type="submit" :disabled="!canEditDocuments || busy">{{ busy ? 'Обновляем…' : 'Обновить документы' }}</button>
        </form>

        <div class="repair-document-export-bar">
          <button class="button compact" type="button" :disabled="!selectedDocument || Boolean(exporting)" @click="exportExcel('selected')">{{ exporting === 'selected' ? 'Формируем…' : 'Скачать выбранный XLSX' }}</button>
          <button class="button compact" type="button" :disabled="!estimate || Boolean(exporting)" @click="exportExcel('fullEstimate')">Полная смета XLSX</button>
          <button class="button compact" type="button" :disabled="!estimate || Boolean(exporting)" @click="exportExcel('customFurniture')">Заказная мебель XLSX</button>
        </div>

        <nav class="repair-document-tabs" aria-label="Документы ремонта">
          <button
            v-for="item in documentDefinitions"
            :key="item.kind"
            type="button"
            class="repair-document-tab"
            :class="{ active: activeDocumentKind === item.kind }"
            :aria-current="activeDocumentKind === item.kind ? 'page' : undefined"
            @click="activeDocumentKind = item.kind"
          >
            <span>{{ item.label }}</span>
            <small>{{ documentPack?.documents?.[item.kind] ? 'Сформирован' : 'Ожидает' }}</small>
          </button>
        </nav>

        <section v-if="selectedDocument" class="repair-generated-document">
          <header class="repair-generated-document__header">
            <label>
              <span>Название документа</span>
              <input :value="selectedDocument.title" type="text" :disabled="!canEditDocuments || busy" @change="updateDocumentTitle" />
            </label>
            <div>
              <span v-if="activeDocumentKind === 'fullEstimate'">Итого: {{ money(estimateSummary.total) }}</span>
              <span v-else>{{ selectedDocument.rows?.length || 0 }} строк</span>
              <button v-if="activeDocumentKind !== 'fullEstimate'" class="button compact" type="button" :disabled="!canEditDocuments || busy" @click="addDocumentRow">Добавить строку</button>
            </div>
          </header>

          <div v-if="activeDocumentKind === 'fullEstimate'" class="repair-estimate-editor">
            <article v-for="sectionRow in estimate?.sections || []" :key="sectionRow.id" class="repair-estimate-section">
              <header><h4>{{ sectionRow.name }}</h4><span>{{ money((estimateSummary.sections || []).find((item: any) => item.id === sectionRow.id)?.total) }}</span></header>
              <section v-for="subsection in sectionRow.subsections || []" :key="subsection.id" class="repair-estimate-subsection">
                <div class="repair-estimate-subsection__heading"><h5>{{ subsection.name }}</h5><span>{{ subsection.items?.length || 0 }} строк</span></div>
                <div v-for="row in subsection.items || []" :key="row.id" class="repair-estimate-row">
                  <label><span>Название</span><input :value="row.name" type="text" :disabled="!canEditDocuments || busy" @change="updateEstimateRow(sectionRow, subsection, row, estimateInputPatch('name', $event))" /></label>
                  <label><span>Цена, ₽</span><input :value="row.price" type="number" min="0" step="0.01" inputmode="decimal" :disabled="!canEditDocuments || busy" @change="updateEstimateRow(sectionRow, subsection, row, estimateInputPatch('price', $event))" /></label>
                  <label><span>Количество</span><input :value="row.quantity" type="number" min="0" step="0.01" inputmode="decimal" :disabled="!canEditDocuments || busy" @change="updateEstimateRow(sectionRow, subsection, row, estimateInputPatch('quantity', $event))" /></label>
                  <label><span>Ед.</span><input :value="row.unit" type="text" :disabled="!canEditDocuments || busy" @change="updateEstimateRow(sectionRow, subsection, row, estimateInputPatch('unit', $event))" /></label>
                  <label><span>Ссылка</span><input :value="row.link" type="url" placeholder="https://" :disabled="!canEditDocuments || busy" @change="updateEstimateRow(sectionRow, subsection, row, estimateInputPatch('link', $event))" /></label>
                  <label v-if="subsection.kind === 'furniture'" class="repair-estimate-check"><input :checked="Boolean(row.customMade)" type="checkbox" :disabled="!canEditDocuments || busy" @change="updateEstimateRow(sectionRow, subsection, row, estimateInputPatch('customMade', $event))" /><span>На заказ</span></label>
                  <strong>{{ money(rowAmount(row)) }}</strong>
                  <button class="button compact danger" type="button" :disabled="!canEditDocuments || busy" @click="removeEstimateRow(sectionRow, subsection, row)">Удалить</button>
                </div>
                <form class="repair-estimate-new-row" @submit.prevent="addEstimateRow(sectionRow, subsection)">
                  <input v-model="estimateDraft(subsection.id).name" type="text" placeholder="Новая трата" :disabled="!canEditDocuments || busy" />
                  <input v-model.number="estimateDraft(subsection.id).price" type="number" min="0" step="0.01" placeholder="Цена" :disabled="!canEditDocuments || busy" />
                  <input v-model.number="estimateDraft(subsection.id).quantity" type="number" min="0" step="0.01" placeholder="Кол-во" :disabled="!canEditDocuments || busy" />
                  <input v-model="estimateDraft(subsection.id).link" type="url" placeholder="Ссылка" :disabled="!canEditDocuments || busy" />
                  <label v-if="subsection.kind === 'furniture'" class="repair-estimate-check"><input v-model="estimateDraft(subsection.id).customMade" type="checkbox" :disabled="!canEditDocuments || busy" /><span>На заказ</span></label>
                  <button class="button compact" type="submit" :disabled="!canEditDocuments || busy">Добавить</button>
                </form>
              </section>
            </article>
          </div>

          <div v-else class="repair-document-table">
            <div v-for="row in selectedDocument.rows || []" :key="row.id" class="repair-document-row-editor">
              <label v-for="field in selectedDocumentFields" :key="field.key" :class="{ 'repair-document-check': field.type === 'checkbox' }">
                <span>{{ field.label }}</span>
                <input
                  v-if="field.type === 'checkbox'"
                  :checked="row[field.key] !== false"
                  type="checkbox"
                  :disabled="!canEditDocuments || busy"
                  @change="updateDocumentRow(row, inputPatch(field, $event))"
                />
                <input
                  v-else
                  :value="row[field.key]"
                  :type="field.type"
                  :min="field.type === 'number' ? 0 : undefined"
                  :step="field.type === 'number' ? '0.01' : undefined"
                  :disabled="!canEditDocuments || busy"
                  @change="updateDocumentRow(row, inputPatch(field, $event))"
                />
              </label>
              <button class="button compact danger" type="button" :disabled="!canEditDocuments || busy" @click="removeDocumentRow(row)">Удалить</button>
            </div>
            <p v-if="!selectedDocument.rows?.length" class="repair-document-empty">В документе пока нет строк. Добавьте первую строку.</p>
          </div>
        </section>

        <div v-else class="repair-document-empty">
          <p>Документ ещё не сформирован.</p>
          <button class="button primary" type="button" :disabled="busy" @click="regenerateDocuments(false)">Сформировать комплект</button>
        </div>
      </div>

      <div v-else-if="section === 'repair'" class="repair-facts">
        <div><span>Статус</span><strong>{{ repair.status === 'in_progress' ? 'Ремонт выполняется' : 'Ожидает запуска' }}</strong></div>
        <div><span>Начало работ</span><strong>{{ repair.startedAt ? formatDate(repair.startedAt) : 'Не указано' }}</strong></div>
        <div><span>Плановое завершение</span><strong>{{ repair.plannedCompletionAt ? formatDate(repair.plannedCompletionAt) : 'Не указано' }}</strong></div>
      </div>

      <div v-else class="repair-checklist">
        <div class="repair-checklist__row"><span class="repair-checklist__mark">○</span><span>Акт приёмки</span><small>Ожидает добавления</small></div>
        <div class="repair-checklist__row"><span class="repair-checklist__mark">○</span><span>Устранение замечаний</span><small>Не начато</small></div>
        <div class="repair-checklist__row"><span class="repair-checklist__mark">○</span><span>Передача помещения</span><small>Не выполнено</small></div>
      </div>
    </section>

    <aside class="form-card repair-stage-next">
      <div class="card-heading"><h3>Текущий этап</h3></div>
      <p>{{ sectionMeta.note }}</p>
      <div v-if="section === 'documents' && documentPack" class="repair-stage-summary">
        <div><span>Смета</span><strong>{{ money(estimateSummary.total) }}</strong></div>
        <div><span>Начало</span><strong>{{ dateValue(documentPack.startDate) || 'Не указано' }}</strong></div>
        <div><span>Статус</span><strong>{{ documentsAgreed ? 'Согласовано' : 'Черновик' }}</strong></div>
      </div>
      <div class="repair-stage-next__status"><span>Помещение</span><strong>{{ repair.stage === 'documents' ? 'Подготовка документов' : 'Передано в ремонт' }}</strong></div>
    </aside>
  </div>
</template>
