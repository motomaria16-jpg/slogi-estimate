const criteria = Object.freeze({
  areaMin: 100,
  areaMax: 150,
  floor: 1,
  premiseTypes: ['office', 'retail', 'free_purpose'],
  excludeBasementOrSocle: true,
  days: 30,
  sort: 'freshness-desc'
})

function normalizeListing(raw: any, runtime: any) {
  const number = (value: any) => value == null || String(value).trim() === '' ? null : Number(value)
  const area = number(raw.area)
  const rent = number(raw.rentMonthly ?? raw.rent_monthly)
  const latitude = number(raw.latitude)
  const longitude = number(raw.longitude)
  const item: any = {
    source: String(raw.source || 'cian'),
    listingUrl: String(raw.listingUrl || raw.listing_url || ''),
    externalId: String(raw.externalId || raw.external_id || ''),
    title: String(raw.title || ''),
    address: String(raw.address || ''),
    description: String(raw.description || ''),
    latitude,
    longitude,
    area,
    rentMonthly: rent,
    pricePerSquareMeter: number(raw.pricePerSquareMeter) ?? (area && rent ? Math.round(rent / area) : null),
    floor: number(raw.floor),
    totalFloors: number(raw.totalFloors ?? raw.total_floors),
    ceilingHeight: number(raw.ceilingHeight ?? raw.ceiling_height),
    premiseType: runtime.feed.normalizePremiseType(raw.premiseType ?? raw.premise_type, raw),
    hasBasementOrSocle: runtime.feed.hasBasementOrSocle(raw),
    freshnessAt: String(raw.freshnessAt || raw.freshness_at || ''),
    freshnessKind: String(raw.freshnessKind || raw.freshness_kind || ''),
    publishedAt: String(raw.publishedAt || raw.published_at || ''),
    sourceUpdatedAt: String(raw.sourceUpdatedAt || raw.source_updated_at || ''),
    marketStatus: String(raw.marketStatus || raw.market_status || 'active'),
    parseWarnings: Array.isArray(raw.parseWarnings) ? raw.parseWarnings : []
  }
  if (latitude != null && longitude != null) {
    const cluster = runtime.phase0.clusterService.findByCoordinates(latitude, longitude)
    item.clusterId = cluster?.id || ''
    item.clusterName = cluster?.name || ''
    item.clusterStatus = cluster ? 'inside' : 'outside'
  }
  return item
}

export function useListings() {
  const { ready, api } = useSlogiRuntime()
  const { searchProjects, refresh: refreshProjects } = useProjects()
  const listings = useState<any[]>('market-listings', () => [])
  const loading = useState<boolean>('market-listings-loading', () => false)
  const loaded = useState<boolean>('market-listings-loaded', () => false)
  const error = useState<string>('market-listings-error', () => '')
  const meta = useState<any>('market-listings-meta', () => null)
  const hidden = useState<string[]>('market-listings-hidden', () => [])

  const items = computed(() => {
    const runtime = api()
    if (!runtime) return searchProjects.value
    const existing = new Set(searchProjects.value.map(project => String(project.id)))
    const external = listings.value.filter(listing => {
      const project = runtime.phase0.phase0Service.findListingProject(listing)
      return !project && !hidden.value.includes(runtime.feed.identity(listing))
    })
    const stored = searchProjects.value.filter(project => existing.has(String(project.id)))
    return [...external, ...stored]
  })

  async function load() {
    const runtime = api()
    if (!runtime || loading.value) return
    loading.value = true
    error.value = ''
    try {
      const config = window.SLOGI_PHASE0_CONFIG?.listingSearch || {}
      if (!config.endpoint) throw new Error('Сервис объявлений не настроен.')
      const token = await runtime.cloud.getAccessToken()
      const loadedResult = await runtime.feed.loadAllPages(async ({ page, limit, snapshotAt, cursor }: any) => {
        const request: any = { sources: ['cian'], page, limit, areaMin: 100, areaMax: 150, floor: 1, premiseTypes: [...criteria.premiseTypes] }
        if (snapshotAt) request.snapshotAt = snapshotAt
        if (cursor) request.cursor = cursor
        const response = await fetch(config.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Slogi-Client': 'nuxt-frontend' },
          body: JSON.stringify(request)
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || 'Не удалось получить объявления.')
        return { items: (payload?.items || []).map((item: any) => normalizeListing(item, runtime)), meta: payload?.meta }
      }, { limit: Math.min(100, Number(config.limit) || 50) })
      const snapshot = new Date(loadedResult.snapshotAt || '').getTime()
      listings.value = runtime.feed.filterAndSort(loadedResult.items, criteria, Number.isFinite(snapshot) ? snapshot : Date.now())
      meta.value = { ...loadedResult.meta, partial: loadedResult.partial, pages: loadedResult.pages, snapshotAt: loadedResult.snapshotAt }
      loaded.value = true
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : 'Не удалось загрузить объявления.'
      listings.value = []
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  async function takeIntoWork(item: any) {
    const runtime = api()
    if (!runtime) return null
    let project = item?.phase0 ? item : runtime.phase0.phase0Service.findListingProject(item)
    if (!project) project = (await runtime.phase0.phase0Service.addMarketListing(item)).project
    const saved = runtime.phase0.phase0Service.takeSpaceIntoWork(project.id)
    refreshProjects()
    return saved
  }

  function remove(item: any) {
    const runtime = api()
    if (!runtime) return
    if (item?.phase0) runtime.phase0.projectRepository.softDelete(item.id)
    else {
      const id = runtime.feed.identity(item)
      hidden.value = [...new Set([...hidden.value, id])]
      localStorage.setItem('slogi_nuxt_hidden_listings_v1', JSON.stringify(hidden.value))
    }
    refreshProjects()
  }

  if (import.meta.client) {
    onMounted(() => {
      try { hidden.value = JSON.parse(localStorage.getItem('slogi_nuxt_hidden_listings_v1') || '[]') } catch { hidden.value = [] }
      if (ready.value && !loaded.value) load()
    })
    watch(ready, value => { if (value && !loaded.value) load() })
  }

  return { items, listings: readonly(listings), loading: readonly(loading), loaded: readonly(loaded), error: readonly(error), meta: readonly(meta), load, takeIntoWork, remove }
}
