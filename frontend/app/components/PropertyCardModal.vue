<script setup lang="ts">
import { approvalTabReady, listingUrlOf, proposalTabReady, repairTabsReady, workflowTabReady } from '~/utils/format'

type PropertyTab = 'object' | 'workflow' | 'proposal' | 'approval' | 'repair-documents' | 'repair-process' | 'repair-handover'

const { state, close } = usePropertyModal()
const { projects, refresh } = useProjects()
const { ready, api } = useSlogiRuntime()
const { show } = useToast()
const dialog = ref<HTMLDialogElement | null>(null)
const approvalTab = ref<{ agree: () => Promise<void> } | null>(null)
const activeTab = ref<PropertyTab>('object')
const form = reactive<any>({})
const saving = ref(false)
const modalError = ref('')
const project = computed(() => state.value.projectId ? projects.value.find(item => String(item.id) === String(state.value.projectId)) || null : null)
const hasLeftSearch = computed(() => Boolean(project.value && api()?.phase0?.spaceLifecycle?.hasLeftSearch?.(project.value)))
const canOpenProposal = computed(() => Boolean(project.value && proposalTabReady(project.value)))
const canOpenApproval = computed(() => Boolean(project.value && approvalTabReady(project.value)))
const canOpenRepairDocuments = computed(() => Boolean(project.value && (api()?.repair?.canOpenStage?.(project.value, 'documents') ?? repairTabsReady(project.value))))
const canOpenRepairProcess = computed(() => Boolean(project.value && api()?.repair?.canOpenStage?.(project.value, 'repair')))
const canOpenRepairHandover = computed(() => Boolean(project.value && api()?.repair?.canOpenStage?.(project.value, 'handover')))
const canOpenRepair = computed(() => canOpenRepairDocuments.value)
const canOpenWorkflow = computed(() => Boolean(
  project.value
    && hasLeftSearch.value
    && workflowTabReady(project.value, import.meta.client ? window.SlogiSearchSpaceCard?.evaluate : undefined)
))
const canAgreeApproval = computed(() => Boolean(project.value && api()?.approval?.canAgree?.(project.value)))
const listingUrl = computed(() => listingUrlOf(form.listingUrl, project.value, state.value.draft))
const propertyTabs = computed(() => [
  { key: 'object', label: 'Объект', enabled: true, hint: '' },
  { key: 'workflow', label: 'Сопровождение', enabled: canOpenWorkflow.value, hint: 'Доступно после заполнения и сохранения всех данных об объекте' },
  { key: 'proposal', label: 'КП', enabled: canOpenProposal.value, hint: 'Доступно после завершения просмотра и добавления фото и видео' },
  { key: 'approval', label: 'Согласование', enabled: canOpenApproval.value, hint: 'Доступно после отправки КП' }
] as { key: PropertyTab; label: string; enabled: boolean; hint: string }[])
const repairTabs = computed(() => [
  { key: 'repair-documents', label: 'Документы', enabled: canOpenRepairDocuments.value, hint: 'Доступно после согласования помещения' },
  { key: 'repair-process', label: 'Ремонт', enabled: canOpenRepairProcess.value, hint: 'Доступно после завершения подготовки документов' },
  { key: 'repair-handover', label: 'Выход из ремонта', enabled: canOpenRepairHandover.value, hint: 'Доступно после завершения ремонта' }
] as { key: PropertyTab; label: string; enabled: boolean; hint: string }[])
const activeGroup = computed(() => activeTab.value.startsWith('repair-') ? 'repair' : 'property')
const visibleTabs = computed(() => activeGroup.value === 'repair' ? repairTabs.value : propertyTabs.value)
const titleAddress = computed(() => form.address || project.value?.address || 'Новое помещение')

function runtime() {
  const value = api()
  if (!value) throw new Error('Приложение ещё загружается.')
  return value
}

