<script setup lang="ts">
import { formatArea, formatMoney, pipelineStatus, projectCard, statusLabel, workflowTabReady } from '~/utils/format'

const props = withDefaults(defineProps<{
  item: any
  context: 'search' | 'in-work' | 'proposal' | 'approval' | 'repair-documents' | 'repair-process' | 'repair-handover'
  selected?: boolean
}>(), { selected: false })

const emit = defineEmits<{
  open: [item: any]
  primary: [item: any]
  remove: [item: any]
  reject: [item: any]
}>()

const isProject = computed(() => Boolean(props.item?.phase0))
const card = computed(() => isProject.value ? projectCard(props.item) : props.item)
const address = computed(() => {
  const value = String(props.item?.address || card.value?.address || 'Адрес не указан').trim()
  return value.replace(/^Россия\s*,?\s*/iu, '').trim() || value
})
const cluster = computed(() => String(props.item?.clusterName || card.value?.cluster?.name || '').trim())
const rank = computed(() => card.value?.competitive?.rank ?? props.item?.clusterRank ?? null)
const status = computed(() => {
  if (props.context === 'search') return 'Новое'
  if (props.context === 'repair-documents') return 'Документы'
  if (props.context === 'repair-process') return 'Ремонт'
  if (props.context === 'repair-handover') return 'Выход из ремонта'
  return statusLabel(props.item)
})
const pricePerSqm = computed(() => Number(card.value?.pricePerSqm ?? props.item?.pricePerSquareMeter))
const rent = computed(() => card.value?.rentMonthly ?? props.item?.rentMonthly ?? props.item?.phase0?.rent?.amount)
const area = computed(() => card.value?.area ?? props.item?.area)
const floor = computed(() => props.item?.floor ?? props.item?.phase0?.floor)
const ceiling = computed(() => card.value?.ceilingHeight ?? props.item?.ceilingHeight)
const canOpenWorkflow = computed(() => workflowTabReady(props.item))
const primaryLabel = computed(() => {
  if (props.context === 'search') return 'Взять в работу'
  if (props.context === 'in-work') {
    if (!canOpenWorkflow.value) return 'Заполнить данные'
    return pipelineStatus(props.item) === 'viewing_scheduled' ? 'Открыть просмотр' : 'Назначить просмотр'
  }
  if (props.context === 'proposal') return 'Открыть КП'
  if (props.context === 'approval') return 'Открыть согласование'
  if (props.context === 'repair-documents') return 'Открыть документы'
  if (props.context === 'repair-process') return 'Открыть ремонт'
  return 'Открыть выход'
})
</script>

<template>
  <article class="premises-row" :class="{ selected }">
    <button class="premises-row__body" type="button" @click="emit('open', item)">
      <div class="premises-row__summary">
        <div class="premises-row__badges">
          <span v-if="cluster" class="badge">{{ cluster }}</span>
          <span v-if="rank != null" class="badge" :class="{ danger: Number(rank) > 35 }">{{ rank }} место</span>
          <span class="badge status">{{ status }}</span>
        </div>
        <h3>{{ address }}</h3>
        <div class="premises-row__metrics">
          <span>{{ formatArea(area) }}</span>
          <span>{{ floor == null ? 'Этаж не указан' : `Этаж ${floor}` }}</span>
          <span>{{ ceiling == null ? 'Высота не указана' : `Потолки ${ceiling} м` }}</span>
        </div>
      </div>
      <div class="premises-row__price"><strong>{{ formatMoney(rent) }}</strong><span>{{ Number.isFinite(pricePerSqm) ? `${formatMoney(pricePerSqm)} / м²` : '' }}</span></div>
    </button>
    <div class="premises-row__actions">
      <button class="button primary compact" type="button" @click="emit('primary', item)">{{ primaryLabel }}</button>
      <button v-if="context === 'search'" class="button compact" type="button" @click="emit('remove', item)">Удалить</button>
      <button v-if="context === 'in-work' || context === 'proposal' || context === 'approval'" class="button danger compact" type="button" @click="emit('reject', item)">Отказ</button>
    </div>
  </article>
</template>
