<script setup lang="ts">
useHead({ title: 'Раздел в разработке' })
const route = useRoute()
const names: Record<string, string> = { approvals: 'Согласование', documents: 'Формирование документов для ремонта', repair: 'Процесс ремонта', handover: 'Выход из ремонта' }
const name = computed(() => names[String(route.query.section || '')] || 'Раздел')
if (String(route.query.section || '') === 'approvals') await navigateTo('/approvals.html', { replace: true })
</script>

<template><div class="page"><section class="development-card"><span>◌</span><h1>{{ name }}</h1><p>Раздел в разработке</p><NuxtLink class="button" to="/in-work.html">Вернуться к помещениям</NuxtLink></section></div></template>
