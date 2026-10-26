<script setup lang="ts">
const model = defineModel<string>({ default: 'unknown' })
defineProps<{ includeUnknown?: boolean }>()
</script>

<template>
  <div class="choice-pills">
    <button type="button" :class="{ active: model === 'yes' }" @click="model = 'yes'">Да</button>
    <button type="button" :class="{ active: model === 'no' }" @click="model = 'no'">Нет</button>
    <button v-if="includeUnknown" type="button" :class="{ active: model === 'unknown' }" @click="model = 'unknown'">—</button>
  </div>
</template>
