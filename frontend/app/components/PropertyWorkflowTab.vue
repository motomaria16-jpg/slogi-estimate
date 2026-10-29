<script setup lang="ts">
import { pipelineStatus, projectWork } from '~/utils/format'

const props = defineProps<{ project: any }>()
const emit = defineEmits<{ changed: [project: any]; proposal: [project: any] }>()
const { api } = useSlogiRuntime()
const { show } = useToast()
const contact = reactive({ name: '', phone: '', email: '' })
const viewing = reactive({ startsAt: '', assignedTo: '', reminder: 30 })
const rejection = reactive({ reason: '', comment: '' })
const photoInput = ref<HTMLInputElement | null>(null)
const videoInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const uploadProgress = reactive({ active: false, kind: 'photo' as 'photo' | 'video', fileName: '', fileIndex: 0, fileCount: 0, percent: 0 })

const work = computed(() => projectWork(props.project))
const pipeline = computed(() => pipelineStatus(props.project))
const activeViewing = computed(() => {
  const id = work.value.activeViewingId
  return (work.value.viewings || []).find((item: any) => item.id === id) || (work.value.viewings || []).slice().reverse().find((item: any) => item.status === 'scheduled' || item.status === 'completed') || null
})
const attachments = computed(() => (activeViewing.value?.attachments || []).filter((item: any) => item.status !== 'removed'))
const hasPhoto = computed(() => attachments.value.some((item: any) => item.kind === 'photo' && item.status === 'uploaded'))
const hasVideo = computed(() => attachments.value.some((item: any) => item.kind === 'video' && item.status === 'uploaded'))
const canCompleteViewing = computed(() => activeViewing.value?.status === 'scheduled' && viewingStarted.value && hasPhoto.value && hasVideo.value && !busy.value)
const viewingStarted = computed(() => Boolean(activeViewing.value && (
  activeViewing.value.status === 'completed'
  || new Date(activeViewing.value.startsAt).getTime() <= Date.now()
)))
const actor = computed(() => api()?.pro?.actor?.() || { id: 'workspace-member', name: 'Специалист' })

function runtime() {
  const value = api()
  if (!value) throw new Error('Приложение ещё загружается.')
  return value
}

function sync() {
  const stored = work.value.landlordContact || {}
  contact.name = stored.name || stored.organization || ''
  contact.phone = stored.phone || ''
  contact.email = stored.email || ''
  if (activeViewing.value) {
    viewing.startsAt = activeViewing.value.startsAt ? new Date(activeViewing.value.startsAt).toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 16) : ''
    viewing.assignedTo = activeViewing.value.assignedToName || activeViewing.value.assignedToId || ''
  } else if (!viewing.startsAt) {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    viewing.startsAt = future.toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 16)
  }
}
watch(() => props.project, sync, { immediate: true, deep: true })

