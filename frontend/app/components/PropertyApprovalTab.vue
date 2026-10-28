<script setup lang="ts">
import { formatDate } from '~/utils/format'

const props = defineProps<{ project: any }>()
const emit = defineEmits<{ changed: [project: any]; decision: [project: any, status: 'agreed' | 'rejected'] }>()
const { api } = useSlogiRuntime()
const { show } = useToast()
const protocolInput = ref<HTMLInputElement | null>(null)
const leaseInput = ref<HTMLInputElement | null>(null)
const ownershipInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const rejection = reactive({ reason: '', comment: '' })
const progress = reactive({ active: false, fileName: '', percent: 0, fileIndex: 0, fileCount: 0 })

const approval = computed(() => api()?.approval?.approvalOf(props.project) || { status: 'pending', documents: { protocol: {}, signedLease: {}, ownershipProofs: [] } })
const documents = computed(() => approval.value.documents || { protocol: {}, signedLease: {}, ownershipProofs: [] })
const canAgree = computed(() => Boolean(api()?.approval?.canAgree(props.project)) && !busy.value)
const canReject = computed(() => Boolean(rejection.reason) && (rejection.reason !== 'other' || Boolean(rejection.comment.trim())) && !busy.value)
const actor = computed(() => api()?.pro?.actor?.() || { id: 'workspace-member', name: 'Специалист' })
const reasonOptions = [
  { value: 'rent_rate', label: 'Не сошлись по ставке' },
  { value: 'rent_holidays', label: 'Не сошлись по арендным каникулам' },
  { value: 'contract_terms', label: 'Не сошлись по условиям договора' },
  { value: 'other', label: 'Иная причина' }
]

function runtime() {
  const value = api()
  if (!value) throw new Error('Приложение ещё загружается.')
  return value
}
function fail(reason: unknown) { show(reason instanceof Error ? reason.message : 'Не удалось выполнить действие.', 'error') }
function trigger(kind: 'protocol' | 'signedLease' | 'ownershipProof') {
  if (kind === 'protocol') protocolInput.value?.click()
  else if (kind === 'signedLease') leaseInput.value?.click()
  else ownershipInput.value?.click()
}

async function upload(kind: 'protocol' | 'signedLease' | 'ownershipProof', event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (!files.length) return
  busy.value = true
  Object.assign(progress, { active: true, fileName: files[0]?.name || '', percent: 0, fileIndex: 1, fileCount: files.length })
  try {
    const value = runtime()
    let current = value.phase0.projectRepository.get(props.project.id)
    for (const [index, file] of files.entries()) {
      const attachmentType = kind === 'ownershipProof' ? `approval-ownership-${value.pro.uid('document')}` : `approval-${kind}`
      Object.assign(progress, { fileName: file.name, percent: Math.round(index / files.length * 100), fileIndex: index + 1 })
      await value.workflow.saveAttachment(props.project.id, attachmentType, file, file.name, {
        onProgress(filePercent: number) {
          const normalized = Math.max(0, Math.min(100, Number(filePercent) || 0))
          progress.percent = Math.round((index + normalized / 100) / files.length * 100)
        }
      })
      current = value.phase0.projectRepository.mutate(props.project.id, (project: any) => value.approval.attachDocument(project, {
        kind,
        name: file.name,
        attachmentType,
        mimeType: file.type,
        size: file.size,
        actorId: actor.value.id
      }), current.phase0.revision, `approval-${kind}-upload`)
    }
    emit('changed', current)
    show(files.length === 1 ? 'Документ прикреплён.' : `Прикреплено документов: ${files.length}.`)
  } catch (reason) { fail(reason) }
  finally {
    busy.value = false
    progress.active = false
    input.value = ''
  }
}

async function download(document: any) {
  try {
    const file = await runtime().workflow.getAttachment(props.project.id, document.attachmentType)
    if (!file?.blob) throw new Error('Файл не найден в хранилище.')
    runtime().workflow.download(file.blob, file.name || document.name)
  } catch (reason) { fail(reason) }
}

async function agree() {
  if (!confirm('Зафиксировать согласование и передать помещение на этап «Ремонт»?')) return
  busy.value = true
  try {
    const value = runtime()
    const current = value.phase0.projectRepository.get(props.project.id)
    const saved = value.phase0.projectRepository.mutate(props.project.id, (project: any) => value.approval.agree(project, { actorId: actor.value.id }), current.phase0.revision, 'approval-agreed')
    emit('changed', saved)
    emit('decision', saved, 'agreed')
    show('Условия согласованы. Помещение передано на этап «Ремонт».')
  } catch (reason) { fail(reason) }
  finally { busy.value = false }
}

