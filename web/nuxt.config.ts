import { fileURLToPath } from 'node:url'
import { fetchAllPublishedSlugs, payloadConfigFromEnv } from '../shared/careers/payload-client'

const sharedCareers = fileURLToPath(new URL('../shared/careers', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },

  // Static site generation: `nuxt generate` writes .output/public, which is
  // deployed to Azure Static Web Apps. Pages are server-rendered at build time.
  ssr: true,

  css: ['~/assets/css/main.css'],

  alias: {
    // Code shared with the Azure Functions API (types, Payload client, handlers).
    '#careers': sharedCareers,
  },

  runtimeConfig: {
    public: {
      siteName: 'Ignite Hubs Careers Hubs',
      siteUrl: '',
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'theme-color', content: '#c2410c' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },

  nitro: {
    prerender: {
      crawlLinks: true,
      routes: ['/', '/careers'],
      // Never write API responses into the static output: in production
      // /api/* is served by Azure Functions.
      ignore: ['/api'],
      failOnError: true,
    },
  },

  hooks: {
    // Discover every published career path directly from Payload so each one
    // gets its own prerendered page, even beyond the first page of the list.
    async 'prerender:routes'(ctx) {
      const slugs = await fetchAllPublishedSlugs(payloadConfigFromEnv(process.env))
      for (const slug of slugs) {
        ctx.routes.add(`/careers/${slug}`)
      }
      console.info(`[careers] prerendering ${slugs.length} career page(s)`)
    },
  },

  vite: {
    server: {
      // Allow the dev server to serve ../shared.
      fs: { allow: ['..'] },
    },
  },

  typescript: {
    strict: true,
  },
})
