<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const notFound = computed(() => props.error.statusCode === 404)

useSeoMeta({
  title: () => (notFound.value ? 'Page not found' : 'Something went wrong'),
  robots: 'noindex',
})
</script>

<template>
  <NuxtLayout>
    <section class="error-page">
      <p class="eyebrow">Error {{ error.statusCode }}</p>
      <h1>{{ notFound ? 'We couldn’t find that page' : 'Something went wrong' }}</h1>
      <p v-if="notFound">This career path may have been removed or the link may be out of date.</p>
      <p v-else>Please try again in a moment.</p>
      <button class="button" type="button" @click="clearError({ redirect: '/careers' })">
        Browse career paths
      </button>
    </section>
  </NuxtLayout>
</template>
