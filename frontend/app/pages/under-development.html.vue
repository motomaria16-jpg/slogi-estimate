<script setup lang="ts">
useHead({ title: 'Раздел в разработке' })
const route = useRoute()
const names: Record<string, string> = { approvals: 'Согласование', documents: 'Документы для ремонта', repair: 'Процесс ремонта', handover: 'Выход из ремонта' }
const name = computed(() => names[String(route.query.section || '')] || 'Раздел')
const legacySection = String(route.query.section || '')
const repairRedirects: Record<string, string> = {
  documents: 'documents',
  'repair-documents': 'documents',
  repair: 'repair',
  'repair-process': 'repair',
  handover: 'handover',
  'repair-exit': 'handover'
}
if (legacySection === 'approvals') await navigateTo('/approvals.html', { replace: true })
else if (repairRedirects[legacySection]) await navigateTo(`/repair.html?section=${repairRedirects[legacySection]}`, { replace: true })
</script>

<template><div class="page"><section class="development-card"><span>◌</span><h1>{{ name }}</h1><p>Раздел в разработке</p><NuxtLink class="button" to="/in-work.html">Вернуться к помещениям</NuxtLink></section></div></template>
