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

export function listingUrlOf(...sources: any[]) {
  for (const source of sources) {
    const candidates = typeof source === 'string'
      ? [source]
      : [
          source?.listingUrl,
          source?.canonicalUrl,
          source?.spaceCard?.listingUrl,
          source?.spaceCard?.canonicalUrl,
          source?.phase0?.listingUrl,
          source?.phase0?.canonicalUrl,
          source?.phase0?.spaceCard?.listingUrl,
          source?.phase0?.spaceCard?.canonicalUrl
        ]
    const url = candidates
      .map(value => String(value || '').trim())
      .find(value => /^https?:\/\//iu.test(value))
    if (url) return url
  }
  return ''
}

export function pipelineStatus(project: any) {
  const work = projectWork(project)
  return work?.pipeline?.status || work.pipelineStatus || 'contact_pending'
}

export function proposalTabReady(project: any) {
  const work = projectWork(project)
  const completedViewing = [...(Array.isArray(work.viewings) ? work.viewings : [])]
    .reverse()
    .find((viewing: any) => viewing?.status === 'completed')
  if (!completedViewing) return false
  const attachments = Array.isArray(completedViewing.attachments)
    ? completedViewing.attachments.filter((item: any) => item?.status === 'uploaded')
    : []
  return attachments.some((item: any) => item.kind === 'photo')
    && attachments.some((item: any) => item.kind === 'video')
}

export function approvalTabReady(project: any) {
  const work = projectWork(project)
  return work?.proposal?.status === 'sent' || Boolean(work?.approval)
}

export function repairTabsReady(project: any) {
  const work = projectWork(project)
  const pipeline = String(work?.pipeline?.status || work?.pipelineStatus || '')
  const stage = String(work?.stage || '')
  return work?.approval?.status === 'agreed'
    || Boolean(work?.repair)
    || ['repair', 'repair_documents', 'repair_process', 'repair_handover', 'handover'].includes(pipeline)
    || ['repair', 'repair_documents', 'repair_process', 'repair_handover', 'handover'].includes(stage)
}

export function statusLabel(project: any) {
  const labels: Record<string, string> = {
    contact_pending: 'Новое',
    contacted: 'Связались',
    viewing_scheduled: 'Просмотр назначен',
    viewing_completed: 'Просмотр завершён',
    proposal_started: 'Готово к КП',
    approval_pending: 'На согласовании',
    repair: 'Согласовано',
    archived: 'Не согласовано',
    rejected: 'Отказ'
  }
  return labels[pipelineStatus(project)] || 'Новое'
}
