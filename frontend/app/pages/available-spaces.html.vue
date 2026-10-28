<script setup lang="ts">
const route = useRoute()
await navigateTo({ path: '/in-work.html', query: route.query }, { replace: true })
</script>

<template><span /></template>
