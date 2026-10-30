<script setup lang="ts">
const props = withDefaults(defineProps<{ open?: boolean }>(), { open: false })
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const { open: openAssistant } = useAiAssistant()
const menuId = 'slogi-primary-navigation'
const buildVersion = String((runtimeConfig.app as { buildId?: string }).buildId || '')
const groups = [
  {
    label: 'Помещения',
    links: [
      { to: '/in-work.html', label: 'Помещения в работе', shortLabel: 'В работе', icon: '▥' },
      { to: '/proposal.html', label: 'Коммерческое предложение', shortLabel: 'КП', icon: '▤' },
      { to: '/approvals.html', label: 'Согласование', shortLabel: 'Согласование', icon: '▤' }
    ]
  },
  {
    label: 'Ремонт',
    links: [
      { to: '/repair.html?section=documents', label: 'Документы для ремонта', shortLabel: 'Документы', icon: '▤' },
      { to: '/repair.html?section=repair', label: 'Процесс ремонта', shortLabel: 'Ремонт', icon: '⌁' },
      { to: '/repair.html?section=handover', label: 'Выход из ремонта', shortLabel: 'Выход', icon: '⌁' }
    ]
  },
  {
    label: '',
    links: [
      { to: '/slogi-objects.html', label: 'Текущие объекты СЛОГИ', shortLabel: 'Объекты СЛОГИ', icon: '▥' },
      { to: '/settings.html', label: 'Настройки', shortLabel: 'Настройки', icon: '⚙' }
    ]
  }
]

function active(path: string) {
  const [pathname, query = ''] = path.split('?')
  if (route.path !== pathname) return false
  const section = new URLSearchParams(query).get('section')
  const currentSection = String(route.query.section || (pathname === '/repair.html' ? 'documents' : ''))
  return !section || currentSection === section
}

function versionedTarget(destination: string) {
  const [path, search = ''] = destination.split('?')
  const query = Object.fromEntries(new URLSearchParams(search))
  if (buildVersion) query.build = buildVersion
  return { path, query }
}

function setMenuOpen(value: boolean) {
  emit('update:open', value)
}

function closeMenu() {
  setMenuOpen(false)
}

function openAssistantFromMenu() {
  closeMenu()
  openAssistant()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) closeMenu()
}

watch(() => route.fullPath, closeMenu)
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <button
    class="sidebar-menu-toggle"
    type="button"
    :aria-expanded="open"
    :aria-controls="menuId"
    :aria-label="open ? 'Закрыть меню' : 'Открыть меню'"
    @click="setMenuOpen(!open)"
  >
    <span aria-hidden="true"></span>
    <span aria-hidden="true"></span>
    <span aria-hidden="true"></span>
  </button>
  <button
    v-if="open"
    class="sidebar-menu-overlay"
    type="button"
    aria-label="Закрыть меню"
    @click="closeMenu"
  ></button>
  <aside :id="menuId" class="sidebar" :class="{ 'is-open': open }" aria-label="Основное меню">
    <NuxtLink class="brand" :to="versionedTarget('/in-work.html')" aria-label="СЛОГИ — главная" @click="closeMenu">
      <span v-for="(letter, index) in ['С', 'Л', 'О', 'Г', 'И']" :key="letter" :class="`brand-letter brand-letter-${index + 1}`">{{ letter }}</span>
    </NuxtLink>
    <nav class="sidebar-nav">
      <section v-for="group in groups" :key="group.label || 'objects'" class="sidebar-group">
        <p v-if="group.label" class="sidebar-label">{{ group.label }}</p>
        <NuxtLink
          v-for="link in group.links"
          :key="link.to"
          :to="versionedTarget(link.to)"
          class="sidebar-link"
          :class="{ active: active(link.to) }"
          @click="closeMenu"
        >
          <span aria-hidden="true">{{ link.icon }}</span><span class="sidebar-link-label">{{ link.label }}</span><span class="sidebar-link-short">{{ link.shortLabel }}</span>
        </NuxtLink>
      </section>
    </nav>
    <button class="sidebar-assistant" type="button" aria-label="Открыть ИИ-помощника" title="Открыть ИИ-помощника" @click="openAssistantFromMenu">
      <img src="/legacy/ai-assistant-owl.png" alt="" aria-hidden="true" />
      <span>Нужна помощь?</span>
    </button>
  </aside>
</template>
