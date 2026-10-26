<script setup lang="ts">
import { projectCard } from '~/utils/format'

const props = withDefaults(defineProps<{ items: any[]; selectedId?: string; showClusters?: boolean }>(), { selectedId: '', showClusters: false })
const emit = defineEmits<{ select: [id: string] }>()
const mapHost = ref<HTMLElement | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const clustersVisible = ref(props.showClusters)
let map: any = null
let scriptPromise: Promise<void> | null = null

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
  const bounds: number[][] = []
  props.items.forEach(item => {
    const point = coordinates(item)
    if (!point) return
    bounds.push(point)
    const id = String(item.id || item.externalId || item.listingUrl || '')
    const marker = new window.ymaps.Placemark(point, { hintContent: item.address || 'Помещение' }, {
      preset: id === props.selectedId ? 'islands#redDotIcon' : 'islands#darkGreenDotIcon'
    })
    marker.events.add('click', () => emit('select', id))
    map.geoObjects.add(marker)
  })
  if (bounds.length) map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 32 })
  else map.setCenter([55.7558, 37.6176], 9)
}

onMounted(async () => {
  try {
    await loadYandex()
    if (!mapHost.value) return
    map = new window.ymaps.Map(mapHost.value, { center: [55.7558, 37.6176], zoom: 9, controls: ['zoomControl', 'fullscreenControl'] })
    state.value = 'ready'
    renderMap()
  } catch {
    state.value = 'error'
  }
})

watch(() => [props.items, props.selectedId], renderMap, { deep: true })
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
