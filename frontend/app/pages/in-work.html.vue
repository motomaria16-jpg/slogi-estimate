<script setup lang="ts">
import { pipelineStatus, projectWork } from '~/utils/format'

useHead({ title: 'Помещения в работе' })
const { ready, api } = useSlogiRuntime()
const { projects, inWorkProjects } = useProjects()
const { openProject, createProject } = usePropertyModal()
const { show } = useToast()
const query = ref('')
const status = ref('')
const mode = ref<'list' | 'calendar'>('list')
const selectedId = ref('')
const filters = [{ key: '', label: 'Все' }, { key: 'contact_pending', label: 'Новые' }, { key: 'viewing_scheduled', label: 'Просмотр назначен' }, { key: 'viewing_completed', label: 'Просмотр завершён' }, { key: 'proposal_started', label: 'Готово к КП' }]
const visible = computed(() => inWorkProjects.value.filter(project => {
  const haystack = [project.address, project.clusterName, projectWork(project)?.landlordContact?.name, projectWork(project)?.landlordContact?.phone].join(' ').toLocaleLowerCase('ru')
  return (!query.value || haystack.includes(query.value.toLocaleLowerCase('ru'))) && (!status.value || pipelineStatus(project) === status.value)
}))
function open(project: any, tab: 'object' | 'workflow' = 'object') { selectedId.value = project.id; openProject(project.id, 'in-work', tab) }
function reject(project: any) { open(project, 'workflow') }
function schedule(project: any) { open(project, 'workflow') }
function idOf(item: any) { return String(item.id) }
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="page-title-line"><h1>Помещения в работе</h1><span class="count-chip">{{ inWorkProjects.length }} {{ inWorkProjects.length === 1 ? 'объект' : 'объектов' }}</span></div>
      <div class="page-actions"><button class="button" @click="createProject('in-work')">Добавить помещение</button><div class="segmented"><button :class="{ active: mode === 'list' }" @click="mode = 'list'">Список и карта</button><button :class="{ active: mode === 'calendar' }" @click="mode = 'calendar'">Календарь</button></div></div>
    </header>
    <template v-if="mode === 'list'">
      <section class="filter-bar"><label class="search-field"><span>⌕</span><input v-model="query" type="search" placeholder="Поиск по адресу, контакту или ответственному" /></label><div class="filter-chips"><button v-for="filter in filters" :key="filter.key" :class="{ active: status === filter.key }" @click="status = filter.key">{{ filter.label }}</button></div></section>
      <section class="split-workspace">
        <div class="list-panel">
          <AppLoading v-if="!ready" />
          <div v-else-if="!visible.length" class="empty-state"><span>⌕</span><h2>Ничего не найдено</h2><p>Измените фильтры или добавьте помещение.</p></div>
          <div v-else class="premises-list"><PremisesCard v-for="project in visible" :key="project.id" :item="project" context="in-work" :selected="selectedId === project.id" @open="open" @primary="schedule" @reject="reject" /></div>
        </div>
        <aside class="map-panel"><div class="panel-heading"><h2>Карта</h2><span class="count-chip">{{ visible.length }} {{ visible.length === 1 ? 'точка' : 'точек' }}</span></div><ClientOnly><PremisesMap :items="visible" :selected-id="selectedId" show-clusters @select="selectedId = $event" /></ClientOnly><p class="panel-note">Все кластеры и помещения в работе показаны на одной карте.</p></aside>
      </section>
    </template>
    <WorkCalendarPanel v-else :projects="projects" />
  </div>
</template>
