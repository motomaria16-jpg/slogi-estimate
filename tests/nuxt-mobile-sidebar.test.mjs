import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('mobile sidebar is controlled by the layout and exposes an accessible burger button', () => {
  const layout = read('frontend/app/layouts/default.vue')
  const sidebar = read('frontend/app/components/AppSidebar.vue')

  assert.match(layout, /const mobileMenuOpen = ref\(false\)/)
  assert.match(layout, /<AppSidebar v-model:open="mobileMenuOpen" \/>/)
  assert.match(sidebar, /class="sidebar-menu-toggle"/)
  assert.match(sidebar, /:aria-expanded="open"/)
  assert.match(sidebar, /:aria-controls="menuId"/)
  assert.match(sidebar, /:aria-label="open \? 'Закрыть меню' : 'Открыть меню'"/)
  assert.match(sidebar, /:class="\{ 'is-open': open \}"/)
})

test('mobile sidebar closes from overlay, navigation, assistant and Escape', () => {
  const sidebar = read('frontend/app/components/AppSidebar.vue')

  assert.match(sidebar, /class="sidebar-menu-overlay"[\s\S]*@click="closeMenu"/)
  assert.match(sidebar, /<NuxtLink class="brand"[\s\S]*@click="closeMenu"/)
  assert.match(sidebar, /class="sidebar-link"[\s\S]*@click="closeMenu"/)
  assert.match(sidebar, /@click="openAssistantFromMenu"/)
  assert.match(sidebar, /event\.key === 'Escape'/)
  assert.match(sidebar, /watch\(\(\) => route\.fullPath, closeMenu\)/)
  assert.match(sidebar, /removeEventListener\('keydown', onKeydown\)/)
})

test('mobile sidebar is an off-canvas drawer instead of a horizontal strip', () => {
  const css = read('frontend/app/assets/css/main.css')

  assert.match(css, /\.sidebar-menu-toggle, \.sidebar-menu-overlay \{ display: none; \}/)
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*\.sidebar-menu-toggle \{[^}]*position: fixed/)
  assert.match(css, /\.sidebar \{[^}]*transform: translateX\(calc\(-100% - 16px\)\)/)
  assert.match(css, /\.sidebar\.is-open \{ transform: translateX\(0\); \}/)
})
