<script setup lang="ts">
import { formatDate, projectWork } from '~/utils/format'

const props = defineProps<{ project: any }>()
const emit = defineEmits<{ changed: [project: any]; approval: [project: any] }>()
const { api } = useSlogiRuntime()
const { show } = useToast()
const busy = ref(false)
const terms = reactive({ rentFreeDays: null as number | null, baseRentRate: null as number | null, discountRentRate: null as number | null, discountPeriodDays: null as number | null, emailSubject: '', emailBody: '' })
const proposal = computed(() => api()?.proposal?.proposalOf(props.project) || {})
const contact = computed(() => projectWork(props.project).landlordContact || {})
const documentReady = computed(() => ['prepared', 'sent'].includes(proposal.value.status) && Boolean(proposal.value.docxName))

function runtime() {
  const value = api()
  if (!value) throw new Error('Приложение ещё загружается.')
  return value
}

function sync() {
  const current = proposal.value
  const draft = api()?.proposal?.emailDraft(props.project, contact.value) || { subject: '', body: '' }
  terms.rentFreeDays = current.rentFreeDays
  terms.baseRentRate = current.baseRentRate
  terms.discountRentRate = current.discountRentRate
  terms.discountPeriodDays = current.discountPeriodDays
  terms.emailSubject = current.emailSubject || draft.subject
  terms.emailBody = current.emailBody || draft.body
}
watch(() => props.project, sync, { immediate: true, deep: true })

function safe(value: string) { return String(value || 'файл').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) }
function fail(reason: unknown) { show(reason instanceof Error ? reason.message : 'Не удалось выполнить действие.', 'error') }

async function prepare() {
  const runtime = api()
  if (!runtime || busy.value) return
  busy.value = true
  try {
    const checked = runtime.proposal.validateTerms(terms)
    if (!checked.valid) throw new Error(checked.errors[0])
    const fields = runtime.proposalDocument.buildFields(props.project, checked.terms)
    const response = await fetch('/legacy/KP_Slogi_template.docx')
    if (!response.ok) throw new Error('Исходный Word-шаблон КП не найден.')
    const blob = await runtime.proposalDocument.docxBlob(await response.arrayBuffer(), fields, window.OfficeZip)
    const docxName = `${safe(`КП ${props.project.address || props.project.id}`)}.docx`
    await runtime.workflow.saveAttachment(props.project.id, 'proposal-docx', blob, docxName)
    const current = runtime.phase0.projectRepository.get(props.project.id)
    const saved = runtime.phase0.projectRepository.mutate(props.project.id, (project: any) => runtime.proposal.prepare(project, {
      ...checked.terms,
      emailSubject: terms.emailSubject,
      emailBody: terms.emailBody,
      docxName,
      docxAttachmentType: 'proposal-docx',
      leaseName: 'Типовой договор аренды.docx'
    }), current.phase0.revision, 'proposal-prepare')
    runtime.pro.upsert('documentVersions', { id: `proposal-${props.project.id}`, projectId: props.project.id, type: 'КП', name: docxName, version: 'v1', status: 'Актуальный', comment: 'DOCX сформирован из корпоративного шаблона' }, 'proposal-docx-prepared')
    emit('changed', saved)
    show('Коммерческое предложение подготовлено в Word.')
  } catch (reason) { fail(reason) }
  finally { busy.value = false }
}

async function downloadProposal() {
  try {
    const value = runtime()
    const file = await value.workflow.getAttachment(props.project.id, 'proposal-docx')
    if (!file?.blob) throw new Error('Файл не найден. Подготовьте КП повторно.')
    value.workflow.download(file.blob, file.name || proposal.value.docxName)
  } catch (reason) { fail(reason) }
}

async function downloadLease() {
  try {
    const response = await fetch('/legacy/lease-agreement-template.docx')
    if (!response.ok) throw new Error('Типовой договор не найден.')
    runtime().workflow.download(await response.blob(), 'Типовой договор аренды.docx')
  } catch (reason) { fail(reason) }
}

async function copyEmail() {
  try { await navigator.clipboard.writeText(`${terms.emailSubject}\n\n${terms.emailBody}`); show('Текст письма скопирован.') }
  catch { show('Не удалось скопировать письмо.', 'error') }
}

