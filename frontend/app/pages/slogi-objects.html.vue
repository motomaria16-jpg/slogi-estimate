<script setup lang="ts">
useHead({ title: 'Текущие объекты СЛОГИ' })
const { ready } = useSlogiRuntime()
const { objects, addAddress, removeObject } = useSlogiObjects()
const { show } = useToast()
const address = ref('')
const adding = ref(false)
const selectedId = ref('')

async function addObject() {
  if (adding.value) return
  adding.value = true
  try {
    const item = await addAddress(address.value)
    selectedId.value = String(item.id)
    address.value = ''
    show('Объект СЛОГИ добавлен и отмечен на всех картах.')
  } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось добавить объект.', 'error')
  } finally {
    adding.value = false
  }
}

function remove(item: any) {
  if (!confirm(`Удалить объект СЛОГИ по адресу «${item.address}»?`)) return
  try {
    removeObject(item.id)
    if (selectedId.value === String(item.id)) selectedId.value = ''
    show('Объект СЛОГИ удалён с карт.')
  } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось удалить объект.', 'error')
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="page-title-line">
        <h1>Текущие объекты СЛОГИ</h1>
        <span class="count-chip">{{ objects.length }} {{ objects.length === 1 ? 'объект' : 'объектов' }}</span>
      </div>
    </header>

    <form class="slogi-object-form" @submit.prevent="addObject">
      <label for="slogi-object-address">Адрес нового объекта</label>
      <input id="slogi-object-address" v-model="address" type="text" autocomplete="street-address" placeholder="Например: Москва, улица Селигерская, 18к1" />
      <button class="button primary" type="submit" :disabled="adding || !address.trim()">{{ adding ? 'Определяем адрес…' : 'Добавить объект' }}</button>
    </form>

    <section class="split-workspace">
      <div class="list-panel">
        <AppLoading v-if="!ready" />
        <div v-else-if="!objects.length" class="empty-state compact">
          <span>⌖</span>
          <h2>Объекты ещё не добавлены</h2>
          <p>Введите адрес выше — объект появится здесь и на всех картах сайта с флажком «СЛОГИ».</p>
        </div>
        <div v-else class="slogi-object-list">
          <article v-for="item in objects" :key="item.id" class="slogi-object-card" :class="{ selected: selectedId === String(item.id) }" @click="selectedId = String(item.id)">
            <div>
              <span class="badge">СЛОГИ</span>
              <h2>{{ item.address }}</h2>
              <p>{{ item.clusterName || 'Вне кластеров' }}</p>
            </div>
            <button v-if="item.entityType === 'slogi_center'" class="button danger compact" type="button" @click.stop="remove(item)">Удалить</button>
          </article>
        </div>
      </div>
      <aside class="map-panel">
        <div class="panel-heading">
          <div><h2>Карта объектов и кластеров</h2><p>Все действующие объекты СЛОГИ</p></div>
          <span class="count-chip">{{ objects.length }} {{ objects.length === 1 ? 'точка' : 'точек' }}</span>
        </div>
        <ClientOnly><PremisesMap :items="objects" :selected-id="selectedId" show-clusters @select="selectedId = $event" /></ClientOnly>
        <p class="panel-note">Контуры кластеров показаны на карте. Каждый текущий объект отмечен флажком «СЛОГИ».</p>
      </aside>
    </section>
  </div>
</template>
