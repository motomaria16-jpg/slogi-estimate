<script setup lang="ts">
const mobileMenuOpen = ref(false)
</script>

<template>
  <div class="app-shell">
    <AppSidebar v-model:open="mobileMenuOpen" />
    <main class="app-content">
      <slot />
    </main>
  </div>
</template>
