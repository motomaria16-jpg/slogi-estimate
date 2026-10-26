<script setup lang="ts">
import { formatDate } from '~/utils/format'

useHead({ title: 'Поиск помещений' })
const { ready } = useSlogiRuntime()
const { items, loading, loaded, error, meta, load, takeIntoWork, remove } = useListings()
const { openProject, openDraft, createProject } = usePropertyModal()
const { show } = useToast()
const selectedId = ref('')
const competitiveInput = ref<HTMLInputElement | null>(null)

function idOf(item: any) { return String(item.id || item.externalId || item.listingUrl || '') }
function open(item: any) {
  selectedId.value = idOf(item)
  item.phase0 ? openProject(item.id, 'search', 'object') : openDraft(item, 'search')
}
async function take(item: any) {
  try { const project = await takeIntoWork(item); show('Помещение добавлено в работу.'); if (project) navigateTo('/in-work.html') }
  catch (reason) { show(reason instanceof Error ? reason.message : 'Не удалось взять помещение в работу.', 'error') }
}
function discard(item: any) {
  if (!confirm(`Удалить из списка помещение «${item.address || 'без адреса'}»?`)) return
  try { remove(item); show('Помещение удалено из списка.') }
  catch (reason) { show(reason instanceof Error ? reason.message : 'Не удалось удалить помещение.', 'error') }
}
async function importCompetitive(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const runtime = useSlogiRuntime().api()
    if (!runtime) throw new Error('Приложение ещё загружается.')
    const snapshot = await runtime.phase0.competitiveRepository.importFile(file)
    if (snapshot.status === 'error') throw new Error(snapshot.error)
    runtime.phase0.phase0Service.applyCompetitiveRows(snapshot)
    show(`Конкурентный анализ обновлён: ${snapshot.rows.length} кластеров.`)
  } catch (reason) { show(reason instanceof Error ? reason.message : 'Не удалось загрузить файл.', 'error') }
  finally { (event.target as HTMLInputElement).value = '' }
}
const updatedAt = computed(() => meta.value?.lastRunAt || meta.value?.snapshotAt || '')
const sourceState = computed(() => error.value ? 'Ошибка' : meta.value?.partial ? 'Частично' : loaded.value ? 'Работает' : 'Проверка')
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="page-title-line"><h1>Поиск помещений</h1><span v-if="updatedAt" class="page-meta">Обновлено: <strong>{{ formatDate(updatedAt) }}</strong></span></div>
      <div class="page-actions">
        <button class="button" type="button" @click="competitiveInput?.click()">Конкурентный анализ</button>
        <input ref="competitiveInput" hidden type="file" accept=".xlsx" @change="importCompetitive" />
        <button class="button" type="button" @click="createProject('search')">Добавить помещение</button>
        <button class="button" type="button" :disabled="loading" @click="load">Обновить</button>
      </div>
    </header>

    <section class="rules-bar" aria-label="Условия парсинга">
      <span class="rules-icon">⌕</span><strong>Условия парсинга</strong>
      <div class="chips"><span>100–150 м²</span><span>Только 1 этаж</span><span>Не подвал / цоколь</span><span>Офис</span><span>Торговая площадь</span><span>ПСН</span></div>
      <div class="source-state"><span>Источник объявлений</span><b :class="{ error }">{{ sourceState }}</b></div>
    </section>

    <section class="split-workspace">
      <div class="list-panel">
        <AppLoading v-if="!ready || loading" label="Загружаем предложения…" />
        <div v-else-if="error && !items.length" class="empty-state"><span>⌕</span><h2>Сбор временно приостановлен</h2><p>{{ error }}</p><button class="button" @click="load">Повторить</button></div>
        <div v-else-if="!items.length" class="empty-state"><span>⌕</span><h2>Помещений пока нет</h2><p>Добавьте помещение вручную или обновите список позже.</p></div>
        <div v-else class="premises-list">
          <PremisesCard v-for="item in items" :key="idOf(item)" :item="item" context="search" :selected="selectedId === idOf(item)" @open="open" @primary="take" @remove="discard" />
        </div>
      </div>
      <aside class="map-panel">
        <div class="panel-heading"><div><h2>Расположение</h2><p>Карта предложений</p></div><span class="count-chip">{{ items.length }} {{ items.length === 1 ? 'точка' : 'точек' }}</span></div>
        <ClientOnly><PremisesMap :items="items" :selected-id="selectedId" show-clusters @select="selectedId = $event" /></ClientOnly>
        <p class="panel-note">Все подходящие объекты с координатами показаны на карте.</p>
      </aside>
    </section>
  </div>
</template>
