const legacyScripts = [
  'phase0-config.js',
  'shared-workspace.js',
  'professional-core.js',
  'workflow-storage.js',
  'yandex-map-config.js',
  'clusters-data.js',
  'cluster-geometry.js',
  'search-space-card.js',
  'premises-list-card.js',
  'pako-inflate.min.js',
  'office-zip.js',
  'xlsx-workflow.js',
  'phase0-services.js',
  'cian-listing-feed.js',
  'cian-map-data.js',
  'work-calendar.js',
  'proposal-assets.js',
  'proposal-stage.js',
  'proposal-document.js'
]

function loadScript(file: string) {
  const source = `/legacy/${file}`
  const existing = document.querySelector<HTMLScriptElement>(`script[data-slogi-legacy="${file}"]`)
  if (existing?.dataset.loaded === 'true') return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const script = existing || document.createElement('script')
    const done = () => { script.dataset.loaded = 'true'; resolve() }
    script.addEventListener('load', done, { once: true })
    script.addEventListener('error', () => reject(new Error(`Не удалось загрузить ${file}`)), { once: true })
    if (!existing) {
      script.src = source
      script.dataset.slogiLegacy = file
      script.defer = false
      document.head.appendChild(script)
    }
  })
}

export default defineNuxtPlugin((nuxtApp) => {
  const ready = useState<boolean>('slogi-runtime-ready', () => false)
  const error = useState<string>('slogi-runtime-error', () => '')

  function restoreGrantedAccess() {
    if (
      window.SlogiCloud?.ready === true
      && document.documentElement.getAttribute('data-slogi-access') !== 'granted'
    ) {
      document.documentElement.setAttribute('data-slogi-access', 'granted')
    }
  }

  const accessObserver = new MutationObserver(restoreGrantedAccess)
  accessObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-slogi-access'] })
  nuxtApp.hook('page:finish', restoreGrantedAccess)

  nuxtApp.hook('app:mounted', async () => {
    try {
      for (const scriptFile of legacyScripts) {
        await loadScript(scriptFile)
      }
      ready.value = true
      restoreGrantedAccess()
      window.dispatchEvent(new CustomEvent('slogi:runtime-ready'))
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : 'Не удалось запустить приложение.'
      console.error(reason)
    }
  })
})