function service() { const value = runtime(); return value.calendar.createService({ projectRepository: value.phase0.projectRepository, idFactory: (prefix: string) => value.pro.uid(prefix) }) }
function operation(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
function done(project: any, message: string) { emit('changed', project); show(message) }
function fail(reason: unknown) { show(reason instanceof Error ? reason.message : 'Не удалось выполнить действие.', 'error') }

async function saveContact() {
  try {
    const saved = service().markContacted(props.project.id, { operationId: operation('contact'), actorId: actor.value.id, contact: { ...contact } , preserveProposalStage: pipeline.value === 'proposal_started' })
    done(saved, 'Контакт арендодателя сохранён.')
  } catch (reason) { fail(reason) }
}

async function saveViewing() {
  try {
    const startsAt = runtime().calendar.moscowLocalToIso(viewing.startsAt)
    const rescheduling = activeViewing.value?.status === 'scheduled'
    const command = { operationId: operation('viewing'), viewingId: rescheduling ? activeViewing.value.id : undefined, startsAt, durationMinutes: 60, assignedToId: viewing.assignedTo, assignedToName: viewing.assignedTo, reminderMinutesBefore: [Number(viewing.reminder)], actorId: actor.value.id, preserveProposalStage: pipeline.value === 'proposal_started' }
    const saved = rescheduling ? service().reschedule(props.project.id, command) : service().schedule(props.project.id, command)
    done(saved, rescheduling ? 'Просмотр перенесён.' : 'Просмотр назначен и добавлен в календарь.')
  } catch (reason) { fail(reason) }
}

async function cancelViewing() {
  if (!activeViewing.value || !confirm('Отменить назначенный просмотр?')) return
  try { done(service().cancel(props.project.id, { operationId: operation('cancel'), viewingId: activeViewing.value.id, reason: 'Отменено пользователем', actorId: actor.value.id }), 'Просмотр отменён.') }
  catch (reason) { fail(reason) }
}

async function upload(kind: 'photo' | 'video', event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || [])
  if (!files.length || !activeViewing.value) return
  busy.value = true
  Object.assign(uploadProgress, { active: true, kind, fileName: files[0]?.name || '', fileIndex: 1, fileCount: files.length, percent: 0 })
  try {
    const value = runtime()
    let current = value.phase0.projectRepository.get(props.project.id)
    for (const [index, file] of files.entries()) {
      Object.assign(uploadProgress, { fileName: file.name, fileIndex: index + 1, percent: Math.round(index / files.length * 100) })
      const id = value.pro.uid(kind)
      const type = `viewing-${activeViewing.value.id}-${id}`
      await value.workflow.saveAttachment(props.project.id, type, file, file.name, {
        onProgress(filePercent: number) {
          const normalized = Math.max(0, Math.min(100, Number(filePercent) || 0))
          uploadProgress.percent = Math.round((index + normalized / 100) / files.length * 100)
        },
      })
      current = value.phase0.projectRepository.mutate(props.project.id, (project: any) => {
        const target = projectWork(project).viewings.find((item: any) => item.id === activeViewing.value.id)
        target.attachments.push({ id, kind, status: 'uploaded', type, name: file.name, mimeType: file.type, uploadedAt: new Date().toISOString() })
        return project
      }, current.phase0.revision, 'viewing-media-upload')
    }
    done(current, `${kind === 'photo' ? 'Фото' : 'Видео'} загружено.`)
  } catch (reason) { fail(reason) }
  finally {
    busy.value = false
    uploadProgress.active = false
    ;(event.target as HTMLInputElement).value = ''
  }
}

async function removeAttachment(item: any) {
  try { done(service().removeAttachment(props.project.id, { operationId: operation('remove-media'), viewingId: activeViewing.value.id, attachmentId: item.id, actorId: actor.value.id }), 'Файл удалён из карточки.') }
  catch (reason) { fail(reason) }
}

async function downloadAttachment(item: any) {
  try {
    const value = runtime()
    const attachmentType = item?.type || item?.attachmentType
    if (!attachmentType) throw new Error('Для этого файла не найден идентификатор хранилища.')
    const file = await value.workflow.getAttachment(props.project.id, attachmentType)
    if (!file?.blob) throw new Error('Файл не найден в хранилище.')
    value.workflow.download(file.blob, file.name || item.name)
  } catch (reason) { fail(reason) }
}

async function completeViewing() {
  try { done(service().complete(props.project.id, { operationId: operation('complete'), viewingId: activeViewing.value.id, confirmed: true, actorId: actor.value.id }), 'Просмотр завершён.') }
  catch (reason) { fail(reason) }
}

async function rejectProject() {
  try { done(service().reject(props.project.id, { operationId: operation('reject'), reason: rejection.reason, comment: rejection.comment, actorId: actor.value.id, preserveProposalStage: pipeline.value === 'proposal_started' }), 'Отказ зафиксирован.') }
  catch (reason) { fail(reason) }
}

async function startProposal() {
  try {
    const saved = service().startProposal(props.project.id, { operationId: operation('proposal'), proposalId: `proposal-${props.project.id}`, actorId: actor.value.id })
    done(saved, 'Помещение передано на этап КП.')
    emit('proposal', saved)
  } catch (reason) { fail(reason) }
}
</script>

