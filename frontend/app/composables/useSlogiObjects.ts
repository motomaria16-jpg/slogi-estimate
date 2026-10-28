import { isSlogiObject, slogiObjectCoordinates } from '~/utils/slogiObjects'

export function useSlogiObjects() {
  const { ready, api } = useSlogiRuntime()
  const objects = useState<any[]>('slogi-current-objects', () => [])

  function refresh() {
    const runtime = api()
    objects.value = runtime?.phase0?.projectRepository?.listAll?.().filter(isSlogiObject) || []
  }

  async function addAddress(rawAddress: string) {
    const address = String(rawAddress || '').trim()
    if (address.length < 5) throw new Error('Введите полный адрес объекта.')
    const runtime = api()
    if (!runtime) throw new Error('Приложение ещё загружается.')

    const result = await runtime.phase0.geocodingService.geocode(address, { allowNearest: false })
    if (!result?.geo || !Number.isFinite(Number(result.geo.lat)) || !Number.isFinite(Number(result.geo.lng))) {
      throw new Error('Не удалось определить координаты адреса. Проверьте написание и повторите попытку.')
    }

    const latitude = Number(result.geo.lat)
    const longitude = Number(result.geo.lng)
    const located = runtime.phase0.clusterService.locate(latitude, longitude)
    const all = window.SlogiPro.readLocations()
    const normalizedAddress = String(result.address || address).trim()
    const duplicate = all.find((item: any) => {
      if (!isSlogiObject(item)) return false
      if (String(item.address || '').trim().toLocaleLowerCase('ru') === normalizedAddress.toLocaleLowerCase('ru')) return true
      const point = slogiObjectCoordinates(item)
      return point && Math.abs(point.lat - latitude) < 0.00015 && Math.abs(point.lng - longitude) < 0.00015
    })
    if (duplicate) return duplicate

    const stamp = new Date().toISOString()
    const item = {
      id: window.SlogiPro.uid('slogi-center'),
      entityType: 'slogi_center',
      centerName: 'СЛОГИ',
      address: normalizedAddress,
      geo: { lat: latitude, lng: longitude },
      latitude,
      longitude,
      clusterId: located?.status === 'inside' ? String(located.clusterId || '') : '',
      clusterName: located?.status === 'inside' ? String(located.clusterName || '') : '',
      isSlogiCenterOpen: true,
      centerOperational: true,
      centerStatus: 'open',
      slogiCenter: { isOpen: true, status: 'open', source: 'manual', createdAt: stamp },
      createdAt: stamp,
      updatedAt: stamp
    }
    window.SlogiPro.writeLocations([item, ...all], 'slogi-center-create')
    window.SlogiPro.activity(item.id, 'slogi-center-create', 'Добавлен текущий объект СЛОГИ', { address: item.address })
    refresh()
    return item
  }

  function removeObject(id: string) {
    const all = window.SlogiPro.readLocations()
    const current = all.find((item: any) => String(item?.id) === String(id))
    if (!current || current.entityType !== 'slogi_center') throw new Error('Этот объект нельзя удалить из данного раздела.')
    window.SlogiPro.writeLocations(all.filter((item: any) => String(item?.id) !== String(id)), 'slogi-center-remove')
    refresh()
  }

  if (import.meta.client) {
    const events = ['slogi:runtime-ready', 'slogi:locations-updated', 'slogi:workspace-updated', 'slogi:shared-workspace-ready']
    watch(ready, value => { if (value) refresh() }, { immediate: true })
    onMounted(() => {
      events.forEach(name => window.addEventListener(name, refresh))
      refresh()
    })
    onBeforeUnmount(() => events.forEach(name => window.removeEventListener(name, refresh)))
  }

  return { objects: readonly(objects), addAddress, removeObject, refresh }
}
