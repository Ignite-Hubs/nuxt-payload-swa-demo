<script setup lang="ts">
import type { PaginatedCareers } from '#careers/types'

const FEATURED = 6
const { siteName } = useRuntimeConfig().public
const { data, error } = await useCareers(FEATURED)

useRevalidate(async () => {
  data.value = await $fetch<PaginatedCareers>('/api/careers', { query: { limit: FEATURED } })
  error.value = undefined
})

useSeoMeta({
  description: `${siteName}: explore career paths, what each role involves and how to get started.`,
})
</script>

<template>
  <section class="hero">
    <p class="eyebrow">For students</p>
    <h1>Find the career that sparks your future</h1>
    <p class="lead">
      Explore career paths, see what each role really involves, and discover the skills and
      routes that can get you there.
    </p>
    <NuxtLink to="/careers" class="button">Explore all career paths</NuxtLink>
  </section>

  <section aria-labelledby="featured-heading">
    <div class="section-heading">
      <h2 id="featured-heading">Start exploring</h2>
      <NuxtLink v-if="data.totalDocs > data.docs.length" to="/careers">
        See all {{ data.totalDocs }}
      </NuxtLink>
    </div>

    <p v-if="error" class="notice notice--error" role="alert">Career paths could not be loaded.</p>
    <p v-else-if="!data.docs.length" class="notice">No career paths have been published yet.</p>
    <CareerList v-else :careers="data.docs" heading-level="h3" />
  </section>
</template>