function propertyErrorMessage(reason: unknown, fallback: string) {
  const error = reason as any
  const fieldErrors = error?.details?.errors
  if (fieldErrors && typeof fieldErrors === 'object') {
    const messages = [...new Set(Object.values(fieldErrors).map(value => String(value || '').trim()).filter(Boolean))]
    if (messages.length) return messages.join(' ')
  }
  if (error?.code === 'POTENTIAL_DUPLICATE') {
    const duplicate = Array.isArray(error?.details?.duplicates) ? error.details.duplicates[0] : null
    const address = String(duplicate?.project?.address || '').trim()
    const reasons = Array.isArray(duplicate?.reasons) ? duplicate.reasons.map(String).filter(Boolean).join(', ') : ''
    return `Похожий объект уже существует${address ? `: ${address}` : ''}.${reasons ? ` Причина: ${reasons}.` : ''}`
  }
  return error instanceof Error && error.message ? error.message : fallback
}

function cardFrom(source: any) {
  const runtime = api()
  const raw = source?.phase0 ? source.phase0.spaceCard || {} : source || {}
  const card = runtime?.phase0 && window.SlogiSearchSpaceCard ? window.SlogiSearchSpaceCard.normalize({
    ...raw,
    id: source?.id || raw.id,
    source: source?.phase0?.source || source?.source || raw.source || 'manual',
    listingUrl: listingUrlOf(source, raw),
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
    listingUrl: listingUrlOf(card, source),
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
    modalError.value = ''
    const requested = state.value.initialTab as PropertyTab
    const requestedTab = [...propertyTabs.value, ...repairTabs.value].find(tab => tab.key === requested)
    const propertyFallback: PropertyTab = canOpenApproval.value ? 'approval' : canOpenProposal.value ? 'proposal' : canOpenWorkflow.value ? 'workflow' : 'object'
    activeTab.value = requestedTab?.enabled
      ? requested
      : requested.startsWith('repair-') && canOpenRepairDocuments.value ? 'repair-documents' : propertyFallback
    nextTick(() => { resetForm(); dialog.value?.showModal() })
  } else if (dialog.value?.open) dialog.value.close()
})
watch(project, () => { if (state.value.open) resetForm() }, { deep: true })
watch(canOpenProposal, enabled => {
  if (!enabled && activeTab.value === 'proposal') activeTab.value = canOpenWorkflow.value ? 'workflow' : 'object'
})
watch(canOpenApproval, enabled => {
  if (!enabled && activeTab.value === 'approval') activeTab.value = canOpenProposal.value ? 'proposal' : canOpenWorkflow.value ? 'workflow' : 'object'
})
watch(canOpenWorkflow, enabled => {
  if (!enabled && activeTab.value === 'workflow') activeTab.value = 'object'
})
watch(canOpenRepair, enabled => {
  if (!enabled && activeTab.value.startsWith('repair-')) activeTab.value = canOpenApproval.value ? 'approval' : 'object'
})

function selectTab(key: PropertyTab) {
  const tab = [...propertyTabs.value, ...repairTabs.value].find(item => item.key === key)
  if (tab?.enabled) activeTab.value = key
}

function selectGroup(group: 'property' | 'repair') {
  if (group === 'repair' && !canOpenRepair.value) return
  activeTab.value = group === 'repair' ? 'repair-documents' : 'object'
}

function handleClose() { if (state.value.open) close() }
async function resolveAddress() {
  modalError.value = ''
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
  } catch (reason) { modalError.value = propertyErrorMessage(reason, 'Не удалось определить адрес.') }
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
  modalError.value = ''
  saving.value = true
  try {
    const value = runtime()
    let saved = await value.phase0.phase0Service.save(saveDraft(), { projectId: project.value?.id || '', expectedRevision: project.value?.phase0?.revision ?? null })
    if (state.value.context === 'in-work' && !value.phase0.spaceLifecycle.hasLeftSearch(saved)) {
      state.value.projectId = saved.id
      refresh()
      saved = value.phase0.phase0Service.takeSpaceIntoWork(saved.id)
    }
    state.value.projectId = saved.id
    state.value.draft = undefined
    refresh()
    show('Карточка помещения сохранена.')
    close()
  } catch (reason) { modalError.value = propertyErrorMessage(reason, 'Не удалось сохранить карточку.') }
  finally { saving.value = false }
}

