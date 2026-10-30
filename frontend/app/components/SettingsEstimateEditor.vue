<script setup lang="ts">
const subsectionKinds = [
  { value: 'furniture', label: 'Мебель' },
  { value: 'equipment', label: 'Оснащение' },
  { value: 'finishing', label: 'Отделка' },
  { value: 'work', label: 'Работа' }
]
const scopes = [
  { value: 'fixed', label: 'Один раздел' },
  { value: 'cabinet', label: 'Для каждого кабинета' },
  { value: 'restroom', label: 'Для каждого санузла' }
]

const {
  draft,
  loaded,
  dirty,
  saving,
  exporting,
  conflict,
  validationError,
  exporterAvailable,
  exportHint,
  save,
  reset,
  addSection,
  removeSection,
  addSubsection,
  removeSubsection,
  addItem,
  removeItem,
  exportExcel
} = useRepairEstimateSettings()
const { show } = useToast()
const newSection = reactive({ name: '', scope: 'fixed' as 'fixed' | 'cabinet' | 'restroom' })
const newSubsections = reactive<Record<string, string>>({})
const newItems = reactive<Record<string, { name: string; price: number | string; link: string; customMade: boolean }>>({})

function availableKinds(section: any) {
  const present = new Set((section.subsections || []).map((item: any) => item.kind))
  return subsectionKinds.filter(item => !present.has(item.value))
}

function sectionScopeHint(scope: string) {
  if (scope === 'cabinet') return 'Раздел будет повторён по количеству кабинетов.'
  if (scope === 'restroom') return 'Раздел будет повторён по количеству санузлов.'
  return 'Раздел будет добавлен в смету один раз.'
}

function itemDraft(id: string) {
  if (!newItems[id]) newItems[id] = { name: '', price: '', link: '', customMade: false }
  return newItems[id]
}

function createSection() {
  const name = newSection.name.trim()
  if (!name) return show('Укажите название раздела.', 'error')
  try {
    addSection(name, newSection.scope)
    newSection.name = ''
    newSection.scope = 'fixed'
  } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось добавить раздел.', 'error')
  }
}

function deleteSection(section: any) {
  if (!confirm(`Удалить раздел «${section.name}» вместе со всеми подразделами и тратами?`)) return
  try { removeSection(section.id) } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось удалить раздел.', 'error')
  }
}

function createSubsection(section: any) {
  const options = availableKinds(section)
  const kind = newSubsections[section.id] || options[0]?.value
  if (!kind) return
  try {
    addSubsection(section.id, kind)
    newSubsections[section.id] = ''
  } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось добавить подраздел.', 'error')
  }
}

function deleteSubsection(section: any, subsection: any) {
  if (!confirm(`Удалить подраздел «${subsection.name}» со всеми тратами?`)) return
  try { removeSubsection(section.id, subsection.id) } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось удалить подраздел.', 'error')
  }
}

function createItem(section: any, subsection: any) {
  const row = itemDraft(subsection.id)
  if (!row.name.trim()) return show('Укажите название траты.', 'error')
  if (row.link.trim()) {
    try {
      const url = new URL(row.link.trim())
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol')
    } catch (_error) {
      return show('Ссылка должна начинаться с http:// или https://.', 'error')
    }
  }
  try {
    addItem(section.id, subsection.id, {
      name: row.name,
      price: row.price,
      link: row.link,
      customMade: subsection.kind === 'furniture' && row.customMade
    })
    newItems[subsection.id] = { name: '', price: '', link: '', customMade: false }
  } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось добавить трату.', 'error')
  }
}

function deleteItem(section: any, subsection: any, item: any) {
  if (!confirm(`Удалить трату «${item.name}»?`)) return
  try { removeItem(section.id, subsection.id, item.id) } catch (reason) {
    show(reason instanceof Error ? reason.message : 'Не удалось удалить трату.', 'error')
  }
}
</script>

