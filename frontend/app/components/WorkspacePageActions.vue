<script setup lang="ts">
const mode = defineModel<'list' | 'calendar'>({ required: true })
const { api } = useSlogiRuntime()
const { createProject } = usePropertyModal()
const { show } = useToast()
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)

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
    runtime.phase0.phase0Service.applyCompetitiveRows(snapshot)
    show(`Конкурентный анализ обновлён: ${snapshot.rows?.length || 0} кластеров.`)
  } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось загрузить конкурентный анализ.', 'error')
  } finally {
    importing.value = false
    input.value = ''
  }
}
</script>

<template>
  <div class="page-actions">
    <button class="button" :disabled="importing" @click="fileInput?.click()">{{ importing ? 'Загрузка…' : 'Конкурентный анализ' }}</button>
    <input ref="fileInput" hidden type="file" accept=".xlsx,.xls" @change="importCompetitive" />
    <button class="button" @click="createProject('in-work')">Добавить помещение</button>
    <div class="segmented" aria-label="Режим страницы">
      <button :class="{ active: mode === 'list' }" @click="mode = 'list'">Список и карта</button>
      <button :class="{ active: mode === 'calendar' }" @click="mode = 'calendar'">Календарь</button>
    </div>
  </div>
</template>
