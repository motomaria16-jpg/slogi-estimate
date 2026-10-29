<script setup lang="ts">
import { projectWork } from '~/utils/format'

type RepairSection = 'documents' | 'repair' | 'handover'

const sectionMeta: Record<RepairSection, {
  title: string
  emptyTitle: string
  emptyText: string
  mapTitle: string
  cardContext: 'repair-documents' | 'repair-process' | 'repair-handover'
  modalTab: 'repair-documents' | 'repair-process' | 'repair-handover'
}> = {
  documents: {
    title: 'Документы для ремонта',
    emptyTitle: 'Помещений для подготовки документов пока нет',
    emptyText: 'После нажатия «Согласовано» помещение автоматически появится в этом разделе.',
    mapTitle: 'Объекты на этапе подготовки документов',
    cardContext: 'repair-documents',
    modalTab: 'repair-documents'
  },
  repair: {
    title: 'Процесс ремонта',
    emptyTitle: 'Помещений в ремонте пока нет',
    emptyText: 'Помещения появятся здесь после завершения этапа документов.',
    mapTitle: 'Объекты в ремонте',
    cardContext: 'repair-process',
    modalTab: 'repair-process'
  },
  handover: {
    title: 'Выход из ремонта',
    emptyTitle: 'Помещений на выходе из ремонта пока нет',
    emptyText: 'Помещения появятся здесь на финальном этапе ремонта.',
    mapTitle: 'Объекты на выходе из ремонта',
    cardContext: 'repair-handover',
    modalTab: 'repair-handover'
  }
}

const route = useRoute()
const { ready, api } = useSlogiRuntime()
const { projects, repairProjects } = useProjects()
const { openProject } = usePropertyModal()
const query = ref('')
const mode = ref<'list' | 'calendar'>('list')
const selectedId = ref('')
const requestedSection = computed(() => String(route.query.section || 'documents'))
const section = computed<RepairSection>(() => requestedSection.value in sectionMeta ? requestedSection.value as RepairSection : 'documents')
const meta = computed(() => sectionMeta[section.value])
const stageProjects = computed(() => repairProjects.value.filter(project => api()?.repair?.stageOf?.(project) === section.value))
const visible = computed(() => stageProjects.value.filter(project => {
  const search = [project.address, project.clusterName, projectWork(project)?.landlordContact?.name].join(' ').toLocaleLowerCase('ru')
  return !query.value || search.includes(query.value.toLocaleLowerCase('ru'))
}))

useHead(() => ({ title: meta.value.title }))

if (!(requestedSection.value in sectionMeta)) {
  await navigateTo('/repair.html?section=documents', { replace: true })
}

function open(project: any) {
  selectedId.value = String(project.id)
  openProject(project.id, 'repair', meta.value.modalTab)
}
function openFromMap(id: string) {
  const project = visible.value.find(item => String(item.id) === id)
  if (project) open(project)
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="page-title-line"><h1>{{ meta.title }}</h1><span class="count-chip">{{ stageProjects.length }} {{ stageProjects.length === 1 ? 'объект' : 'объектов' }}</span></div>
      <WorkspacePageActions v-model="mode" />
    </header>
    <template v-if="mode === 'list'">
      <section class="filter-bar">
        <label class="search-field"><span>⌕</span><input v-model="query" type="search" placeholder="Поиск по адресу, кластеру или контакту" /></label>
      </section>
      <section class="split-workspace">
        <div class="list-panel">
          <AppLoading v-if="!ready" />
          <div v-else-if="!visible.length" class="empty-state"><span>○</span><h2>{{ meta.emptyTitle }}</h2><p>{{ meta.emptyText }}</p></div>
          <div v-else class="premises-list">
            <PremisesCard v-for="project in visible" :key="project.id" :item="project" :context="meta.cardContext" :selected="selectedId === String(project.id)" @open="open" @primary="open" />
          </div>
        </div>
        <aside class="map-panel">
          <div class="panel-heading"><div><h2>Расположение</h2><p>{{ meta.mapTitle }}</p></div><span class="count-chip">{{ visible.length }} {{ visible.length === 1 ? 'точка' : 'точек' }}</span></div>
          <ClientOnly><PremisesMap :items="visible" :selected-id="selectedId" show-clusters @select="selectedId = $event" @open="openFromMap" /></ClientOnly>
          <p class="panel-note">Все кластеры и помещения текущего этапа показаны на одной карте.</p>
        </aside>
      </section>
    </template>
    <WorkCalendarPanel v-else :projects="projects" />
  </div>
</template>
