<script setup lang="ts">
useHead({ title: 'Настройки', bodyAttrs: { class: 'settings-route' } })
</script>

<template>
  <div class="page settings-page">
    <header class="page-header">
      <div class="page-title-line">
        <h1>Настройки</h1>
        <span class="count-chip">Смета ремонта</span>
      </div>
    </header>
    <SettingsEstimateEditor />
  </div>
</template>

<style scoped>
.settings-page { min-width: 0; }
</style>
