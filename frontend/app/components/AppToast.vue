<script setup lang="ts">
const props = withDefaults(defineProps<{ scope?: 'global' | 'dialog' }>(), { scope: 'global' })
const { toast, hide } = useToast()
const { state } = usePropertyModal()
const visible = computed(() => toast.value.visible && (props.scope === 'dialog' ? state.value.open : !state.value.open))
</script>

<template>
  <Transition name="toast">
    <div
      v-if="visible"
      class="app-toast"
      :class="[`is-${toast.tone}`, { 'app-toast--dialog': props.scope === 'dialog' }]"
      :role="toast.tone === 'error' ? 'alert' : 'status'"
      :aria-live="toast.tone === 'error' ? 'assertive' : 'polite'"
    ><span>{{ toast.message }}</span><button type="button" aria-label="Закрыть уведомление" @click="hide">×</button></div>
  </Transition>
</template>