function changed(saved: any) { refresh(); state.value.projectId = saved.id; resetForm() }
function toProposal(saved: any) { changed(saved); activeTab.value = 'proposal'; navigateTo('/proposal.html') }
function toApproval(saved: any) { changed(saved); activeTab.value = 'approval'; navigateTo('/approvals.html') }
function approvalDecision(saved: any, status: 'agreed' | 'rejected') {
  changed(saved)
  close()
  if (status === 'agreed') navigateTo('/repair.html?section=documents')
}
function agreeApproval() { return approvalTab.value?.agree() }
</script>

<template>
  <dialog ref="dialog" class="property-dialog" @close="handleClose" @cancel.prevent="close">
    <div v-if="state.open" class="property-card">
      <header class="property-header"><div class="property-header__main"><h2 class="visually-hidden">{{ activeGroup === 'repair' ? 'Ремонт помещения' : 'Карточка помещения' }}</h2><nav class="property-section-switch" :class="{ 'has-repair': canOpenRepair }" aria-label="Переключение раздела карточки"><button type="button" :class="{ active: activeGroup === 'property' }" :aria-pressed="activeGroup === 'property'" @click="selectGroup('property')">Карточка помещения</button><button v-if="canOpenRepair" type="button" :class="{ active: activeGroup === 'repair' }" :aria-pressed="activeGroup === 'repair'" @click="selectGroup('repair')">Ремонт помещения</button></nav><p>{{ titleAddress }}</p></div><div class="property-header__actions"><a v-if="listingUrl" :href="listingUrl" target="_blank" rel="noopener">Открыть объявление</a><button class="close-button" aria-label="Закрыть" @click="close">×</button></div></header>
      <nav class="property-tabs" :class="{ 'property-tabs--repair': activeGroup === 'repair' }" aria-label="Разделы карточки">
        <button
          v-for="tab in visibleTabs"
          :key="tab.key"
          :class="{ active: activeTab === tab.key, locked: !tab.enabled }"
          :disabled="!tab.enabled"
          :title="tab.enabled ? '' : tab.hint"
          @click="selectTab(tab.key)"
        >{{ tab.label }}<span v-if="!tab.enabled" class="tab-lock" aria-hidden="true">·</span></button>
      </nav>
      <div class="property-body">
        <div v-if="modalError" class="property-form-alert" role="alert" aria-live="assertive"><span>{{ modalError }}</span><button type="button" aria-label="Закрыть сообщение об ошибке" @click="modalError = ''">×</button></div>
        <AppLoading v-if="!ready" />
        <PropertyObjectTab v-else-if="activeTab === 'object'" v-model="form" @resolve="resolveAddress" />
        <PropertyWorkflowTab v-else-if="activeTab === 'workflow' && project" :project="project" @changed="changed" @proposal="toProposal" />
        <PropertyProposalTab v-else-if="activeTab === 'proposal' && project" :project="project" @changed="changed" @approval="toApproval" />
        <PropertyApprovalTab v-else-if="activeTab === 'approval' && project" ref="approvalTab" :project="project" @changed="changed" @decision="approvalDecision" />
        <PropertyRepairStageTab v-else-if="activeTab === 'repair-documents' && project" :project="project" section="documents" />
        <PropertyRepairStageTab v-else-if="activeTab === 'repair-process' && project" :project="project" section="repair" />
        <PropertyRepairStageTab v-else-if="activeTab === 'repair-handover' && project" :project="project" section="handover" />
      </div>
      <footer class="property-footer"><button v-if="activeTab === 'approval'" class="button accent" :disabled="!canAgreeApproval" @click="agreeApproval">Согласовано</button><button class="button" @click="close">Отменить</button><button class="button primary" :disabled="saving" @click="save">Сохранить</button></footer>
      <AppToast scope="dialog" />
    </div>
  </dialog>
</template>
