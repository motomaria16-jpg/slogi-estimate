<script setup lang="ts">
import { approvalTabReady, proposalTabReady } from '~/utils/format'

const { state, close } = usePropertyModal()
const { projects, refresh } = useProjects()
const { ready, api } = useSlogiRuntime()
const { show } = useToast()
const dialog = ref<HTMLDialogElement | null>(null)
const approvalTab = ref<{ agree: () => Promise<void> } | null>(null)
const activeTab = ref<'object' | 'workflow' | 'proposal' | 'approval'>('object')
const form = reactive<any>({})
const saving = ref(false)
const project = computed(() => state.value.projectId ? projects.value.find(item => String(item.id) === String(state.value.projectId)) || null : null)
const isInWork = computed(() => Boolean(project.value && api()?.phase0?.spaceLifecycle?.hasLeftSearch?.(project.value)) || state.value.context !== 'search')
const canOpenProposal = computed(() => Boolean(project.value && proposalTabReady(project.value)))
const canOpenApproval = computed(() => Boolean(project.value && approvalTabReady(project.value)))
const canAgreeApproval = computed(() => Boolean(project.value && api()?.approval?.canAgree?.(project.value)))
const listingUrl = computed(() => String(
  form.listingUrl
  || project.value?.listingUrl
  || project.value?.canonicalUrl
  || project.value?.phase0?.listingUrl
  || project.value?.phase0?.canonicalUrl
  || project.value?.phase0?.spaceCard?.listingUrl
  || ''
).trim())
const tabs = computed(() => [
  { key: 'object', label: 'Объект', enabled: true, hint: '' },
  { key: 'workflow', label: 'Сопровождение', enabled: isInWork.value, hint: 'Доступно после добавления помещения в работу' },
  { key: 'proposal', label: 'КП', enabled: canOpenProposal.value, hint: 'Доступно после завершения просмотра и добавления фото и видео' },
  { key: 'approval', label: 'Согласование', enabled: canOpenApproval.value, hint: 'Доступно после отправки КП' }
] as { key: 'object' | 'workflow' | 'proposal' | 'approval'; label: string; enabled: boolean; hint: string }[])
const titleAddress = computed(() => form.address || project.value?.address || 'Новое помещение')

function runtime() {
  const value = api()
  if (!value) throw new Error('Приложение ещё загружается.')
  return value
}

function cardFrom(source: any) {
  const runtime = api()
  const raw = source?.phase0 ? source.phase0.spaceCard || {} : source || {}
  const card = runtime?.phase0 && window.SlogiSearchSpaceCard ? window.SlogiSearchSpaceCard.normalize({
    ...raw,
    id: source?.id || raw.id,
    source: source?.phase0?.source || source?.source || raw.source || 'manual',
    listingUrl: source?.phase0?.listingUrl || source?.listingUrl || raw.listingUrl || '',
    address: source?.address || raw.address || '',
    geo: raw.geo || { lat: source?.latitude, lng: source?.longitude },
    cluster: raw.cluster || { id: source?.clusterId || '', name: source?.clusterName || '', status: source?.clusterId || source?.clusterName ? 'inside' : 'not_computed', hasSlogiCenter: null },
    competitive: raw.competitive || {},
    rentMonthly: raw.rentMonthly ?? source?.rentMonthly ?? source?.phase0?.rent?.amount,
    area: raw.area ?? source?.area,
    ceilingHeight: raw.ceilingHeight ?? source?.ceilingHeight
  }) : raw
  return card
}

function resetForm() {
  const source = project.value || state.value.draft || {}
  const card = cardFrom(source)
  Object.keys(form).forEach(key => delete form[key])
  Object.assign(form, {
    id: source.id || '',
    externalId: source.externalId || source.phase0?.externalId || '',
    title: source.title || source.phase0?.listingTitle || '',
    description: source.description || source.phase0?.listingDescription || '',
    source: source.source || source.phase0?.source || 'manual',
    address: card.address || source.address || '',
    listingUrl: card.listingUrl || source.listingUrl || source.canonicalUrl || source.phase0?.listingUrl || source.phase0?.canonicalUrl || '',
    latitude: card.geo?.lat ?? source.latitude ?? null,
    longitude: card.geo?.lng ?? source.longitude ?? null,
    clusterId: card.cluster?.id || source.clusterId || '',
    clusterName: card.cluster?.name || source.clusterName || '',
    clusterInside: card.cluster?.status === 'inside' ? 'yes' : card.cluster?.status === 'outside' ? 'no' : 'unknown',
    hasSlogiCenter: card.cluster?.hasSlogiCenter === true ? 'yes' : card.cluster?.hasSlogiCenter === false ? 'no' : 'unknown',
    clusterRank: card.competitive?.rank ?? null,
    averageRentPerSqm: card.competitive?.averageRentPerSqm ?? null,
    rentMonthly: card.rentMonthly ?? source.rentMonthly ?? null,
    area: card.area ?? source.area ?? null,
    areaConfirmed: card.areaConfirmed || 'unknown',
    separateEntrance: card.separateEntrance || 'unknown',
    hasWindows: card.hasWindows || 'unknown',
    windowsOpen: card.windowsOpen || 'unknown',
    ceilingHeight: card.ceilingHeight ?? source.ceilingHeight ?? null,
    ceilingHeightConfirmed: card.ceilingHeightConfirmed || 'unknown',
    repair: card.repair || '',
    work: card.work || {}
  })
}

