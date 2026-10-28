import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('search page is hidden and the primary navigation exposes current SLOGI objects', () => {
  const sidebar = read('frontend/app/components/AppSidebar.vue')
  const search = read('frontend/app/pages/available-spaces.html.vue')
  const index = read('frontend/app/pages/index.vue')

  assert.doesNotMatch(sidebar, /label: 'Поиск помещения'/)
  assert.match(sidebar, /Текущие объекты СЛОГИ/)
  assert.match(sidebar, /\/slogi-objects\.html/)
  assert.match(search, /navigateTo\(\{ path: '\/in-work\.html'/)
  assert.match(index, /navigateTo\(\{ path: '\/in-work\.html'/)
})
test('current objects use shared storage, server geocoding and the canonical cluster service', () => {
  const composable = read('frontend/app/composables/useSlogiObjects.ts')
  const page = read('frontend/app/pages/slogi-objects.html.vue')

  assert.match(composable, /geocodingService\.geocode/)
  assert.match(composable, /clusterService\.locate/)
  assert.match(composable, /SlogiPro\.readLocations/)
  assert.match(composable, /SlogiPro\.writeLocations/)
  assert.match(composable, /entityType: 'slogi_center'/)
  assert.match(page, /Адрес нового объекта/)
  assert.match(page, /show-clusters/)
})

test('every Nuxt premises map automatically overlays labeled SLOGI markers', () => {
  const map = read('frontend/app/components/PremisesMap.client.vue')
  const css = read('frontend/app/assets/css/main.css')

  assert.match(map, /showSlogiObjects/)
  assert.match(map, /useSlogiObjects\(\)/)
  assert.match(map, /iconContent: slogiObject \? 'СЛОГИ'/)
  assert.match(map, /darkGreenStretchyIcon/)
  assert.match(map, /MOSCOW_CENTER: \[number, number\] = \[55\.7558, 37\.6176\]/)
  assert.match(map, /MOSCOW_ZOOM = 9/)
  assert.doesNotMatch(map, /map\.setBounds\(/)
  assert.match(css, /grid-template-columns: minmax\(0, \.85fr\) minmax\(420px, 1\.15fr\)/)
  assert.match(css, /body, body \* \{ font-weight: 400 !important; \}/)
})
