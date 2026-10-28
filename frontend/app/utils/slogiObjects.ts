const OPEN_CENTER_STATUSES = new Set([
  'open',
  'opened',
  'operating',
  'active',
  'открыт',
  'открыта',
  'работает',
  'действует',
  'завершён'
])

export function isSlogiObject(value: any) {
  if (!value || value.deletedAt) return false
  const center = value.slogiCenter && typeof value.slogiCenter === 'object' ? value.slogiCenter : {}
  const status = String(value.centerStatus || value.slogiCenterStatus || center.status || '').trim().toLocaleLowerCase('ru')
  return value.entityType === 'slogi_center'
    || value.isSlogiCenterOpen === true
    || value.centerOperational === true
    || center.isOpen === true
    || Boolean(String(value.actualOpeningDate || center.openedAt || '').trim())
    || OPEN_CENTER_STATUSES.has(status)
}
export function slogiObjectCoordinates(value: any) {
  const lat = Number(value?.geo?.lat ?? value?.latitude)
  const lng = Number(value?.geo?.lng ?? value?.longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}
