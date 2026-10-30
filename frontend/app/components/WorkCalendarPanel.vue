<script setup lang="ts">
import { formatDate, projectWork } from '~/utils/format'

type CalendarView = 'day' | 'week' | 'month'
type EventSource = 'viewing' | 'follow-up' | 'manual' | 'repair-control-point'
interface CalendarEvent {
  id: string
  projectId?: string
  source: EventSource
  type: string
  title: string
  at: string
  endsAt?: string
  responsible: string
  description?: string
  reminderMinutesBefore: number
}

const props = defineProps<{ projects: readonly any[] }>()
const { api, ready } = useSlogiRuntime()
const { show } = useToast()
const activeDate = ref(new Date())
const view = ref<CalendarView>('month')
const manualTasks = ref<any[]>([])
const editorOpen = ref(false)
const selectedEvent = ref<CalendarEvent | null>(null)
const reminderEvent = ref<CalendarEvent | null>(null)
const editingId = ref('')
const deletingEvent = ref(false)
const taskForm = reactive({ title: '', date: '', time: '10:00', duration: 60, responsible: '', description: '', reminder: 30 })
let reminderTimer: ReturnType<typeof setInterval> | undefined

function dayStart(value: Date) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date }
function addDays(value: Date, amount: number) { const date = new Date(value); date.setDate(date.getDate() + amount); return date }
function weekStart(value: Date) { const date = dayStart(value); return addDays(date, -((date.getDay() + 6) % 7)) }
function monthStart(value: Date) { return new Date(value.getFullYear(), value.getMonth(), 1) }
function dateKey(value: Date | string) { return new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }) }
function localDateTime(date: string, time: string) { return new Date(`${date}T${time}:00`).toISOString() }
function pad(value: number) { return String(value).padStart(2, '0') }

function refreshManualTasks() {
  const state = api()?.pro?.read?.()
  manualTasks.value = (state?.tasks || []).filter((task: any) => task?.source === 'manual-calendar' && !task.deletedAt)
}

const events = computed<CalendarEvent[]>(() => {
  const result: CalendarEvent[] = []
  props.projects.forEach(project => {
    const work = projectWork(project)
    ;(work.viewings || []).filter((item: any) => item.status !== 'cancelled' && !item.calendarDeletedAt).forEach((item: any) => result.push({
      id: String(item.id), projectId: String(project.id), source: 'viewing', type: 'Просмотр', title: project.address,
      at: item.startsAt, endsAt: item.endsAt, responsible: item.assignedToName || item.assignedToId || 'Не указан',
      reminderMinutesBefore: Number(item.reminderMinutesBefore?.[0] ?? item.reminderMinutesBefore ?? 30)
    }))
    const proposal = work.proposal || {}
    if (proposal.followUpDueAt) result.push({
      id: String(proposal.followUpTaskId || `${project.id}-follow-up`), projectId: String(project.id), source: 'follow-up',
      type: 'Связаться с арендодателем', title: project.address, at: proposal.followUpDueAt, responsible: 'Ответственный по объекту', reminderMinutesBefore: 30
    })
    const repair = work.repair || {}
    ;(repair.calendarEvents || [])
      .filter((item: any) => item?.source === 'repair-control-point' && item.status !== 'deleted' && !item.calendarDeletedAt)
      .forEach((item: any) => result.push({
        id: String(item.id), projectId: String(item.projectId || project.id), source: 'repair-control-point',
        type: item.type || 'Контроль ремонта', title: item.title || project.address,
        at: item.startsAt || item.at, endsAt: item.endsAt,
        responsible: item.responsible || 'Ответственный по ремонту', description: item.description || project.address || '',
        reminderMinutesBefore: Number(item.reminderMinutesBefore ?? 1440)
      }))
  })
  manualTasks.value.forEach(task => result.push({
    id: String(task.id), source: 'manual', type: 'Задача', title: task.title || task.name, at: task.startsAt || task.dueDate,
    endsAt: task.endsAt, responsible: task.responsible || 'Не указан', description: task.description || '', reminderMinutesBefore: Number(task.reminderMinutesBefore ?? 30)
  }))
  return result.filter(item => item.at).sort((a, b) => String(a.at).localeCompare(String(b.at)))
})

