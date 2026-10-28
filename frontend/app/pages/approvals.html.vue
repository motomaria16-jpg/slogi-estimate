<script setup lang="ts">
import { projectWork } from '~/utils/format'

useHead({ title: 'Согласование' })
const { ready, api } = useSlogiRuntime()
const { projects, approvalProjects } = useProjects()
const { openProject } = usePropertyModal()
const query = ref('')
const filter = ref('')
const mode = ref<'list' | 'calendar'>('list')
const selectedId = ref('')
const filters = [{ key: '', label: 'Все' }, { key: 'documents_missing', label: 'Нужны документы' }, { key: 'ready', label: 'Готово к решению' }]
const visible = computed(() => approvalProjects.value.filter((project) => {
  const search = [project.address, project.clusterName, projectWork(project).landlordContact?.name].join(' ').toLocaleLowerCase('ru')
  const required = api()?.approval?.requiredDocuments?.(projectWork(project).approval) || { signedLease: false, ownershipProof: false }
  const readiness = required.signedLease && required.ownershipProof ? 'ready' : 'documents_missing'
  return (!query.value || search.includes(query.value.toLocaleLowerCase('ru'))) && (!filter.value || readiness === filter.value)
}))
function open(project: any) { selectedId.value = project.id; openProject(project.id, 'approval', 'approval') }
function openFromMap(id: string) { const project = visible.value.find(item => String(item.id) === id); if (project) open(project) }
function reject(project: any) { open(project) }
</script>

<template>
  <div class="page">
    <header class="page-header"><div class="page-title-line"><h1>Согласование</h1><span class="count-chip">{{ approvalProjects.length }} {{ approvalProjects.length === 1 ? 'объект' : 'объектов' }}</span></div><WorkspacePageActions v-model="mode" /></header>
    <template v-if="mode === 'list'">
      <section class="filter-bar"><label class="search-field"><span>⌕</span><input v-model="query" type="search" placeholder="Поиск по адресу, кластеру или контакту" /></label><div class="filter-chips"><button v-for="item in filters" :key="item.key" :class="{ active: filter === item.key }" @click="filter = item.key">{{ item.label }}</button></div></section>
      <section class="split-workspace">
        <div class="list-panel">
          <AppLoading v-if="!ready" />
          <div v-else-if="!visible.length" class="empty-state"><span>✓</span><h2>Помещений на согласовании пока нет</h2><p>После нажатия «КП отправлено» помещение автоматически появится в этом разделе.</p><NuxtLink class="button primary" to="/proposal.html">Перейти к коммерческим предложениям</NuxtLink></div>
          <div v-else class="premises-list"><PremisesCard v-for="project in visible" :key="project.id" :item="project" context="approval" :selected="selectedId === project.id" @open="open" @primary="open" @reject="reject" /></div>
        </div>
        <aside class="map-panel">
          <div class="panel-heading"><div><h2>Расположение</h2><p>Объекты на согласовании</p></div><span class="count-chip">{{ visible.length }} {{ visible.length === 1 ? 'точка' : 'точек' }}</span></div>
          <ClientOnly><PremisesMap :items="visible" :selected-id="selectedId" show-clusters @select="selectedId = $event" @open="openFromMap" /></ClientOnly>
          <p class="panel-note">Все кластеры и помещения на согласовании показаны на одной карте.</p>
        </aside>
      </section>
    </template>
    <WorkCalendarPanel v-else :projects="projects" />
  </div>
</template>
