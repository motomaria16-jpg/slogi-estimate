import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = resolve(here, '..')
const source = resolve(frontend, '..')
const target = resolve(frontend, 'public', 'legacy')
const publicRoot = `${resolve(frontend, 'public')}${sep}`

if (!`${target}${sep}`.startsWith(publicRoot)) {
  throw new Error(`Refusing to replace assets outside the Nuxt public directory: ${target}`)
}

const files = [
  'phase0-config.js',
  'shared-workspace.js',
  'professional-core.js',
  'workflow-storage.js',
  'yandex-map-config.js',
  'clusters-data.js',
  'clusters.geojson',
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
  'proposal-document.js',
  'proposal-logo.png',
  'KP_Slogi_template.docx',
  'lease-agreement-template.docx',
  'documents-owl-approved-v2.png',
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png'
]

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await Promise.all(files.map(file => cp(resolve(source, file), resolve(target, file))))
console.log(`Synced ${files.length} tested domain assets to Nuxt public/legacy.`)