const range = computed(() => {
  if (view.value === 'day') return { start: dayStart(activeDate.value), end: addDays(dayStart(activeDate.value), 1) }
  if (view.value === 'week') { const start = weekStart(activeDate.value); return { start, end: addDays(start, 7) } }
  const start = weekStart(monthStart(activeDate.value))
  return { start, end: addDays(start, 42) }
})
const rangeTitle = computed(() => {
  if (view.value === 'day') return activeDate.value.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  if (view.value === 'month') return activeDate.value.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  return `${range.value.start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${addDays(range.value.end, -1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`
})
const days = computed(() => {
  const result = []
  for (let date = new Date(range.value.start); date < range.value.end; date = addDays(date, 1)) {
    const current = new Date(date)
    result.push({
      key: dateKey(current), outside: view.value === 'month' && current.getMonth() !== activeDate.value.getMonth(),
      label: view.value === 'month' ? String(current.getDate()) : current.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }),
      events: events.value.filter(event => dateKey(event.at) === dateKey(current))
    })
  }
  return result
})
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function move(step: number) {
  const date = new Date(activeDate.value)
  if (view.value === 'day') date.setDate(date.getDate() + step)
  else if (view.value === 'week') date.setDate(date.getDate() + step * 7)
  else date.setMonth(date.getMonth() + step)
  activeDate.value = date
}

function openEditor(event?: CalendarEvent) {
  const source = event?.source === 'manual' ? manualTasks.value.find(task => String(task.id) === event.id) : null
  const start = source?.startsAt ? new Date(source.startsAt) : new Date(Date.now() + 60 * 60 * 1000)
  editingId.value = source?.id || ''
  taskForm.title = source?.title || ''
  taskForm.date = dateKey(start)
  taskForm.time = `${pad(start.getHours())}:${pad(start.getMinutes())}`
  taskForm.duration = Number(source?.durationMinutes || 60)
  taskForm.responsible = source?.responsible || ''
  taskForm.description = source?.description || ''
  taskForm.reminder = Number(source?.reminderMinutesBefore ?? 30)
  editorOpen.value = true
}

function saveTask() {
  if (!taskForm.title.trim() || !taskForm.date || !taskForm.time) { show('Укажите название, дату и время задачи.', 'error'); return }
  const startsAt = localDateTime(taskForm.date, taskForm.time)
  const endsAt = new Date(new Date(startsAt).getTime() + Number(taskForm.duration || 60) * 60000).toISOString()
  const runtime = api()
  if (!runtime?.pro) { show('Календарь ещё загружается.', 'error'); return }
  runtime.pro.upsert('tasks', {
    id: editingId.value || runtime.pro.uid('calendar-task'), source: 'manual-calendar', type: 'Календарь', status: 'Запланировано',
    title: taskForm.title.trim(), name: taskForm.title.trim(), startsAt, dueDate: startsAt, endsAt,
    durationMinutes: Number(taskForm.duration || 60), responsible: taskForm.responsible.trim(), description: taskForm.description.trim(), reminderMinutesBefore: Number(taskForm.reminder)
  }, editingId.value ? 'calendar-task-update' : 'calendar-task-create')
  refreshManualTasks(); editorOpen.value = false
  show(editingId.value ? 'Задача обновлена.' : 'Задача добавлена в календарь.')
}

function removeTask() {
  if (!editingId.value || !confirm('Удалить задачу из календаря?')) return
  api()?.pro?.remove?.('tasks', editingId.value)
  refreshManualTasks(); editorOpen.value = false; selectedEvent.value = null
  show('Задача удалена.')
}

