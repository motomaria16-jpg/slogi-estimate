<script setup lang="ts">
import { formatDate, projectWork } from '~/utils/format'

const props = defineProps<{
  project: any
  section: 'documents' | 'repair' | 'handover'
}>()

const work = computed(() => projectWork(props.project))
const repair = computed(() => work.value?.repair || {})
const documents = computed(() => Array.isArray(repair.value.documents) ? repair.value.documents : [])
const completedDocuments = computed(() => documents.value.filter((item: any) => item?.status === 'ready' || item?.status === 'signed').length)

const documentRows = computed(() => [
  { label: 'Техническое задание', ready: documents.value.some((item: any) => item?.kind === 'technicalTask') },
  { label: 'Смета ремонта', ready: documents.value.some((item: any) => item?.kind === 'estimate') },
  { label: 'График работ', ready: documents.value.some((item: any) => item?.kind === 'schedule') }
])

const sectionMeta = computed(() => ({
  documents: {
    title: 'Формирование документов для ремонта',
    badge: documents.value.length ? `${completedDocuments.value} из ${documents.value.length} готово` : 'Новый этап',
    note: 'Здесь будет собран комплект документов, необходимый для начала ремонтных работ.'
  },
  repair: {
    title: 'Процесс ремонта',
    badge: repair.value.status === 'in_progress' ? 'В работе' : 'Не начат',
    note: 'После подготовки документов здесь появятся сроки, ответственные и текущий статус работ.'
  },
  handover: {
    title: 'Выход из ремонта',
    badge: repair.value.handover?.status === 'completed' ? 'Завершён' : 'Ожидает ремонта',
    note: 'Раздел предназначен для приёмки помещения и фиксации завершения ремонта.'
  }
}[props.section]))
</script>

<template>
  <div class="repair-stage-tab">
    <section class="form-card repair-stage-main">
      <div class="card-heading"><h3>{{ sectionMeta.title }}</h3><span class="badge status">{{ sectionMeta.badge }}</span></div>

      <div v-if="section === 'documents'" class="repair-checklist">
        <div v-for="row in documentRows" :key="row.label" class="repair-checklist__row">
          <span class="repair-checklist__mark" :class="{ ready: row.ready }">{{ row.ready ? '✓' : '○' }}</span>
          <span>{{ row.label }}</span>
          <small>{{ row.ready ? 'Подготовлено' : 'Ожидает добавления' }}</small>
        </div>
      </div>

      <div v-else-if="section === 'repair'" class="repair-facts">
        <div><span>Статус</span><strong>{{ repair.status === 'in_progress' ? 'Ремонт выполняется' : 'Ожидает запуска' }}</strong></div>
        <div><span>Начало работ</span><strong>{{ repair.startedAt ? formatDate(repair.startedAt) : 'Не указано' }}</strong></div>
        <div><span>Плановое завершение</span><strong>{{ repair.plannedCompletionAt ? formatDate(repair.plannedCompletionAt) : 'Не указано' }}</strong></div>
      </div>

      <div v-else class="repair-checklist">
        <div class="repair-checklist__row"><span class="repair-checklist__mark">○</span><span>Акт приёмки</span><small>Ожидает добавления</small></div>
        <div class="repair-checklist__row"><span class="repair-checklist__mark">○</span><span>Устранение замечаний</span><small>Не начато</small></div>
        <div class="repair-checklist__row"><span class="repair-checklist__mark">○</span><span>Передача помещения</span><small>Не выполнено</small></div>
      </div>
    </section>

    <aside class="form-card repair-stage-next">
      <div class="card-heading"><h3>Текущий этап</h3></div>
      <p>{{ sectionMeta.note }}</p>
      <div class="repair-stage-next__status"><span>Помещение</span><strong>Передано в ремонт</strong></div>
    </aside>
  </div>
</template>