async function reject() {
  if (!confirm('Зафиксировать отказ и переместить помещение в архив?')) return
  busy.value = true
  try {
    const value = runtime()
    const current = value.phase0.projectRepository.get(props.project.id)
    const saved = value.phase0.projectRepository.mutate(props.project.id, (project: any) => value.approval.reject(project, {
      reason: rejection.reason,
      comment: rejection.comment,
      actorId: actor.value.id
    }), current.phase0.revision, 'approval-rejected')
    emit('changed', saved)
    emit('decision', saved, 'rejected')
    show('Отказ зафиксирован. Помещение перемещено в архив.')
  } catch (reason) { fail(reason) }
  finally { busy.value = false }
}

defineExpose({ agree })
</script>

<template>
  <div class="approval-workflow">
    <section class="form-card approval-documents">
      <div class="card-heading"><h3>Документы согласования</h3><span class="badge status">{{ approval.status === 'pending' ? 'На согласовании' : approval.status === 'agreed' ? 'Согласовано' : 'Не согласовано' }}</span></div>
      <div class="approval-document-row">
        <div><h4>Итоговый протокол разногласий</h4><p>Прикрепите финальную версию при наличии.</p></div>
        <button v-if="documents.protocol?.name" class="approval-file" type="button" @click="download(documents.protocol)"><span>Файл</span><strong>{{ documents.protocol.name }}</strong></button>
        <button class="button compact" type="button" :disabled="busy" @click="trigger('protocol')">{{ documents.protocol?.name ? 'Заменить' : 'Прикрепить' }}</button>
      </div>
      <div class="approval-document-row required">
        <div><h4>Подписанный договор аренды</h4><p>Обязательный документ.</p></div>
        <button v-if="documents.signedLease?.name" class="approval-file" type="button" @click="download(documents.signedLease)"><span>Файл</span><strong>{{ documents.signedLease.name }}</strong></button>
        <button class="button compact" type="button" :disabled="busy" @click="trigger('signedLease')">{{ documents.signedLease?.name ? 'Заменить' : 'Прикрепить' }}</button>
      </div>
      <div class="approval-document-row required ownership-row">
        <div><h4>Документы о праве сдачи помещения</h4><p>Право собственности или иной подтверждающий документ.</p></div>
        <div v-if="documents.ownershipProofs?.length" class="approval-file-list">
          <button v-for="document in documents.ownershipProofs" :key="document.attachmentType" class="approval-file" type="button" @click="download(document)"><span>Файл</span><strong>{{ document.name }}</strong></button>
        </div>
        <button class="button compact" type="button" :disabled="busy" @click="trigger('ownershipProof')">Добавить</button>
      </div>
      <input ref="protocolInput" hidden type="file" accept=".pdf,.doc,.docx" @change="upload('protocol', $event)" />
      <input ref="leaseInput" hidden type="file" accept=".pdf,.doc,.docx" @change="upload('signedLease', $event)" />
      <input ref="ownershipInput" hidden type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" multiple @change="upload('ownershipProof', $event)" />
      <div v-if="progress.active" class="media-progress approval-progress" aria-live="polite"><div><span>Загрузка: {{ progress.fileName }}</span><span>{{ progress.percent }}%</span></div><progress :value="progress.percent" max="100" /><small>Файл {{ progress.fileIndex }} из {{ progress.fileCount }}</small></div>
    </section>

    <section class="form-card approval-decision">
      <div class="card-heading"><h3>Решение об отказе</h3><span v-if="approval.decidedAt" class="badge status">{{ formatDate(approval.decidedAt, true) }}</span></div>
      <label class="stacked-field"><span>Причина отказа</span><select v-model="rejection.reason"><option value="">Выберите причину</option><option v-for="option in reasonOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
      <label class="stacked-field approval-comment"><span>Комментарий</span><textarea v-model="rejection.comment" rows="5" placeholder="Добавьте пояснение к решению" /></label>
      <div class="approval-actions"><button class="button danger" type="button" :disabled="!canReject" @click="reject">Не согласовано</button></div>
    </section>
  </div>
</template>