function operation(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function eventProject(event: CalendarEvent) {
  const id = String(event.projectId || '')
  return id ? props.projects.find(project => String(project?.id || '') === id) || null : null
}

function removeViewingEvent(event: CalendarEvent) {
  const runtime = api()
  const project = eventProject(event)
  if (!runtime?.phase0?.projectRepository || !project) throw new Error('Помещение для просмотра не найдено.')
  const repository = runtime.phase0.projectRepository
  const current = repository.get(project.id)
  const work = projectWork(current)
  const viewing = (work.viewings || []).find((item: any) => String(item.id) === event.id)
  if (!viewing) throw new Error('Просмотр уже удалён из календаря.')

  const pipeline = runtime.calendar?.pipelineStatus?.(current)
  if (viewing.status === 'scheduled' && (runtime.calendar?.isInWork?.(current) || pipeline === 'proposal_started')) {
    const service = runtime.calendar.createService({ projectRepository: repository, idFactory: (prefix: string) => runtime.pro.uid(prefix) })
    service.cancel(project.id, {
      operationId: operation('calendar-delete-viewing'),
      viewingId: event.id,
      reason: 'Удалено пользователем из календаря',
      actorId: runtime.pro.actor().id,
      preserveProposalStage: pipeline === 'proposal_started'
    })
    return
  }

  const at = new Date().toISOString()
  repository.mutate(project.id, (draft: any) => {
    const draftWork = projectWork(draft)
    const target = (draftWork.viewings || []).find((item: any) => String(item.id) === event.id)
    if (!target) throw new Error('Просмотр уже удалён из календаря.')
    target.calendarDeletedAt = at
    target.calendarDeletedById = runtime.pro.actor().id
    target.updatedAt = at
    return draft
  }, current.phase0.revision, 'calendar-viewing-hide')
}

function removeFollowUpEvent(event: CalendarEvent) {
  const runtime = api()
  const project = eventProject(event)
  if (!runtime?.phase0?.projectRepository || !project) throw new Error('Помещение для контрольной связи не найдено.')
  const repository = runtime.phase0.projectRepository
  const current = repository.get(project.id)
  const currentProposal = projectWork(current).proposal || {}
  const taskId = String(currentProposal.followUpTaskId || event.id)
  const at = new Date().toISOString()
  repository.mutate(project.id, (draft: any) => {
    const draftWork = projectWork(draft)
    const proposal = draftWork.proposal || {}
    proposal.followUpTaskId = null
    proposal.followUpDueAt = null
    proposal.updatedAt = at
    draftWork.proposal = proposal
    return draft
  }, current.phase0.revision, 'calendar-follow-up-remove')
  runtime.pro.remove('tasks', taskId)
}

function removeRepairControlEvent(event: CalendarEvent) {
  const runtime = api()
  const project = eventProject(event)
  if (!runtime?.phase0?.projectRepository || !project) throw new Error('Помещение для контрольной точки не найдено.')
  const repository = runtime.phase0.projectRepository
  const current = repository.get(project.id)
  const currentRepair = projectWork(current).repair || {}
  const controlPoint = (currentRepair.calendarEvents || []).find((item: any) => String(item.id) === event.id)
  if (!controlPoint || controlPoint.status === 'deleted' || controlPoint.calendarDeletedAt) {
    throw new Error('Контрольная точка уже удалена из календаря.')
  }

  const at = new Date().toISOString()
  const actorId = runtime.pro?.actor?.()?.id || null
  repository.mutate(project.id, (draft: any) => {
    const draftRepair = projectWork(draft).repair || {}
    const target = (draftRepair.calendarEvents || []).find((item: any) => String(item.id) === event.id)
    if (!target || target.status === 'deleted' || target.calendarDeletedAt) {
      throw new Error('Контрольная точка уже удалена из календаря.')
    }
    target.status = 'deleted'
    target.calendarDeletedAt = at
    target.calendarDeletedById = actorId
    target.updatedAt = at
    return draft
  }, current.phase0.revision, 'calendar-repair-control-hide')
}

function removeManualEvent(event: CalendarEvent) {
  const runtime = api()
  if (!runtime?.pro) throw new Error('Календарь ещё загружается.')
  runtime.pro.remove('tasks', event.id)
  refreshManualTasks()
}

function removalConfirmation(event: CalendarEvent) {
  const when = formatDate(event.at, true)
  if (event.source === 'viewing') return `Удалить просмотр «${event.title}» на ${when} из календаря? Назначенный просмотр будет отменён; завершённый останется в истории помещения.`
  if (event.source === 'follow-up') return `Удалить контрольную связь «${event.title}» на ${when}? Задача будет снята с помещения.`
  if (event.source === 'repair-control-point') return `Удалить контрольную точку ремонта «${event.title}» на ${when} из календаря?`
  return `Удалить задачу «${event.title}» на ${when} из календаря?`
}

async function removeSelectedEvent() {
  const event = selectedEvent.value
  if (!event || deletingEvent.value || !confirm(removalConfirmation(event))) return
  deletingEvent.value = true
  try {
    if (event.source === 'viewing') removeViewingEvent(event)
    else if (event.source === 'follow-up') removeFollowUpEvent(event)
    else if (event.source === 'repair-control-point') removeRepairControlEvent(event)
    else removeManualEvent(event)
    selectedEvent.value = null
    show('Событие удалено из календаря.')
  } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось удалить событие.', 'error')
  } finally {
    deletingEvent.value = false
  }
}