function openEmail() {
  const email = String(contact.value.email || '')
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(terms.emailSubject)}&body=${encodeURIComponent(terms.emailBody)}`
}

async function markSent() {
  const runtime = api()
  try {
    if (!runtime) throw new Error('Приложение ещё загружается.')
    const current = runtime.phase0.projectRepository.get(props.project.id)
    const now = new Date().toISOString()
    const taskId = proposal.value.followUpTaskId || `kp-follow-up-${props.project.id}`
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const saved = runtime.phase0.projectRepository.mutate(props.project.id, (project: any) => {
      const refreshed = runtime.proposal.prepare(project, { ...proposal.value, emailSubject: terms.emailSubject, emailBody: terms.emailBody }, { now: proposal.value.preparedAt || now })
      const sent = runtime.proposal.markSent(refreshed, { followUpTaskId: taskId, followUpDueAt: dueAt }, { now })
      return runtime.approval.start(sent, { actorId: runtime.pro.actor().id }, { now })
    }, current.phase0.revision, 'proposal-sent')
    runtime.pro.upsert('tasks', runtime.proposal.followUpTask(saved, runtime.proposal.proposalOf(saved), taskId), 'proposal-follow-up-task')
    emit('changed', saved)
    emit('approval', saved)
    show('Отправка КП зафиксирована. Помещение передано на согласование, контрольная связь добавлена в календарь через 24 часа.')
  } catch (reason) { fail(reason) }
}
</script>

<template>
  <div class="proposal-workflow">
    <section class="form-card proposal-terms">
      <div class="card-heading"><h3>Коммерческие условия</h3><span class="badge status">{{ documentReady ? 'DOCX подготовлен' : 'Заполните 4 параметра' }}</span></div>
      <label class="form-row"><b>Арендные каникулы, дней</b><input v-model.number="terms.rentFreeDays" type="number" min="0" /></label>
      <label class="form-row"><b>Базовая арендная ставка, ₽/м²/мес.</b><input v-model.number="terms.baseRentRate" type="number" min="0" step="0.01" /></label>
      <label class="form-row"><b>Ставка на льготный период, ₽/м²/мес.</b><input v-model.number="terms.discountRentRate" type="number" min="0" step="0.01" /></label>
      <label class="form-row"><b>Срок льготного периода, дней</b><input v-model.number="terms.discountPeriodDays" type="number" min="0" /></label>
      <div class="card-actions"><button class="button primary" :disabled="busy" @click="prepare">{{ documentReady ? 'Обновить КП' : 'Подготовить КП' }}</button></div>
    </section>

    <section class="form-card proposal-package">
      <div class="card-heading"><h3>Пакет для арендодателя</h3><span class="badge status">{{ documentReady ? 'Готов к отправке' : 'Сначала подготовьте КП' }}</span></div>
      <div class="document-buttons"><button class="document-file" :disabled="!documentReady" @click="downloadProposal"><span>DOCX</span><strong>{{ proposal.docxName || 'Коммерческое предложение.docx' }}</strong></button><button class="document-file" @click="downloadLease"><span>DOCX</span><strong>Типовой договор аренды.docx</strong></button></div>
      <label class="stacked-field"><span>Тема письма</span><input v-model="terms.emailSubject" :disabled="!documentReady" /></label>
      <label class="stacked-field"><span>Текст письма</span><textarea v-model="terms.emailBody" rows="4" :disabled="!documentReady" /></label>
      <div class="package-actions"><button class="button compact" :disabled="!documentReady" @click="copyEmail">Копировать письмо</button><button class="button compact" :disabled="!documentReady" @click="openEmail">Открыть письмо</button><button class="button accent compact" :disabled="!documentReady || proposal.status === 'sent'" @click="markSent">КП отправлено</button></div>
      <p v-if="proposal.status === 'sent'" class="success-note">Отправка зафиксирована {{ formatDate(proposal.sentAt, true) }}. Контрольная связь запланирована на {{ formatDate(proposal.followUpDueAt, true) }}.</p>
    </section>
  </div>
</template>
