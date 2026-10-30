export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  experimental: { payloadExtraction: false },
  ssr: true,
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      titleTemplate: '%s — СЛОГИ',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { 'http-equiv': 'Cache-Control', content: 'no-cache,no-store,must-revalidate' },
        { name: 'theme-color', content: '#5f797e' }
      ],
      link: [
        { rel: 'icon', href: '/legacy/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/legacy/apple-touch-icon.png' }
      ]
    }
  },
  nitro: {
    prerender: {
      routes: ['/', '/available-spaces.html', '/in-work.html', '/proposal.html', '/approvals.html', '/repair.html', '/slogi-objects.html', '/settings.html', '/under-development.html'],
      crawlLinks: true
    }
  },
  typescript: {
    strict: true,
    typeCheck: false
  }
})