watch(() => state.value.open, open => {
  if (!import.meta.client) return
  if (open) {
    activeTab.value = state.value.initialTab === 'approval' && !canOpenApproval.value
      ? (canOpenProposal.value ? 'proposal' : isInWork.value ? 'workflow' : 'object')
      : state.value.initialTab === 'proposal' && !canOpenProposal.value
        ? (isInWork.value ? 'workflow' : 'object')
        : state.value.initialTab === 'workflow' && !isInWork.value ? 'object' : state.value.initialTab
    nextTick(() => { resetForm(); dialog.value?.showModal() })
  } else if (dialog.value?.open) dialog.value.close()
})
watch(project, () => { if (state.value.open) resetForm() }, { deep: true })
watch(canOpenProposal, enabled => {
  if (!enabled && activeTab.value === 'proposal') activeTab.value = isInWork.value ? 'workflow' : 'object'
})
watch(canOpenApproval, enabled => {
  if (!enabled && activeTab.value === 'approval') activeTab.value = canOpenProposal.value ? 'proposal' : isInWork.value ? 'workflow' : 'object'
})

function selectTab(key: 'object' | 'workflow' | 'proposal' | 'approval') {
  const tab = tabs.value.find(item => item.key === key)
  if (tab?.enabled) activeTab.value = key
}

function handleClose() { if (state.value.open) close() }
async function resolveAddress() {
  try {
    const result = await runtime().phase0.phase0Service.resolveSpaceAddress(form.address, project.value?.id || '')
    form.address = result.address || form.address
    form.latitude = result.geo?.lat ?? null
    form.longitude = result.geo?.lng ?? null
    form.clusterId = result.cluster?.id || ''
    form.clusterName = result.cluster?.name || ''
    form.clusterInside = result.cluster?.status === 'inside' ? 'yes' : 'no'
    form.hasSlogiCenter = result.cluster?.hasSlogiCenter === true ? 'yes' : result.cluster?.hasSlogiCenter === false ? 'no' : 'unknown'
    form.clusterRank = result.competitive?.rank ?? null
    form.averageRentPerSqm = result.competitive?.averageRentPerSqm ?? null
    show('Адрес и кластер определены.')
  } catch (reason) { show(reason instanceof Error ? reason.message : 'Не удалось определить адрес.', 'error') }
}

