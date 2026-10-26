<script setup lang="ts">
import { formatDate, projectWork } from '~/utils/format'

const props = defineProps<{ projects: readonly any[] }>()
const activeDate = ref(new Date())
const view = ref<'week' | 'month'>('week')

function dayStart(value: Date) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date }
function addDays(value: Date, amount: number) { const date = new Date(value); date.setDate(date.getDate() + amount); return date }
function weekStart(value: Date) { const date = dayStart(value); return addDays(date, -((date.getDay() + 6) % 7)) }
function monthStart(value: Date) { return new Date(value.getFullYear(), value.getMonth(), 1) }
function dateKey(value: Date | string) { return new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }) }

const events = computed(() => {
  const result: any[] = []
  props.projects.forEach(project => {
    const work = projectWork(project)
    ;(work.viewings || []).filter((item: any) => item.status !== 'cancelled').forEach((item: any) => result.push({
      id: item.id,
      type: 'Просмотр',
      title: project.address,
      at: item.startsAt,
      responsible: item.assignedToName || item.assignedToId || 'Не указан'
    }))
    const proposal = work.proposal || {}
    if (proposal.followUpDueAt) result.push({ id: proposal.followUpTaskId || `${project.id}-follow-up`, type: 'Связаться', title: project.address, at: proposal.followUpDueAt, responsible: 'Арендодатель' })
  })
  return result.sort((a, b) => String(a.at).localeCompare(String(b.at)))
})

const range = computed(() => {
  const start = view.value === 'week' ? weekStart(activeDate.value) : monthStart(activeDate.value)
  const end = view.value === 'week' ? addDays(start, 7) : new Date(start.getFullYear(), start.getMonth() + 1, 1)
  return { start, end }
})
const rangeTitle = computed(() => view.value === 'month'
  ? activeDate.value.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  : `${range.value.start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${addDays(range.value.end, -1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`)
const days = computed(() => {
  const result = []
  for (let date = new Date(range.value.start); date < range.value.end; date = addDays(date, 1)) {
    const current = new Date(date)
    result.push({
      key: dateKey(current),
      label: current.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }),
      events: events.value.filter(event => dateKey(event.at) === dateKey(current))
    })
  }
  return result
})
function move(step: number) { const date = new Date(activeDate.value); view.value === 'week' ? date.setDate(date.getDate() + step * 7) : date.setMonth(date.getMonth() + step); activeDate.value = date }
</script>

<template>
  <section class="calendar-shell">
    <div class="calendar-toolbar">
      <div class="calendar-nav"><button class="icon-button" @click="move(-1)">‹</button><button class="button compact" @click="activeDate = new Date()">Сегодня</button><button class="icon-button" @click="move(1)">›</button><h2>{{ rangeTitle }}</h2></div>
      <div class="segmented"><button :class="{ active: view === 'week' }" @click="view = 'week'">Неделя</button><button :class="{ active: view === 'month' }" @click="view = 'month'">Месяц</button></div>
    </div>
    <div class="calendar-days" :class="`is-${view}`">
      <section v-for="day in days" :key="day.key" class="calendar-day" :class="{ empty: !day.events.length }">
        <h3>{{ day.label }}</h3>
        <div v-if="day.events.length" class="agenda-list">
          <article v-for="event in day.events" :key="event.id" class="agenda-item"><time>{{ formatDate(event.at, true) }}</time><div><strong>{{ event.type }}</strong><span>{{ event.title }}</span></div><small>{{ event.responsible }}</small></article>
        </div>
        <p v-else>Событий нет</p>
      </section>
    </div>
  </section>
</template>
