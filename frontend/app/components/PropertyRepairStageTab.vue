<script setup lang="ts">
import { formatDate, projectWork } from '~/utils/format'

const props = defineProps<{
  project: any
  section: 'documents' | 'repair' | 'handover'
}>()
const emit = defineEmits<{ changed: [project: any] }>()
const { api } = useSlogiRuntime()
const { show } = useToast()
const busyKind = ref('')
const inputRefs = reactive<Record<string, HTMLInputElement | null>>({})
const progress = reactive({ active: false, fileName: '', percent: 0 })
const actor = computed(() => api()?.pro?.actor?.() || { id: 'workspace-member', name: 'Специалист' })

const work = computed(() => projectWork(props.project))
const repair = computed(() => work.value?.repair || {})
const documents = computed(() => Array.isArray(repair.value.documents) ? repair.value.documents : [])
const documentDefinitions = [
  { kind: 'technicalTask', label: 'Техническое задание' },
  { kind: 'estimate', label: 'Смета ремонта' },
  { kind: 'schedule', label: 'График работ' }
] as const
const documentRows = computed(() => documentDefinitions.map(definition => {
  const document = documents.value.find((item: any) => item?.kind === definition.kind) || null
  return { ...definition, document, ready: Boolean(document?.name && document?.attachmentType) }
}))
const completedDocuments = computed(() => documentRows.value.filter(row => row.ready).length)

const sectionMeta = computed(() => ({
  documents: {
    title: 'Документы для ремонта',
    badge: completedDocuments.value ? `${completedDocuments.value} из ${documentDefinitions.length} готово` : 'Новый этап',
    note: 'Здесь будет собран комплект документов, необходимый для начала ремонтных работ.'
  },
  repair: {
    title: 'Процесс ремонта',
    badge: repair.value.status === 'in_progress' ? 'В работе' : 'Не начат',
    note: 'После подготовки документов здесь появятся сроки, ответственные и текущий статус работ.'
  },
  handover: {
    title: 'Выход из ремонта',
    badge: repair.value.handover?.status === 'completed' ? 'Завершён' : 'Ожидает ремонта',
    note: 'Раздел предназначен для приёмки помещения и фиксации завершения ремонта.'
  }
}[props.section]))

function runtime() {
  const value = api()
  if (!value) throw new Error('Приложение ещё загружается.')
  return value
}

function fail(reason: unknown) {
  show(reason instanceof Error ? reason.message : 'Не удалось выполнить действие.', 'error')
}

function setInput(kind: string, element: any) {
  inputRefs[kind] = element as HTMLInputElement | null
}

function trigger(kind: string) {
  inputRefs[kind]?.click()
}

async function upload(row: any, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  busyKind.value = row.kind
  Object.assign(progress, { active: true, fileName: file.name, percent: 0 })
  let uploadedAttachmentType = ''
  let metadataCommitted = false
  try {
    const value = runtime()
    const initial = value.phase0.projectRepository.get(props.project.id)
    const initialDocument = value.repair.documentOf(initial, row.kind)
    const previousAttachmentType = initialDocument?.attachmentType || ''
    const attachmentType = `repair-document-${row.kind}-${value.pro.uid('document')}`
    uploadedAttachmentType = attachmentType
    await value.workflow.saveAttachment(props.project.id, attachmentType, file, file.name, {
      onProgress(percent: number) { progress.percent = Math.round(Math.max(0, Math.min(100, Number(percent) || 0))) }
    })
    const current = value.phase0.projectRepository.get(props.project.id)
    const currentDocument = value.repair.documentOf(current, row.kind)
    if ((currentDocument?.attachmentType || '') !== previousAttachmentType) {
      throw new Error('Документ уже изменён другим пользователем. Обновите карточку и повторите действие.')
    }
    const saved = value.phase0.projectRepository.mutate(props.project.id, (project: any) => value.repair.attachDocument(project, {
        kind: row.kind,
        name: file.name,
        attachmentType,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        actorId: actor.value.id
      }), current.phase0.revision, `repair-document-${row.kind}-upload`)
    metadataCommitted = true
    emit('changed', saved)
    if (previousAttachmentType && previousAttachmentType !== attachmentType) {
      try { await value.workflow.deleteAttachment(props.project.id, previousAttachmentType) }
      catch (reason) { console.warn('Не удалось удалить предыдущую версию документа.', reason) }
    }
    show('Документ добавлен.')
  } catch (reason) {
    if (uploadedAttachmentType && !metadataCommitted) {
      try { await runtime().workflow.deleteAttachment(props.project.id, uploadedAttachmentType) }
      catch (cleanupReason) { console.error('Не удалось удалить незавершённую загрузку документа.', cleanupReason) }
    }
    fail(reason)
  }
  finally {
    busyKind.value = ''
    progress.active = false
    input.value = ''
  }
}