<template>
  <AppLoading v-if="!loaded" />
  <div v-else-if="draft" class="estimate-settings">
    <section class="settings-intro">
      <div>
        <h2>Шаблон сметы ремонта</h2>
        <p>Настройте помещения, подразделы и типовые траты. Этот шаблон используется для автоматического формирования документов ремонта.</p>
      </div>
      <div class="settings-export-actions">
        <button
          class="button"
          type="button"
          :disabled="!exporterAvailable || dirty || Boolean(exporting)"
          :title="exportHint"
          @click="exportExcel('estimate')"
        >{{ exporting === 'estimate' ? 'Формируем…' : 'Выгрузить смету в Excel' }}</button>
        <button
          class="button"
          type="button"
          :disabled="!exporterAvailable || dirty || Boolean(exporting)"
          :title="exportHint"
          @click="exportExcel('customFurniture')"
        >{{ exporting === 'customFurniture' ? 'Формируем…' : 'Скачать заказную мебель' }}</button>
        <p v-if="exportHint" class="settings-hint">{{ exportHint }}</p>
      </div>
    </section>

    <p v-if="conflict" class="settings-conflict" role="alert">{{ conflict }}</p>
    <p v-if="validationError" class="settings-conflict" role="alert">{{ validationError }}</p>

    <form class="settings-add-section" @submit.prevent="createSection">
      <label>
        <span>Название нового раздела</span>
        <input v-model="newSection.name" type="text" placeholder="Например: Ресепшен" />
      </label>
      <label>
        <span>Как использовать</span>
        <select v-model="newSection.scope">
          <option v-for="scope in scopes" :key="scope.value" :value="scope.value">{{ scope.label }}</option>
        </select>
      </label>
      <button class="button primary" type="submit">Добавить раздел</button>
    </form>

    <div v-if="!draft.sections.length" class="settings-empty">
      <h2>Разделов пока нет</h2>
      <p>Добавьте первый раздел сметы с помощью формы выше.</p>
    </div>

    <section v-for="(section, sectionIndex) in draft.sections" :key="section.id" class="estimate-section">
      <header class="estimate-section-header">
        <span class="estimate-section-number">{{ String(sectionIndex + 1).padStart(2, '0') }}</span>
        <label class="estimate-section-name">
          <span>Название раздела</span>
          <input v-model="section.name" type="text" />
        </label>
        <label class="estimate-section-scope">
          <span>Повторение</span>
          <select v-model="section.scope">
            <option v-for="scope in scopes" :key="scope.value" :value="scope.value">{{ scope.label }}</option>
          </select>
        </label>
        <button class="button danger compact" type="button" @click="deleteSection(section)">Удалить раздел</button>
        <p>{{ sectionScopeHint(section.scope) }}</p>
      </header>

      <div class="estimate-subsections">
        <article v-for="subsection in section.subsections" :key="subsection.id" class="estimate-subsection">
          <header>
            <div>
              <h3>{{ subsection.name }}</h3>
              <span>{{ subsection.items.length }} {{ subsection.items.length === 1 ? 'трата' : 'трат' }}</span>
            </div>
            <button class="button danger compact" type="button" @click="deleteSubsection(section, subsection)">Удалить подраздел</button>
          </header>

          <div v-if="subsection.items.length" class="estimate-items">
            <div v-for="item in subsection.items" :key="item.id" class="estimate-item-grid">
              <label>
                <span>Название</span>
                <input v-model="item.name" type="text" />
              </label>
              <label>
                <span>Цена, ₽</span>
                <input v-model.number="item.price" type="number" min="0" step="0.01" inputmode="decimal" />
              </label>
              <label>
                <span>Ссылка</span>
                <input v-model="item.link" type="url" placeholder="https://" />
              </label>
              <label v-if="subsection.kind === 'furniture'" class="estimate-custom-check">
                <input v-model="item.customMade" type="checkbox" />
                <span>На заказ</span>
              </label>
              <button class="button danger compact" type="button" @click="deleteItem(section, subsection, item)">Удалить</button>
            </div>
          </div>
          <p v-else class="estimate-no-items">В подразделе пока нет трат.</p>

          <form class="estimate-new-item" @submit.prevent="createItem(section, subsection)">
            <label>
              <span>Новая трата</span>
              <input v-model="itemDraft(subsection.id).name" type="text" placeholder="Название" />
            </label>
            <label>
              <span>Цена, ₽</span>
              <input v-model.number="itemDraft(subsection.id).price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" />
            </label>
            <label>
              <span>Ссылка</span>
              <input v-model="itemDraft(subsection.id).link" type="url" placeholder="https://" />
            </label>
            <label v-if="subsection.kind === 'furniture'" class="estimate-custom-check">
              <input v-model="itemDraft(subsection.id).customMade" type="checkbox" />
              <span>На заказ</span>
            </label>
            <button class="button compact" type="submit">Добавить трату</button>
          </form>
        </article>

        <form v-if="availableKinds(section).length" class="settings-add-subsection" @submit.prevent="createSubsection(section)">
          <label>
            <span>Новый подраздел</span>
            <select v-model="newSubsections[section.id]">
              <option value="">Выберите подраздел</option>
              <option v-for="kind in availableKinds(section)" :key="kind.value" :value="kind.value">{{ kind.label }}</option>
            </select>
          </label>
          <button class="button compact" type="submit">Добавить подраздел</button>
        </form>
      </div>
    </section>

    <footer class="settings-save-bar">
      <span>{{ dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены' }}</span>
      <div>
        <button class="button" type="button" :disabled="!dirty || saving" @click="reset">Отменить изменения</button>
        <button class="button primary" type="button" :disabled="!dirty || saving" @click="save">{{ saving ? 'Сохраняем…' : 'Сохранить' }}</button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.estimate-settings { display: grid; gap: 8px; min-width: 0; padding-bottom: 70px; }
.settings-intro, .settings-add-section, .estimate-section, .settings-empty { border: 1px solid var(--line); border-radius: 13px; background: var(--surface); }
.settings-intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 11px 12px; }
.settings-intro h2, .settings-empty h2 { margin: 0 0 3px; color: var(--ink); font-size: 20px; font-weight: 400; }
.settings-intro p, .settings-empty p { max-width: 720px; margin: 0; color: var(--muted); font-size: 14px; line-height: 1.35; }
.settings-export-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; min-width: min(100%, 390px); }
.settings-hint { flex-basis: 100%; max-width: none !important; text-align: right; font-size: 13px; }
.settings-conflict { margin: 0; padding: 9px 12px; border: 1px solid #e7bdb3; border-radius: 10px; background: #fff5f1; color: #a9503f; }
.settings-add-section { display: grid; grid-template-columns: minmax(220px, 2fr) minmax(190px, 1fr) auto; align-items: end; gap: 8px; padding: 9px 10px; }
label { display: grid; gap: 3px; min-width: 0; color: var(--muted); font-size: 12px; }
input, select { box-sizing: border-box; width: 100%; min-width: 0; min-height: 38px; padding: 0 10px; border: 1px solid var(--line); border-radius: 10px; background: #fffdfa; color: var(--ink); font: inherit; font-size: 14px; }
input:focus, select:focus { outline: 2px solid rgba(78, 128, 121, .22); border-color: #6a938d; }
.settings-empty { padding: 22px; text-align: center; }
.estimate-section { overflow: hidden; border-color: #afc9c3; border-top: 3px solid #4e8079; box-shadow: 0 3px 12px rgba(34, 70, 67, .08); }
.estimate-section-header { display: grid; grid-template-columns: auto minmax(220px, 2fr) minmax(175px, .9fr) auto; align-items: end; gap: 8px; padding: 9px 10px 8px; border-bottom: 1px solid #bdd0cc; background: linear-gradient(90deg, #edf5f2 0%, #f8faf8 100%); }
.estimate-section-header > p { grid-column: 2 / -1; margin: -1px 0 0; color: #617b77; font-size: 12px; line-height: 1.25; }
.estimate-section-number { align-self: center; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: #4e8079; color: #fff; font-size: 13px; }
.estimate-section-name > span, .estimate-section-scope > span { color: #436a65; }
.estimate-section-name input { border-color: #9dbdb6; background: #fff; color: #244f4b; font-size: 17px; }
.estimate-subsections { display: grid; gap: 7px; padding: 8px; background: #fbfcfa; }
.estimate-subsection { min-width: 0; padding: 8px; border: 1px solid #c9d8d4; border-radius: 10px; background: #fff; }
.estimate-subsection > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: -8px -8px 6px; padding: 7px 9px; border-bottom: 1px solid #c9d8d4; background: #f0f5f3; }
.estimate-subsection h3 { margin: 0 0 1px; color: #285b55; font-size: 17px; font-weight: 400; }
.estimate-subsection header span { color: var(--muted); font-size: 12px; }
.estimate-items { display: grid; gap: 5px; padding: 5px 0; }
.estimate-item-grid, .estimate-new-item { display: grid; grid-template-columns: minmax(160px, 1.6fr) minmax(105px, .65fr) minmax(180px, 1.5fr) minmax(100px, auto) auto; align-items: end; gap: 6px; min-width: 0; }
.estimate-item-grid { padding-bottom: 5px; border-bottom: 1px solid #eee5dc; }
.estimate-custom-check { display: flex; align-items: center; align-self: center; gap: 6px; min-height: 38px; color: var(--ink); white-space: nowrap; }
.estimate-custom-check input { width: 18px; min-height: 18px; margin: 0; padding: 0; }
.estimate-no-items { margin: 6px 0; color: var(--muted); font-size: 12px; }
.estimate-new-item { margin-top: 6px; padding: 7px; border-radius: 9px; background: #f5f8f6; }
.settings-add-subsection { display: flex; align-items: end; gap: 6px; padding: 7px; border: 1px dashed #9ebcb5; border-radius: 9px; background: #f8fbf9; }
.settings-add-subsection label { flex: 1; }
.estimate-settings .button.compact { min-height: 34px; padding-inline: 10px; font-size: 13px; }
.settings-save-bar { position: fixed; z-index: 25; right: 24px; bottom: 10px; left: 284px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 12px; background: rgba(255, 253, 249, .96); box-shadow: 0 10px 28px rgba(31, 57, 61, .14); backdrop-filter: blur(10px); }
.settings-save-bar > span { color: var(--muted); font-size: 13px; }
.settings-save-bar > div { display: flex; gap: 8px; }
@media (max-width: 1180px) {
  .settings-intro { flex-direction: column; }
  .settings-export-actions { justify-content: flex-start; min-width: 0; }
  .settings-hint { text-align: left; }
  .estimate-item-grid, .estimate-new-item { grid-template-columns: minmax(180px, 1.4fr) minmax(110px, .6fr) minmax(180px, 1.2fr); }
  .estimate-custom-check, .estimate-item-grid > .button, .estimate-new-item > .button { justify-self: start; }
  .settings-save-bar { right: 20px; left: 274px; }
}
@media (max-width: 900px) {
  .settings-add-section, .estimate-section-header { grid-template-columns: 1fr 1fr; }
  .estimate-section-number { display: none; }
  .estimate-section-header > p { grid-column: 1 / -1; }
  .settings-save-bar { right: 14px; left: 14px; }
}
@media (max-width: 680px) {
  .settings-intro, .settings-add-section, .estimate-section-header { display: grid; grid-template-columns: 1fr; }
  .settings-export-actions, .settings-export-actions .button { width: 100%; }
  .estimate-section-header > p { grid-column: auto; }
  .estimate-settings { gap: 7px; padding-bottom: 116px; }
  .settings-intro { padding: 9px; }
  .estimate-section-header { padding: 8px; }
  .estimate-subsections { gap: 6px; padding: 6px; }
  .estimate-subsection > header { align-items: flex-start; }
  .estimate-item-grid, .estimate-new-item { grid-template-columns: 1fr; }
  .settings-add-subsection { align-items: stretch; flex-direction: column; }
  .settings-save-bar { right: 8px; bottom: 8px; left: 8px; align-items: stretch; flex-direction: column; }
  .settings-save-bar > div, .settings-save-bar .button { width: 100%; }
}
</style>