function saveDraft() {
  const existing = project.value
  return {
    spaceCard: {
      ...(existing?.phase0?.spaceCard || {}),
      id: existing?.id || form.id,
      source: form.source,
      listingUrl: form.listingUrl,
      address: form.address,
      geo: { lat: form.latitude, lng: form.longitude, resolutionSource: 'manual' },
      cluster: { id: form.clusterId || form.clusterName, name: form.clusterName, status: form.clusterInside === 'yes' ? 'inside' : form.clusterInside === 'no' ? 'outside' : 'not_computed', matched: form.clusterInside === 'yes', hasSlogiCenter: form.hasSlogiCenter === 'yes' ? true : form.hasSlogiCenter === 'no' ? false : null, resolutionSource: 'manual' },
      competitive: { rank: form.clusterRank, rating: form.clusterRank, isTop35: form.clusterRank == null ? null : Number(form.clusterRank) <= 35, averageRentPerSqm: form.averageRentPerSqm, resolutionSource: 'manual' },
      rentMonthly: form.rentMonthly,
      area: form.area,
      areaConfirmed: form.areaConfirmed,
      areaConfirmedSource: 'manual',
      separateEntrance: form.separateEntrance,
      hasWindows: form.hasWindows,
      windowsOpen: form.windowsOpen,
      ceilingHeight: form.ceilingHeight,
      ceilingHeightConfirmed: form.ceilingHeightConfirmed,
      repair: form.repair,
      work: form.work
    },
    listingUrl: form.listingUrl,
    canonicalUrl: form.listingUrl,
    externalId: form.externalId,
    listingTitle: form.title,
    listingDescription: form.description,
    address: form.address,
    latitude: form.latitude,
    longitude: form.longitude,
    clusterId: form.clusterId || form.clusterName,
    clusterName: form.clusterName,
    area: form.area,
    rentMonthly: form.rentMonthly,
    floor: project.value?.floor ?? state.value.draft?.floor,
    totalFloors: project.value?.phase0?.totalFloors ?? state.value.draft?.totalFloors,
    premiseType: project.value?.phase0?.premiseType ?? state.value.draft?.premiseType,
    hasBasementOrSocle: project.value?.phase0?.hasBasementOrSocle ?? state.value.draft?.hasBasementOrSocle,
    ceilingHeight: form.ceilingHeight,
    status: project.value?.phase0?.status || runtime().phase0.STATUS.NO_ANSWER,
    interestConfirmed: project.value?.phase0?.interest?.confirmed || false,
    measurementStatus: project.value?.phase0?.measurement?.status || 'Не назначен'
  }
}

async function save() {
  if (activeTab.value !== 'object') { close(); return }
  saving.value = true
  try {
    const value = runtime()
    let saved = await value.phase0.phase0Service.save(saveDraft(), { projectId: project.value?.id || '', expectedRevision: project.value?.phase0?.revision ?? null })
    if (!project.value && state.value.context === 'in-work') saved = value.phase0.phase0Service.takeSpaceIntoWork(saved.id)
    state.value.projectId = saved.id
    state.value.draft = undefined
    refresh()
    show('Карточка помещения сохранена.')
    close()
  } catch (reason) { show(reason instanceof Error ? reason.message : 'Не удалось сохранить карточку.', 'error') }
  finally { saving.value = false }
}

function changed(saved: any) { refresh(); state.value.projectId = saved.id; resetForm() }
function toProposal(saved: any) { changed(saved); activeTab.value = 'proposal'; navigateTo('/proposal.html') }
function toApproval(saved: any) { changed(saved); activeTab.value = 'approval'; navigateTo('/approvals.html') }
function approvalDecision(saved: any, status: 'agreed' | 'rejected') {
  changed(saved)
  close()
  if (status === 'agreed') navigateTo('/under-development.html?section=repair')
}
function agreeApproval() { return approvalTab.value?.agree() }
</script>

<template>
  <dialog ref="dialog" class="property-dialog" @close="handleClose" @cancel.prevent="close">
    <div v-if="state.open" class="property-card">
      <header class="property-header"><div class="property-header__main"><h2>Карточка помещения</h2><p>{{ titleAddress }}</p></div><div class="property-header__actions"><a v-if="listingUrl" :href="listingUrl" target="_blank" rel="noopener">Открыть объявление</a><button class="close-button" aria-label="Закрыть" @click="close">×</button></div></header>
      <nav class="property-tabs" aria-label="Разделы карточки">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :class="{ active: activeTab === tab.key, locked: !tab.enabled }"
          :disabled="!tab.enabled"
          :title="tab.enabled ? '' : tab.hint"
          @click="selectTab(tab.key)"
        >{{ tab.label }}<span v-if="!tab.enabled" class="tab-lock" aria-hidden="true">·</span></button>
      </nav>
      <div class="property-body">
        <AppLoading v-if="!ready" />
        <PropertyObjectTab v-else-if="activeTab === 'object'" v-model="form" @resolve="resolveAddress" />
        <PropertyWorkflowTab v-else-if="activeTab === 'workflow' && project" :project="project" @changed="changed" @proposal="toProposal" />
        <PropertyProposalTab v-else-if="activeTab === 'proposal' && project" :project="project" @changed="changed" @approval="toApproval" />
        <PropertyApprovalTab v-else-if="activeTab === 'approval' && project" ref="approvalTab" :project="project" @changed="changed" @decision="approvalDecision" />
      </div>
      <footer class="property-footer"><button v-if="activeTab === 'approval'" class="button accent" :disabled="!canAgreeApproval" @click="agreeApproval">Согласовано</button><button class="button" @click="close">Отменить</button><button class="button primary" :disabled="saving" @click="save">Сохранить</button></footer>
    </div>
  </dialog>
</template>
