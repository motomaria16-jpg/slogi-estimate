export function formatMoney(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount) ? `${Math.round(amount).toLocaleString('ru-RU')} ₽` : 'Аренда не указана'
}

export function formatArea(value: unknown) {
  const area = Number(value)
  return Number.isFinite(area) ? `${area.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м²` : 'Площадь не указана'
}

export function formatDate(value: unknown, time = false) {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', time
    ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' }
    : { dateStyle: 'medium', timeZone: 'Europe/Moscow' }).format(date)
}

export function projectCard(project: any) {
  return project?.phase0?.spaceCard || {}
}

export function projectWork(project: any) {
  return projectCard(project)?.work || {}
}

export function pipelineStatus(project: any) {
  const work = projectWork(project)
  return work?.pipeline?.status || work.pipelineStatus || 'contact_pending'
}

export function statusLabel(project: any) {
  const labels: Record<string, string> = {
    contact_pending: 'Новое',
    contacted: 'Связались',
    viewing_scheduled: 'Просмотр назначен',
    viewing_completed: 'Просмотр завершён',
    proposal_started: 'Готово к КП',
    rejected: 'Отказ'
  }
  return labels[pipelineStatus(project)] || 'Новое'
}
