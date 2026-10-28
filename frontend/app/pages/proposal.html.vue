<script setup lang="ts">
import { projectWork } from '~/utils/format'

useHead({ title: 'Коммерческое предложение' })
const { ready } = useSlogiRuntime()
const { projects, proposalProjects } = useProjects()
const { openProject } = usePropertyModal()
const query = ref('')
const filter = ref('')
const mode = ref<'list' | 'calendar'>('list')
const selectedId = ref('')
const filters = [{ key: '', label: 'Все' }, { key: 'draft', label: 'Подготовка' }, { key: 'prepared', label: 'Готово к отправке' }, { key: 'sent', label: 'Отправлено' }]
const visible = computed(() => proposalProjects.value.filter(project => {
  const proposal = projectWork(project).proposal || {}
  const search = [project.address, project.clusterName, projectWork(project).landlordContact?.name].join(' ').toLocaleLowerCase('ru')
  return (!query.value || search.includes(query.value.toLocaleLowerCase('ru'))) && (!filter.value || (proposal.status || 'draft') === filter.value)
}))
function open(project: any) { selectedId.value = project.id; openProject(project.id, 'proposal', 'proposal') }
</script>

<template>
  <div class="page">
    <header class="page-header"><div class="page-title-line"><h1>Коммерческое предложение</h1><span class="count-chip">{{ proposalProjects.length }} {{ proposalProjects.length === 1 ? 'объект' : 'объектов' }}</span></div><WorkspacePageActions v-model="mode" /></header>
    <template v-if="mode === 'list'">
      <section class="filter-bar"><label class="search-field"><span>⌕</span><input v-model="query" type="search" placeholder="Поиск по адресу, кластеру или контакту" /></label><div class="filter-chips"><button v-for="item in filters" :key="item.key" :class="{ active: filter === item.key }" @click="filter = item.key">{{ item.label }}</button></div></section>
      <section class="split-workspace">
      <div class="list-panel">
        <AppLoading v-if="!ready" />
        <div v-else-if="!visible.length" class="empty-state"><span>⌕</span><h2>Помещений на этапе КП пока нет</h2><p>После завершения просмотра нажмите «Сформировать КП» в карточке помещения.</p><NuxtLink class="button primary" to="/in-work.html">Перейти в «Помещения в работе»</NuxtLink></div>
        <div v-else class="premises-list"><PremisesCard v-for="project in visible" :key="project.id" :item="project" context="proposal" :selected="selectedId === project.id" @open="open" @primary="open" /></div>
      </div>
      <aside class="map-panel">
        <div class="panel-heading"><div><h2>Расположение</h2><p>Объекты на этапе КП</p></div><span class="count-chip">{{ visible.length }} {{ visible.length === 1 ? 'точка' : 'точек' }}</span></div>
        <ClientOnly><PremisesMap :items="visible" :selected-id="selectedId" show-clusters @select="selectedId = $event" /></ClientOnly>
        <p class="panel-note">Все кластеры и помещения на этапе КП показаны на одной карте.</p>
      </aside>
      </section>
    </template>
    <WorkCalendarPanel v-else :projects="projects" />
  </div>
</template>
