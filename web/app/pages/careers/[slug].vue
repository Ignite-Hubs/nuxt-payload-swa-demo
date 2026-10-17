<script setup lang="ts">
import type { Career } from '#careers/types'
import { toExcerpt, toPlainText } from '#careers/rich-text'

const route = useRoute()
const slug = String(route.params.slug)
const { siteName, siteUrl } = useRuntimeConfig().public

const { data: career, error } = await useCareer(slug)

if (error.value || !career.value) {
  // A 404 is a real "not found". Anything else must fail loudly: during
  // `nuxt generate` this aborts the build instead of publishing an error page.
  const notFound = !error.value || error.value.statusCode === 404
  throw createError({
    statusCode: notFound ? 404 : 503,
    statusMessage: notFound ? 'Career path not found' : 'Career path could not be loaded',
    fatal: true,
  })
}

// Live check after mount: flags career paths unpublished since the last build.
const withdrawn = ref(false)
useRevalidate(async () => {
  try {
    career.value = await $fetch<Career>(`/api/careers/${encodeURIComponent(slug)}`)
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 404) withdrawn.value = true
  }
})

const summary = computed(
  () => toExcerpt(career.value?.content, 160) || `Explore the ${career.value?.title} career path on ${siteName}.`,
)

useSeoMeta({
  title: () => career.value?.title ?? 'Career path',
  description: () => summary.value,
  ogTitle: () => career.value?.title,
  ogDescription: () => summary.value,
  ogType: 'article',
})

// schema.org Occupation structured data: describes a kind of work, not a job opening.
useHead(() => ({
  link: siteUrl ? [{ rel: 'canonical', href: `${siteUrl.replace(/\/$/, '')}/careers/${slug}` }] : [],
  script: career.value
    ? [{
        type: 'application/ld+json',
        // Escape "<" so CMS content can never close the script element.
        innerHTML: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Occupation',
          name: career.value.title,
          description: toPlainText(career.value.content) || career.value.title,
        }).replace(/</g, '\\u003c'),
      }]
    : [],
}))
</script>

<template>
  <article v-if="career" class="career">
    <NuxtLink to="/careers" class="back-link">← All career paths</NuxtLink>

    <header class="career__header">
      <p class="eyebrow">Career path</p>
      <h1>{{ career.title }}</h1>
    </header>

    <p v-if="withdrawn" class="notice notice--warning" role="status">
      This career path is no longer listed on {{ siteName }}.
    </p>

    <RichText :value="career.content" />

    <p class="career__next">
      <NuxtLink to="/careers" class="button button--secondary">Explore more career paths</NuxtLink>
    </p>
  </article>
</template>