async function download(document: any) {
  if (!document?.attachmentType) return
  try {
    const value = runtime()
    const file = await value.workflow.getAttachment(props.project.id, document.attachmentType)
    if (!file?.blob) throw new Error('Файл не найден в хранилище.')
    value.workflow.download(file.blob, file.name || document.name)
  } catch (reason) { fail(reason) }
}

async function removeDocument(row: any) {
  const document = row.document
  if (!document?.attachmentType || !confirm(`Удалить документ «${document.name || row.label}»?`)) return
  busyKind.value = row.kind
  try {
    const value = runtime()
    const current = value.phase0.projectRepository.get(props.project.id)
    const currentDocument = value.repair.documentOf(current, row.kind)
    if (currentDocument?.attachmentType !== document.attachmentType) {
      throw new Error('Документ уже изменён другим пользователем. Обновите карточку и повторите действие.')
    }
    const saved = value.phase0.projectRepository.mutate(props.project.id, (project: any) => value.repair.removeDocument(project, {
      kind: row.kind,
      attachmentType: document.attachmentType,
      actorId: actor.value.id
    }), current.phase0.revision, `repair-document-${row.kind}-remove`)
    emit('changed', saved)
    try {
      await value.workflow.deleteAttachment(props.project.id, document.attachmentType)
    } catch (storageReason) {
      let attachmentStillAvailable = true
      try {
        const cloud = (window as any).SlogiCloud
        const stored = cloud?.getAttachment
          ? await cloud.getAttachment(props.project.id, document.attachmentType)
          : await value.workflow.getAttachment(props.project.id, document.attachmentType)
        attachmentStillAvailable = Boolean(stored?.blob)
      } catch (checkReason) {
        console.warn('Не удалось проверить состояние удаляемого документа.', checkReason)
      }
      const latest = value.phase0.projectRepository.get(props.project.id)
      if (attachmentStillAvailable && !value.repair.documentOf(latest, row.kind)) {
        const restored = value.phase0.projectRepository.mutate(props.project.id, (project: any) => value.repair.attachDocument(project, {
          kind: row.kind,
          name: document.name,
          attachmentType: document.attachmentType,
          mimeType: document.mimeType,
          size: document.size,
          actorId: document.uploadedById || actor.value.id
        }), latest.phase0.revision, `repair-document-${row.kind}-restore`)
        emit('changed', restored)
      }
      if (attachmentStillAvailable) {
        throw new Error('Файл не удалось удалить из хранилища. Документ восстановлен в карточке.')
      }
      console.warn('Документ удалён, но хранилище сообщило об ошибке после удаления.', storageReason)
    }
    show('Документ удалён.')
  } catch (reason) { fail(reason) }
  finally { busyKind.value = '' }
}
</script>

<template>
  <div class="repair-stage-tab">
    <section class="form-card repair-stage-main">
      <div class="card-heading"><h3>{{ sectionMeta.title }}</h3><span class="badge status">{{ sectionMeta.badge }}</span></div>

      <div v-if="section === 'documents'" class="repair-documents">
        <div v-for="row in documentRows" :key="row.kind" class="approval-document-row repair-document-row">
          <div class="repair-document-copy">
            <span class="repair-checklist__mark" :class="{ ready: row.ready }">{{ row.ready ? '✓' : '○' }}</span>
            <div><h4>{{ row.label }}</h4><p>{{ row.ready ? 'Документ подготовлен' : 'Ожидает добавления' }}</p></div>
          </div>
          <div class="approval-document-slot">
            <button v-if="row.ready" class="approval-file" type="button" @click="download(row.document)"><span>Файл</span><strong>{{ row.document.name }}</strong></button>
            <div v-else class="approval-file-placeholder">Файл не добавлен</div>
          </div>
          <div class="approval-document-actions repair-document-actions">
            <button class="button compact" type="button" :disabled="Boolean(busyKind)" @click="trigger(row.kind)">Добавить</button>
            <button class="button compact" type="button" :disabled="Boolean(busyKind) || !row.ready" @click="download(row.document)">Скачать</button>
            <button class="button compact danger" type="button" :disabled="Boolean(busyKind) || !row.ready" @click="removeDocument(row)">Удалить</button>
          </div>
          <input :ref="element => setInput(row.kind, element)" hidden type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" @change="upload(row, $event)" />
        </div>
        <div v-if="progress.active" class="media-progress" aria-live="polite"><div><span>Загрузка: {{ progress.fileName }}</span><span>{{ progress.percent }}%</span></div><progress :value="progress.percent" max="100" /></div>
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
      <div class="repair-stage-next__status"><span>Помещение</span><strong>Передано в ремонт</strong></div>
    </aside>
  </div>
</template>
