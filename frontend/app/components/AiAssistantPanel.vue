<script setup lang="ts">
const { isOpen, messages, close, send } = useAiAssistant()
const question = ref('')
const input = ref<HTMLInputElement | null>(null)
const history = ref<HTMLElement | null>(null)

const quickQuestions = [
  'Как добавить помещение?',
  'Как назначить просмотр?',
  'Как подготовить КП?'
]

watch(isOpen, async (opened) => {
  if (!opened) return
  await nextTick()
  input.value?.focus()
})

watch(() => messages.value.length, async () => {
  await nextTick()
  history.value?.scrollTo({ top: history.value.scrollHeight, behavior: 'smooth' })
})

function submit(value = question.value) {
  if (!value.trim()) return
  send(value)
  question.value = ''
}
</script>

<template>
  <Transition name="assistant-panel">
    <div v-if="isOpen" class="ai-assistant-layer" @keydown.esc="close">
      <button class="ai-assistant-backdrop" type="button" aria-label="Закрыть ИИ-помощник" @click="close" />
      <aside class="ai-assistant-panel" role="dialog" aria-modal="true" aria-labelledby="ai-assistant-title">
        <header class="ai-assistant-header">
          <img src="/legacy/ai-assistant-owl.png" alt="" aria-hidden="true" />
          <div>
            <h2 id="ai-assistant-title">ИИ-помощник</h2>
            <p>Помощь по работе с платформой</p>
          </div>
          <button class="close-button" type="button" aria-label="Закрыть" @click="close">×</button>
        </header>

        <div ref="history" class="ai-assistant-history" aria-live="polite">
          <p v-for="message in messages" :key="message.id" class="ai-assistant-message" :class="`is-${message.role}`">
            {{ message.text }}
          </p>
        </div>

        <div class="ai-assistant-quick" aria-label="Быстрые вопросы">
          <button v-for="item in quickQuestions" :key="item" type="button" @click="submit(item)">{{ item }}</button>
        </div>

        <form class="ai-assistant-form" @submit.prevent="submit()">
          <input ref="input" v-model="question" type="text" autocomplete="off" placeholder="Напишите вопрос…" aria-label="Вопрос ИИ-помощнику" />
          <button type="submit" :disabled="!question.trim()" aria-label="Отправить вопрос">↑</button>
        </form>
      </aside>
    </div>
  </Transition>
</template>