function toIcsStamp(value: string) { return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') }
function escapeIcs(value: string) { return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;') }
function buildIcs(items: CalendarEvent[]) {
  const rows = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SLOGI//Calendar//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  items.forEach(event => rows.push('BEGIN:VEVENT', `UID:${escapeIcs(event.id)}@schoolslogi.ru`, `DTSTAMP:${toIcsStamp(new Date().toISOString())}`, `DTSTART:${toIcsStamp(event.at)}`, `DTEND:${toIcsStamp(event.endsAt || new Date(new Date(event.at).getTime() + 3600000).toISOString())}`, `SUMMARY:${escapeIcs(`${event.type}: ${event.title}`)}`, `DESCRIPTION:${escapeIcs([event.description, `Ответственный: ${event.responsible}`].filter(Boolean).join('\n'))}`, 'END:VEVENT'))
  rows.push('END:VCALENDAR')
  return rows.join('\r\n')
}
function downloadCalendar(items: CalendarEvent[] = events.value, name = 'slogi-calendar.ics') {
  const url = URL.createObjectURL(new Blob([buildIcs(items)], { type: 'text/calendar;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url)
  show('Файл календаря подготовлен. Откройте его в календаре телефона или компьютера.')
}
function openGoogle(event: CalendarEvent) {
  const end = event.endsAt || new Date(new Date(event.at).getTime() + 3600000).toISOString()
  const query = new URLSearchParams({ action: 'TEMPLATE', text: `${event.type}: ${event.title}`, dates: `${toIcsStamp(event.at)}/${toIcsStamp(end)}`, details: [event.description, `Ответственный: ${event.responsible}`].filter(Boolean).join('\n') })
  window.open(`https://calendar.google.com/calendar/render?${query}`, '_blank', 'noopener')
}

async function enableNotifications() {
  if (!('Notification' in window)) { show('Браузер не поддерживает системные уведомления.', 'error'); return }
  const permission = await Notification.requestPermission()
  show(permission === 'granted' ? 'Уведомления включены.' : 'Уведомления не разрешены.', permission === 'granted' ? 'success' : 'error')
}
function checkReminders() {
  for (const event of events.value) {
    const distance = new Date(event.at).getTime() - Date.now()
    const key = `slogi-calendar-notified:${event.id}:${event.at}`
    if (distance > 0 && distance <= event.reminderMinutesBefore * 60000 && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1'); reminderEvent.value = event; show(`Напоминание: ${event.type} — ${event.title}`)
      if ('Notification' in window && Notification.permission === 'granted') new Notification(`СЛОГИ: ${event.type}`, { body: `${event.title} · ${formatDate(event.at, true)}` })
      break
    }
  }
}

watch(ready, value => { if (value) refreshManualTasks() }, { immediate: true })
function handleProfessionalState() { refreshManualTasks() }
onMounted(() => {
  window.addEventListener('slogi:professional-state', handleProfessionalState)
  refreshManualTasks(); checkReminders(); reminderTimer = setInterval(checkReminders, 30000)
})
onBeforeUnmount(() => { window.removeEventListener('slogi:professional-state', handleProfessionalState); if (reminderTimer) clearInterval(reminderTimer) })
</script>

<template>
  <section class="calendar-shell">
    <div class="calendar-toolbar">
      <div class="calendar-nav"><button class="icon-button" aria-label="Предыдущий период" @click="move(-1)">‹</button><button class="button compact" @click="activeDate = new Date()">Сегодня</button><button class="icon-button" aria-label="Следующий период" @click="move(1)">›</button><h2>{{ rangeTitle }}</h2></div>
      <div class="calendar-tools"><button class="button primary compact calendar-add-button" @click="openEditor()">Добавить</button><button class="button compact calendar-tool-secondary calendar-tool-secondary--notifications" @click="enableNotifications">Уведомления</button><button class="button compact calendar-tool-secondary calendar-tool-secondary--export" :disabled="!events.length" @click="downloadCalendar()">В календарь (.ics)</button><div class="segmented"><button :class="{ active: view === 'day' }" @click="view = 'day'">День</button><button :class="{ active: view === 'week' }" @click="view = 'week'">Неделя</button><button :class="{ active: view === 'month' }" @click="view = 'month'">Месяц</button></div></div>
    </div>
    <div v-if="view === 'month'" class="calendar-weekdays"><span v-for="weekday in weekdays" :key="weekday">{{ weekday }}</span></div>
    <div class="calendar-days" :class="`is-${view}`">
      <section v-for="day in days" :key="day.key" class="calendar-day" :class="{ empty: !day.events.length, outside: day.outside, today: day.key === dateKey(new Date()) }">
        <h3>{{ day.label }}</h3>
        <div v-if="day.events.length" class="agenda-list"><button v-for="event in day.events" :key="event.id" class="agenda-item" :class="`is-${event.source}`" @click="selectedEvent = event"><time>{{ new Date(event.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }}</time><span><b>{{ event.type }}</b><small>{{ event.title }}</small></span></button></div>
        <p v-else-if="view !== 'month'">Событий нет</p>
      </section>
    </div>
  </section>

  <div v-if="editorOpen" class="calendar-modal-backdrop" @click.self="editorOpen = false"><section class="calendar-modal" role="dialog" aria-modal="true"><header><h2>{{ editingId ? 'Изменить задачу' : 'Новая задача' }}</h2><button class="close-button" @click="editorOpen = false">×</button></header><label class="stacked-field"><span>Название</span><input v-model="taskForm.title" /></label><div class="calendar-form-grid"><label class="stacked-field"><span>Дата</span><input v-model="taskForm.date" type="date" /></label><label class="stacked-field"><span>Время</span><input v-model="taskForm.time" type="time" /></label></div><div class="calendar-form-grid"><label class="stacked-field"><span>Длительность</span><select v-model.number="taskForm.duration"><option :value="30">30 минут</option><option :value="60">1 час</option><option :value="90">1,5 часа</option><option :value="120">2 часа</option></select></label><label class="stacked-field"><span>Напомнить</span><select v-model.number="taskForm.reminder"><option :value="0">Не напоминать</option><option :value="15">За 15 минут</option><option :value="30">За 30 минут</option><option :value="60">За 1 час</option><option :value="1440">За 1 день</option></select></label></div><label class="stacked-field"><span>Ответственный</span><input v-model="taskForm.responsible" /></label><label class="stacked-field"><span>Описание</span><textarea v-model="taskForm.description" rows="3" /></label><footer><button v-if="editingId" class="button danger" @click="removeTask">Удалить</button><span /><button class="button" @click="editorOpen = false">Отменить</button><button class="button primary" @click="saveTask">Сохранить</button></footer></section></div>

  <div v-if="selectedEvent" class="calendar-modal-backdrop" @click.self="selectedEvent = null"><section class="calendar-modal compact" role="dialog" aria-modal="true"><header><h2>{{ selectedEvent.type }}</h2><button class="close-button" @click="selectedEvent = null">×</button></header><h3>{{ selectedEvent.title }}</h3><p>{{ formatDate(selectedEvent.at, true) }}</p><p>Ответственный: {{ selectedEvent.responsible }}</p><p v-if="selectedEvent.description">{{ selectedEvent.description }}</p><footer><div class="calendar-event-management"><button class="button danger" :disabled="deletingEvent" @click="removeSelectedEvent">Удалить</button><button v-if="selectedEvent.source === 'manual'" class="button" @click="openEditor(selectedEvent); selectedEvent = null">Изменить</button></div><span /><button class="button" @click="downloadCalendar([selectedEvent!], 'slogi-event.ics')">В календарь</button><button class="button primary" @click="openGoogle(selectedEvent!)">Google Calendar</button></footer></section></div>

  <div v-if="reminderEvent" class="calendar-reminder" role="alertdialog" aria-live="assertive"><div><b>Напоминание</b><span>{{ reminderEvent.type }} · {{ reminderEvent.title }}</span><small>{{ formatDate(reminderEvent.at, true) }}</small></div><button class="button compact" @click="reminderEvent = null">Понятно</button></div>
</template>
