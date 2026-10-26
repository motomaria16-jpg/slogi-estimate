<script setup lang="ts">
defineProps<{ label?: string }>()
</script>

<template>
  <div class="loading-state" role="status"><span class="spinner" aria-hidden="true" /><p>{{ label || 'Загружаем данные…' }}</p></div>
</template>
