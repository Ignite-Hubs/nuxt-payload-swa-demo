<script setup lang="ts">
import type { PaginatedCareers } from '#careers/types'
import { MAX_PAGE_SIZE } from '#careers/payload-client'

// Request as many as the API allows so the whole catalogue is usually one page;
// "Load more" covers anything beyond that.
const PAGE_SIZE = MAX_PAGE_SIZE

const { data, error } = await useCareers(PAGE_SIZE)
const { careers, hasMore, loadMore, loading, failed } = useMoreCareers(data)

useRevalidate(async () => {
  data.value = await $fetch<PaginatedCareers>('/api/careers', { query: { limit: PAGE_SIZE } })
  error.value = undefined
})

useSeoMeta({
  title: 'Career paths',
  description: 'Browse every career path and find out what each role involves.',
})
</script>

<template>
  <h1>Career paths</h1>
  <p v-if="!error" class="lead">
    {{ data.totalDocs }} {{ data.totalDocs === 1 ? 'role' : 'roles' }} to explore. Choose one to learn more.
  </p>

  <p v-if="error" class="notice notice--error" role="alert">Unable to load career paths. Please try again later.</p>
  <p v-else-if="!careers.length" class="notice">No career paths have been published yet.</p>
  <template v-else>
    <CareerList :careers="careers" />
    <div v-if="hasMore" class="load-more">
      <button class="button button--secondary" type="button" :disabled="loading" @click="loadMore">
        {{ loading ? 'Loading…' : 'Load more career paths' }}
      </button>
      <p v-if="failed" class="notice notice--error" role="alert">Couldn't load more career paths.</p>
    </div>
  </template>
</template>
