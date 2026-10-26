<script setup lang="ts">
const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const { open: openAssistant } = useAiAssistant()
const buildVersion = String((runtimeConfig.app as { buildId?: string }).buildId || '')
const groups = [
  {
    label: 'Поиск помещения',
    links: [
      { to: '/available-spaces.html', label: 'Поиск помещения', shortLabel: 'Поиск', icon: '⌕' },
      { to: '/in-work.html', label: 'Помещения в работе', shortLabel: 'В работе', icon: '▥' },
      { to: '/proposal.html', label: 'КП', shortLabel: 'КП', icon: '▤' },
      { to: '/under-development.html?section=approvals', label: 'Согласование', shortLabel: 'Согласование', icon: '▤' }
    ]
  },
  {
    label: 'Ремонт',
    links: [
      { to: '/under-development.html?section=documents', label: 'Формирование документов для ремонта', shortLabel: 'Документы', icon: '▤' },
      { to: '/under-development.html?section=repair', label: 'Процесс ремонта', shortLabel: 'Ремонт', icon: '⌁' },
      { to: '/under-development.html?section=handover', label: 'Выход из ремонта', shortLabel: 'Выход', icon: '⌁' }
    ]
  },
  {
    label: '',
    links: [{ to: '/under-development.html?section=objects', label: 'Мои объекты', shortLabel: 'Объекты', icon: '▥' }]
  }
]

function active(path: string) {
  const [pathname, query = ''] = path.split('?')
  if (route.path !== pathname) return false
  const section = new URLSearchParams(query).get('section')
  return !section || route.query.section === section
}

function versionedTarget(destination: string) {
  const [path, search = ''] = destination.split('?')
  const query = Object.fromEntries(new URLSearchParams(search))
  if (buildVersion) query.build = buildVersion
  return { path, query }
}
</script>

<template>
  <aside class="sidebar" aria-label="Основное меню">
    <NuxtLink class="brand" :to="versionedTarget('/available-spaces.html')" aria-label="СЛОГИ — главная">
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
        >
          <span aria-hidden="true">{{ link.icon }}</span><span class="sidebar-link-label">{{ link.label }}</span><span class="sidebar-link-short">{{ link.shortLabel }}</span>
        </NuxtLink>
      </section>
    </nav>
    <button class="sidebar-assistant" type="button" aria-label="Открыть ИИ-помощника" title="Открыть ИИ-помощника" @click="openAssistant">
      <img src="/legacy/ai-assistant-owl.png" alt="" aria-hidden="true" />
      <span>Нужна помощь?</span>
    </button>
  </aside>
</template>
