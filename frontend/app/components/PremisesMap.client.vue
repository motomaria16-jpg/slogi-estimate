<script setup lang="ts">
import { projectCard } from '~/utils/format'
import { isSlogiObject } from '~/utils/slogiObjects'

const props = withDefaults(defineProps<{ items: readonly any[]; selectedId?: string; showClusters?: boolean; showSlogiObjects?: boolean }>(), { selectedId: '', showClusters: false, showSlogiObjects: true })
const emit = defineEmits<{ select: [id: string]; open: [id: string] }>()
const { objects: slogiObjects } = useSlogiObjects()
const mapHost = ref<HTMLElement | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const clustersVisible = ref(props.showClusters)
const MOSCOW_CENTER: [number, number] = [55.7558, 37.6176]
const MOSCOW_ZOOM = 9
let map: any = null
let scriptPromise: Promise<void> | null = null
let initialViewportApplied = false
const plottedItems = computed(() => {
  const values = props.showSlogiObjects ? [...props.items, ...slogiObjects.value] : props.items
  const unique = new Map<string, any>()
  values.forEach((item: any, index: number) => unique.set(String(item?.id || item?.externalId || item?.listingUrl || index), item))
  return [...unique.values()]
})

function coordinates(item: any) {
  const card = projectCard(item)
  const lat = Number(card?.geo?.lat ?? item?.latitude ?? item?.geo?.lat)
  const lng = Number(card?.geo?.lng ?? item?.longitude ?? item?.geo?.lng)
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null
}

function loadYandex() {
  if (window.ymaps) return new Promise<void>(resolve => window.ymaps.ready(resolve))
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const key = String(window.SLOGI_CONFIG?.yandexMapsApiKey || '')
    const script = document.createElement('script')
    script.src = `https://api-maps.yandex.ru/2.1/?lang=ru_RU${key ? `&apikey=${encodeURIComponent(key)}` : ''}`
    script.async = true
    script.onload = () => window.ymaps.ready(resolve)
    script.onerror = () => reject(new Error('map_unavailable'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

function renderMap() {
  if (!map || !window.ymaps) return
  map.geoObjects.removeAll()
  if (props.showClusters && clustersVisible.value) {
    const features = window.SLOGI_CLUSTERS_GEOJSON?.features || []
    const convert = (ring: number[][]) => ring.map(point => [point[1], point[0]])
    features.forEach((feature: any) => {
      const geometry = feature?.geometry || {}
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
      polygons.forEach((polygon: number[][][]) => {
        map.geoObjects.add(new window.ymaps.Polygon(polygon.map(convert), {
          hintContent: feature?.properties?.name || 'Кластер'
        }, {
          fillColor: '#7fa49b33',
          strokeColor: '#315c5d',
          strokeWidth: 2,
          interactivityModel: 'default#transparent'
        }))
      })
    })
  }
  plottedItems.value.forEach(item => {
    const point = coordinates(item)
    if (!point) return
    const id = String(item.id || item.externalId || item.listingUrl || '')
    const slogiObject = isSlogiObject(item)
    const marker = new window.ymaps.Placemark(point, {
      hintContent: slogiObject ? `СЛОГИ · ${item.address || 'Текущий объект'}` : item.address || 'Помещение',
      iconContent: slogiObject ? 'СЛОГИ' : ''
    }, slogiObject
      ? { preset: 'islands#darkGreenStretchyIcon', zIndex: 850 }
      : { preset: id === props.selectedId ? 'islands#redDotIcon' : 'islands#darkGreenDotIcon' })
    marker.events.add('click', () => {
      emit('select', id)
      if (!slogiObject) emit('open', id)
    })
    map.geoObjects.add(marker)
  })
  if (!initialViewportApplied) {
    map.setCenter(MOSCOW_CENTER, MOSCOW_ZOOM)
    initialViewportApplied = true
  }
}

onMounted(async () => {
  try {
    await loadYandex()
    if (!mapHost.value) return
    map = new window.ymaps.Map(mapHost.value, { center: MOSCOW_CENTER, zoom: MOSCOW_ZOOM, controls: ['zoomControl', 'fullscreenControl'] })
    state.value = 'ready'
    renderMap()
  } catch {
    state.value = 'error'
  }
})

watch(() => [plottedItems.value, props.selectedId], renderMap, { deep: true })
watch(clustersVisible, renderMap)
onBeforeUnmount(() => { map?.destroy?.(); map = null })
</script>

<template>
  <div class="map-stage">
    <div ref="mapHost" class="map-host" />
    <button v-if="showClusters" class="map-cluster-toggle" type="button" :aria-pressed="clustersVisible" @click="clustersVisible = !clustersVisible">{{ clustersVisible ? 'Скрыть кластеры' : 'Показать кластеры' }}</button>
    <div v-if="state === 'loading'" class="map-overlay"><AppLoading label="Загружаем карту…" /></div>
    <div v-else-if="state === 'error'" class="map-overlay"><strong>Карта временно недоступна</strong><span>Список помещений продолжает работать.</span></div>
  </div>
</template>
