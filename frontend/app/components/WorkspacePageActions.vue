<script setup lang="ts">
const mode = defineModel<'list' | 'calendar'>({ required: true })
const { ready, api } = useSlogiRuntime()
const { createProject } = usePropertyModal()
const { show } = useToast()
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const competitiveFileName = ref('')
const competitiveStorageId = 'workspace-competitive-analysis'
const competitiveAttachmentType = 'competitive-source-xlsx'

async function restoreCompetitiveAttachment() {
  if (!import.meta.client) return
  const runtime = api()
  const snapshotName = String(runtime?.phase0?.competitiveRepository?.snapshot?.()?.fileName || '')
  if (!snapshotName || !runtime?.workflow) return
  const file = await runtime.workflow.getAttachment(competitiveStorageId, competitiveAttachmentType)
  competitiveFileName.value = file?.blob ? String(file.name || snapshotName) : ''
}

watch(ready, value => { if (value) restoreCompetitiveAttachment() }, { immediate: true })

async function importCompetitive(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  try {
    const runtime = api()
    if (!runtime?.phase0?.competitiveRepository) throw new Error('Модуль конкурентного анализа ещё загружается.')
    const snapshot = await runtime.phase0.competitiveRepository.importFile(file)
    if (snapshot.status === 'error') throw new Error(snapshot.error || 'Не удалось прочитать файл.')
    await runtime.workflow.saveAttachment(competitiveStorageId, competitiveAttachmentType, file, file.name)
    runtime.phase0.phase0Service.applyCompetitiveRows(snapshot)
    competitiveFileName.value = file.name
    show(`Конкурентный анализ обновлён: ${snapshot.rows?.length || 0} кластеров.`)
  } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось загрузить конкурентный анализ.', 'error')
  } finally {
    importing.value = false
    input.value = ''
  }
}

async function downloadCompetitive() {
  try {
    const runtime = api()
    if (!runtime?.workflow) throw new Error('Модуль файлов ещё загружается.')
    const file = await runtime.workflow.getAttachment(competitiveStorageId, competitiveAttachmentType)
    if (!file?.blob) throw new Error('Исходный файл конкурентного анализа не найден в хранилище.')
    runtime.workflow.download(file.blob, file.name || competitiveFileName.value || 'Конкурентный анализ.xlsx')
  } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось скачать конкурентный анализ.', 'error')
  }
}
</script>

<template>
  <div class="page-actions">
    <button class="button" :disabled="importing" @click="fileInput?.click()">{{ importing ? 'Загрузка…' : 'Конкурентный анализ' }}</button>
    <input ref="fileInput" hidden type="file" accept=".xlsx" @change="importCompetitive" />
    <button v-if="competitiveFileName" class="button" type="button" :title="competitiveFileName" @click="downloadCompetitive">Скачать анализ</button>
    <button class="button" @click="createProject('in-work')">Добавить помещение</button>
    <div class="segmented" aria-label="Режим страницы">
      <button :class="{ active: mode === 'list' }" @click="mode = 'list'">Список и карта</button>
      <button :class="{ active: mode === 'calendar' }" @click="mode = 'calendar'">Календарь</button>
    </div>
  </div>
</template>
