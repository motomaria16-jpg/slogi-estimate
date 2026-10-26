<script setup lang="ts">
const { toast } = useToast()
</script>

<template>
  <Transition name="toast">
    <div v-if="toast.visible" class="app-toast" :class="`is-${toast.tone}`" role="status">{{ toast.message }}</div>
  </Transition>
</template>
