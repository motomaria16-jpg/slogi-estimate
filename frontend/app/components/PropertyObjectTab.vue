<script setup lang="ts">
const form = defineModel<any>({ required: true })
const emit = defineEmits<{ resolve: [] }>()
</script>

<template>
  <div class="object-tab">
    <section class="inline-data-strip">
      <label class="wide"><span>Адрес</span><input v-model="form.address" /></label>
      <button class="button compact" type="button" @click="emit('resolve')">Определить</button>
      <label><span>Объявление</span><input v-model="form.listingUrl" placeholder="https://…" /></label>
      <label class="coordinate"><span>Широта</span><input v-model.number="form.latitude" inputmode="decimal" /></label>
      <label class="coordinate"><span>Долгота</span><input v-model.number="form.longitude" inputmode="decimal" /></label>
    </section>

    <div class="object-grid">
      <section class="form-card">
        <h3><span>01</span>Кластер и рейтинг</h3>
        <label class="form-row"><b>Название кластера</b><input v-model="form.clusterName" /></label>
        <label class="form-row"><b>Входит в кластер</b><TriStateField v-model="form.clusterInside" /></label>
        <label class="form-row"><b>Объект СЛОГИ в кластере</b><TriStateField v-model="form.hasSlogiCenter" /></label>
        <label class="form-row"><b>Место в ТОП-35</b><input v-model.number="form.clusterRank" type="number" min="1" /></label>
      </section>

      <section class="form-card">
        <h3><span>02</span>Экономика</h3>
        <label class="form-row"><b>Аренда в месяц</b><input v-model.number="form.rentMonthly" type="number" min="0" /></label>
        <label class="form-row"><b>Площадь, м²</b><div class="row-control"><input v-model.number="form.area" type="number" min="0" /><TriStateField v-model="form.areaConfirmed" /></div></label>
        <label class="form-row"><b>Цена за 1 м²</b><output>{{ form.area && form.rentMonthly ? Math.round(form.rentMonthly / form.area).toLocaleString('ru-RU') : '—' }}</output></label>
        <label class="form-row"><b>Средняя в кластере</b><input v-model.number="form.averageRentPerSqm" type="number" min="0" /></label>
      </section>

      <section class="form-card full">
        <h3><span>03</span>Технические условия</h3>
        <div class="technical-grid">
          <label class="form-row"><b>Входная группа</b><TriStateField v-model="form.separateEntrance" include-unknown /></label>
          <label class="form-row"><b>Окна есть</b><TriStateField v-model="form.hasWindows" include-unknown /></label>
          <label class="form-row"><b>Окна открываются</b><TriStateField v-model="form.windowsOpen" include-unknown /></label>
          <label class="form-row"><b>Высота потолков, м</b><div class="row-control"><input v-model.number="form.ceilingHeight" type="number" min="0" step="0.1" /><TriStateField v-model="form.ceilingHeightConfirmed" /></div></label>
          <label class="form-row"><b>Ремонт</b><select v-model="form.repair"><option value="">Не указано</option><option value="concrete">Бетон</option><option value="rough">Черновой</option><option value="finished">Чистовой</option></select></label>
        </div>
      </section>
    </div>
  </div>
</template>