<template>
  <div class="workflow-tab">
    <div class="workflow-grid">
      <section class="form-card workflow-card">
        <div class="card-heading"><h3>Контакт арендодателя</h3><span class="badge status">{{ work.landlordContact?.contactedAt ? 'Связались' : 'Не зафиксирован' }}</span></div>
        <label class="form-row"><b>Имя / организация</b><input v-model="contact.name" /></label>
        <label class="form-row"><b>Телефон</b><input v-model="contact.phone" inputmode="tel" /></label>
        <label class="form-row"><b>Email</b><input v-model="contact.email" type="email" /></label>
        <div class="card-actions"><button class="button compact" @click="saveContact">{{ work.landlordContact?.contactedAt ? 'Обновить контакт' : 'Зафиксировать связь' }}</button></div>
      </section>

      <section class="form-card workflow-card">
        <div class="card-heading"><h3>Просмотр</h3><span class="badge status">{{ activeViewing?.status === 'completed' ? 'Завершён' : activeViewing?.status === 'scheduled' ? 'Назначен' : 'Не назначен' }}</span></div>
        <label class="form-row"><b>Дата и время</b><input v-model="viewing.startsAt" type="datetime-local" /></label>
        <label class="form-row"><b>Ответственный</b><input v-model="viewing.assignedTo" placeholder="Введите имя" /></label>
        <label class="form-row"><b>Напомнить</b><select v-model.number="viewing.reminder"><option :value="0">Без напоминания</option><option :value="30">За 30 минут</option><option :value="60">За 1 час</option><option :value="1440">За 1 день</option></select></label>
        <div class="card-actions"><button v-if="activeViewing?.status === 'scheduled'" class="button danger compact" @click="cancelViewing">Отменить просмотр</button><button class="button accent compact" :disabled="!contact.name || !viewing.assignedTo" @click="saveViewing">{{ activeViewing?.status === 'scheduled' ? 'Перенести' : 'Назначить' }}</button></div>
      </section>

      <section class="form-card workflow-card">
        <div class="card-heading"><h3>Фото и видео помещения</h3><span class="badge status">{{ attachments.length }} файлов</span></div>
        <p v-if="activeViewing && !viewingStarted" class="helper-text">Загрузка откроется после начала просмотра.</p>
        <div class="media-actions"><button class="button media" :disabled="!viewingStarted || busy" @click="photoInput?.click()">＋ Добавить фото</button><button class="button media" :disabled="!viewingStarted || busy" @click="videoInput?.click()">＋ Добавить видео</button></div>
        <input ref="photoInput" hidden type="file" accept="image/*" multiple @change="upload('photo', $event)" /><input ref="videoInput" hidden type="file" accept="video/*" multiple @change="upload('video', $event)" />
        <div v-if="uploadProgress.active" class="media-progress" aria-live="polite">
          <div><span>Загрузка {{ uploadProgress.kind === 'photo' ? 'фото' : 'видео' }}: {{ uploadProgress.fileName }}</span><span>{{ uploadProgress.percent }}%</span></div>
          <progress :value="uploadProgress.percent" max="100" aria-label="Прогресс загрузки файла" />
          <small>Файл {{ uploadProgress.fileIndex }} из {{ uploadProgress.fileCount }}</small>
        </div>
        <ul v-if="attachments.length" class="attachment-list"><li v-for="item in attachments" :key="item.id"><span><b>{{ item.kind === 'photo' ? 'Фото' : 'Видео' }}</b>{{ item.name }}</span><div class="attachment-actions"><button class="button compact" type="button" @click="downloadAttachment(item)">Скачать</button><button class="button compact danger" type="button" @click="removeAttachment(item)">Удалить</button></div></li></ul>
        <div class="card-actions"><button v-if="activeViewing?.status === 'scheduled'" class="button accent compact" :disabled="!canCompleteViewing" @click="completeViewing">Завершить просмотр</button><span v-else-if="activeViewing?.status === 'completed'" class="completion-state">Просмотр завершён</span></div>
      </section>

      <section class="form-card workflow-card">
        <div class="card-heading"><h3>Решение по помещению</h3><span class="badge status">{{ pipeline === 'viewing_completed' ? 'Готово к КП' : pipeline === 'proposal_started' ? 'На этапе КП' : 'Ожидает просмотра' }}</span></div>
        <div class="reject-options"><label><input v-model="rejection.reason" type="radio" value="not_suitable_da" /> Не подходит ДА</label><label><input v-model="rejection.reason" type="radio" value="not_suitable_tu" /> Не подходят ТУ</label></div>
        <label class="form-row textarea"><b>Комментарий</b><textarea v-model="rejection.comment" rows="3" placeholder="Зафиксируйте детали решения" /></label>
        <div class="card-actions"><button class="button danger compact" :disabled="!rejection.reason || !rejection.comment" @click="rejectProject">Зафиксировать отказ</button></div>
      </section>
    </div>
    <div v-if="pipeline === 'viewing_completed'" class="workflow-final-action"><button class="button accent" @click="startProposal">Сформировать КП</button></div>
  </div>
</template>
